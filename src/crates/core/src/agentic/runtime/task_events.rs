use super::agent_task::{now_ms, AgentTaskId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentTaskEventKind {
    TaskStarted,
    ModelRequestStarted,
    TokenDelta,
    ToolCallQueued,
    ToolCallStarted,
    ToolCallWaitingApproval,
    ToolCallStreamChunk,
    ToolCallCompleted,
    ToolCallFailed,
    ToolCallCancelled,
    PatchReady,
    TaskSucceeded,
    TaskFailed,
    TaskCancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskEvent {
    pub event_id: String,
    pub task_id: AgentTaskId,
    pub kind: AgentTaskEventKind,
    pub timestamp_ms: u64,
    pub message: Option<String>,
    pub data: Option<Value>,
}

impl AgentTaskEvent {
    pub fn new(
        task_id: AgentTaskId,
        kind: AgentTaskEventKind,
        message: Option<String>,
        data: Option<Value>,
    ) -> Self {
        Self {
            event_id: format!("agtevt-{}", uuid::Uuid::new_v4()),
            task_id,
            kind,
            timestamp_ms: now_ms(),
            message,
            data,
        }
    }
}
