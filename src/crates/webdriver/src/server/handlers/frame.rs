use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use super::get_session;
use crate::executor::BridgeExecutor;
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;
use crate::webdriver::FrameId;

const W3C_ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";
const JSONWIRE_ELEMENT_KEY: &str = "ELEMENT";
const INVALID_FRAME_REFERENCE: &str =
    "Frame reference must be null, an index, or an element reference";
const FRAME_NOT_FOUND: &str = "Unable to locate frame";

#[derive(Debug, Deserialize)]
pub struct SwitchFrameRequest {
    id: Value,
}

pub async fn switch_to_frame(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<SwitchFrameRequest>,
) -> WebDriverResult {
    match request.id {
        Value::Null => clear_frame_context(&state, &session_id).await,
        Value::Number(number) => {
            let index = parse_frame_index(number)?;
            validate_frame_index(state.clone(), &session_id, index).await?;
            push_frame_context(&state, &session_id, FrameId::Index(index)).await
        }
        Value::Object(obj) => {
            let element_id = extract_frame_element_id(&obj)?;
            validate_frame_element(state.clone(), &session_id, &element_id).await?;
            push_frame_context(&state, &session_id, FrameId::Element(element_id)).await
        }
        _ => Err(invalid_frame_reference()),
    }
}

pub async fn switch_to_parent_frame(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let _session = get_session(&state, &session_id).await?;
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    session.frame_context.pop();
    Ok(WebDriverResponse::null())
}

async fn clear_frame_context(state: &Arc<AppState>, session_id: &str) -> WebDriverResult {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(session_id)?;
    session.frame_context.clear();
    Ok(WebDriverResponse::null())
}

async fn push_frame_context(
    state: &Arc<AppState>,
    session_id: &str,
    frame_id: FrameId,
) -> WebDriverResult {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(session_id)?;
    session.frame_context.push(frame_id);
    Ok(WebDriverResponse::null())
}

fn parse_frame_index(number: serde_json::Number) -> Result<u32, WebDriverErrorResponse> {
    let index = number.as_u64().ok_or_else(|| {
        WebDriverErrorResponse::invalid_argument("Frame index must be a non-negative integer")
    })?;

    u32::try_from(index)
        .map_err(|_| WebDriverErrorResponse::invalid_argument("Frame index too large"))
}

fn extract_frame_element_id(
    obj: &serde_json::Map<String, Value>,
) -> Result<String, WebDriverErrorResponse> {
    obj.get(W3C_ELEMENT_KEY)
        .or_else(|| obj.get(JSONWIRE_ELEMENT_KEY))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(invalid_frame_reference)
}

async fn validate_frame_index(
    state: Arc<AppState>,
    session_id: &str,
    index: u32,
) -> Result<(), WebDriverErrorResponse> {
    BridgeExecutor::from_session_id(state, session_id)
        .await?
        .validate_frame_index(index)
        .await
        .map_err(|_| WebDriverErrorResponse::no_such_frame(FRAME_NOT_FOUND))
}

async fn validate_frame_element(
    state: Arc<AppState>,
    session_id: &str,
    element_id: &str,
) -> Result<(), WebDriverErrorResponse> {
    BridgeExecutor::from_session_id(state, session_id)
        .await?
        .validate_frame_element(element_id)
        .await
        .map_err(|_| WebDriverErrorResponse::no_such_frame(FRAME_NOT_FOUND))
}

fn invalid_frame_reference() -> WebDriverErrorResponse {
    WebDriverErrorResponse::invalid_argument(INVALID_FRAME_REFERENCE)
}
