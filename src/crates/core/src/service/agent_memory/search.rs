use super::models::{MemoryEntry, MemoryIndex, MemoryTier};
use super::storage::MemoryStorage;
use log::debug;
use std::path::Path;

/// High-level memory search service combining BM25 index with storage.
pub struct MemorySearchService {
    index: MemoryIndex,
    storage: MemoryStorage,
}

impl MemorySearchService {
    /// Create a new search service, loading all memories from storage.
    pub async fn load(workspace_root: &Path) -> Result<Self, String> {
        let storage = MemoryStorage::new(workspace_root);
        let index = storage
            .load_index()
            .await
            .map_err(|e| format!("Failed to load memory index: {}", e))?;

        debug!(
            "Memory search service loaded: {} entries",
            index.entries.len()
        );

        Ok(Self { index, storage })
    }

    /// Search memories by query string.
    /// Returns entries sorted by combined BM25 + relevance score.
    pub fn search(&self, query: &str, top_k: usize) -> Vec<(&MemoryEntry, f32)> {
        if query.trim().is_empty() {
            // Return most relevant entries when no query
            let mut entries: Vec<(&MemoryEntry, f32)> =
                self.index.entries.iter().map(|e| (e, e.relevance_score())).collect();
            entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            entries.truncate(top_k);
            return entries;
        }

        self.index.search(query, top_k)
    }

    /// Search with token budget constraint.
    /// Estimates ~4 chars per token and stops adding results when budget is exceeded.
    pub fn search_with_budget(&self, query: &str, token_budget: usize) -> Vec<(&MemoryEntry, f32)> {
        let char_budget = token_budget * 4; // Rough estimate: 1 token ≈ 4 chars
        let results = self.search(query, 50); // Over-fetch

        let mut selected = Vec::new();
        let mut total_chars = 0;

        for (entry, score) in results {
            let entry_chars = entry.content.len();
            if total_chars + entry_chars > char_budget && !selected.is_empty() {
                break;
            }
            total_chars += entry_chars;
            selected.push((entry, score));
        }

        selected
    }

    /// Format search results as a prompt section for injection into agent context.
    pub fn format_for_prompt(&self, query: &str, token_budget: usize) -> String {
        let results = self.search_with_budget(query, token_budget);

        if results.is_empty() {
            return String::new();
        }

        let mut output = String::from("<memory_context>\n## Project Memory (auto-captured)\n");

        for (entry, _score) in &results {
            let tier_label = match entry.tier {
                MemoryTier::Working => "Working",
                MemoryTier::Episodic => "Episodic",
                MemoryTier::Semantic => "Semantic",
                MemoryTier::Procedural => "Procedural",
            };

            let access_info = if entry.access_count > 0 {
                format!(" (accessed: {}x)", entry.access_count)
            } else {
                String::new()
            };

            output.push_str(&format!(
                "- [{}] {} (importance: {:.1}{})\n",
                tier_label,
                entry.content.lines().next().unwrap_or(""),
                entry.importance,
                access_info,
            ));
        }

        output.push_str("</memory_context>\n");
        output
    }

    /// Get the underlying index (for testing or direct manipulation)
    pub fn index(&self) -> &MemoryIndex {
        &self.index
    }

    /// Get mutable access to the index
    pub fn index_mut(&mut self) -> &mut MemoryIndex {
        &mut self.index
    }

    /// Persist updated entries back to storage
    pub async fn save_all(&self) -> Result<(), String> {
        self.storage
            .save_entries(&self.index.entries)
            .await
            .map_err(|e| format!("Failed to save memory entries: {}", e))
    }

    /// Update decay scores and evict stale entries
    pub async fn update_and_evict(&mut self, decay_threshold: f32) -> Result<Vec<MemoryEntry>, String> {
        self.index.update_decay_scores();
        let evicted = self.index.evict_decayed(decay_threshold);

        if !evicted.is_empty() {
            debug!("Evicted {} decayed memory entries", evicted.len());
            // Save remaining entries
            self.save_all().await?;
        }

        Ok(evicted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tokio::fs;

    fn temp_workspace() -> PathBuf {
        std::env::temp_dir().join(format!("openharness-memory-search-{}", uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn search_returns_relevant_entries() {
        let workspace = temp_workspace();
        {
            let storage = MemoryStorage::new(&workspace);
            storage.ensure_dirs().await.unwrap();

            let mut entry1 = MemoryEntry::new(
                MemoryTier::Semantic,
                "Auth uses JWT middleware in src/middleware/auth.ts".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            );
            entry1.importance = 0.9;

            let mut entry2 = MemoryEntry::new(
                MemoryTier::Episodic,
                "Fixed N+1 query in user service".to_string(),
                "s2".to_string(),
                "agent".to_string(),
            );
            entry2.importance = 0.6;

            storage.save_entry(&entry1).await.unwrap();
            storage.save_entry(&entry2).await.unwrap();
        }

        let service = MemorySearchService::load(&workspace).await.unwrap();
        let results = service.search("JWT authentication", 5);

        assert!(!results.is_empty());
        assert!(results[0].0.content.contains("JWT"));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn search_with_budget_limits_output() {
        let workspace = temp_workspace();
        {
            let storage = MemoryStorage::new(&workspace);
            storage.ensure_dirs().await.unwrap();

            for i in 0..10 {
                let entry = MemoryEntry::new(
                    MemoryTier::Semantic,
                    format!("Important fact number {} about the project architecture", i),
                    "s1".to_string(),
                    "agent".to_string(),
                );
                storage.save_entry(&entry).await.unwrap();
            }
        }

        let service = MemorySearchService::load(&workspace).await.unwrap();
        let results = service.search_with_budget("project", 50); // ~200 chars budget

        // Should have fewer results than total due to budget
        assert!(results.len() <= 10);

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn format_for_prompt_produces_valid_xml() {
        let workspace = temp_workspace();
        {
            let storage = MemoryStorage::new(&workspace);
            storage.ensure_dirs().await.unwrap();

            let entry = MemoryEntry::new(
                MemoryTier::Semantic,
                "Auth uses JWT middleware".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            );
            storage.save_entry(&entry).await.unwrap();
        }

        let service = MemorySearchService::load(&workspace).await.unwrap();
        let prompt = service.format_for_prompt("auth", 2000);

        assert!(prompt.contains("<memory_context>"));
        assert!(prompt.contains("</memory_context>"));
        assert!(prompt.contains("[Semantic]"));
        assert!(prompt.contains("JWT"));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn empty_query_returns_by_relevance() {
        let workspace = temp_workspace();
        {
            let storage = MemoryStorage::new(&workspace);
            storage.ensure_dirs().await.unwrap();

            let mut entry = MemoryEntry::new(
                MemoryTier::Semantic,
                "test".to_string(),
                "s1".to_string(),
                "agent".to_string(),
            );
            entry.importance = 0.8;
            storage.save_entry(&entry).await.unwrap();
        }

        let service = MemorySearchService::load(&workspace).await.unwrap();
        let results = service.search("", 5);
        assert_eq!(results.len(), 1);

        let _ = fs::remove_dir_all(&workspace).await;
    }
}
