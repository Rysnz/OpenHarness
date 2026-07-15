//! Platform-agnostic business handlers
//!
//! These functions encapsulate all business logic and can be called by different platforms

use crate::dto::*;
use anyhow::Result;
use log::{debug, info};
use openharness_transport::TransportAdapter;
use std::sync::Arc;

/// Core application state
pub struct CoreAppState {
    pub app_start_time: std::time::Instant,
    /// Workspace root directory — used to sandbox file read/write operations.
    pub workspace_root: std::path::PathBuf,
    /// Pre-computed canonical root for path traversal checks (avoid I/O on every request).
    canonical_root: std::path::PathBuf,
}

impl CoreAppState {
    pub fn new(workspace_root: std::path::PathBuf) -> Self {
        let canonical_root = std::fs::canonicalize(&workspace_root)
            .unwrap_or_else(|_| workspace_root.clone());
        Self {
            app_start_time: std::time::Instant::now(),
            workspace_root,
            canonical_root,
        }
    }
}

impl Default for CoreAppState {
    fn default() -> Self {
        Self::new(std::path::PathBuf::from("."))
    }
}

/// Execute agent task
pub async fn handle_execute_agent_task(
    _state: &CoreAppState,
    _transport: Arc<dyn TransportAdapter>,
    request: ExecuteAgentRequest,
) -> Result<ExecuteAgentResponse> {
    info!(
        "Executing agent task: agent_type={}, message_length={}",
        request.agent_type,
        request.user_message.len()
    );

    Ok(ExecuteAgentResponse {
        session_id: uuid::Uuid::new_v4().to_string(),
        turn_id: uuid::Uuid::new_v4().to_string(),
        status: "started".to_string(),
        message: Some("Task execution started".to_string()),
    })
}

/// Get session history
pub async fn handle_get_session_history(
    _state: &CoreAppState,
    request: GetSessionHistoryRequest,
) -> Result<SessionHistoryResponse> {
    debug!("Getting session history: session_id={}", request.session_id);

    Ok(SessionHistoryResponse {
        session_id: request.session_id,
        turns: vec![],
    })
}

/// Sanitize a user-supplied path against path traversal.
/// Resolves relative components (..) and verifies the result stays inside `workspace_root`.
/// Uses the pre-computed canonical root from state to avoid I/O on every request.
fn sanitize_path(state: &CoreAppState, user_path: &str) -> Result<std::path::PathBuf> {
    let resolved = state.workspace_root.join(user_path.trim_start_matches('/').trim_start_matches('\\'));
    let canonical = std::fs::canonicalize(&resolved)
        .map_err(|e| anyhow::anyhow!("Invalid or inaccessible path: {}", e))?;
    if !canonical.starts_with(&state.canonical_root) {
        return Err(anyhow::anyhow!("Path traversal detected"));
    }
    Ok(canonical)
}

/// Read file content
pub async fn handle_read_file(
    state: &CoreAppState,
    request: ReadFileRequest,
) -> Result<ReadFileResponse> {
    let safe_path = sanitize_path(state, &request.path)?;
    let content = std::fs::read_to_string(&safe_path)?;

    Ok(ReadFileResponse {
        content,
        total_lines: None,
    })
}

/// Write file content
pub async fn handle_write_file(
    state: &CoreAppState,
    request: WriteFileRequest,
) -> Result<SuccessResponse> {
    let safe_path = sanitize_path(state, &request.path)?;

    if request.create_dirs.unwrap_or(false) {
        if let Some(parent) = safe_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::write(&safe_path, request.content)?;

    Ok(SuccessResponse {
        success: true,
        message: Some(format!("File written: {}", safe_path.display())),
        data: None,
    })
}

/// Health check
pub async fn handle_health_check(state: &CoreAppState) -> Result<HealthResponse> {
    Ok(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: state.app_start_time.elapsed().as_secs(),
        active_sessions: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_check() {
        let state = CoreAppState::new();
        let response = handle_health_check(&state)
            .await
            .expect("health check should always succeed");
        assert_eq!(response.status, "healthy");
    }
}
