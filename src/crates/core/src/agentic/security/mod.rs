//! Security module entry point
//!
//! This module exposes security-related types and analyzers.

pub mod shell;

// Re-export main types for convenient access
pub use shell::{
    RiskCategory, RiskLevel, ShellDialect, ShellDialectDetector, ShellRisk, ShellRiskAnalyzer,
    ShellRuleId,
};
