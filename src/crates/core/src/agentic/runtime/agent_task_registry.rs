use super::agent_task::{
    now_ms, AgentTaskConfig, AgentTaskFilter, AgentTaskId, AgentTaskKind, AgentTaskSnapshot,
    AgentTaskStatus,
};
use super::task_events::{AgentTaskEvent, AgentTaskEventKind};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Notify, RwLock};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct TaskRecord {
    snapshot: AgentTaskSnapshot,
    events: Vec<AgentTaskEvent>,
    completion_notify: Arc<Notify>,
    cancel_token: Option<CancellationToken>,
    terminal_notified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedTaskStore {
    tasks: Vec<AgentTaskSnapshot>,
}

pub struct AgentTaskRegistry {
    records: RwLock<HashMap<String, TaskRecord>>,
    snapshot_file: PathBuf,
}

impl AgentTaskRegistry {
    pub fn default_snapshot_file() -> PathBuf {
        get_path_manager_arc()
            .user_data_dir()
            .join("agent_runtime")
            .join("task_snapshots.json")
    }

    pub fn new(snapshot_file: PathBuf) -> Self {
        Self {
            records: RwLock::new(HashMap::new()),
            snapshot_file,
        }
    }

    pub async fn create_task(
        &self,
        config: AgentTaskConfig,
        kind: AgentTaskKind,
    ) -> AgentTaskSnapshot {
        let snapshot = AgentTaskSnapshot::new(config, kind);
        let task_id = snapshot.task_id.as_str().to_string();

        self.records.write().await.insert(
            task_id,
            TaskRecord {
                snapshot: snapshot.clone(),
                events: Vec::new(),
                completion_notify: Arc::new(Notify::new()),
                cancel_token: None,
                terminal_notified: false,
            },
        );

        snapshot
    }

    pub async fn set_cancel_token(&self, task_id: &AgentTaskId, token: CancellationToken) {
        if let Some(record) = self.records.write().await.get_mut(task_id.as_str()) {
            record.cancel_token = Some(token);
        }
    }

    pub async fn push_event(&self, event: AgentTaskEvent) -> OpenHarnessResult<()> {
        let mut records = self.records.write().await;
        let record = records.get_mut(event.task_id.as_str()).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Task not found: {}", event.task_id.as_str()))
        })?;
        record.events.push(event);
        Ok(())
    }

    pub async fn events(&self, task_id: &AgentTaskId) -> OpenHarnessResult<Vec<AgentTaskEvent>> {
        let records = self.records.read().await;
        let record = records.get(task_id.as_str()).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Task not found: {}", task_id.as_str()))
        })?;
        Ok(record.events.clone())
    }

    pub async fn query_task(&self, task_id: &AgentTaskId) -> Option<AgentTaskSnapshot> {
        self.records
            .read()
            .await
            .get(task_id.as_str())
            .map(|r| r.snapshot.clone())
    }

    pub async fn list_tasks(&self, filter: Option<&AgentTaskFilter>) -> Vec<AgentTaskSnapshot> {
        self.records
            .read()
            .await
            .values()
            .map(|r| r.snapshot.clone())
            .filter(|snapshot| Self::matches_filter(snapshot, filter))
            .collect()
    }

    fn matches_filter(snapshot: &AgentTaskSnapshot, filter: Option<&AgentTaskFilter>) -> bool {
        let Some(filter) = filter else {
            return true;
        };

        if let Some(statuses) = &filter.statuses {
            if !statuses.contains(&snapshot.status) {
                return false;
            }
        }

        if let Some(kinds) = &filter.kinds {
            if !kinds.contains(&snapshot.kind) {
                return false;
            }
        }

        if let Some(parent_task_id) = &filter.parent_task_id {
            if snapshot.config.parent_task_id.as_ref() != Some(parent_task_id) {
                return false;
            }
        }

        if let Some(session_id) = &filter.session_id {
            if snapshot.config.session_id.as_ref() != Some(session_id) {
                return false;
            }
        }

        true
    }

    pub async fn mark_running(
        &self,
        task_id: &AgentTaskId,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        self.update_status(task_id, AgentTaskStatus::Running, None, None)
            .await
    }

    pub async fn mark_waiting_approval(
        &self,
        task_id: &AgentTaskId,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        self.update_status(task_id, AgentTaskStatus::WaitingApproval, None, None)
            .await
    }

    pub async fn mark_succeeded(
        &self,
        task_id: &AgentTaskId,
        summary: String,
        transcript_ref: Option<String>,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        self.update_status(
            task_id,
            AgentTaskStatus::Succeeded,
            Some(summary),
            transcript_ref,
        )
        .await
    }

    pub async fn mark_failed(
        &self,
        task_id: &AgentTaskId,
        error: String,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let snapshot = self
            .update_status(task_id, AgentTaskStatus::Failed, None, None)
            .await?;

        if !matches!(snapshot.status, AgentTaskStatus::Failed) {
            return Ok(snapshot);
        }

        let mut records = self.records.write().await;
        if let Some(record) = records.get_mut(task_id.as_str()) {
            record.snapshot.last_error = Some(error);
            return Ok(record.snapshot.clone());
        }

        Ok(snapshot)
    }

    pub async fn mark_cancelled(
        &self,
        task_id: &AgentTaskId,
        reason: String,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let snapshot = self
            .update_status(task_id, AgentTaskStatus::Cancelled, None, None)
            .await?;

        if !matches!(snapshot.status, AgentTaskStatus::Cancelled) {
            return Ok(snapshot);
        }

        let mut records = self.records.write().await;
        if let Some(record) = records.get_mut(task_id.as_str()) {
            record.snapshot.last_error = Some(reason);
            return Ok(record.snapshot.clone());
        }

        Ok(snapshot)
    }

    pub async fn mark_interrupted(
        &self,
        task_id: &AgentTaskId,
        reason: String,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let snapshot = self
            .update_status(task_id, AgentTaskStatus::Interrupted, None, None)
            .await?;

        if !matches!(snapshot.status, AgentTaskStatus::Interrupted) {
            return Ok(snapshot);
        }

        let mut records = self.records.write().await;
        if let Some(record) = records.get_mut(task_id.as_str()) {
            record.snapshot.last_error = Some(reason);
            return Ok(record.snapshot.clone());
        }

        Ok(snapshot)
    }

    async fn update_status(
        &self,
        task_id: &AgentTaskId,
        status: AgentTaskStatus,
        summary: Option<String>,
        transcript_ref: Option<String>,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let mut records = self.records.write().await;
        let record = records.get_mut(task_id.as_str()).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Task not found: {}", task_id.as_str()))
        })?;

        // Terminal states are immutable to avoid racing transitions (e.g. cancelled -> succeeded).
        if record.snapshot.status.is_terminal() {
            return Ok(record.snapshot.clone());
        }

        let now = now_ms();
        record.snapshot.status = status;

        if matches!(status, AgentTaskStatus::Running) {
            record.snapshot.started_at_ms = Some(now);
        }

        if status.is_terminal() {
            record.snapshot.completed_at_ms = Some(now);
            record.cancel_token = None;

            if matches!(status, AgentTaskStatus::Succeeded) {
                // Success transitions must wait for supervisor finalization
                // (transcript/patch/event persistence) before waiters are released.
                record.terminal_notified = false;
            } else {
                record.terminal_notified = true;
                record.completion_notify.notify_waiters();
            }
        }

        if let Some(summary) = summary {
            record.snapshot.result_summary = Some(summary);
        }

        if let Some(transcript_ref) = transcript_ref {
            record.snapshot.transcript_ref = Some(transcript_ref);
        }

        Ok(record.snapshot.clone())
    }

    pub async fn cancel_task(
        &self,
        task_id: &AgentTaskId,
        reason: String,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        let cancel_token = {
            let mut records = self.records.write().await;
            let record = records.get_mut(task_id.as_str()).ok_or_else(|| {
                OpenHarnessError::NotFound(format!("Task not found: {}", task_id.as_str()))
            })?;
            record.cancel_token.take()
        };

        if let Some(token) = cancel_token {
            token.cancel();
        }

        self.mark_cancelled(task_id, reason).await
    }

    pub async fn wait_for_terminal(
        &self,
        task_id: &AgentTaskId,
    ) -> OpenHarnessResult<AgentTaskSnapshot> {
        loop {
            let notify = {
                let records = self.records.read().await;
                let record = records.get(task_id.as_str()).ok_or_else(|| {
                    OpenHarnessError::NotFound(format!("Task not found: {}", task_id.as_str()))
                })?;

                if record.snapshot.status.is_terminal() && record.terminal_notified {
                    return Ok(record.snapshot.clone());
                }

                Arc::clone(&record.completion_notify)
            };

            notify.notified().await;
        }
    }

    pub async fn persist_snapshot(&self, task_id: &AgentTaskId) -> OpenHarnessResult<PathBuf> {
        let Some(snapshot) = self.query_task(task_id).await else {
            return Err(OpenHarnessError::NotFound(format!(
                "Task not found: {}",
                task_id.as_str()
            )));
        };

        let mut store = self.read_persisted_store().await?;
        if let Some(existing) = store
            .tasks
            .iter_mut()
            .find(|item| item.task_id.as_str() == task_id.as_str())
        {
            *existing = snapshot;
        } else {
            store.tasks.push(snapshot);
        }

        self.write_persisted_store(&store).await?;
        Ok(self.snapshot_file.clone())
    }

    pub async fn persist_all_snapshots(&self) -> OpenHarnessResult<PathBuf> {
        let snapshots = self.list_tasks(None).await;
        let store = PersistedTaskStore { tasks: snapshots };
        self.write_persisted_store(&store).await?;
        Ok(self.snapshot_file.clone())
    }

    pub async fn recover_interrupted_tasks(&self) -> OpenHarnessResult<Vec<AgentTaskSnapshot>> {
        let mut store = self.read_persisted_store().await?;
        let mut recovered = Vec::new();

        let mut records = self.records.write().await;

        for snapshot in &mut store.tasks {
            if matches!(
                snapshot.status,
                AgentTaskStatus::Queued
                    | AgentTaskStatus::Running
                    | AgentTaskStatus::WaitingApproval
            ) {
                snapshot.status = AgentTaskStatus::Interrupted;
                snapshot.completed_at_ms = Some(now_ms());
                snapshot.last_error =
                    Some("Interrupted during previous process lifecycle".to_string());
                recovered.push(snapshot.clone());
            }

            let key = snapshot.task_id.as_str().to_string();
            records.entry(key).or_insert_with(|| TaskRecord {
                snapshot: snapshot.clone(),
                events: vec![AgentTaskEvent::new(
                    snapshot.task_id.clone(),
                    AgentTaskEventKind::TaskFailed,
                    Some("Recovered from persisted snapshot".to_string()),
                    None,
                )],
                completion_notify: Arc::new(Notify::new()),
                cancel_token: None,
                terminal_notified: snapshot.status.is_terminal(),
            });
        }

        drop(records);
        self.write_persisted_store(&store).await?;

        Ok(recovered)
    }

    pub async fn notify_completion(&self, task_id: &AgentTaskId) -> OpenHarnessResult<()> {
        let mut records = self.records.write().await;
        let record = records.get_mut(task_id.as_str()).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Task not found: {}", task_id.as_str()))
        })?;

        if record.snapshot.status.is_terminal() {
            record.terminal_notified = true;
            record.completion_notify.notify_waiters();
        }

        Ok(())
    }

    async fn read_persisted_store(&self) -> OpenHarnessResult<PersistedTaskStore> {
        if !tokio::fs::try_exists(&self.snapshot_file)
            .await
            .unwrap_or(false)
        {
            return Ok(PersistedTaskStore::default());
        }

        let raw = tokio::fs::read_to_string(&self.snapshot_file)
            .await
            .map_err(|e| {
                OpenHarnessError::service(format!(
                    "Failed to read task snapshot file '{}': {}",
                    self.snapshot_file.display(),
                    e
                ))
            })?;

        if raw.trim().is_empty() {
            return Ok(PersistedTaskStore::default());
        }

        serde_json::from_str::<PersistedTaskStore>(&raw).map_err(|e| {
            OpenHarnessError::service(format!(
                "Failed to parse task snapshot file '{}': {}",
                self.snapshot_file.display(),
                e
            ))
        })
    }

    async fn write_persisted_store(&self, store: &PersistedTaskStore) -> OpenHarnessResult<()> {
        if let Some(parent) = self.snapshot_file.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                OpenHarnessError::service(format!(
                    "Failed to create task snapshot directory '{}': {}",
                    parent.display(),
                    e
                ))
            })?;
        }

        let raw = serde_json::to_string_pretty(store).map_err(|e| {
            OpenHarnessError::service(format!("Failed to serialize task snapshots: {}", e))
        })?;

        tokio::fs::write(&self.snapshot_file, raw)
            .await
            .map_err(|e| {
                OpenHarnessError::service(format!(
                    "Failed to write task snapshot file '{}': {}",
                    self.snapshot_file.display(),
                    e
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::runtime::{
        CleanupPolicy, ForkContextMode, WorkspaceBinding, WorkspaceIsolation,
    };
    use tokio::time::{timeout, Duration};

    fn build_test_config() -> AgentTaskConfig {
        let root = std::env::temp_dir().join(format!(
            "openharness-agent-task-registry-{}",
            uuid::Uuid::new_v4()
        ));

        AgentTaskConfig {
            agent_name: "Explore".to_string(),
            prompt: "test prompt".to_string(),
            parent_task_id: None,
            session_id: Some("test-session".to_string()),
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

    #[tokio::test]
    async fn cancelled_task_status_is_not_overwritten() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-task-snapshot-{}.json",
            uuid::Uuid::new_v4()
        ));

        let registry = AgentTaskRegistry::new(snapshot_file.clone());
        let created = registry
            .create_task(build_test_config(), AgentTaskKind::Background)
            .await;
        let task_id = created.task_id.clone();

        let running = registry.mark_running(&task_id).await.unwrap();
        assert_eq!(running.status, AgentTaskStatus::Running);

        let cancelled = registry
            .cancel_task(&task_id, "cancel requested".to_string())
            .await
            .unwrap();
        assert_eq!(cancelled.status, AgentTaskStatus::Cancelled);

        let after_success_attempt = registry
            .mark_succeeded(
                &task_id,
                "this should not replace cancelled state".to_string(),
                Some("transcript-ref".to_string()),
            )
            .await
            .unwrap();
        assert_eq!(after_success_attempt.status, AgentTaskStatus::Cancelled);

        let snapshot = registry.query_task(&task_id).await.unwrap();
        assert_eq!(snapshot.status, AgentTaskStatus::Cancelled);

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn succeeded_task_waits_until_completion_is_notified() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-task-wait-notify-{}.json",
            uuid::Uuid::new_v4()
        ));

        let registry = AgentTaskRegistry::new(snapshot_file.clone());
        let created = registry
            .create_task(build_test_config(), AgentTaskKind::Background)
            .await;
        let task_id = created.task_id.clone();

        registry.mark_running(&task_id).await.unwrap();
        registry
            .mark_succeeded(&task_id, "done".to_string(), None)
            .await
            .unwrap();

        let premature_wait = timeout(Duration::from_millis(25), registry.wait_for_terminal(&task_id)).await;
        assert!(premature_wait.is_err());

        registry.notify_completion(&task_id).await.unwrap();
        let terminal = timeout(Duration::from_millis(200), registry.wait_for_terminal(&task_id))
            .await
            .expect("wait_for_terminal should complete after notify")
            .unwrap();

        assert_eq!(terminal.status, AgentTaskStatus::Succeeded);

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }
}
