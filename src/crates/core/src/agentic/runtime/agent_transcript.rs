use super::agent_task::{now_ms, AgentTaskId};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentTranscriptEntry {
    InitialPrompt {
        prompt: String,
    },
    InheritedContext {
        summary: String,
    },
    ModelMessage {
        text: String,
    },
    ToolCall {
        tool_name: String,
        tool_call_id: Option<String>,
        input: Option<Value>,
    },
    ToolResult {
        tool_name: String,
        success: bool,
        output: Option<Value>,
    },
    PermissionDecision {
        tool_name: String,
        decision: String,
        reason: Option<String>,
    },
    PatchRecord {
        patch_id: String,
        summary: String,
    },
    FinalResult {
        summary: String,
    },
    Failure {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTranscript {
    pub task_id: AgentTaskId,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub entries: Vec<AgentTranscriptEntry>,
}

pub struct AgentTranscriptStore {
    inner: RwLock<HashMap<String, AgentTranscript>>,
    persistence_path: Option<PathBuf>,
}

impl Default for AgentTranscriptStore {
    fn default() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            persistence_path: None,
        }
    }
}

impl AgentTranscriptStore {
    /// Create a new store with disk persistence at the given path.
    pub fn with_persistence(path: PathBuf) -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            persistence_path: Some(path),
        }
    }

    /// Load persisted transcripts from disk.
    pub async fn load_from_disk(&self) {
        let Some(path) = &self.persistence_path else {
            return;
        };

        if !path.exists() {
            return;
        }

        match tokio::fs::read_to_string(path).await {
            Ok(content) => match serde_json::from_str::<HashMap<String, AgentTranscript>>(&content) {
                Ok(loaded) => {
                    let count = loaded.len();
                    *self.inner.write().await = loaded;
                    debug!("Loaded {} persisted transcripts from disk", count);
                }
                Err(e) => {
                    warn!("Failed to parse persisted transcripts: {}", e);
                }
            },
            Err(e) => {
                warn!("Failed to read persisted transcripts: {}", e);
            }
        }
    }

    /// Persist transcripts to disk.
    async fn persist_to_disk(&self) {
        let Some(path) = &self.persistence_path else {
            return;
        };

        let map = self.inner.read().await;
        match serde_json::to_string_pretty(&*map) {
            Ok(json) => {
                if let Some(parent) = path.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                if let Err(e) = tokio::fs::write(path, json).await {
                    warn!("Failed to persist transcripts: {}", e);
                }
            }
            Err(e) => {
                warn!("Failed to serialize transcripts: {}", e);
            }
        }
    }

    pub async fn start_transcript(&self, task_id: &AgentTaskId, prompt: String) {
        let now = now_ms();
        let transcript = AgentTranscript {
            task_id: task_id.clone(),
            created_at_ms: now,
            updated_at_ms: now,
            entries: vec![AgentTranscriptEntry::InitialPrompt { prompt }],
        };

        self.inner
            .write()
            .await
            .insert(task_id.as_str().to_string(), transcript);

        self.persist_to_disk().await;
    }

    pub async fn append_entry(&self, task_id: &AgentTaskId, entry: AgentTranscriptEntry) {
        {
            let mut map = self.inner.write().await;
            let record = map
                .entry(task_id.as_str().to_string())
                .or_insert_with(|| AgentTranscript {
                    task_id: task_id.clone(),
                    created_at_ms: now_ms(),
                    updated_at_ms: now_ms(),
                    entries: Vec::new(),
                });

            record.entries.push(entry);
            record.updated_at_ms = now_ms();
        }

        self.persist_to_disk().await;
    }

    pub async fn get(&self, task_id: &AgentTaskId) -> Option<AgentTranscript> {
        self.inner.read().await.get(task_id.as_str()).cloned()
    }

    pub async fn list(&self) -> Vec<AgentTranscript> {
        self.inner.read().await.values().cloned().collect()
    }

    /// Get count of transcripts (for diagnostics).
    pub async fn count(&self) -> usize {
        self.inner.read().await.len()
    }
}
