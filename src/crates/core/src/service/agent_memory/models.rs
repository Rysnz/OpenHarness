use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    /// Raw observations from tool use — short-term, high volume
    Working,
    /// Compressed session summaries — "what happened"
    Episodic,
    /// Extracted facts, patterns, preferences — "what I know"
    Semantic,
    /// Workflows and decision patterns — "how to do it"
    Procedural,
}

impl MemoryTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::Episodic => "episodic",
            Self::Semantic => "semantic",
            Self::Procedural => "procedural",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub tier: MemoryTier,
    pub content: String,
    pub source_observation_ids: Vec<String>,
    pub session_id: String,
    pub agent_name: String,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub access_count: u32,
    /// 0.0 (trivial) to 1.0 (critical)
    pub importance: f32,
    /// Ebbinghaus decay score, 0.0 (forgotten) to 1.0 (fresh)
    pub decay_score: f32,
    pub tags: Vec<String>,
    pub file_paths: Vec<String>,
    /// Related memory IDs for graph traversal
    pub related_ids: Vec<String>,
}

impl MemoryEntry {
    pub fn new(tier: MemoryTier, content: String, session_id: String, agent_name: String) -> Self {
        let now = Utc::now();
        Self {
            id: format!("mem-{}", uuid::Uuid::new_v4()),
            tier,
            content,
            source_observation_ids: Vec::new(),
            session_id,
            agent_name,
            created_at: now,
            last_accessed: now,
            access_count: 0,
            importance: 0.5,
            decay_score: 1.0,
            tags: Vec::new(),
            file_paths: Vec::new(),
            related_ids: Vec::new(),
        }
    }

    /// Update access timestamp and count
    pub fn record_access(&mut self) {
        self.last_accessed = Utc::now();
        self.access_count += 1;
    }

    /// Calculate Ebbinghaus decay: R = e^(-t/S)
    /// where t = hours since last access, S = stability (higher = slower decay)
    pub fn update_decay(&mut self) {
        let hours_since_access = (Utc::now() - self.last_accessed).num_minutes() as f64 / 60.0;
        // Stability increases with access count and importance
        let stability = 24.0 * (1.0 + self.access_count as f64 * 0.5 + self.importance as f64);
        self.decay_score = (-hours_since_access / stability).exp() as f32;
    }

    /// Combined relevance score for ranking
    pub fn relevance_score(&self) -> f32 {
        self.importance * 0.4 + self.decay_score * 0.4 + (self.access_count as f32).ln_1p() * 0.2
    }
}

/// A session summary produced by the consolidation pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub agent_name: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub total_rounds: usize,
    pub total_tools: usize,
    /// One-paragraph summary of what happened
    pub summary: String,
    /// Key facts extracted from this session
    pub facts: Vec<String>,
    /// Files touched
    pub files: Vec<String>,
    /// Tools used
    pub tools_used: Vec<String>,
}

/// BM25 index for fast keyword search over memory entries
pub struct Bm25Index {
    /// term → [(entry_id, term_frequency)]
    pub inverted_index: HashMap<String, Vec<(String, u32)>>,
    /// entry_id → document length (in tokens)
    pub doc_lengths: HashMap<String, u32>,
    /// Total number of documents
    pub doc_count: u32,
    /// Average document length
    pub avg_doc_length: f64,
}

impl Bm25Index {
    pub fn new() -> Self {
        Self {
            inverted_index: HashMap::new(),
            doc_lengths: HashMap::new(),
            doc_count: 0,
            avg_doc_length: 0.0,
        }
    }

    /// Tokenize text into searchable terms.
    /// Splits on whitespace and punctuation, lowercases, includes character bigrams for CJK.
    pub fn tokenize(text: &str) -> Vec<String> {
        let lower = text.to_lowercase();
        let mut tokens = Vec::new();

        // Split on whitespace and punctuation, keep ASCII alphanumeric runs.
        // CJK characters are emitted individually for unigram matching.
        let mut current = String::new();
        for ch in lower.chars() {
            let is_cjk = !ch.is_ascii() && !ch.is_whitespace() && ch.is_alphanumeric();
            if is_cjk {
                // Flush current buffer before CJK character
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
                tokens.push(ch.to_string());
            } else if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                current.push(ch);
            } else {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
        }
        if !current.is_empty() {
            tokens.push(current);
        }

        // Add character bigrams for better CJK matching
        let chars: Vec<char> = lower.chars().filter(|c| !c.is_whitespace()).collect();
        for window in chars.windows(2) {
            let bigram: String = window.iter().collect();
            tokens.push(bigram);
        }

        tokens
    }

