//! Shell Security Module
//!
//! Provides shell command risk analysis for agent tool execution.
//! Supports PowerShell, cmd, bash, and zsh dialects.

mod analyzer;
mod ast;
mod dialect;
mod risk;
mod rules;

pub use analyzer::ShellRiskAnalyzer;
pub use dialect::{ShellDialect, ShellDialectDetector};
pub use risk::{RiskCategory, RiskLevel, ShellRisk};
pub use rules::ShellRuleId;
