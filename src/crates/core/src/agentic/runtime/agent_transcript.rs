use super::agent_task::{now_ms, AgentTaskId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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

#[derive(Default)]
pub struct AgentTranscriptStore {
    inner: RwLock<HashMap<String, AgentTranscript>>,
}

impl AgentTranscriptStore {
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
    }

    pub async fn append_entry(&self, task_id: &AgentTaskId, entry: AgentTranscriptEntry) {
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

    pub async fn get(&self, task_id: &AgentTaskId) -> Option<AgentTranscript> {
        self.inner.read().await.get(task_id.as_str()).cloned()
    }

    pub async fn list(&self) -> Vec<AgentTranscript> {
        self.inner.read().await.values().cloned().collect()
    }
}
