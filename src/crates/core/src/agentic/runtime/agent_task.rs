use super::workspace_binding::WorkspaceBinding;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct AgentTaskId(pub String);

impl AgentTaskId {
    pub fn new() -> Self {
        Self(format!("agtask-{}", uuid::Uuid::new_v4()))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for AgentTaskId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for AgentTaskId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for AgentTaskId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentTaskStatus {
    Queued,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

impl AgentTaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            AgentTaskStatus::Succeeded
                | AgentTaskStatus::Failed
                | AgentTaskStatus::Cancelled
                | AgentTaskStatus::Interrupted
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentTaskKind {
    Foreground,
    Child,
    Background,
    TeamMember,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ForkContextMode {
    #[default]
    Fresh,
    InheritParent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskConfig {
    pub agent_name: String,
    pub prompt: String,
    pub parent_task_id: Option<AgentTaskId>,
    pub session_id: Option<String>,
    pub workspace_binding: WorkspaceBinding,
    pub fork_context: ForkContextMode,
    pub max_turns: Option<u32>,
    pub allowed_tools: Vec<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskSnapshot {
    pub task_id: AgentTaskId,
    pub status: AgentTaskStatus,
    pub kind: AgentTaskKind,
    pub config: AgentTaskConfig,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub last_error: Option<String>,
    pub result_summary: Option<String>,
    pub transcript_ref: Option<String>,
}

impl AgentTaskSnapshot {
    pub fn new(config: AgentTaskConfig, kind: AgentTaskKind) -> Self {
        Self {
            task_id: AgentTaskId::new(),
            status: AgentTaskStatus::Queued,
            kind,
            config,
            created_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
            last_error: None,
            result_summary: None,
            transcript_ref: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AgentTaskFilter {
    pub statuses: Option<Vec<AgentTaskStatus>>,
    pub kinds: Option<Vec<AgentTaskKind>>,
    pub parent_task_id: Option<AgentTaskId>,
    pub session_id: Option<String>,
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
