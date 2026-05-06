use std::sync::Arc;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use std::time::Duration;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use crate::runtime::{script, BridgeError, BridgeResponse};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use tokio::sync::oneshot;

use crate::server::{response::WebDriverErrorResponse, AppState};
use serde_json::Value;
use tauri::Webview;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

pub(crate) async fn evaluate_script<R: tauri::Runtime>(
    state: Arc<AppState>,
    webview: Webview<R>,
    timeout_ms: u64,
    script_source: &str,
    args: &[Value],
    async_mode: bool,
    frame_context: &Value,
) -> Result<Value, WebDriverErrorResponse> {
    #[cfg(target_os = "macos")]
    {
        let _ = state;
        return macos::evaluate_script(
            webview,
            timeout_ms,
            script_source,
            args,
            async_mode,
            frame_context,
        )
        .await;
    }

    #[cfg(target_os = "windows")]
    {
        return windows::evaluate_script(
            state,
            webview,
            timeout_ms,
            script_source,
            args,
            async_mode,
            frame_context,
        )
        .await;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let (request_id, receiver) = register_pending_request(&state)?;
        let injected = script::build_bridge_eval_script(
            &request_id,
            script_source,
            args,
            async_mode,
            frame_context,
        );

        evaluate_bridge_script(&state, &webview, &request_id, &injected)?;
        let response = wait_for_bridge_response(&state, &request_id, timeout_ms, receiver).await?;

        return bridge_response_to_value(response);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn register_pending_request(
    state: &AppState,
) -> Result<(String, oneshot::Receiver<BridgeResponse>), WebDriverErrorResponse> {
    let request_id = state.next_request_id();
    let (sender, receiver) = oneshot::channel();

    state
        .pending_requests
        .lock()
        .map_err(|_| WebDriverErrorResponse::unknown_error("Failed to lock pending request map"))?
        .insert(request_id.clone(), sender);

    Ok((request_id, receiver))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn evaluate_bridge_script<R: tauri::Runtime>(
    state: &AppState,
    webview: &Webview<R>,
    request_id: &str,
    injected: &str,
) -> Result<(), WebDriverErrorResponse> {
    webview.eval(injected).map_err(|error| {
        remove_pending_request(state, request_id);
        WebDriverErrorResponse::javascript_error(
            format!("Failed to evaluate script: {error}"),
            None,
        )
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn wait_for_bridge_response(
    state: &AppState,
    request_id: &str,
    timeout_ms: u64,
    receiver: oneshot::Receiver<BridgeResponse>,
) -> Result<BridgeResponse, WebDriverErrorResponse> {
    tokio::time::timeout(Duration::from_millis(timeout_ms), receiver)
        .await
        .map_err(|_| {
            remove_pending_request(state, request_id);
            WebDriverErrorResponse::timeout(format!("Script timed out after {timeout_ms}ms"))
        })?
        .map_err(|_| {
            WebDriverErrorResponse::unknown_error("Bridge response channel closed unexpectedly")
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn bridge_response_to_value(response: BridgeResponse) -> Result<Value, WebDriverErrorResponse> {
    if response.ok {
        return Ok(response.value.unwrap_or(Value::Null));
    }

    let error = response.error.unwrap_or(BridgeError {
        message: Some("Unknown JavaScript error".into()),
        stack: None,
    });

    Err(WebDriverErrorResponse::javascript_error(
        error
            .message
            .unwrap_or_else(|| "Unknown JavaScript error".into()),
        error.stack,
    ))
}

#[cfg(not(target_os = "macos"))]
pub(super) fn remove_pending_request(state: &AppState, request_id: &str) {
    if let Ok(mut pending) = state.pending_requests.lock() {
        pending.remove(request_id);
    }
}
