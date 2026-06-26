use super::capture::CapturedObservation;
use super::models::{MemoryEntry, MemoryTier, SessionSummary};
use chrono::Utc;
use log::info;

/// Trait for LLM-powered memory operations.
/// Implementors can use any AI client to generate summaries and extract facts.
pub trait MemoryLlmProvider: Send + Sync {
    /// Compress a set of observations into a session summary
    fn summarize_session(
        &self,
        observations: &[CapturedObservation],
    ) -> impl std::future::Future<Output = Result<SessionSummary, String>> + Send;

    /// Extract semantic facts from a session summary
    fn extract_facts(
        &self,
        summary: &SessionSummary,
    ) -> impl std::future::Future<Output = Result<Vec<String>, String>> + Send;
}

/// A no-op LLM provider for testing — generates simple deterministic summaries
pub struct NoOpLlmProvider;

impl MemoryLlmProvider for NoOpLlmProvider {
    async fn summarize_session(
        &self,
        observations: &[CapturedObservation],
    ) -> Result<SessionSummary, String> {
        if observations.is_empty() {
            return Err("No observations to summarize".to_string());
        }

        let session_id = observations[0].session_id.clone();
        let agent_name = observations[0].agent_name.clone();
        let started_at = observations.first().map(|o| o.timestamp).unwrap_or_else(Utc::now);
        let ended_at = observations.last().map(|o| o.timestamp).unwrap_or_else(Utc::now);

        let tools_used: Vec<String> = observations
            .iter()
            .map(|o| o.tool_name.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let files: Vec<String> = observations
            .iter()
            .flat_map(|o| o.file_paths.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let total_errors = observations.iter().filter(|o| o.is_error).count();

        let summary = format!(
            "Session with {} agent performed {} tool operations ({} errors). Tools used: {}. Files: {}.",
            agent_name,
            observations.len(),
            total_errors,
            tools_used.join(", "),
            if files.is_empty() {
                "none".to_string()
            } else {
                files.join(", ")
            }
        );

        Ok(SessionSummary {
            session_id,
            agent_name,
            started_at,
            ended_at,
            total_rounds: 0,
            total_tools: observations.len(),
            summary,
            facts: Vec::new(),
            files,
            tools_used,
        })
    }

    async fn extract_facts(&self, summary: &SessionSummary) -> Result<Vec<String>, String> {
        // No-op: return empty facts. Real implementation would use LLM.
        let _ = summary;
        Ok(Vec::new())
    }
}

/// Consolidation pipeline: converts Working observations into higher-tier memories.
pub struct ConsolidationPipeline<L: MemoryLlmProvider> {
    llm: L,
}

impl<L: MemoryLlmProvider> ConsolidationPipeline<L> {
    pub fn new(llm: L) -> Self {
        Self { llm }
    }

    /// Consolidate a batch of working observations into episodic memories.
    /// Returns (session_summary, episodic_entries, semantic_entries).
    pub async fn consolidate_session(
        &self,
        observations: &[CapturedObservation],
    ) -> Result<ConsolidationResult, String> {
        if observations.is_empty() {
            return Ok(ConsolidationResult::default());
        }

        let session_id = observations[0].session_id.clone();
        let agent_name = observations[0].agent_name.clone();

        info!(
            "Consolidating session: session={}, observations={}",
            session_id,
            observations.len()
        );

        // Step 1: Working → Episodic (summarize session)
        let summary = self.llm.summarize_session(observations).await?;

        // Create episodic memory entry from summary
        let mut episodic = MemoryEntry::new(
            MemoryTier::Episodic,
            summary.summary.clone(),
            session_id.clone(),
            agent_name.clone(),
        );
        episodic.source_observation_ids = observations.iter().map(|o| o.id.clone()).collect();
        episodic.file_paths = summary.files.clone();
        episodic.tags = summary.tools_used.clone();
        episodic.importance = self.estimate_importance(observations);

        // Step 2: Episodic → Semantic (extract facts)
        let facts = self.llm.extract_facts(&summary).await?;
        let semantic_entries: Vec<MemoryEntry> = facts
            .into_iter()
            .map(|fact| {
                let mut entry = MemoryEntry::new(
                    MemoryTier::Semantic,
                    fact,
                    session_id.clone(),
                    agent_name.clone(),
                );
                entry.importance = 0.7;
                entry
            })
            .collect();

        info!(
            "Consolidation complete: session={}, episodic=1, semantic={}",
            session_id,
            semantic_entries.len()
        );

        Ok(ConsolidationResult {
            summary: Some(summary),
            episodic_entries: vec![episodic],
            semantic_entries,
            procedural_entries: Vec::new(),
        })
    }

    /// Estimate importance based on observation characteristics
    fn estimate_importance(&self, observations: &[CapturedObservation]) -> f32 {
        let mut importance: f32 = 0.5;

        // More observations = more complex session = slightly more important
        let obs_count = observations.len() as f32;
        importance += (obs_count / 20.0).min(0.2);

        // Errors suggest debugging/problem-solving = more important
        let error_ratio = observations.iter().filter(|o| o.is_error).count() as f32 / obs_count;
        if error_ratio > 0.1 {
            importance += 0.1;
        }

        // File diversity suggests broader changes
        let file_count = observations
            .iter()
            .flat_map(|o| o.file_paths.iter())
            .collect::<std::collections::HashSet<_>>()
            .len();
        if file_count > 3 {
            importance += 0.1;
        }

        importance.min(1.0)
    }
}

#[derive(Debug, Default)]
pub struct ConsolidationResult {
    pub summary: Option<SessionSummary>,
    pub episodic_entries: Vec<MemoryEntry>,
    pub semantic_entries: Vec<MemoryEntry>,
    pub procedural_entries: Vec<MemoryEntry>,
}

impl ConsolidationResult {
    pub fn all_entries(&self) -> Vec<&MemoryEntry> {
        self.episodic_entries
            .iter()
            .chain(self.semantic_entries.iter())
            .chain(self.procedural_entries.iter())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_observations() -> Vec<CapturedObservation> {
        vec![
            CapturedObservation {
                id: "obs-1".to_string(),
                tool_name: "Bash".to_string(),
                tool_input_summary: "command: npm install jose".to_string(),
                tool_output_summary: "added 3 packages".to_string(),
                file_paths: vec!["package.json".to_string()],
                timestamp: Utc::now() - chrono::Duration::minutes(30),
                session_id: "session-1".to_string(),
                agent_name: "agentic".to_string(),
                is_error: false,
            },
            CapturedObservation {
                id: "obs-2".to_string(),
                tool_name: "Write".to_string(),
                tool_input_summary: "file_path: src/middleware/auth.ts".to_string(),
                tool_output_summary: "File created successfully".to_string(),
                file_paths: vec!["src/middleware/auth.ts".to_string()],
                timestamp: Utc::now() - chrono::Duration::minutes(20),
                session_id: "session-1".to_string(),
                agent_name: "agentic".to_string(),
                is_error: false,
            },
            CapturedObservation {
                id: "obs-3".to_string(),
                tool_name: "Bash".to_string(),
                tool_input_summary: "command: cargo test".to_string(),
                tool_output_summary: "test result: ok. 5 passed".to_string(),
                file_paths: vec![],
                timestamp: Utc::now() - chrono::Duration::minutes(10),
                session_id: "session-1".to_string(),
                agent_name: "agentic".to_string(),
                is_error: false,
            },
        ]
    }

    #[tokio::test]
    async fn consolidation_produces_episodic_entry() {
        let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
        let observations = sample_observations();

        let result = pipeline.consolidate_session(&observations).await.unwrap();

        assert!(result.summary.is_some());
        assert_eq!(result.episodic_entries.len(), 1);
        assert_eq!(result.episodic_entries[0].tier, MemoryTier::Episodic);
        assert!(result.episodic_entries[0].content.contains("3 tool operations"));
        assert_eq!(
            result.episodic_entries[0].source_observation_ids.len(),
            3
        );
    }

    #[tokio::test]
    async fn consolidation_extracts_files_and_tools() {
        let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
        let observations = sample_observations();

        let result = pipeline.consolidate_session(&observations).await.unwrap();
        let summary = result.summary.as_ref().unwrap();

        assert!(summary.tools_used.contains(&"Bash".to_string()));
        assert!(summary.tools_used.contains(&"Write".to_string()));
        assert!(summary.files.contains(&"src/middleware/auth.ts".to_string()));
    }

    #[tokio::test]
    async fn consolidation_empty_observations() {
        let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
        let result = pipeline.consolidate_session(&[]).await.unwrap();

        assert!(result.summary.is_none());
        assert!(result.episodic_entries.is_empty());
    }

    #[tokio::test]
    async fn importance_increases_with_errors() {
        let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
        let mut observations = sample_observations();
        observations[2].is_error = true;

        let result = pipeline.consolidate_session(&observations).await.unwrap();
        assert!(result.episodic_entries[0].importance > 0.5);
    }

    #[tokio::test]
    async fn consolidation_result_all_entries() {
        let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
        let observations = sample_observations();

        let result = pipeline.consolidate_session(&observations).await.unwrap();
        let all = result.all_entries();
        // 1 episodic + 0 semantic (NoOpLlmProvider returns empty facts) = 1
        assert_eq!(all.len(), 1);
    }
}