    /// Add a document to the index
    pub fn add_document(&mut self, doc_id: String, text: &str) {
        let tokens = Self::tokenize(text);
        let doc_len = tokens.len() as u32;

        // Count term frequencies
        let mut tf: HashMap<String, u32> = HashMap::new();
        for token in &tokens {
            *tf.entry(token.clone()).or_insert(0) += 1;
        }

        // Add to inverted index
        for (term, freq) in &tf {
            self.inverted_index
                .entry(term.clone())
                .or_default()
                .push((doc_id.clone(), *freq));
        }

        self.doc_lengths.insert(doc_id, doc_len);
        self.doc_count += 1;

        // Recalculate average doc length
        let total_len: u32 = self.doc_lengths.values().sum();
        self.avg_doc_length = total_len as f64 / self.doc_count as f64;
    }

    /// Remove a document from the index
    pub fn remove_document(&mut self, doc_id: &str) {
        self.doc_lengths.remove(doc_id);
        for postings in self.inverted_index.values_mut() {
            postings.retain(|(id, _)| id != doc_id);
        }
        // Clean up empty terms
        self.inverted_index.retain(|_, postings| !postings.is_empty());

        if self.doc_count > 0 {
            self.doc_count -= 1;
            let total_len: u32 = self.doc_lengths.values().sum();
            self.avg_doc_length = if self.doc_count > 0 {
                total_len as f64 / self.doc_count as f64
            } else {
                0.0
            };
        }
    }

    /// Search with BM25 scoring.
    /// k1 = 1.2, b = 0.75 (standard defaults)
    pub fn search(&self, query: &str, top_k: usize) -> Vec<(String, f32)> {
        const K1: f32 = 1.2;
        const B: f32 = 0.75;

        let query_tokens = Self::tokenize(query);
        if query_tokens.is_empty() || self.doc_count == 0 {
            return Vec::new();
        }

        let mut scores: HashMap<String, f32> = HashMap::new();

        for term in &query_tokens {
            let Some(postings) = self.inverted_index.get(term) else {
                continue;
            };

            // IDF: log((N - n + 0.5) / (n + 0.5) + 1)
            let n = postings.len() as f32;
            let n_docs = self.doc_count as f32;
            let idf = ((n_docs - n + 0.5) / (n + 0.5) + 1.0).ln();

            for (doc_id, tf) in postings {
                let doc_len = self.doc_lengths.get(doc_id).copied().unwrap_or(0) as f32;
                let avg_len = self.avg_doc_length as f32;

                // BM25 score for this term-document pair
                let tf_norm = (*tf as f32 * (K1 + 1.0))
                    / (*tf as f32 + K1 * (1.0 - B + B * doc_len / avg_len.max(1.0)));

                *scores.entry(doc_id.clone()).or_insert(0.0) += idf * tf_norm;
            }
        }

        let mut results: Vec<(String, f32)> = scores.into_iter().collect();
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        results
    }
}

/// In-memory memory index combining all tiers
pub struct MemoryIndex {
    pub entries: Vec<MemoryEntry>,
    pub bm25: Bm25Index,
}

