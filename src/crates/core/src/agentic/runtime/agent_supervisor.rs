use super::agent_mailbox::{AgentMailboxMessage, AgentMailboxStore};
use super::agent_task::{
    AgentTaskConfig, AgentTaskFilter, AgentTaskId, AgentTaskKind, AgentTaskSnapshot,
    AgentTaskStatus, ForkContextMode,
};
use super::agent_task_registry::AgentTaskRegistry;
use super::patch_store::{AgentPatchRecord, AgentPatchStore, PatchStatus};
use super::agent_transcript::{AgentTranscriptEntry, AgentTranscriptStore};
use super::task_events::{AgentTaskEvent, AgentTaskEventKind};
use super::team::{AgentTeam, AgentTeamMemberStatus, AgentTeamStatus, AgentTeamStore};
use super::workspace_binding::WorkspaceIsolation;
use crate::service::git::{GitAddParams, GitDiffParams, GitService};
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Default)]
pub struct AgentTaskExecutionOutput {
    pub summary: String,
    pub transcript_ref: Option<String>,
    pub metadata: HashMap<String, String>,
}

pub type AgentTaskExecutionFuture =
    Pin<Box<dyn Future<Output = OpenHarnessResult<AgentTaskExecutionOutput>> + Send + 'static>>;

pub type AgentTaskExecutor = Arc<
    dyn Fn(AgentTaskConfig, AgentTaskId, CancellationToken) -> AgentTaskExecutionFuture
        + Send
        + Sync,
>;

pub struct AgentTaskSupervisor {
    registry: Arc<AgentTaskRegistry>,
    mailbox_store: Arc<AgentMailboxStore>,
    patch_store: Arc<AgentPatchStore>,
    team_store: Arc<AgentTeamStore>,
    transcript_store: Arc<AgentTranscriptStore>,
    semaphore: Arc<Semaphore>,
}

impl AgentTaskSupervisor {
    pub fn new(max_concurrency: usize, snapshot_file: Option<PathBuf>) -> Self {
        let max_concurrency = max_concurrency.max(1);
        let snapshot_file = snapshot_file.unwrap_or_else(AgentTaskRegistry::default_snapshot_file);

        Self {
            registry: Arc::new(AgentTaskRegistry::new(snapshot_file)),
            mailbox_store: Arc::new(AgentMailboxStore::default()),
            transcript_store: Arc::new(AgentTranscriptStore::default()),
            patch_store: Arc::new(AgentPatchStore::new(Some(
                AgentPatchStore::default_snapshot_file(),
            ))),
            team_store: Arc::new(AgentTeamStore::default()),
            semaphore: Arc::new(Semaphore::new(max_concurrency)),
        }
    }

    pub fn registry(&self) -> Arc<AgentTaskRegistry> {
        Arc::clone(&self.registry)
    }

    pub fn patch_store(&self) -> Arc<AgentPatchStore> {
        Arc::clone(&self.patch_store)
    }

    pub fn mailbox_store(&self) -> Arc<AgentMailboxStore> {
        Arc::clone(&self.mailbox_store)
    }

    pub fn team_store(&self) -> Arc<AgentTeamStore> {
        Arc::clone(&self.team_store)
    }

    pub fn transcript_store(&self) -> Arc<AgentTranscriptStore> {
        Arc::clone(&self.transcript_store)
    }

    fn mailbox_id_for_task(task_id: &AgentTaskId) -> String {
        format!("agtask-mailbox-{}", task_id.as_str())
    }

    fn merge_patch_summary(target: &mut super::patch_store::AgentPatchSummary, source: &super::patch_store::AgentPatchSummary) {
        target.total += source.total;
        target.pending += source.pending;
        target.accepted += source.accepted;
        target.rejected += source.rejected;
        target.applied += source.applied;
        target.conflicted += source.conflicted;
    }

    fn recommend_team_next_step(
        total_members: usize,
        queued: usize,
        running: usize,
        waiting_approval: usize,
        failed: usize,
        cancelled: usize,
        interrupted: usize,
        succeeded: usize,
    ) -> String {
        if failed > 0 {
            return "Review failed members, inspect transcripts, and retry failed tasks with narrower scope.".to_string();
        }
        if waiting_approval > 0 {
            return "Resolve pending approvals to unblock team progress.".to_string();
        }
        if running > 0 || queued > 0 {
            return "Monitor running members and wait for all queued tasks to finish.".to_string();
        }
        if cancelled > 0 || interrupted > 0 {
            return "Investigate cancelled or interrupted members before scheduling follow-up tasks.".to_string();
        }
        if total_members > 0 && succeeded == total_members {
            return "Review patch summary, accept or reject pending patches, then merge accepted changes.".to_string();
        }

        "Inspect member task states and align the next execution wave.".to_string()
    }

    async fn build_team_status(&self, team: AgentTeam) -> OpenHarnessResult<AgentTeamStatus> {
        if team.members.is_empty() {
            return Err(OpenHarnessError::Validation(format!(
                "Agent team {} has no members",
                team.team_id
            )));
        }

        let mut queued = 0usize;
        let mut running = 0usize;
        let mut waiting_approval = 0usize;
        let mut succeeded = 0usize;
        let mut failed = 0usize;
        let mut cancelled = 0usize;
        let mut interrupted = 0usize;
        let mut patch_summary = super::patch_store::AgentPatchSummary::default();
        let mut members = Vec::with_capacity(team.members.len());
        let mut succeeded_members = Vec::new();
        let mut failed_members = Vec::new();
        let mut failed_reasons = Vec::new();

        for member_task_id in &team.members {
            let task_snapshot = self
                .registry
                .query_task(member_task_id)
                .await
                .ok_or_else(|| {
                    OpenHarnessError::NotFound(format!(
                        "Agent team member task not found: {}",
                        member_task_id
                    ))
                })?;

            let member_patch_summary = self.patch_store.summary_by_task(member_task_id).await;
            Self::merge_patch_summary(&mut patch_summary, &member_patch_summary);

            match task_snapshot.status {
                AgentTaskStatus::Queued => queued += 1,
                AgentTaskStatus::Running => running += 1,
                AgentTaskStatus::WaitingApproval => waiting_approval += 1,
                AgentTaskStatus::Succeeded => {
                    succeeded += 1;
                    succeeded_members.push(task_snapshot.task_id.clone());
                }
                AgentTaskStatus::Failed => {
                    failed += 1;
                    failed_members.push(task_snapshot.task_id.clone());
                    if let Some(reason) = task_snapshot.last_error.as_ref() {
                        failed_reasons.push(format!("{}: {}", task_snapshot.task_id, reason));
                    } else {
                        failed_reasons
                            .push(format!("{}: unknown failure reason", task_snapshot.task_id));
                    }
                }
                AgentTaskStatus::Cancelled => cancelled += 1,
                AgentTaskStatus::Interrupted => interrupted += 1,
            }

            members.push(AgentTeamMemberStatus {
                task_id: task_snapshot.task_id.clone(),
                status: task_snapshot.status,
                result_summary: task_snapshot.result_summary.clone(),
                failure_reason: task_snapshot.last_error.clone(),
                patch_summary: member_patch_summary,
            });
        }

        let total_members = members.len();
        let recommended_next_step = Self::recommend_team_next_step(
            total_members,
            queued,
            running,
            waiting_approval,
            failed,
            cancelled,
            interrupted,
            succeeded,
        );

        Ok(AgentTeamStatus {
            team_id: team.team_id,
            name: team.name,
            objective: team.objective,
            total_members,
            queued,
            running,
            waiting_approval,
            succeeded,
            failed,
            cancelled,
            interrupted,
            patch_summary,
            members,
            succeeded_members,
            failed_members,
            failed_reasons,
            recommended_next_step,
        })
    }

