//! MCP protocol layer
//!
//! Implements the core protocol definitions of Model Context Protocol and JSON-RPC 2.0
//! communication.

mod jsonrpc;
mod schema;
mod transport;
mod transport_remote;
pub mod types;

pub use jsonrpc::*;
pub use schema::*;
pub use transport::*;
pub use transport_remote::*;
