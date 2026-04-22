use super::agent_task::AgentTaskId;
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatchStatus {
    Pending,
    Accepted,
    Rejected,
    Applied,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentPatchRecord {
    pub patch_id: String,
    pub task_id: AgentTaskId,
    pub tool_call_id: String,
    pub relative_path: PathBuf,
    pub diff_preview: String,
    pub full_diff_ref: Option<String>,
    pub status: PatchStatus,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentPatchSummary {
    pub total: usize,
    pub pending: usize,
    pub accepted: usize,
    pub rejected: usize,
    pub applied: usize,
    pub conflicted: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedPatchStore {
    records_by_task: HashMap<String, Vec<AgentPatchRecord>>,
}

pub struct AgentPatchStore {
    records_by_task: RwLock<HashMap<String, Vec<AgentPatchRecord>>>,
    snapshot_file: Option<PathBuf>,
}

impl Default for AgentPatchStore {
    fn default() -> Self {
        Self::new(None)
    }
}

impl AgentPatchStore {
    pub fn default_snapshot_file() -> PathBuf {
        get_path_manager_arc()
            .user_data_dir()
            .join("agent_runtime")
            .join("task_patches.json")
    }

    pub fn new(snapshot_file: Option<PathBuf>) -> Self {
        let records_by_task = snapshot_file
            .as_ref()
            .and_then(|path| match Self::read_persisted_store_blocking(path) {
                Ok(store) => Some(store.records_by_task),
                Err(error) => {
                    warn!(
                        "Failed to recover patch store from '{}': {}",
                        path.display(),
                        error
                    );
                    None
                }
            })
            .unwrap_or_default();

        Self {
            records_by_task: RwLock::new(records_by_task),
            snapshot_file,
        }
    }

    fn read_persisted_store_blocking(
        snapshot_file: &PathBuf,
    ) -> OpenHarnessResult<PersistedPatchStore> {
        if !snapshot_file.exists() {
            return Ok(PersistedPatchStore::default());
        }

        let raw = std::fs::read_to_string(snapshot_file).map_err(|error| {
            OpenHarnessError::service(format!(
                "Failed to read patch snapshot file '{}': {}",
                snapshot_file.display(),
                error
            ))
        })?;

        if raw.trim().is_empty() {
            return Ok(PersistedPatchStore::default());
        }

        serde_json::from_str::<PersistedPatchStore>(&raw).map_err(|error| {
            OpenHarnessError::service(format!(
                "Failed to parse patch snapshot file '{}': {}",
                snapshot_file.display(),
                error
            ))
        })
    }

    async fn write_persisted_store(
        &self,
        records: &HashMap<String, Vec<AgentPatchRecord>>,
    ) -> OpenHarnessResult<()> {
        let Some(snapshot_file) = self.snapshot_file.as_ref() else {
            return Ok(());
        };

        if let Some(parent) = snapshot_file.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                OpenHarnessError::service(format!(
                    "Failed to create patch snapshot directory '{}': {}",
                    parent.display(),
                    error
                ))
            })?;
        }

        let raw = serde_json::to_string_pretty(&PersistedPatchStore {
            records_by_task: records.clone(),
        })
        .map_err(|error| {
            OpenHarnessError::service(format!("Failed to serialize patch snapshots: {}", error))
        })?;

        tokio::fs::write(snapshot_file, raw).await.map_err(|error| {
            OpenHarnessError::service(format!(
                "Failed to write patch snapshot file '{}': {}",
                snapshot_file.display(),
                error
            ))
        })
    }

    async fn persist_if_needed(&self, records: &HashMap<String, Vec<AgentPatchRecord>>) {
        if self.snapshot_file.is_none() {
            return;
        }

        if let Err(error) = self.write_persisted_store(records).await {
            if let Some(snapshot_file) = self.snapshot_file.as_ref() {
                warn!(
                    "Failed to persist patch store to '{}': {}",
                    snapshot_file.display(),
                    error
                );
            } else {
                warn!("Failed to persist patch store: {}", error);
            }
        }
    }

    pub async fn upsert_patch(&self, record: AgentPatchRecord) {
        let snapshot = {
            let mut map = self.records_by_task.write().await;
            let records = map
                .entry(record.task_id.as_str().to_string())
                .or_insert_with(Vec::new);

            if let Some(existing) = records
                .iter_mut()
                .find(|existing| existing.patch_id == record.patch_id)
            {
                *existing = record;
            } else {
                records.push(record);
            }

            map.clone()
        };

        self.persist_if_needed(&snapshot).await;
    }

    pub async fn upsert_many(&self, records: Vec<AgentPatchRecord>) {
        let snapshot = {
            let mut map = self.records_by_task.write().await;
            for record in records {
                let task_records = map
                    .entry(record.task_id.as_str().to_string())
                    .or_insert_with(Vec::new);

                if let Some(existing) = task_records
                    .iter_mut()
                    .find(|existing| existing.patch_id == record.patch_id)
                {
                    *existing = record;
                } else {
                    task_records.push(record);
                }
            }

            map.clone()
        };

        self.persist_if_needed(&snapshot).await;
    }

    pub async fn list_by_task(&self, task_id: &AgentTaskId) -> Vec<AgentPatchRecord> {
        self.records_by_task
            .read()
            .await
            .get(task_id.as_str())
            .cloned()
            .unwrap_or_default()
    }

    pub async fn set_status(
        &self,
        task_id: &AgentTaskId,
        patch_id: &str,
        status: PatchStatus,
    ) -> OpenHarnessResult<AgentPatchRecord> {
        let (updated_record, snapshot) = {
            let mut map = self.records_by_task.write().await;
            let records = map.get_mut(task_id.as_str()).ok_or_else(|| {
                OpenHarnessError::NotFound(format!("Task patches not found: {}", task_id.as_str()))
            })?;

            let record = records
                .iter_mut()
                .find(|record| record.patch_id == patch_id)
                .ok_or_else(|| {
                    OpenHarnessError::NotFound(format!(
                        "Patch not found for task {}: {}",
                        task_id.as_str(),
                        patch_id
                    ))
                })?;

            record.status = status;
            (record.clone(), map.clone())
        };

        self.persist_if_needed(&snapshot).await;
        Ok(updated_record)
    }

    pub async fn summary_by_task(&self, task_id: &AgentTaskId) -> AgentPatchSummary {
        let records = self.list_by_task(task_id).await;
        let mut summary = AgentPatchSummary::default();

        for record in records {
            summary.total += 1;
            match record.status {
                PatchStatus::Pending => summary.pending += 1,
                PatchStatus::Accepted => summary.accepted += 1,
                PatchStatus::Rejected => summary.rejected += 1,
                PatchStatus::Applied => summary.applied += 1,
                PatchStatus::Conflicted => summary.conflicted += 1,
            }
        }

        summary
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_record(task_id: &AgentTaskId, patch_id: &str) -> AgentPatchRecord {
        AgentPatchRecord {
            patch_id: patch_id.to_string(),
            task_id: task_id.clone(),
            tool_call_id: "tool-call-1".to_string(),
            relative_path: PathBuf::from("README.md"),
            diff_preview: "diff --git a/README.md b/README.md".to_string(),
            full_diff_ref: None,
            status: PatchStatus::Pending,
        }
    }

    #[tokio::test]
    async fn stores_and_lists_patches_by_task() {
        let store = AgentPatchStore::default();
        let task_id = AgentTaskId::from("agtask-test-1");

        store.upsert_patch(build_record(&task_id, "patch-1")).await;
        store.upsert_patch(build_record(&task_id, "patch-2")).await;

        let records = store.list_by_task(&task_id).await;
        assert_eq!(records.len(), 2);
    }

    #[tokio::test]
    async fn updates_patch_status() {
        let store = AgentPatchStore::default();
        let task_id = AgentTaskId::from("agtask-test-2");

        store.upsert_patch(build_record(&task_id, "patch-3")).await;

        let updated = store
            .set_status(&task_id, "patch-3", PatchStatus::Accepted)
            .await
            .unwrap();
        assert_eq!(updated.status, PatchStatus::Accepted);
    }

    #[tokio::test]
    async fn summarizes_patch_status_counts() {
        let store = AgentPatchStore::default();
        let task_id = AgentTaskId::from("agtask-test-3");

        store
            .upsert_many(vec![
                build_record(&task_id, "patch-1"),
                AgentPatchRecord {
                    patch_id: "patch-2".to_string(),
                    status: PatchStatus::Accepted,
                    ..build_record(&task_id, "patch-2")
                },
                AgentPatchRecord {
                    patch_id: "patch-3".to_string(),
                    status: PatchStatus::Rejected,
                    ..build_record(&task_id, "patch-3")
                },
            ])
            .await;

        let summary = store.summary_by_task(&task_id).await;
        assert_eq!(summary.total, 3);
        assert_eq!(summary.pending, 1);
        assert_eq!(summary.accepted, 1);
        assert_eq!(summary.rejected, 1);
        assert_eq!(summary.applied, 0);
        assert_eq!(summary.conflicted, 0);
    }

    #[tokio::test]
    async fn persists_records_and_status_when_snapshot_file_is_configured() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-patch-store-{}.json",
            uuid::Uuid::new_v4()
        ));

        let task_id = AgentTaskId::from("agtask-test-persist");
        let store = AgentPatchStore::new(Some(snapshot_file.clone()));
        store
            .upsert_patch(build_record(&task_id, "patch-persist-1"))
            .await;

        let reloaded = AgentPatchStore::new(Some(snapshot_file.clone()));
        let records = reloaded.list_by_task(&task_id).await;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].patch_id, "patch-persist-1");

        reloaded
            .set_status(&task_id, "patch-persist-1", PatchStatus::Accepted)
            .await
            .unwrap();

        let reloaded_again = AgentPatchStore::new(Some(snapshot_file.clone()));
        let records_after_status = reloaded_again.list_by_task(&task_id).await;
        assert_eq!(records_after_status.len(), 1);
        assert_eq!(records_after_status[0].status, PatchStatus::Accepted);

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }
}
