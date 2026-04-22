//! Shell rule identifiers
//!
//! Defines unique identifiers for shell security rules.

use serde::{Deserialize, Serialize};

/// Shell security rule ID
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ShellRuleId {
    // Blocked rules (cannot be overridden)
    /// rm -rf / or similar root delete
    RmRfRoot,
    /// PowerShell Remove-Item -Recurse -Force C:\
    PowershellRootDelete,
    /// Encoded command execution
    PowershellEncodedCommand,
    /// Download and pipe to shell
    CurlPipeShell,
    WgetPipeShell,
    /// Credential leak
    EnvCredentialLeak,
    /// Privilege escalation attempt
    SudoWithoutPassword,
    SudoShellEscape,

    // High risk rules (require approval)
    /// Recursive delete in user directory
    RmRfRecursive,
    /// Git reset --hard with uncommitted changes
    GitResetHard,
    /// Git clean -fd (deletes untracked files)
    GitCleanForce,
    /// Process kill commands
    KillCommand,
    PkillCommand,
    KillallCommand,
    /// Heredoc with shell execution
    HeredocShell,
    /// Format filesystem
    MkfsCommand,
    /// DD command (disk operations)
    DdCommand,
    /// Shutdown/reboot
    ShutdownCommand,
    RebootCommand,

    // Medium risk rules (require approval)
    /// File write outside workspace
    CrossWorkspaceWrite,
    /// Remove-Item with -Recurse
    PowershellRecursiveDelete,
    /// Del /s /q (recursive delete in cmd)
    CmdRecursiveDelete,
    /// Git operations that modify history
    GitPushForce,
    GitRebaseInteractive,
    /// Command substitution in arguments
    CommandSubstitution,
    /// Network operations
    CurlCommand,
    WgetCommand,
    NcCommand,
    /// PowerShell Invoke-Expression
    PowershellInvokeExpression,
    /// PowerShell aliases that could be dangerous
    PowershellDangerousAlias,

    // Low risk rules (logged but allowed)
    /// Standard file read
    StandardRead,
    /// Standard file write
    StandardWrite,
    /// Standard directory listing
    StandardList,
    /// Git read operations
    GitRead,
    /// Safe network request
    SafeNetworkRequest,
    /// No risk detected
    None,
}

impl ShellRuleId {
    /// Get the risk level for this rule
    pub fn risk_level(&self) -> crate::agentic::security::shell::risk::RiskLevel {
        use crate::agentic::security::shell::risk::RiskLevel;
        match self {
            // Blocked
            Self::RmRfRoot
            | Self::PowershellRootDelete
            | Self::PowershellEncodedCommand
            | Self::CurlPipeShell
            | Self::WgetPipeShell
            | Self::EnvCredentialLeak
            | Self::SudoWithoutPassword
            | Self::SudoShellEscape => RiskLevel::Blocked,

            // High risk
            Self::RmRfRecursive
            | Self::GitResetHard
            | Self::GitCleanForce
            | Self::KillCommand
            | Self::PkillCommand
            | Self::KillallCommand
            | Self::HeredocShell
            | Self::MkfsCommand
            | Self::DdCommand
            | Self::ShutdownCommand
            | Self::RebootCommand => RiskLevel::High,

            // Medium risk
            Self::CrossWorkspaceWrite
            | Self::PowershellRecursiveDelete
            | Self::CmdRecursiveDelete
            | Self::GitPushForce
            | Self::GitRebaseInteractive
            | Self::CommandSubstitution
            | Self::CurlCommand
            | Self::WgetCommand
            | Self::NcCommand
            | Self::PowershellInvokeExpression
            | Self::PowershellDangerousAlias => RiskLevel::Medium,

            // Low risk
            Self::StandardRead
            | Self::StandardWrite
            | Self::StandardList
            | Self::GitRead
            | Self::SafeNetworkRequest
            | Self::None => RiskLevel::Low,
        }
    }

    /// Get human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            Self::RmRfRoot => "Root filesystem delete attempt blocked",
            Self::PowershellRootDelete => "PowerShell root drive delete blocked",
            Self::PowershellEncodedCommand => "Encoded command execution blocked",
            Self::CurlPipeShell => "Download and pipe to shell blocked",
            Self::WgetPipeShell => "Download and pipe to shell blocked",
            Self::EnvCredentialLeak => "Potential credential leak blocked",
            Self::SudoWithoutPassword => "Sudo without password blocked",
            Self::SudoShellEscape => "Sudo shell escape blocked",
            Self::RmRfRecursive => "Recursive delete requires approval",
            Self::GitResetHard => "Git reset --hard requires approval",
            Self::GitCleanForce => "Git clean -fd requires approval",
            Self::KillCommand => "Process kill requires approval",
            Self::PkillCommand => "Process kill requires approval",
            Self::KillallCommand => "Process kill requires approval",
            Self::HeredocShell => "Heredoc shell execution requires approval",
            Self::MkfsCommand => "Filesystem format requires approval",
            Self::DdCommand => "Disk operation requires approval",
            Self::ShutdownCommand => "System shutdown requires approval",
            Self::RebootCommand => "System reboot requires approval",
            Self::CrossWorkspaceWrite => "Cross-workspace write requires approval",
            Self::PowershellRecursiveDelete => "Recursive delete requires approval",
            Self::CmdRecursiveDelete => "Recursive delete requires approval",
            Self::GitPushForce => "Force push requires approval",
            Self::GitRebaseInteractive => "Interactive rebase requires approval",
            Self::CommandSubstitution => "Command substitution requires approval",
            Self::CurlCommand => "Network download requires approval",
            Self::WgetCommand => "Network download requires approval",
            Self::NcCommand => "Network connection requires approval",
            Self::PowershellInvokeExpression => "Dynamic code execution requires approval",
            Self::PowershellDangerousAlias => "Dangerous PowerShell alias detected",
            Self::StandardRead => "Standard file read",
            Self::StandardWrite => "Standard file write",
            Self::StandardList => "Standard directory listing",
            Self::GitRead => "Git read operation",
            Self::SafeNetworkRequest => "Safe network request",
            Self::None => "No risk detected",
        }
    }
}

impl std::fmt::Display for ShellRuleId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl From<ShellRuleId> for String {
    fn from(rule_id: ShellRuleId) -> Self {
        format!("{:?}", rule_id)
    }
}
