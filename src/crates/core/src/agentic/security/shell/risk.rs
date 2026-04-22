//! Shell risk definitions
//!
//! Defines risk levels and categories for shell command analysis.

use serde::{Deserialize, Serialize};

/// Risk level for shell commands
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    #[default]
    Low,
    Medium,
    High,
    Blocked,
}

impl RiskLevel {
    /// Check if this risk level requires approval
    pub fn requires_approval(&self) -> bool {
        matches!(self, RiskLevel::Medium | RiskLevel::High)
    }

    /// Check if this risk level blocks execution
    pub fn is_blocked(&self) -> bool {
        matches!(self, RiskLevel::Blocked)
    }
}

/// Risk category for shell commands
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskCategory {
    /// Recursive delete operations
    RecursiveDelete,
    /// Root/system drive delete operations
    RootDelete,
    /// Destructive git operations
    GitDestructive,
    /// Encoded command execution
    EncodedCommand,
    /// Command substitution/injection
    CommandSubstitution,
    /// Heredoc with potentially dangerous content
    Heredoc,
    /// Download and pipe to shell
    DownloadPipeShell,
    /// Credential/environment leak
    CredentialLeak,
    /// Cross workspace path access
    CrossWorkspace,
    /// Privilege escalation
    PrivilegeEscalation,
    /// Process killing
    ProcessKill,
    /// File system damage
    FileSystemDamage,
    /// Network operation
    NetworkOperation,
    /// Unknown risk
    Unknown,
}

impl std::fmt::Display for RiskCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            RiskCategory::RecursiveDelete => "Recursive delete operation",
            RiskCategory::RootDelete => "Root/system drive delete operation",
            RiskCategory::GitDestructive => "Destructive git operation",
            RiskCategory::EncodedCommand => "Encoded command execution",
            RiskCategory::CommandSubstitution => "Command substitution/injection",
            RiskCategory::Heredoc => "Heredoc with dangerous content",
            RiskCategory::DownloadPipeShell => "Download and pipe to shell",
            RiskCategory::CredentialLeak => "Credential/environment leak",
            RiskCategory::CrossWorkspace => "Cross workspace path access",
            RiskCategory::PrivilegeEscalation => "Privilege escalation",
            RiskCategory::ProcessKill => "Process killing",
            RiskCategory::FileSystemDamage => "File system damage",
            RiskCategory::NetworkOperation => "Network operation",
            RiskCategory::Unknown => "Unknown risk",
        };
        write!(f, "{}", s)
    }
}

/// Shell risk analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellRisk {
    /// Overall risk level
    pub level: RiskLevel,
    /// Risk category
    pub category: RiskCategory,
    /// Human-readable reason
    pub reason: String,
    /// Rule that triggered this risk
    pub rule_id: String,
    /// Specific pattern that matched
    pub matched_pattern: Option<String>,
    /// Confidence level (0.0 - 1.0)
    pub confidence: f32,
}

impl ShellRisk {
    pub fn new(
        level: RiskLevel,
        category: RiskCategory,
        reason: String,
        rule_id: impl Into<String>,
    ) -> Self {
        Self {
            level,
            category,
            reason,
            rule_id: rule_id.into(),
            matched_pattern: None,
            confidence: 1.0,
        }
    }

    pub fn with_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.matched_pattern = Some(pattern.into());
        self
    }

    pub fn with_confidence(mut self, confidence: f32) -> Self {
        self.confidence = confidence.clamp(0.0, 1.0);
        self
    }
}

impl Default for ShellRisk {
    fn default() -> Self {
        Self {
            level: RiskLevel::Low,
            category: RiskCategory::Unknown,
            reason: "No risk detected".to_string(),
            rule_id: "none".to_string(),
            matched_pattern: None,
            confidence: 1.0,
        }
    }
}
