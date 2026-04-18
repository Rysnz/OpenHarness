use crate::agentic::runtime::workspace_binding::WorkspaceIsolation;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Standard,
    Plan,
    Debug,
    Explore,
    Review,
    Custom(String),
}

impl Default for AgentMode {
    fn default() -> Self {
        Self::Standard
    }
}

impl AgentMode {
    pub fn from_str(raw: &str) -> Self {
        match raw.trim().to_lowercase().as_str() {
            "" | "standard" | "agentic" => Self::Standard,
            "plan" | "planning" => Self::Plan,
            "debug" => Self::Debug,
            "explore" => Self::Explore,
            "review" | "code_review" | "code-review" => Self::Review,
            other => Self::Custom(other.to_string()),
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Self::Standard => "standard".to_string(),
            Self::Plan => "plan".to_string(),
            Self::Debug => "debug".to_string(),
            Self::Explore => "explore".to_string(),
            Self::Review => "review".to_string(),
            Self::Custom(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    Default,
    Ask,
    Allow,
    Deny,
    Custom(String),
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::Default
    }
}

impl PermissionMode {
    pub fn from_str(raw: &str) -> Self {
        match raw.trim().to_lowercase().as_str() {
            "" | "default" => Self::Default,
            "ask" => Self::Ask,
            "allow" | "allow_all" | "always_allow" => Self::Allow,
            "deny" | "deny_all" => Self::Deny,
            other => Self::Custom(other.to_string()),
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Self::Default => "default".to_string(),
            Self::Ask => "ask".to_string(),
            Self::Allow => "allow".to_string(),
            Self::Deny => "deny".to_string(),
            Self::Custom(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentMemoryConfig {
    pub enabled: bool,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentHookConfig {
    pub before_agent_start: Vec<String>,
    pub before_model_request: Vec<String>,
    pub before_tool_call: Vec<String>,
    pub after_tool_result: Vec<String>,
    pub before_agent_finish: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub mode: AgentMode,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub max_turns: Option<u32>,
    pub permission_mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub skills: Vec<String>,
    pub memory: AgentMemoryConfig,
    pub hooks: AgentHookConfig,
    pub isolation: WorkspaceIsolation,
    pub cwd: Option<PathBuf>,
}
