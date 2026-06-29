//! API utility macros — reduce error-handling boilerplate across Tauri commands.
//!
//! Usage from any `api/*.rs` module:
//! ```ignore
//! use crate::api::{api_err, api_try, api_service};
//! ```

/// Convert an error into a `String` for `Result<T, String>` Tauri return types.
///
/// Replaces the ubiquitous `.map_err(|e| e.to_string())` pattern.
#[macro_export]
macro_rules! api_err {
    ($expr:expr) => {
        $expr.map_err(|e| e.to_string())
    };
}

/// Shorthand: execute a fallible expression, propagate the `String` error.
///
/// Equivalent to `$expr.map_err(|e| e.to_string())?`.
#[macro_export]
macro_rules! api_try {
    ($expr:expr) => {
        $expr.map_err(|e| e.to_string())?
    };
}

/// Short-hand for "service not initialized" pattern.
///
/// ```ignore
/// let svc = api_service!(get_mcp_service().await, "MCP")?;
/// ```
#[macro_export]
macro_rules! api_service {
    ($expr:expr, $service_name:literal) => {
        $expr.ok_or_else(|| format!("{} service not initialized", $service_name))
    };
}
