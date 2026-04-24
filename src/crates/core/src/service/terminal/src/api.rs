//! Compatibility namespace for terminal API consumers.
//!
//! The implementation lives in `public_api` so the crate root can expose a
//! stable facade while the internal layout continues to evolve.

pub use crate::public_api::*;
