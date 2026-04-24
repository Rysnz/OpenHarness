//! Coordination layer
//!
//! Top-level component that integrates all subsystems

pub mod coordinator;
mod dispatch_queue;
pub mod scheduler;
pub mod state_manager;
pub mod turn_outcome;

pub use coordinator::*;
pub use dispatch_queue::*;
pub use state_manager::*;
pub use turn_outcome::*;

pub use coordinator::get_global_coordinator;
pub use dispatch_queue::get_global_scheduler;
