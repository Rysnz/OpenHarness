use super::models::{MemoryEntry, MemoryIndex, MemoryTier, SessionSummary};
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use log::{debug, warn};
use std::path::{Path, PathBuf};
use tokio::fs;

const WORKING_DIR: &str = "working";
const EPISODIC_DIR: &str = "episodic";
const SEMANTIC_DIR: &str = "semantic";
const PROCEDURAL_DIR: &str = "procedural";
const SUMMARIES_DIR: &str = "summaries";
const INDEX_FILE: &str = "index.json";

/// File-based storage for the 4-tier memory system.
/// Each tier has its own directory under `.openharness/memory/`.
pub struct MemoryStorage {
    base_dir: PathBuf,
}

impl MemoryStorage {
    pub fn new(workspace_root: &Path) -> Self {
        Self {
            base_dir: workspace_root
                .join(".openharness")
                .join("memory")
                .join("engine"),
        }
    }

    fn tier_dir(&self, tier: MemoryTier) -> PathBuf {
        let dir_name = match tier {
            MemoryTier::Working => WORKING_DIR,
            MemoryTier::Episodic => EPISODIC_DIR,
            MemoryTier::Semantic => SEMANTIC_DIR,
            MemoryTier::Procedural => PROCEDURAL_DIR,
        };
        self.base_dir.join(dir_name)
    }

    /// Ensure all tier directories exist
    pub async fn ensure_dirs(&self) -> OpenHarnessResult<()> {
        for tier in [
            MemoryTier::Working,
            MemoryTier::Episodic,
            MemoryTier::Semantic,
            MemoryTier::Procedural,
        ] {
            let dir = self.tier_dir(tier);
            fs::create_dir_all(&dir).await.map_err(|e| {
                OpenHarnessError::service(format!(
                    "Failed to create memory tier directory {}: {}",
                    dir.display(),
                    e
                ))
            })?;
        }
        let summaries_dir = self.base_dir.join(SUMMARIES_DIR);
        fs::create_dir_all(&summaries_dir).await.map_err(|e| {
            OpenHarnessError::service(format!(
                "Failed to create summaries directory: {}",
                e
            ))
        })?;
        Ok(())
    }