impl MemoryIndex {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            bm25: Bm25Index::new(),
        }
    }

    /// Add an entry and index it
    pub fn add(&mut self, entry: MemoryEntry) {
        self.bm25
            .add_document(entry.id.clone(), &entry.content);
        self.entries.push(entry);
    }

    /// Search by query, returning top-k results sorted by BM25 score * relevance
    pub fn search(&self, query: &str, top_k: usize) -> Vec<(&MemoryEntry, f32)> {
        let bm25_results = self.bm25.search(query, top_k * 3); // Over-fetch for re-ranking

        let entry_map: std::collections::HashMap<&str, &MemoryEntry> =
            self.entries.iter().map(|e| (e.id.as_str(), e)).collect();

        let mut results: Vec<(&MemoryEntry, f32)> = bm25_results
            .iter()
            .filter_map(|(id, bm25_score)| {
                entry_map.get(id.as_str()).map(|entry| {
                    // Combine BM25 score with relevance (importance + decay + access)
                    let combined = bm25_score * 0.6 + entry.relevance_score() * 0.4;
                    (*entry, combined)
                })
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        results
    }

    /// Update decay scores for all entries
    pub fn update_decay_scores(&mut self) {
        for entry in &mut self.entries {
            entry.update_decay();
        }
    }

    /// Remove entries below decay threshold
    pub fn evict_decayed(&mut self, threshold: f32) -> Vec<MemoryEntry> {
        let mut evicted = Vec::new();
        let mut retained = Vec::new();

        for entry in self.entries.drain(..) {
            if entry.decay_score < threshold && entry.importance < 0.8 {
                evicted.push(entry);
            } else {
                retained.push(entry);
            }
        }

        self.entries = retained;
        evicted
    }

    /// Get entries by tier
    pub fn entries_by_tier(&self, tier: MemoryTier) -> Vec<&MemoryEntry> {
        self.entries.iter().filter(|e| e.tier == tier).collect()
    }

    /// Get entries by session
    pub fn entries_by_session(&self, session_id: &str) -> Vec<&MemoryEntry> {
        self.entries
            .iter()
            .filter(|e| e.session_id == session_id)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn tokenize_splits_on_whitespace_and_punctuation() {
        let tokens = Bm25Index::tokenize("Hello, world! This is a test.");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"this".to_string()));
        assert!(tokens.contains(&"test".to_string()));
    }

    #[test]
    fn tokenize_handles_cjk() {
        let tokens = Bm25Index::tokenize("认证中间件");
        // Should have individual characters and bigrams
        assert!(tokens.contains(&"认".to_string()));
        assert!(tokens.contains(&"认证".to_string()));
        assert!(tokens.contains(&"证中".to_string()));
    }

    #[test]
    fn tokenize_lowercases() {
        let tokens = Bm25Index::tokenize("JWT Authentication");
        assert!(tokens.contains(&"jwt".to_string()));
        assert!(tokens.contains(&"authentication".to_string()));
    }

    #[test]
    fn bm25_search_returns_relevant_docs() {
        let mut index = Bm25Index::new();
        index.add_document("doc1".to_string(), "JWT authentication middleware for Express");
        index.add_document("doc2".to_string(), "Rate limiting with Redis");
        index.add_document("doc3".to_string(), "JWT token validation and refresh");

        let results = index.search("JWT authentication", 3);
        assert!(!results.is_empty());
        // doc1 and doc3 should rank highest
        let top_ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
        assert!(top_ids.contains(&"doc1"));
        assert!(top_ids.contains(&"doc3"));
    }

    #[test]
    fn bm25_remove_document() {
        let mut index = Bm25Index::new();
        index.add_document("doc1".to_string(), "hello world");
        index.add_document("doc2".to_string(), "hello rust");
        assert_eq!(index.doc_count, 2);

        index.remove_document("doc1");
        assert_eq!(index.doc_count, 1);

        let results = index.search("hello", 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "doc2");
    }

    #[test]
    fn memory_entry_decay_decreases_over_time() {
        let mut entry = MemoryEntry::new(
            MemoryTier::Semantic,
            "test".to_string(),
            "session-1".to_string(),
            "agent".to_string(),
        );
        entry.last_accessed = Utc::now() - chrono::Duration::hours(48);
        entry.update_decay();
        assert!(entry.decay_score < 1.0);
        assert!(entry.decay_score > 0.0);
    }

    #[test]
    fn memory_entry_access_increases_stability() {
        let mut entry = MemoryEntry::new(
            MemoryTier::Semantic,
            "test".to_string(),
            "session-1".to_string(),
            "agent".to_string(),
        );
        entry.last_accessed = Utc::now() - chrono::Duration::hours(48);
        entry.access_count = 10;
        entry.update_decay();
        let score_high_access = entry.decay_score;

        entry.access_count = 0;
        entry.update_decay();
        let score_low_access = entry.decay_score;

        assert!(
            score_high_access > score_low_access,
            "Higher access count should result in slower decay"
        );
    }

    #[test]
    fn memory_index_search_combines_bm25_and_relevance() {
        let mut index = MemoryIndex::new();

        let mut entry1 = MemoryEntry::new(
            MemoryTier::Semantic,
            "JWT authentication uses jose middleware".to_string(),
            "s1".to_string(),
            "agent".to_string(),
        );
        entry1.importance = 0.9;

        let mut entry2 = MemoryEntry::new(
            MemoryTier::Working,
            "JWT token was refreshed".to_string(),
            "s2".to_string(),
            "agent".to_string(),
        );
        entry2.importance = 0.3;

        index.add(entry1);
        index.add(entry2);

        let results = index.search("JWT authentication", 5);
        assert!(!results.is_empty());
        // Higher importance entry should rank higher
        assert_eq!(results[0].0.content, "JWT authentication uses jose middleware");
    }

    #[test]
    fn memory_index_evict_decayed() {
        let mut index = MemoryIndex::new();

        let mut old_entry = MemoryEntry::new(
            MemoryTier::Working,
            "old stuff".to_string(),
            "s1".to_string(),
            "agent".to_string(),
        );
        old_entry.last_accessed = Utc::now() - chrono::Duration::days(30);
        old_entry.importance = 0.2;
        old_entry.update_decay();

        let fresh_entry = MemoryEntry::new(
            MemoryTier::Semantic,
            "important fact".to_string(),
            "s2".to_string(),
            "agent".to_string(),
        );

        index.add(old_entry);
        index.add(fresh_entry);

        let evicted = index.evict_decayed(0.3);
        assert_eq!(evicted.len(), 1);
        assert_eq!(evicted[0].content, "old stuff");
        assert_eq!(index.entries.len(), 1);
    }
}
