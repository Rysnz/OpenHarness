/**
 * Startchat Function Agent - type definitions
 *
 * Defines data structures for work state analysis and greeting info at session start
 */
use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! display_debug_name {
    ($type_name:ty) => {
        impl fmt::Display for $type_name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{:?}", self)
            }
        }
    };
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStateOptions {
    #[serde(default = "default_true")]
    pub analyze_git: bool,

    #[serde(default = "default_true")]
    pub predict_next_actions: bool,

    #[serde(default = "default_true")]
    pub include_quick_actions: bool,

    #[serde(default = "default_language")]
    pub language: Language,
}

fn default_true() -> bool {
    true
}

fn default_language() -> Language {
    Language::English
}

impl Default for WorkStateOptions {
    fn default() -> Self {
        Self {
            analyze_git: default_true(),
            predict_next_actions: default_true(),
            include_quick_actions: default_true(),
            language: default_language(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Language {
    Chinese,
    English,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStateAnalysis {
    pub greeting: GreetingMessage,

    pub current_state: CurrentWorkState,

    pub predicted_actions: Vec<PredictedAction>,

    pub quick_actions: Vec<QuickAction>,

    pub analyzed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GreetingMessage {
    pub title: String,

    pub subtitle: String,

    pub tagline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWorkState {
    pub summary: String,

    pub git_state: Option<GitWorkState>,

    pub ongoing_work: Vec<WorkItem>,

    pub time_info: TimeInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkState {
    pub current_branch: String,

    pub unstaged_files: u32,

    pub staged_files: u32,

    pub unpushed_commits: u32,

    pub ahead_behind: Option<AheadBehind>,

    /// List of modified files (show at most the first few)
    pub modified_files: Vec<FileModification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: u32,

    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileModification {
    pub path: String,

    pub change_type: FileChangeType,

    pub module: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

display_debug_name!(FileChangeType);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    pub title: String,

    pub description: String,

    pub related_files: Vec<String>,

    pub category: WorkCategory,

    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkCategory {
    Backend,
    Frontend,
    API,
    Database,
    Infrastructure,
    Testing,
    Documentation,
    Other,
}

display_debug_name!(WorkCategory);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeInfo {
    /// Minutes since last commit
    pub minutes_since_last_commit: Option<u64>,

    /// Last commit time description (e.g., "2 hours ago")
    pub last_commit_time_desc: Option<String>,

    /// Current time of day (morning/afternoon/evening)
    pub time_of_day: TimeOfDay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TimeOfDay {
    Morning,
    Afternoon,
    Evening,
    Night,
}

display_debug_name!(TimeOfDay);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictedAction {
    pub description: String,

    pub priority: ActionPriority,

    pub icon: String,

    pub is_reminder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
pub enum ActionPriority {
    High,
    Medium,
    Low,
}

display_debug_name!(ActionPriority);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAction {
    pub title: String,

    /// Action command (natural language)
    pub command: String,

    pub icon: String,

    pub action_type: QuickActionType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum QuickActionType {
    Continue,
    ViewStatus,
    Commit,
    Visualize,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIGeneratedAnalysis {
    pub summary: String,

    pub ongoing_work: Vec<WorkItem>,

    pub predicted_actions: Vec<PredictedAction>,

    pub quick_actions: Vec<QuickAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentError {
    pub message: String,
    pub error_type: AgentErrorType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentErrorType {
    GitError,
    AnalysisError,
    InvalidInput,
    InternalError,
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.error_type, self.message)
    }
}

impl std::error::Error for AgentError {}

impl AgentError {
    fn new(error_type: AgentErrorType, msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            error_type,
        }
    }

    pub fn git_error(msg: impl Into<String>) -> Self {
        Self::new(AgentErrorType::GitError, msg)
    }

    pub fn analysis_error(msg: impl Into<String>) -> Self {
        Self::new(AgentErrorType::AnalysisError, msg)
    }

    pub fn invalid_input(msg: impl Into<String>) -> Self {
        Self::new(AgentErrorType::InvalidInput, msg)
    }

    pub fn internal_error(msg: impl Into<String>) -> Self {
        Self::new(AgentErrorType::InternalError, msg)
    }
}

pub type AgentResult<T> = Result<T, AgentError>;
