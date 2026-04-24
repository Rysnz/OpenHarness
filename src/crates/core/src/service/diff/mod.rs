//! Diff service module
//!
//! Provides unified diff calculation, merge, and status management.

mod engine;
pub mod service;
pub mod types;

pub use engine::DiffService;
pub use types::*;
