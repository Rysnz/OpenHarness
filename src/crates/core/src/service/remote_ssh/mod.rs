//! Remote SSH compatibility facade.
//!
//! The concrete SSH implementation now lives in [`crate::service::remote::ssh`].
//! This module remains as a stable compatibility layer for existing imports.

pub mod manager {
    pub use crate::service::remote::ssh::manager::*;
}
pub(crate) mod password_vault {
    pub use crate::service::remote::ssh::password_vault::*;
}
pub mod remote_fs {
    pub use crate::service::remote::ssh::remote_fs::*;
}
pub mod remote_terminal {
    pub use crate::service::remote::ssh::remote_terminal::*;
}
pub mod types {
    pub use crate::service::remote::ssh::types::*;
}
pub mod workspace_state {
    pub use crate::service::remote::ssh::workspace_state::*;
}

pub use crate::service::remote::ssh::*;
