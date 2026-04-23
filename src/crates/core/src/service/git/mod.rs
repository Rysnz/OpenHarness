//! Git service compatibility facade.
//!
//! The concrete implementation now lives in [`crate::service::source_control::git`].
//! This module remains as a stable compatibility layer for existing imports.

pub mod git_service {
    pub use crate::service::source_control::git::git_service::*;
}
pub mod git_types {
    pub use crate::service::source_control::git::git_types::*;
}
pub mod git_utils {
    pub use crate::service::source_control::git::git_utils::*;
}
pub mod graph {
    pub use crate::service::source_control::git::graph::*;
}

pub use crate::service::source_control::git::*;
