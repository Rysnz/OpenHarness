//! System service module
//!
//! Provides system info retrieval, command detection/execution, and
//! command security assessment.

mod command;
mod info;
pub mod security;

pub use command::*;
pub use info::*;
