//! LSP compatibility facade.
//!
//! The concrete implementation now lives in [`crate::service::language_server`].
//! This module remains as a stable compatibility layer for existing imports.

pub mod config_watcher {
    pub use crate::service::language_server::config_watcher::*;
}
pub mod debouncer {
    pub use crate::service::language_server::debouncer::*;
}
pub mod file_sync {
    pub use crate::service::language_server::file_sync::*;
}
pub mod global {
    pub use crate::service::language_server::global::*;
}
pub mod manager {
    pub use crate::service::language_server::manager::*;
}
pub mod plugin_loader {
    pub use crate::service::language_server::plugin_loader::*;
}
pub mod process {
    pub use crate::service::language_server::process::*;
}
pub mod project_detector {
    pub use crate::service::language_server::project_detector::*;
}
pub mod protocol {
    pub use crate::service::language_server::protocol::*;
}
pub mod registry {
    pub use crate::service::language_server::registry::*;
}
pub mod types {
    pub use crate::service::language_server::types::*;
}
pub mod workspace_manager {
    pub use crate::service::language_server::workspace_manager::*;
}

pub use crate::service::language_server::*;