    pub async fn upsert_team(&self, team: AgentTeam) {
        self.team_store.upsert(team).await;
    }

    pub async fn send_to_agent_mailbox(
        &self,
        to_task_id: &AgentTaskId,
        content: String,
        from_task_id: Option<AgentTaskId>,
        team_id: Option<String>,
    ) -> OpenHarnessResult<AgentMailboxMessage> {
        if self.registry.query_task(to_task_id).await.is_none() {
            return Err(OpenHarnessError::NotFound(format!(
                "Agent task not found for mailbox delivery: {}",
                to_task_id
            )));
        }

        let mailbox_id = Self::mailbox_id_for_task(to_task_id);
        let message = AgentMailboxMessage::new(content, from_task_id, Some(to_task_id.clone()), team_id);
        Ok(self.mailbox_store.send(&mailbox_id, message).await)
    }

    pub async fn broadcast_to_team_mailbox(
        &self,
        team_id: &str,
        content: String,
        from_task_id: Option<AgentTaskId>,
    ) -> OpenHarnessResult<Vec<AgentMailboxMessage>> {
        let team = self.team_store.get(team_id).await.ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Agent team not found for broadcast: {}", team_id))
        })?;

        let mut delivered = Vec::with_capacity(team.members.len());
        for member_task_id in &team.members {
            let message = self
                .send_to_agent_mailbox(
                    member_task_id,
                    content.clone(),
                    from_task_id.clone(),
                    Some(team_id.to_string()),
                )
                .await?;
            delivered.push(message);
        }

        Ok(delivered)
    }

    pub async fn wait_agent_mailbox_messages(
        &self,
        task_id: &AgentTaskId,
        timeout_ms: Option<u64>,
    ) -> OpenHarnessResult<Vec<AgentMailboxMessage>> {
        if self.registry.query_task(task_id).await.is_none() {
            return Err(OpenHarnessError::NotFound(format!(
                "Agent task not found for mailbox wait: {}",
                task_id
            )));
        }

        let mailbox_id = Self::mailbox_id_for_task(task_id);
        Ok(self
            .mailbox_store
            .wait_and_recv_all(&mailbox_id, timeout_ms)
            .await)
    }

    pub async fn team_status(&self, team_id: &str) -> OpenHarnessResult<AgentTeamStatus> {
        let team = self.team_store.get(team_id).await.ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Agent team not found: {}", team_id))
        })?;

        self.build_team_status(team).await
    }

    pub async fn team_status_from_members(
        &self,
        team_name: String,
        objective: String,
        members: Vec<AgentTaskId>,
    ) -> OpenHarnessResult<AgentTeamStatus> {
        let team = AgentTeam::new(team_name, objective, members);
        self.build_team_status(team).await
    }

    fn is_cancelled_failure(error: &str) -> bool {
        error.to_ascii_lowercase().contains("cancel")
    }

    async fn ensure_task_cancelled_observability(
        registry: &Arc<AgentTaskRegistry>,
        transcript_store: &Arc<AgentTranscriptStore>,
        task_id: &AgentTaskId,
        reason: &str,
    ) -> OpenHarnessResult<()> {
        let has_cancel_event = registry
            .events(task_id)
            .await
            .map(|events| {
                events
                    .iter()
                    .any(|event| matches!(event.kind, AgentTaskEventKind::TaskCancelled))
            })
            .unwrap_or(false);

        if !has_cancel_event {
            registry
                .push_event(AgentTaskEvent::new(
                    task_id.clone(),
                    AgentTaskEventKind::TaskCancelled,
                    Some("Task execution cancelled".to_string()),
                    None,
                ))
                .await?;
        }

        let has_cancelled_failure = transcript_store
            .get(task_id)
            .await
            .map(|transcript| {
                transcript.entries.iter().any(|entry| match entry {
                    AgentTranscriptEntry::Failure { error } => Self::is_cancelled_failure(error),
                    _ => false,
                })
            })
            .unwrap_or(false);

        if !has_cancelled_failure {
            transcript_store
                .append_entry(
                    task_id,
                    AgentTranscriptEntry::Failure {
                        error: reason.to_string(),
                    },
                )
                .await;
        }

        Ok(())
    }

    fn patch_repo_path(config: &AgentTaskConfig) -> PathBuf {
        config
            .workspace_binding
            .worktree_path
            .clone()
            .unwrap_or_else(|| config.workspace_binding.root.clone())
    }

    fn normalize_patch_path_for_git(repo_root: &Path, patch_path: &Path) -> OpenHarnessResult<String> {
        let relative = if patch_path.is_absolute() {
            patch_path.strip_prefix(repo_root).map_err(|_| {
                OpenHarnessError::Validation(format!(
                    "Patch path '{}' is outside task workspace '{}'",
                    patch_path.display(),
                    repo_root.display()
                ))
            })?
        } else {
            patch_path
        };

        if relative.as_os_str().is_empty() {
            return Err(OpenHarnessError::Validation(
                "Patch path cannot be empty".to_string(),
            ));
        }

        if relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(OpenHarnessError::Validation(format!(
                "Patch path '{}' escapes task workspace",
                relative.display()
            )));
        }

        let normalized = relative.to_string_lossy().replace('\\', "/");
        if normalized.trim().is_empty() || normalized == "." {
            return Err(OpenHarnessError::Validation(
                "Patch path cannot be current directory".to_string(),
            ));
        }

        Ok(normalized)
    }

    fn normalize_git_status_path(path: &str) -> String {
        path.trim()
            .trim_start_matches("./")
            .replace('\\', "/")
    }

    async fn resolve_patch_operation_context(
        &self,
        task_id: &AgentTaskId,
        patch_id: &str,
    ) -> OpenHarnessResult<(AgentPatchRecord, PathBuf, String, bool)> {
        let task_snapshot = self.registry.query_task(task_id).await.ok_or_else(|| {
            OpenHarnessError::NotFound(format!(
                "Task not found for patch operation: {}",
                task_id.as_str()
            ))
        })?;

        let patch_record = self
            .patch_store
            .list_by_task(task_id)
            .await
            .into_iter()
            .find(|record| record.patch_id == patch_id)
            .ok_or_else(|| {
                OpenHarnessError::NotFound(format!(
                    "Patch not found for task {}: {}",
                    task_id.as_str(),
                    patch_id
                ))
            })?;

        let repo_path = Self::patch_repo_path(&task_snapshot.config);
        let normalized_path =
            Self::normalize_patch_path_for_git(&repo_path, patch_record.relative_path.as_path())?;

        let is_repository = GitService::is_repository(&repo_path).await.map_err(|error| {
            OpenHarnessError::service(format!(
                "Failed to inspect git repository '{}': {}",
                repo_path.display(),
                error
            ))
        })?;

        Ok((patch_record, repo_path, normalized_path, is_repository))
    }

    async fn emit_patch_operation_event(
        registry: &Arc<AgentTaskRegistry>,
        task_id: &AgentTaskId,
        kind: AgentTaskEventKind,
        message: String,
        data: serde_json::Value,
    ) {
        let _ = registry
            .push_event(AgentTaskEvent::new(
                task_id.clone(),
                kind,
                Some(message),
                Some(data),
            ))
            .await;
    }

    pub async fn apply_task_patch(
        &self,
        task_id: &AgentTaskId,
        patch_id: &str,
        target_status: PatchStatus,
    ) -> OpenHarnessResult<AgentPatchRecord> {
        if !matches!(target_status, PatchStatus::Accepted | PatchStatus::Applied) {
            return Err(OpenHarnessError::Validation(format!(
                "apply_task_patch requires target status accepted/applied, got {:?}",
                target_status
            )));
        }

        let (patch_record, repo_path, normalized_path, is_repository) = self
            .resolve_patch_operation_context(task_id, patch_id)
            .await?;

        if !is_repository {
            return self
                .patch_store
                .set_status(task_id, patch_id, target_status)
                .await;
        }

        let add_result = GitService::add_files(
            &repo_path,
            GitAddParams {
                files: vec![normalized_path.clone()],
                all: Some(false),
                update: Some(false),
            },
        )
        .await;

        match add_result {
            Ok(_) => {
                let updated = self
                    .patch_store
                    .set_status(task_id, patch_id, target_status)
                    .await?;

                self.transcript_store
                    .append_entry(
                        task_id,
                        AgentTranscriptEntry::PatchRecord {
                            patch_id: patch_id.to_string(),
                            summary: format!(
                                "Patch {} staged with git add {}",
                                patch_id, normalized_path
                            ),
                        },
                    )
                    .await;

                Self::emit_patch_operation_event(
                    &self.registry,
                    task_id,
                    AgentTaskEventKind::ToolCallCompleted,
                    format!("Patch {} applied", patch_id),
                    serde_json::json!({
                        "patch_id": patch_id,
                        "patch_status": updated.status,
                        "operation": "apply",
                        "path": normalized_path,
                        "repository_path": repo_path,
                    }),
                )
                .await;

                Ok(updated)
            }
            Err(error) => {
                let _ = self
                    .patch_store
                    .set_status(task_id, patch_id, PatchStatus::Conflicted)
                    .await;

                Self::emit_patch_operation_event(
                    &self.registry,
                    task_id,
                    AgentTaskEventKind::ToolCallFailed,
                    format!("Patch {} apply failed", patch_id),
                    serde_json::json!({
                        "patch_id": patch_id,
                        "operation": "apply",
                        "path": normalized_path,
                        "error": error.to_string(),
                    }),
                )
                .await;

                Err(OpenHarnessError::service(format!(
                    "Failed to apply patch {} for task {} (source path: {}): {}",
                    patch_id,
                    task_id.as_str(),
                    patch_record.relative_path.display(),
                    error
                )))
            }
        }
    }

    async fn remove_untracked_patch_path(
        repo_path: &Path,
        relative_path: &str,
    ) -> OpenHarnessResult<()> {
        let target_path = repo_path.join(relative_path);
        if !target_path.exists() {
            return Ok(());
        }

        if target_path.is_dir() {
            tokio::fs::remove_dir_all(&target_path)
                .await
                .map_err(|error| {
                    OpenHarnessError::service(format!(
                        "Failed to remove untracked directory '{}': {}",
                        target_path.display(),
                        error
                    ))
                })?;
        } else {
            tokio::fs::remove_file(&target_path)
                .await
                .map_err(|error| {
                    OpenHarnessError::service(format!(
                        "Failed to remove untracked file '{}': {}",
                        target_path.display(),
                        error
                    ))
                })?;
        }

        Ok(())
    }

    pub async fn reject_task_patch_with_rollback(
        &self,
        task_id: &AgentTaskId,
        patch_id: &str,
    ) -> OpenHarnessResult<AgentPatchRecord> {
        let (_patch_record, repo_path, normalized_path, is_repository) = self
            .resolve_patch_operation_context(task_id, patch_id)
            .await?;

        if !is_repository {
            return self
                .patch_store
                .set_status(task_id, patch_id, PatchStatus::Rejected)
                .await;
        }

        let normalized_path = Self::normalize_git_status_path(&normalized_path);
        let tracked_in_head = GitService::get_file_content(&repo_path, &normalized_path, Some("HEAD"))
            .await
            .is_ok();

        let rollback_result: OpenHarnessResult<()> = if !tracked_in_head {
            Self::remove_untracked_patch_path(&repo_path, &normalized_path).await
        } else {
            let files = vec![normalized_path.clone()];

            let _ = GitService::reset_files(&repo_path, &files, true).await;
            GitService::reset_files(&repo_path, &files, false)
                .await
                .map(|_| ())
                .map_err(|error| {
                    OpenHarnessError::service(format!(
                        "Failed to rollback patch {} for task {}: {}",
                        patch_id,
                        task_id.as_str(),
                        error
                    ))
                })
        };

        if let Err(error) = rollback_result {
            let _ = self
                .patch_store
                .set_status(task_id, patch_id, PatchStatus::Conflicted)
                .await;

            Self::emit_patch_operation_event(
                &self.registry,
                task_id,
                AgentTaskEventKind::ToolCallFailed,
                format!("Patch {} rollback failed", patch_id),
                serde_json::json!({
                    "patch_id": patch_id,
                    "operation": "rollback",
                    "path": normalized_path,
                    "error": error.to_string(),
                }),
            )
            .await;

            return Err(error);
        }

        let updated = self
            .patch_store
            .set_status(task_id, patch_id, PatchStatus::Rejected)
            .await?;

        self.transcript_store
            .append_entry(
                task_id,
                AgentTranscriptEntry::PatchRecord {
                    patch_id: patch_id.to_string(),
                    summary: format!("Patch {} rolled back at {}", patch_id, normalized_path),
                },
            )
            .await;

        Self::emit_patch_operation_event(
            &self.registry,
            task_id,
            AgentTaskEventKind::ToolCallCompleted,
            format!("Patch {} rejected and rolled back", patch_id),
            serde_json::json!({
                "patch_id": patch_id,
                "patch_status": updated.status,
                "operation": "rollback",
                "path": normalized_path,
                "repository_path": repo_path,
            }),
        )
        .await;

        Ok(updated)
    }

    pub async fn merge_task_worktree_branch(
        &self,
        task_id: &AgentTaskId,
    ) -> OpenHarnessResult<Vec<AgentPatchRecord>> {
        let task_snapshot = self.registry.query_task(task_id).await.ok_or_else(|| {
            OpenHarnessError::NotFound(format!(
                "Task not found for merge operation: {}",
                task_id.as_str()
            ))
        })?;

        if !matches!(
            task_snapshot.config.workspace_binding.isolation,
            WorkspaceIsolation::GitWorktree
        ) {
            return Err(OpenHarnessError::Validation(format!(
                "Task {} is not using git worktree isolation",
                task_id.as_str()
            )));
        }

        let branch_name = task_snapshot
            .config
            .workspace_binding
            .branch_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                OpenHarnessError::Validation(format!(
                    "Task {} does not provide a worktree branch name",
                    task_id.as_str()
                ))
            })?
            .to_string();

        let repo_path = task_snapshot.config.workspace_binding.root.clone();
        let is_repository = GitService::is_repository(&repo_path).await.map_err(|error| {
            OpenHarnessError::service(format!(
                "Failed to inspect repository '{}': {}",
                repo_path.display(),
                error
            ))
        })?;
        if !is_repository {
            return Err(OpenHarnessError::Validation(format!(
                "Task {} root '{}' is not a git repository",
                task_id.as_str(),
                repo_path.display()
            )));
        }

        let output = Command::new("git")
            .arg("-c")
            .arg("user.name=OpenHarness Agent")
            .arg("-c")
            .arg("user.email=openharness@example.com")
            .arg("merge")
            .arg("--no-ff")
            .arg("--no-edit")
            .arg(&branch_name)
            .current_dir(&repo_path)
            .output()
            .await
            .map_err(|error| {
                OpenHarnessError::service(format!(
                    "Failed to run git merge for task {}: {}",
                    task_id.as_str(),
                    error
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let abort_detail = match Command::new("git")
                .arg("merge")
                .arg("--abort")
                .current_dir(&repo_path)
                .output()
                .await
            {
                Ok(abort_output) if abort_output.status.success() => {
                    Some("merge abort succeeded".to_string())
                }
                Ok(abort_output) => {
                    let abort_stderr = String::from_utf8_lossy(&abort_output.stderr)
                        .trim()
                        .to_string();
                    Some(format!("merge abort failed: {}", abort_stderr))
                }
                Err(error) => {
                    Some(format!("merge abort failed to execute: {}", error))
                }
            };

            Self::emit_patch_operation_event(
                &self.registry,
                task_id,
                AgentTaskEventKind::ToolCallFailed,
                format!("Task branch merge failed: {}", branch_name),
                serde_json::json!({
                    "task_id": task_id,
                    "operation": "merge",
                    "branch_name": branch_name,
                    "repository_path": repo_path,
                    "error": stderr,
                    "merge_abort": abort_detail,
                }),
            )
            .await;

            return Err(OpenHarnessError::service(format!(
                "Failed to merge task branch '{}' for task {}: {}{}",
                branch_name,
                task_id.as_str(),
                stderr,
                abort_detail
                    .as_ref()
                    .map(|detail| format!(" ({})", detail))
                    .unwrap_or_default()
            )));
        }

        let current_records = self.patch_store.list_by_task(task_id).await;
        let mut updated_records = Vec::with_capacity(current_records.len());
        for record in current_records {
            let updated = if matches!(record.status, PatchStatus::Rejected | PatchStatus::Conflicted)
            {
                record
            } else if matches!(record.status, PatchStatus::Applied) {
                record
            } else {
                self.patch_store
                    .set_status(task_id, &record.patch_id, PatchStatus::Applied)
                    .await?
            };
            updated_records.push(updated);
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        self.transcript_store
            .append_entry(
                task_id,
                AgentTranscriptEntry::PatchRecord {
                    patch_id: format!("task-merge-{}", task_id.as_str()),
                    summary: format!(
                        "Merged worktree branch '{}' into repository root '{}'",
                        branch_name,
                        repo_path.display()
                    ),
                },
            )
            .await;

        Self::emit_patch_operation_event(
            &self.registry,
            task_id,
            AgentTaskEventKind::ToolCallCompleted,
            format!("Task branch merged: {}", branch_name),
            serde_json::json!({
                "task_id": task_id,
                "operation": "merge",
                "branch_name": branch_name,
                "repository_path": repo_path,
                "patch_count": updated_records.len(),
                "merge_output": stdout,
            }),
        )
        .await;

        Ok(updated_records)
    }

    async fn capture_worktree_patch_summary(
        registry: &Arc<AgentTaskRegistry>,
        patch_store: &Arc<AgentPatchStore>,
        transcript_store: &Arc<AgentTranscriptStore>,
        task_id: &AgentTaskId,
        config: &AgentTaskConfig,
    ) -> OpenHarnessResult<()> {
        if !matches!(
            config.workspace_binding.isolation,
            WorkspaceIsolation::GitWorktree
        ) {
            return Ok(());
        }

        let Some(worktree_path) = config.workspace_binding.worktree_path.as_ref() else {
            return Err(OpenHarnessError::service(format!(
                "Task {} declares git worktree isolation without worktree_path",
                task_id
            )));
        };

        let status = GitService::get_status(worktree_path)
            .await
            .map_err(|error| {
                OpenHarnessError::service(format!(
                    "Failed to inspect agent worktree '{}': {}",
                    worktree_path.display(),
                    error
                ))
            })?;

        let mut changed_files = Vec::new();
        changed_files.extend(status.staged.iter().map(|file| file.path.clone()));
        changed_files.extend(status.unstaged.iter().map(|file| file.path.clone()));
        changed_files.extend(status.untracked.iter().cloned());
        changed_files.sort();
        changed_files.dedup();

        let existing_paths: HashSet<String> = patch_store
            .list_by_task(task_id)
            .await
            .into_iter()
            .map(|record| record.relative_path.to_string_lossy().replace('\\', "/"))
            .collect();
        if !existing_paths.is_empty() {
            changed_files.retain(|path| {
                let normalized = path.replace('\\', "/");
                !existing_paths.contains(&normalized)
            });
        }

        if changed_files.is_empty() {
            return Ok(());
        }

        let diff_stat = GitService::get_diff(
            worktree_path,
            &GitDiffParams {
                source: None,
                target: None,
                files: None,
                staged: None,
                stat: Some(true),
            },
        )
        .await
        .unwrap_or_else(|error| format!("Failed to collect diff stat: {}", error));

        let diff_preview = GitService::get_diff(
            worktree_path,
            &GitDiffParams {
                source: None,
                target: None,
                files: None,
                staged: None,
                stat: Some(false),
            },
        )
        .await
        .unwrap_or_else(|error| format!("Failed to collect diff preview: {}", error));

        let preview_limit = 12000usize;
        let truncated_preview = if diff_preview.len() > preview_limit {
            format!(
                "{}\n\n... diff preview truncated after {} bytes ...",
                &diff_preview[..preview_limit],
                preview_limit
            )
        } else {
            diff_preview
        };

        let branch_name = config.workspace_binding.branch_name.clone();
        let summary = format!(
            "Agent worktree produced {} changed file(s) on branch {}:\n{}",
            changed_files.len(),
            branch_name.as_deref().unwrap_or("<unknown>"),
            diff_stat.trim()
        );

        let patch_group_id = uuid::Uuid::new_v4();
        let patch_records = changed_files
            .iter()
            .enumerate()
            .map(|(index, changed_file)| AgentPatchRecord {
                patch_id: format!("patch-{}-{}", patch_group_id, index + 1),
                task_id: task_id.clone(),
                tool_call_id: "task-finalize-worktree".to_string(),
                relative_path: PathBuf::from(changed_file),
                diff_preview: truncated_preview.clone(),
                full_diff_ref: None,
                status: PatchStatus::Pending,
            })
            .collect::<Vec<_>>();

        patch_store.upsert_many(patch_records.clone()).await;

        let patch_ids = patch_records
            .iter()
            .map(|record| record.patch_id.clone())
            .collect::<Vec<_>>();
        let primary_patch_id = patch_ids
            .first()
            .cloned()
            .unwrap_or_else(|| format!("patch-{}", patch_group_id));

        transcript_store
            .append_entry(
                task_id,
                AgentTranscriptEntry::PatchRecord {
                    patch_id: primary_patch_id.clone(),
                    summary: summary.clone(),
                },
            )
            .await;

        registry
            .push_event(AgentTaskEvent::new(
                task_id.clone(),
                AgentTaskEventKind::PatchReady,
                Some("Agent worktree patch ready for review".to_string()),
                Some(serde_json::json!({
                    "patch_id": primary_patch_id,
                    "patch_ids": patch_ids,
                    "patch_count": patch_records.len(),
                    "task_id": task_id,
                    "isolation": "git_worktree",
                    "branch_name": branch_name,
                    "worktree_path": worktree_path,
                    "changed_files": changed_files,
                    "diff_stat": diff_stat,
                    "diff_preview": truncated_preview,
                    "merge_risk": "unknown",
                })),
            ))
            .await?;

        Ok(())
    }

    pub async fn spawn_task(
        &self,
        config: AgentTaskConfig,
        kind: AgentTaskKind,
        executor: AgentTaskExecutor,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let snapshot = self.registry.create_task(config.clone(), kind).await;
        let task_id = snapshot.task_id.clone();

        self.transcript_store
            .start_transcript(&task_id, config.prompt.clone())
            .await;

        if matches!(config.fork_context, ForkContextMode::InheritParent) {
            let inherit_hint = config
                .parent_task_id
                .as_ref()
                .map(|id| id.to_string())
                .unwrap_or_else(|| "session-context".to_string());
            self.transcript_store
                .append_entry(
                    &task_id,
                    AgentTranscriptEntry::InheritedContext {
                        summary: format!("Inherited context from {}", inherit_hint),
                    },
                )
                .await;
        }

        let cancel_token = CancellationToken::new();
        self.registry
            .set_cancel_token(&task_id, cancel_token.clone())
            .await;

        let registry = Arc::clone(&self.registry);
        let patch_store = Arc::clone(&self.patch_store);
        let transcript_store = Arc::clone(&self.transcript_store);
        let semaphore = Arc::clone(&self.semaphore);
        let task_config = config.clone();
        let task_id_clone = task_id.clone();

        tokio::spawn(async move {
            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    let _ = registry
                        .mark_failed(
                            &task_id_clone,
                            "Task semaphore is closed; cannot execute task".to_string(),
                        )
                        .await;
                    let _ = registry.persist_snapshot(&task_id_clone).await;
                    return;
                }
            };

            let running_snapshot = match registry.mark_running(&task_id_clone).await {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    let _ = registry.persist_snapshot(&task_id_clone).await;
                    return;
                }
            };

            if !matches!(running_snapshot.status, AgentTaskStatus::Running) {
                let _ = registry.persist_snapshot(&task_id_clone).await;
                return;
            }

            let _ = registry
                .push_event(AgentTaskEvent::new(
                    task_id_clone.clone(),
                    AgentTaskEventKind::TaskStarted,
                    Some("Task execution started".to_string()),
                    None,
                ))
                .await;

            let result = executor(task_config, task_id_clone.clone(), cancel_token.clone()).await;

            match result {
                Ok(output) => {
                    let snapshot = match registry
                        .mark_succeeded(
                            &task_id_clone,
                            output.summary.clone(),
                            output.transcript_ref.clone(),
                        )
                        .await
                    {
                        Ok(snapshot) => snapshot,
                        Err(_) => {
                            let _ = registry.persist_snapshot(&task_id_clone).await;
                            return;
                        }
                    };

                    if matches!(snapshot.status, AgentTaskStatus::Succeeded) {
                        transcript_store
                            .append_entry(
                                &task_id_clone,
                                AgentTranscriptEntry::FinalResult {
                                    summary: output.summary.clone(),
                                },
                            )
                            .await;

                        if let Err(error) = Self::capture_worktree_patch_summary(
                            &registry,
                            &patch_store,
                            &transcript_store,
                            &task_id_clone,
                            &config,
                        )
                        .await
                        {
                            let _ = registry
                                .push_event(AgentTaskEvent::new(
                                    task_id_clone.clone(),
                                    AgentTaskEventKind::ToolCallFailed,
                                    Some("Failed to collect worktree patch summary".to_string()),
                                    Some(serde_json::json!({
                                        "error": error.to_string(),
                                    })),
                                ))
                                .await;
                        }

                        let _ = registry
                            .push_event(AgentTaskEvent::new(
                                task_id_clone.clone(),
                                AgentTaskEventKind::TaskSucceeded,
                                Some("Task execution succeeded".to_string()),
                                None,
                            ))
                            .await;
                    }
                }
                Err(error) => {
                    if matches!(error, OpenHarnessError::Cancelled(_)) {
                        let error_text = error.to_string();
                        let snapshot = match registry.mark_cancelled(&task_id_clone, error_text.clone()).await {
                            Ok(snapshot) => snapshot,
                            Err(_) => {
                                let _ = registry.persist_snapshot(&task_id_clone).await;
                                return;
                            }
                        };

                        if matches!(snapshot.status, AgentTaskStatus::Cancelled) {
                            let _ = Self::ensure_task_cancelled_observability(
                                &registry,
                                &transcript_store,
                                &task_id_clone,
                                &error_text,
                            )
                            .await;
                        }
                    } else {
                        let error_text = error.to_string();
                        let snapshot = match registry
                            .mark_failed(&task_id_clone, error_text.clone())
                            .await
                        {
                            Ok(snapshot) => snapshot,
                            Err(_) => {
                                let _ = registry.persist_snapshot(&task_id_clone).await;
                                return;
                            }
                        };

                        if matches!(snapshot.status, AgentTaskStatus::Failed) {
                            transcript_store
                                .append_entry(
                                    &task_id_clone,
                                    AgentTranscriptEntry::Failure { error: error_text },
                                )
                                .await;

                            let _ = registry
                                .push_event(AgentTaskEvent::new(
                                    task_id_clone.clone(),
                                    AgentTaskEventKind::TaskFailed,
                                    Some("Task execution failed".to_string()),
                                    None,
                                ))
                                .await;
                        }
                    }
                }
            }

            let _ = registry.persist_snapshot(&task_id_clone).await;
            let _ = registry.notify_completion(&task_id_clone).await;
        });

        Ok(snapshot)
    }

    pub async fn wait_task(&self, task_id: &AgentTaskId) -> OpenHarnessResult<AgentTaskSnapshot> {
        self.registry.wait_for_terminal(task_id).await
    }

    pub async fn cancel_task(
        &self,
        task_id: &AgentTaskId,
        reason: String,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let snapshot = self.registry.cancel_task(task_id, reason.clone()).await?;

        if matches!(snapshot.status, AgentTaskStatus::Cancelled) {
            Self::ensure_task_cancelled_observability(
                &self.registry,
                &self.transcript_store,
                task_id,
                &reason,
            )
            .await?;
        }

        self.registry.persist_snapshot(task_id).await?;
        Ok(snapshot)
    }

    pub async fn query_task(&self, task_id: &AgentTaskId) -> Option<AgentTaskSnapshot> {
        self.registry.query_task(task_id).await
    }

    pub async fn list_tasks(&self, filter: Option<&AgentTaskFilter>) -> Vec<AgentTaskSnapshot> {
        self.registry.list_tasks(filter).await
    }

    pub async fn events(&self, task_id: &AgentTaskId) -> OpenHarnessResult<Vec<AgentTaskEvent>> {
        self.registry.events(task_id).await
    }

    pub async fn recover_interrupted_tasks(&self) -> OpenHarnessResult<Vec<AgentTaskSnapshot>> {
        self.registry.recover_interrupted_tasks().await
    }

    pub async fn count_running_tasks(&self) -> usize {
        self.registry
            .list_tasks(Some(&AgentTaskFilter {
                statuses: Some(vec![
                    AgentTaskStatus::Queued,
                    AgentTaskStatus::Running,
                    AgentTaskStatus::WaitingApproval,
                ]),
                ..Default::default()
            }))
            .await
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::runtime::{AgentTeam, CleanupPolicy, WorkspaceBinding, WorkspaceIsolation};
    use git2::{Repository, Signature};
    use std::path::Path;
    use std::process::Command as StdCommand;

    fn build_task_config() -> AgentTaskConfig {
        let root = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-{}",
            uuid::Uuid::new_v4()
        ));

        AgentTaskConfig {
            agent_name: "Explore".to_string(),
            prompt: "collect context".to_string(),
            parent_task_id: None,
            session_id: Some("session-test".to_string()),
            workspace_binding: WorkspaceBinding {
                isolation: WorkspaceIsolation::None,
                root: root.clone(),
                working_dir: root,
                branch_name: None,
                worktree_path: None,
                cleanup_policy: CleanupPolicy::Keep,
            },
            fork_context: ForkContextMode::Fresh,
            max_turns: Some(1),
            allowed_tools: Vec::new(),
            model: None,
        }
    }

    fn build_git_worktree_task_config(worktree_path: PathBuf) -> AgentTaskConfig {
        AgentTaskConfig {
            agent_name: "Explore".to_string(),
            prompt: "collect context".to_string(),
            parent_task_id: None,
            session_id: Some("session-test".to_string()),
            workspace_binding: WorkspaceBinding {
                isolation: WorkspaceIsolation::GitWorktree,
                root: worktree_path.clone(),
                working_dir: worktree_path.clone(),
                branch_name: Some("main".to_string()),
                worktree_path: Some(worktree_path),
                cleanup_policy: CleanupPolicy::Keep,
            },
            fork_context: ForkContextMode::Fresh,
            max_turns: Some(1),
            allowed_tools: Vec::new(),
            model: None,
        }
    }

    fn init_temp_git_repo_with_untracked_file(file_name: &str) -> PathBuf {
        let worktree_path = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-worktree-{}",
            uuid::Uuid::new_v4()
        ));

        std::fs::create_dir_all(&worktree_path).unwrap();
        let repository = Repository::init(&worktree_path).unwrap();
        std::fs::write(worktree_path.join(file_name), "draft content").unwrap();
        drop(repository);

        worktree_path
    }

    fn init_temp_git_repo_with_tracked_modification(
        file_name: &str,
        initial_content: &str,
        modified_content: &str,
    ) -> PathBuf {
        let repo_path = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-tracked-{}",
            uuid::Uuid::new_v4()
        ));

        std::fs::create_dir_all(&repo_path).unwrap();
        let repository = Repository::init(&repo_path).unwrap();

        std::fs::write(repo_path.join(file_name), initial_content).unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new(file_name)).unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("OpenHarness", "openharness@example.com").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial commit", &tree, &[])
            .unwrap();

        std::fs::write(repo_path.join(file_name), modified_content).unwrap();
        repo_path
    }

    fn run_git_sync(repo_path: &Path, args: &[&str]) -> String {
        let output = StdCommand::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );

        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn init_temp_git_repo_with_feature_branch(
        file_name: &str,
        feature_branch: &str,
        base_content: &str,
        feature_content: &str,
    ) -> (PathBuf, String) {
        let repo_path = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-merge-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&repo_path).unwrap();

        run_git_sync(repo_path.as_path(), &["init"]);
        run_git_sync(
            repo_path.as_path(),
            &["config", "user.name", "OpenHarness Test"],
        );
        run_git_sync(
            repo_path.as_path(),
            &["config", "user.email", "openharness@example.com"],
        );

        std::fs::write(repo_path.join(file_name), base_content).unwrap();
        run_git_sync(repo_path.as_path(), &["add", file_name]);
        run_git_sync(repo_path.as_path(), &["commit", "-m", "base commit"]);

        let base_branch = run_git_sync(repo_path.as_path(), &["rev-parse", "--abbrev-ref", "HEAD"]);
        run_git_sync(repo_path.as_path(), &["checkout", "-b", feature_branch]);

        std::fs::write(repo_path.join(file_name), feature_content).unwrap();
        run_git_sync(repo_path.as_path(), &["add", file_name]);
        run_git_sync(repo_path.as_path(), &["commit", "-m", "feature commit"]);
        run_git_sync(repo_path.as_path(), &["checkout", &base_branch]);

        (repo_path, feature_branch.to_string())
    }

    fn init_temp_git_repo_with_conflicting_feature_branch(
        file_name: &str,
        feature_branch: &str,
        base_content: &str,
        feature_content: &str,
        main_content: &str,
    ) -> (PathBuf, String) {
        let repo_path = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-merge-conflict-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&repo_path).unwrap();

        run_git_sync(repo_path.as_path(), &["init"]);
        run_git_sync(
            repo_path.as_path(),
            &["config", "user.name", "OpenHarness Test"],
        );
        run_git_sync(
            repo_path.as_path(),
            &["config", "user.email", "openharness@example.com"],
        );

        std::fs::write(repo_path.join(file_name), base_content).unwrap();
        run_git_sync(repo_path.as_path(), &["add", file_name]);
        run_git_sync(repo_path.as_path(), &["commit", "-m", "base commit"]);

        let base_branch = run_git_sync(repo_path.as_path(), &["rev-parse", "--abbrev-ref", "HEAD"]);
        run_git_sync(repo_path.as_path(), &["checkout", "-b", feature_branch]);
        std::fs::write(repo_path.join(file_name), feature_content).unwrap();
        run_git_sync(repo_path.as_path(), &["add", file_name]);
        run_git_sync(repo_path.as_path(), &["commit", "-m", "feature commit"]);

        run_git_sync(repo_path.as_path(), &["checkout", &base_branch]);
        std::fs::write(repo_path.join(file_name), main_content).unwrap();
        run_git_sync(repo_path.as_path(), &["add", file_name]);
        run_git_sync(repo_path.as_path(), &["commit", "-m", "main commit"]);

        (repo_path, feature_branch.to_string())
    }

    fn build_patch_record(task_id: &AgentTaskId, patch_id: &str, relative_path: &str) -> AgentPatchRecord {
        AgentPatchRecord {
            patch_id: patch_id.to_string(),
            task_id: task_id.clone(),
            tool_call_id: "tool-call-test".to_string(),
            relative_path: PathBuf::from(relative_path),
            diff_preview: "diff preview".to_string(),
            full_diff_ref: None,
            status: PatchStatus::Pending,
        }
    }

    fn status_contains_path(paths: &[String], target: &str) -> bool {
        let target = target.replace('\\', "/");
        paths
            .iter()
            .map(|path| path.replace('\\', "/"))
            .any(|path| path == target)
    }

    #[tokio::test]
    async fn apply_task_patch_stages_file_and_updates_status() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-apply-patch-{}.json",
            uuid::Uuid::new_v4()
        ));
        let repo_path = init_temp_git_repo_with_untracked_file("notes.txt");
        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));

        let config = build_git_worktree_task_config(repo_path.clone());
        let snapshot = supervisor
            .registry()
            .create_task(config, AgentTaskKind::Background)
            .await;

        supervisor
            .patch_store()
            .upsert_patch(build_patch_record(&snapshot.task_id, "patch-apply-1", "notes.txt"))
            .await;

        let updated = supervisor
            .apply_task_patch(&snapshot.task_id, "patch-apply-1", PatchStatus::Accepted)
            .await
            .unwrap();
        assert_eq!(updated.status, PatchStatus::Accepted);

        let status = GitService::get_status(&repo_path).await.unwrap();
        let staged_paths = status
            .staged
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        assert!(status_contains_path(&staged_paths, "notes.txt"));

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(repo_path).await;
    }

    #[tokio::test]
    async fn reject_task_patch_rolls_back_tracked_changes_and_updates_status() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-reject-patch-{}.json",
            uuid::Uuid::new_v4()
        ));
        let repo_path = init_temp_git_repo_with_tracked_modification(
            "tracked.txt",
            "initial content\n",
            "modified content\n",
        );
        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));

        let config = build_git_worktree_task_config(repo_path.clone());
        let snapshot = supervisor
            .registry()
            .create_task(config, AgentTaskKind::Background)
            .await;

        supervisor
            .patch_store()
            .upsert_patch(build_patch_record(
                &snapshot.task_id,
                "patch-reject-1",
                "tracked.txt",
            ))
            .await;

        let updated = supervisor
            .reject_task_patch_with_rollback(&snapshot.task_id, "patch-reject-1")
            .await
            .unwrap();
        assert_eq!(updated.status, PatchStatus::Rejected);

        let file_content = tokio::fs::read_to_string(repo_path.join("tracked.txt"))
            .await
            .unwrap();
        assert_eq!(file_content.replace("\r\n", "\n"), "initial content\n");

        let status = GitService::get_status(&repo_path).await.unwrap();
        let unstaged_paths = status
            .unstaged
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        assert!(!status_contains_path(&unstaged_paths, "tracked.txt"));

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(repo_path).await;
    }

    #[tokio::test]
    async fn merge_task_worktree_branch_updates_patch_records_to_applied() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-merge-patch-{}.json",
            uuid::Uuid::new_v4()
        ));
        let (repo_path, feature_branch) = init_temp_git_repo_with_feature_branch(
            "README.md",
            "feature/agent-task-merge",
            "base\n",
            "feature\n",
        );

        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));
        let config = AgentTaskConfig {
            agent_name: "Explore".to_string(),
            prompt: "merge task branch".to_string(),
            parent_task_id: None,
            session_id: Some("session-test".to_string()),
            workspace_binding: WorkspaceBinding {
                isolation: WorkspaceIsolation::GitWorktree,
                root: repo_path.clone(),
                working_dir: repo_path.clone(),
                branch_name: Some(feature_branch.clone()),
                worktree_path: Some(repo_path.clone()),
                cleanup_policy: CleanupPolicy::Keep,
            },
            fork_context: ForkContextMode::Fresh,
            max_turns: Some(1),
            allowed_tools: Vec::new(),
            model: None,
        };

        let snapshot = supervisor
            .registry()
            .create_task(config, AgentTaskKind::Background)
            .await;

        supervisor
            .patch_store()
            .upsert_many(vec![
                AgentPatchRecord {
                    status: PatchStatus::Accepted,
                    ..build_patch_record(&snapshot.task_id, "patch-merge-1", "README.md")
                },
                AgentPatchRecord {
                    status: PatchStatus::Pending,
                    ..build_patch_record(&snapshot.task_id, "patch-merge-2", "README.md")
                },
            ])
            .await;

        let merged_records = supervisor
            .merge_task_worktree_branch(&snapshot.task_id)
            .await
            .unwrap();

        assert_eq!(merged_records.len(), 2);
        assert!(merged_records
            .iter()
            .all(|record| matches!(record.status, PatchStatus::Applied)));

        let readme = tokio::fs::read_to_string(repo_path.join("README.md"))
            .await
            .unwrap();
        assert_eq!(readme.replace("\r\n", "\n"), "feature\n");

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(repo_path).await;
    }

    #[tokio::test]
    async fn merge_task_worktree_branch_conflict_aborts_and_keeps_patch_status() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-merge-conflict-patch-{}.json",
            uuid::Uuid::new_v4()
        ));
        let (repo_path, feature_branch) = init_temp_git_repo_with_conflicting_feature_branch(
            "README.md",
            "feature/agent-task-conflict",
            "base\n",
            "feature change\n",
            "main change\n",
        );

        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));
        let config = AgentTaskConfig {
            agent_name: "Explore".to_string(),
            prompt: "merge task branch with conflict".to_string(),
            parent_task_id: None,
            session_id: Some("session-test".to_string()),
            workspace_binding: WorkspaceBinding {
                isolation: WorkspaceIsolation::GitWorktree,
                root: repo_path.clone(),
                working_dir: repo_path.clone(),
                branch_name: Some(feature_branch.clone()),
                worktree_path: Some(repo_path.clone()),
                cleanup_policy: CleanupPolicy::Keep,
            },
            fork_context: ForkContextMode::Fresh,
            max_turns: Some(1),
            allowed_tools: Vec::new(),
            model: None,
        };

        let snapshot = supervisor
            .registry()
            .create_task(config, AgentTaskKind::Background)
            .await;

        supervisor
            .patch_store()
            .upsert_patch(AgentPatchRecord {
                status: PatchStatus::Accepted,
                ..build_patch_record(&snapshot.task_id, "patch-conflict-1", "README.md")
            })
            .await;

        let merge_result = supervisor.merge_task_worktree_branch(&snapshot.task_id).await;
        assert!(merge_result.is_err());

        let status = GitService::get_status(&repo_path).await.unwrap();
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert!(status.untracked.is_empty());

        let merge_head = repo_path.join(".git").join("MERGE_HEAD");
        assert!(!merge_head.exists());

        let patches = supervisor.patch_store().list_by_task(&snapshot.task_id).await;
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].status, PatchStatus::Accepted);

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(repo_path).await;
    }

    #[tokio::test]
    async fn cancelled_executor_records_task_cancelled_observability() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-snapshot-{}.json",
            uuid::Uuid::new_v4()
        ));
        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));

        let executor: AgentTaskExecutor = Arc::new(|_, _, _| {
            Box::pin(async {
                Err(OpenHarnessError::Cancelled(
                    "execution cancelled from executor".to_string(),
                ))
            })
        });

        let snapshot = supervisor
            .spawn_task(build_task_config(), AgentTaskKind::Background, executor)
            .await
            .unwrap();

        let terminal = supervisor.wait_task(&snapshot.task_id).await.unwrap();
        assert_eq!(terminal.status, AgentTaskStatus::Cancelled);

        let events = supervisor.events(&snapshot.task_id).await.unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event.kind, AgentTaskEventKind::TaskCancelled)));

        let transcript = supervisor
            .transcript_store()
            .get(&snapshot.task_id)
            .await
            .unwrap();
        assert!(transcript.entries.iter().any(|entry| {
            matches!(
                entry,
                AgentTranscriptEntry::Failure { error }
                    if error.to_ascii_lowercase().contains("cancel")
            )
        }));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn capture_worktree_patch_summary_persists_patch_and_emits_patch_ready() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-snapshot-{}.json",
            uuid::Uuid::new_v4()
        ));
        let worktree_path = init_temp_git_repo_with_untracked_file("notes.txt");

        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let patch_store = Arc::new(AgentPatchStore::default());
        let transcript_store = Arc::new(AgentTranscriptStore::default());
        let config = build_git_worktree_task_config(worktree_path.clone());
        let snapshot = registry
            .create_task(config.clone(), AgentTaskKind::Background)
            .await;

        transcript_store
            .start_transcript(&snapshot.task_id, config.prompt.clone())
            .await;

        AgentTaskSupervisor::capture_worktree_patch_summary(
            &registry,
            &patch_store,
            &transcript_store,
            &snapshot.task_id,
            &config,
        )
        .await
        .unwrap();

        let records = patch_store.list_by_task(&snapshot.task_id).await;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].tool_call_id, "task-finalize-worktree");
        assert_eq!(records[0].relative_path, PathBuf::from("notes.txt"));
        assert_eq!(records[0].status, PatchStatus::Pending);

        let events = registry.events(&snapshot.task_id).await.unwrap();
        let patch_ready = events
            .iter()
            .find(|event| matches!(event.kind, AgentTaskEventKind::PatchReady))
            .expect("expected PatchReady event for worktree summary");
        let data = patch_ready
            .data
            .as_ref()
            .expect("expected metadata on PatchReady event");
        assert_eq!(data.get("patch_count").and_then(|value| value.as_u64()), Some(1));
        assert_eq!(
            data.get("isolation").and_then(|value| value.as_str()),
            Some("git_worktree")
        );
        let changed_files = data
            .get("changed_files")
            .and_then(|value| value.as_array())
            .expect("expected changed_files array");
        assert!(
            changed_files
                .iter()
                .any(|value| value.as_str() == Some("notes.txt"))
        );

        let transcript = transcript_store.get(&snapshot.task_id).await.unwrap();
        assert!(transcript
            .entries
            .iter()
            .any(|entry| matches!(entry, AgentTranscriptEntry::PatchRecord { .. })));

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(worktree_path).await;
    }

    #[tokio::test]
    async fn capture_worktree_patch_summary_skips_paths_already_recorded_by_tools() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-supervisor-snapshot-{}.json",
            uuid::Uuid::new_v4()
        ));
        let worktree_path = init_temp_git_repo_with_untracked_file("notes.txt");

        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let patch_store = Arc::new(AgentPatchStore::default());
        let transcript_store = Arc::new(AgentTranscriptStore::default());
        let config = build_git_worktree_task_config(worktree_path.clone());
        let snapshot = registry
            .create_task(config.clone(), AgentTaskKind::Background)
            .await;

        transcript_store
            .start_transcript(&snapshot.task_id, config.prompt.clone())
            .await;

        patch_store
            .upsert_patch(AgentPatchRecord {
                patch_id: "patch-existing-tool-record".to_string(),
                task_id: snapshot.task_id.clone(),
                tool_call_id: "tool-call-1".to_string(),
                relative_path: PathBuf::from("notes.txt"),
                diff_preview: "existing diff preview".to_string(),
                full_diff_ref: None,
                status: PatchStatus::Pending,
            })
            .await;

        AgentTaskSupervisor::capture_worktree_patch_summary(
            &registry,
            &patch_store,
            &transcript_store,
            &snapshot.task_id,
            &config,
        )
        .await
        .unwrap();

        let records = patch_store.list_by_task(&snapshot.task_id).await;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].patch_id, "patch-existing-tool-record");

        let events = registry.events(&snapshot.task_id).await.unwrap();
        assert!(!events
            .iter()
            .any(|event| matches!(event.kind, AgentTaskEventKind::PatchReady)));

        let transcript = transcript_store.get(&snapshot.task_id).await.unwrap();
        assert!(!transcript
            .entries
            .iter()
            .any(|entry| matches!(entry, AgentTranscriptEntry::PatchRecord { .. })));

        let _ = tokio::fs::remove_file(snapshot_file).await;
        let _ = tokio::fs::remove_dir_all(worktree_path).await;
    }

    #[tokio::test]
    async fn team_status_from_members_summarizes_results_and_patch_counts() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-team-snapshot-{}.json",
            uuid::Uuid::new_v4()
        ));
        let supervisor = AgentTaskSupervisor::new(2, Some(snapshot_file.clone()));

        let success_task = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;
        let failed_task = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;

        supervisor
            .registry()
            .mark_succeeded(&success_task.task_id, "completed successfully".to_string(), None)
            .await
            .unwrap();
        supervisor
            .registry()
            .mark_failed(&failed_task.task_id, "tool execution failed".to_string())
            .await
            .unwrap();

        supervisor
            .patch_store()
            .upsert_patch(AgentPatchRecord {
                patch_id: "patch-success-1".to_string(),
                task_id: success_task.task_id.clone(),
                tool_call_id: "tool-call-success".to_string(),
                relative_path: PathBuf::from("src/success.rs"),
                diff_preview: "success diff".to_string(),
                full_diff_ref: None,
                status: PatchStatus::Accepted,
            })
            .await;
        supervisor
            .patch_store()
            .upsert_patch(AgentPatchRecord {
                patch_id: "patch-failed-1".to_string(),
                task_id: failed_task.task_id.clone(),
                tool_call_id: "tool-call-failed".to_string(),
                relative_path: PathBuf::from("src/failed.rs"),
                diff_preview: "failed diff".to_string(),
                full_diff_ref: None,
                status: PatchStatus::Pending,
            })
            .await;

        let team_status = supervisor
            .team_status_from_members(
                "migration-team".to_string(),
                "finish native runtime migration".to_string(),
                vec![success_task.task_id.clone(), failed_task.task_id.clone()],
            )
            .await
            .unwrap();

        assert_eq!(team_status.total_members, 2);
        assert_eq!(team_status.succeeded, 1);
        assert_eq!(team_status.failed, 1);
        assert_eq!(team_status.patch_summary.total, 2);
        assert_eq!(team_status.patch_summary.accepted, 1);
        assert_eq!(team_status.patch_summary.pending, 1);
        assert_eq!(team_status.succeeded_members.len(), 1);
        assert_eq!(team_status.failed_members.len(), 1);
        assert!(team_status
            .failed_reasons
            .iter()
            .any(|reason| reason.contains("tool execution failed")));
        assert!(team_status
            .recommended_next_step
            .to_ascii_lowercase()
            .contains("failed members"));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn team_status_reads_registered_team_members() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-team-registry-{}.json",
            uuid::Uuid::new_v4()
        ));
        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));

        let queued_task = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;

        let team = AgentTeam {
            team_id: "team-runtime-1".to_string(),
            name: "runtime-team".to_string(),
            objective: "coordinate queued work".to_string(),
            members: vec![queued_task.task_id.clone()],
            mailbox_id: "mailbox-runtime-1".to_string(),
        };
        supervisor.upsert_team(team).await;

        let status = supervisor.team_status("team-runtime-1").await.unwrap();
        assert_eq!(status.team_id, "team-runtime-1");
        assert_eq!(status.name, "runtime-team");
        assert_eq!(status.total_members, 1);
        assert_eq!(status.queued, 1);

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn send_and_wait_agent_mailbox_messages() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-mailbox-{}.json",
            uuid::Uuid::new_v4()
        ));
        let supervisor = AgentTaskSupervisor::new(1, Some(snapshot_file.clone()));

        let receiver = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;
        let sender = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;

        let message = supervisor
            .send_to_agent_mailbox(
                &receiver.task_id,
                "please update module A".to_string(),
                Some(sender.task_id.clone()),
                None,
            )
            .await
            .unwrap();

        assert_eq!(message.to_task_id, Some(receiver.task_id.clone()));

        let received = supervisor
            .wait_agent_mailbox_messages(&receiver.task_id, Some(100))
            .await
            .unwrap();
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].content, "please update module A");
        assert_eq!(received[0].from_task_id, Some(sender.task_id.clone()));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn broadcast_team_mailbox_delivers_to_all_members() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-mailbox-team-{}.json",
            uuid::Uuid::new_v4()
        ));
        let supervisor = AgentTaskSupervisor::new(2, Some(snapshot_file.clone()));

        let member_a = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;
        let member_b = supervisor
            .registry()
            .create_task(build_task_config(), AgentTaskKind::TeamMember)
            .await;

        supervisor
            .upsert_team(AgentTeam {
                team_id: "team-mailbox-1".to_string(),
                name: "mailbox-team".to_string(),
                objective: "coordinate edits".to_string(),
                members: vec![member_a.task_id.clone(), member_b.task_id.clone()],
                mailbox_id: "mailbox-team-1".to_string(),
            })
            .await;

        let delivered = supervisor
            .broadcast_to_team_mailbox(
                "team-mailbox-1",
                "sync on patch review".to_string(),
                None,
            )
            .await
            .unwrap();
        assert_eq!(delivered.len(), 2);

        let inbox_a = supervisor
            .wait_agent_mailbox_messages(&member_a.task_id, Some(100))
            .await
            .unwrap();
        let inbox_b = supervisor
            .wait_agent_mailbox_messages(&member_b.task_id, Some(100))
            .await
            .unwrap();
        assert_eq!(inbox_a.len(), 1);
        assert_eq!(inbox_b.len(), 1);
        assert_eq!(inbox_a[0].team_id.as_deref(), Some("team-mailbox-1"));
        assert_eq!(inbox_b[0].team_id.as_deref(), Some("team-mailbox-1"));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }
}