    /// Save a single memory entry to its tier directory
    pub async fn save_entry(&self, entry: &MemoryEntry) -> OpenHarnessResult<()> {
        let dir = self.tier_dir(entry.tier);
        fs::create_dir_all(&dir).await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to create tier dir: {}", e))
        })?;

        let file_path = dir.join(format!("{}.json", entry.id));
        let json = serde_json::to_string_pretty(entry).map_err(|e| {
            OpenHarnessError::service(format!("Failed to serialize memory entry: {}", e))
        })?;

        fs::write(&file_path, json).await.map_err(|e| {
            OpenHarnessError::service(format!(
                "Failed to write memory entry {}: {}",
                file_path.display(),
                e
            ))
        })?;

        debug!("Saved memory entry: id={}, tier={:?}", entry.id, entry.tier);
        Ok(())
    }

    /// Save multiple entries (batch)
    pub async fn save_entries(&self, entries: &[MemoryEntry]) -> OpenHarnessResult<()> {
        for entry in entries {
            self.save_entry(entry).await?;
        }
        Ok(())
    }

    /// Delete a memory entry file
    pub async fn delete_entry(&self, entry_id: &str, tier: MemoryTier) -> OpenHarnessResult<()> {
        let file_path = self.tier_dir(tier).join(format!("{}.json", entry_id));
        if file_path.exists() {
            fs::remove_file(&file_path).await.map_err(|e| {
                OpenHarnessError::service(format!("Failed to delete memory entry: {}", e))
            })?;
        }
        Ok(())
    }

    /// Load all entries from all tiers into a MemoryIndex
    pub async fn load_index(&self) -> OpenHarnessResult<MemoryIndex> {
        self.ensure_dirs().await?;

        let mut index = MemoryIndex::new();

        for tier in [
            MemoryTier::Working,
            MemoryTier::Episodic,
            MemoryTier::Semantic,
            MemoryTier::Procedural,
        ] {
            let dir = self.tier_dir(tier);
            let entries = self.load_entries_from_dir(&dir).await?;
            for entry in entries {
                index.add(entry);
            }
        }

        debug!(
            "Loaded memory index: {} entries",
            index.entries.len()
        );
        Ok(index)
    }

    /// Load all entries from a specific tier
    pub async fn load_tier(&self, tier: MemoryTier) -> OpenHarnessResult<Vec<MemoryEntry>> {
        let dir = self.tier_dir(tier);
        self.load_entries_from_dir(&dir).await
    }

    async fn load_entries_from_dir(&self, dir: &Path) -> OpenHarnessResult<Vec<MemoryEntry>> {
        let mut entries = Vec::new();

        if !dir.exists() {
            return Ok(entries);
        }

        let mut dir_entries = fs::read_dir(dir).await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to read memory dir {}: {}", dir.display(), e))
        })?;

        while let Some(entry) = dir_entries.next_entry().await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to iterate memory dir: {}", e))
        })? {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.ends_with(".json") {
                continue;
            }

            match fs::read_to_string(entry.path()).await {
                Ok(content) => match serde_json::from_str::<MemoryEntry>(&content) {
                    Ok(entry) => entries.push(entry),
                    Err(e) => {
                        warn!(
                            "Failed to parse memory entry {}: {}",
                            entry.path().display(),
                            e
                        );
                    }
                },
                Err(e) => {
                    warn!(
                        "Failed to read memory entry {}: {}",
                        entry.path().display(),
                        e
                    );
                }
            }
        }

        Ok(entries)
    }

    /// Save a session summary
    pub async fn save_session_summary(&self, summary: &SessionSummary) -> OpenHarnessResult<()> {
        let dir = self.base_dir.join(SUMMARIES_DIR);
        fs::create_dir_all(&dir).await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to create summaries dir: {}", e))
        })?;

        let file_path = dir.join(format!("{}.json", summary.session_id));
        let json = serde_json::to_string_pretty(summary).map_err(|e| {
            OpenHarnessError::service(format!("Failed to serialize session summary: {}", e))
        })?;

        fs::write(&file_path, json).await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to write session summary: {}", e))
        })?;

        debug!("Saved session summary: session={}", summary.session_id);
        Ok(())
    }

    /// Load all session summaries
    pub async fn load_session_summaries(&self) -> OpenHarnessResult<Vec<SessionSummary>> {
        let dir = self.base_dir.join(SUMMARIES_DIR);
        let mut summaries = Vec::new();

        if !dir.exists() {
            return Ok(summaries);
        }

        let mut dir_entries = fs::read_dir(&dir).await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to read summaries dir: {}", e))
        })?;

        while let Some(entry) = dir_entries.next_entry().await.map_err(|e| {
            OpenHarnessError::service(format!("Failed to iterate summaries dir: {}", e))
        })? {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.ends_with(".json") {
                continue;
            }

            if let Ok(content) = fs::read_to_string(entry.path()).await {
                if let Ok(summary) = serde_json::from_str::<SessionSummary>(&content) {
                    summaries.push(summary);
                }
            }
        }

        summaries.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        Ok(summaries)
    }

    /// Count entries per tier
    pub async fn stats(&self) -> OpenHarnessResult<MemoryStats> {
        let mut stats = MemoryStats::default();

        for tier in [
            MemoryTier::Working,
            MemoryTier::Episodic,
            MemoryTier::Semantic,
            MemoryTier::Procedural,
        ] {
            let entries = self.load_tier(tier).await?;
            match tier {
                MemoryTier::Working => stats.working_count = entries.len(),
                MemoryTier::Episodic => stats.episodic_count = entries.len(),
                MemoryTier::Semantic => stats.semantic_count = entries.len(),
                MemoryTier::Procedural => stats.procedural_count = entries.len(),
            }
        }

        let summaries = self.load_session_summaries().await?;
        stats.session_count = summaries.len();

        Ok(stats)
    }
}

