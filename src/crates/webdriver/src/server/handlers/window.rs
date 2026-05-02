use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use tauri::Manager;

use super::{ensure_session, get_session};
use crate::executor::BridgeExecutor;
use crate::platform::WindowRect;
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Deserialize)]
pub struct SwitchWindowRequest {
    handle: String,
}

#[derive(Debug, Deserialize)]
pub struct NewWindowRequest {
    #[allow(dead_code)]
    #[serde(rename = "type", default)]
    window_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WindowRectRequest {
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

fn rect_response(rect: WindowRect) -> WebDriverResponse {
    WebDriverResponse::success(json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    }))
}

fn reset_session_window_state(
    session: &mut crate::webdriver::Session,
    window_handle: Option<String>,
) {
    if let Some(window_handle) = window_handle {
        session.current_window = window_handle;
    }
    session.frame_context.clear();
    session.action_state = Default::default();
}

async fn executor_for_window(
    state: Arc<AppState>,
    session_id: &str,
) -> Result<BridgeExecutor, WebDriverErrorResponse> {
    let _session = get_session(&state, session_id).await?;
    BridgeExecutor::from_session_id(state, session_id).await
}

fn requested_rect(current: WindowRect, request: WindowRectRequest) -> WindowRect {
    WindowRect {
        x: request.x.unwrap_or(current.x),
        y: request.y.unwrap_or(current.y),
        width: request.width.unwrap_or(current.width),
        height: request.height.unwrap_or(current.height),
    }
}

pub async fn get_window_handle(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let session = get_session(&state, &session_id).await?;
    Ok(WebDriverResponse::success(session.current_window))
}

pub async fn switch_to_window(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<SwitchWindowRequest>,
) -> WebDriverResult {
    if !state.has_window(&request.handle) {
        return Err(WebDriverErrorResponse::no_such_window(format!(
            "Unknown window handle: {}",
            request.handle
        )));
    }

    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    reset_session_window_state(session, Some(request.handle));

    Ok(WebDriverResponse::null())
}

pub async fn get_window_handles(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    ensure_session(&state, &session_id).await?;
    Ok(WebDriverResponse::success(state.window_labels()))
}

pub async fn close_window(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let current_window = get_session(&state, &session_id).await?.current_window;
    let window = state
        .app
        .get_webview_window(&current_window)
        .ok_or_else(|| {
            WebDriverErrorResponse::no_such_window(format!("Window not found: {current_window}"))
        })?;
    window.destroy().map_err(|error| {
        WebDriverErrorResponse::unknown_error(format!("Failed to close window: {error}"))
    })?;

    let handles = state.window_labels();
    let next_handle = handles.first().cloned();
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    reset_session_window_state(session, next_handle);
    Ok(WebDriverResponse::success(handles))
}

pub async fn new_window(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(_request): Json<NewWindowRequest>,
) -> WebDriverResult {
    ensure_session(&state, &session_id).await?;
    Err(WebDriverErrorResponse::unsupported_operation(
        "Creating new windows is not supported in this context",
    ))
}

pub async fn get_window_rect(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let rect = executor_for_window(state, &session_id)
        .await?
        .get_window_rect()
        .await?;
    Ok(rect_response(rect))
}

pub async fn set_window_rect(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<WindowRectRequest>,
) -> WebDriverResult {
    let executor = executor_for_window(state, &session_id).await?;
    let current = executor.get_window_rect().await?;
    let rect = executor
        .set_window_rect(requested_rect(current, request))
        .await?;
    Ok(rect_response(rect))
}

pub async fn maximize(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let rect = executor_for_window(state, &session_id)
        .await?
        .maximize_window()
        .await?;
    Ok(rect_response(rect))
}

pub async fn minimize(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    executor_for_window(state, &session_id)
        .await?
        .minimize_window()
        .await?;
    Ok(WebDriverResponse::null())
}

pub async fn fullscreen(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let rect = executor_for_window(state, &session_id)
        .await?
        .fullscreen_window()
        .await?;
    Ok(rect_response(rect))
}
