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
use crate::service::git::{GitDiffParams, GitService};
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
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
    use git2::Repository;

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