#[derive(Debug, Default)]
pub struct MemoryStats {
    pub working_count: usize,
    pub episodic_count: usize,
    pub semantic_count: usize,
    pub procedural_count: usize,
    pub session_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn temp_workspace() -> PathBuf {
        std::env::temp_dir().join(format!("openharness-memory-storage-{}", uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn save_and_load_entry() {
        let workspace = temp_workspace();
        let storage = MemoryStorage::new(&workspace);
        storage.ensure_dirs().await.unwrap();

        let entry = MemoryEntry::new(
            MemoryTier::Semantic,
            "Auth uses JWT middleware".to_string(),
            "session-1".to_string(),
            "agentic".to_string(),
        );
        let entry_id = entry.id.clone();

        storage.save_entry(&entry).await.unwrap();

        let index = storage.load_index().await.unwrap();
        assert_eq!(index.entries.len(), 1);
        assert_eq!(index.entries[0].id, entry_id);
        assert_eq!(index.entries[0].content, "Auth uses JWT middleware");

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn save_entries_across_tiers() {
        let workspace = temp_workspace();
        let storage = MemoryStorage::new(&workspace);
        storage.ensure_dirs().await.unwrap();

        let entries = vec![
            MemoryEntry::new(
                MemoryTier::Working,
                "raw observation".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            ),
            MemoryEntry::new(
                MemoryTier::Episodic,
                "session summary".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            ),
            MemoryEntry::new(
                MemoryTier::Semantic,
                "extracted fact".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            ),
        ];

        storage.save_entries(&entries).await.unwrap();

        let index = storage.load_index().await.unwrap();
        assert_eq!(index.entries.len(), 3);

        let working = storage.load_tier(MemoryTier::Working).await.unwrap();
        assert_eq!(working.len(), 1);

        let semantic = storage.load_tier(MemoryTier::Semantic).await.unwrap();
        assert_eq!(semantic.len(), 1);

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn delete_entry_removes_file() {
        let workspace = temp_workspace();
        let storage = MemoryStorage::new(&workspace);
        storage.ensure_dirs().await.unwrap();

        let entry = MemoryEntry::new(
            MemoryTier::Semantic,
            "to be deleted".to_string(),
            "s1".to_string(),
            "agent".to_string(),
        );
        let entry_id = entry.id.clone();

        storage.save_entry(&entry).await.unwrap();
        assert_eq!(storage.load_tier(MemoryTier::Semantic).await.unwrap().len(), 1);

        storage
            .delete_entry(&entry_id, MemoryTier::Semantic)
            .await
            .unwrap();
        assert_eq!(storage.load_tier(MemoryTier::Semantic).await.unwrap().len(), 0);

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn session_summary_roundtrip() {
        let workspace = temp_workspace();
        let storage = MemoryStorage::new(&workspace);
        storage.ensure_dirs().await.unwrap();

        let summary = SessionSummary {
            session_id: "session-abc".to_string(),
            agent_name: "agentic".to_string(),
            started_at: Utc::now() - chrono::Duration::hours(1),
            ended_at: Utc::now(),
            total_rounds: 5,
            total_tools: 12,
            summary: "Implemented JWT auth with jose".to_string(),
            facts: vec!["Uses jose over jsonwebtoken".to_string()],
            files: vec!["src/middleware/auth.ts".to_string()],
            tools_used: vec!["Bash".to_string(), "Write".to_string()],
        };

        storage.save_session_summary(&summary).await.unwrap();

        let summaries = storage.load_session_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].session_id, "session-abc");
        assert!(summaries[0].summary.contains("JWT"));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn stats_counts_entries_per_tier() {
        let workspace = temp_workspace();
        let storage = MemoryStorage::new(&workspace);
        storage.ensure_dirs().await.unwrap();

        for i in 0..3 {
            storage
                .save_entry(&MemoryEntry::new(
                    MemoryTier::Working,
                    format!("obs {}", i),
                    "s1".to_string(),
                    "agent".to_string(),
                ))
                .await
                .unwrap();
        }
        storage
            .save_entry(&MemoryEntry::new(
                MemoryTier::Semantic,
                "fact".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            ))
            .await
            .unwrap();

        let stats = storage.stats().await.unwrap();
        assert_eq!(stats.working_count, 3);
        assert_eq!(stats.semantic_count, 1);
        assert_eq!(stats.episodic_count, 0);

        let _ = fs::remove_dir_all(&workspace).await;
    }
}
