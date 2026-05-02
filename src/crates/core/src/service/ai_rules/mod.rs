//! AI rules management service
//!
//! Provides management of project-level and user-level AI rules.
//! Supports creating, reading, updating, and deleting rules.

mod rule_model;
pub mod service;
pub mod types;

pub use rule_model::*;
pub use service::{
    get_global_ai_rules_service, initialize_global_ai_rules_service,
    is_global_ai_rules_service_initialized, AIRulesService, FileRulesResult,
};
