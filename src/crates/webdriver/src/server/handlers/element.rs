use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ensure_session;
use crate::executor::BridgeExecutor;
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Deserialize)]
pub struct ElementLocationRequest {
    using: String,
    value: String,
}

#[derive(Debug, Deserialize)]
pub struct ElementValueRequest {
    text: Option<String>,
    value: Option<Vec<String>>,
}

async fn executor_for_session(
    state: Arc<AppState>,
    session_id: &str,
) -> Result<BridgeExecutor, WebDriverErrorResponse> {
    ensure_session(&state, session_id).await?;
    BridgeExecutor::from_session_id(state, session_id).await
}

fn success<T: Serialize>(value: T) -> WebDriverResult {
    Ok(WebDriverResponse::success(value))
}

fn null_success() -> WebDriverResult {
    Ok(WebDriverResponse::null())
}

fn first_element_or(result: Vec<Value>, message: &str) -> WebDriverResult {
    result
        .first()
        .cloned()
        .map(WebDriverResponse::success)
        .ok_or_else(|| WebDriverErrorResponse::no_such_element(message))
}

fn text_from_request(request: ElementValueRequest) -> String {
    request
        .text
        .or_else(|| request.value.map(|items| items.join("")))
        .unwrap_or_default()
}

pub async fn find(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<ElementLocationRequest>,
) -> WebDriverResult {
    let result = executor_for_session(state, &session_id)
        .await?
        .find_elements(None, &request.using, &request.value)
        .await?;
    first_element_or(result, "No element matched the selector")
}

pub async fn find_all(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<ElementLocationRequest>,
) -> WebDriverResult {
    let result = executor_for_session(state, &session_id)
        .await?
        .find_elements(None, &request.using, &request.value)
        .await?;
    success(Value::Array(result))
}

pub async fn get_active(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let active = executor_for_session(state, &session_id)
        .await?
        .get_active_element()
        .await?;
    success(active)
}

pub async fn find_from_element(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
    Json(request): Json<ElementLocationRequest>,
) -> WebDriverResult {
    let result = executor_for_session(state, &session_id)
        .await?
        .find_elements(Some(element_id), &request.using, &request.value)
        .await?;
    first_element_or(result, "No child element matched the selector")
}

pub async fn find_all_from_element(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
    Json(request): Json<ElementLocationRequest>,
) -> WebDriverResult {
    let result = executor_for_session(state, &session_id)
        .await?
        .find_elements(Some(element_id), &request.using, &request.value)
        .await?;
    success(Value::Array(result))
}

pub async fn is_selected(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .is_element_selected(&element_id)
        .await?;
    success(value)
}

pub async fn is_displayed(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .is_element_displayed(&element_id)
        .await?;
    success(value)
}

pub async fn get_attribute(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_attribute(&element_id, &name)
        .await?;
    success(value)
}

pub async fn get_property(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_property(&element_id, &name)
        .await?;
    success(value)
}

pub async fn get_css_value(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id, property_name)): Path<(String, String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_css_value(&element_id, &property_name)
        .await?;
    success(value)
}

pub async fn get_text(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_text(&element_id)
        .await?;
    success(value)
}

pub async fn get_computed_role(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_computed_role(&element_id)
        .await?;
    success(value)
}

pub async fn get_computed_label(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_computed_label(&element_id)
        .await?;
    success(value)
}

pub async fn get_name(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_name(&element_id)
        .await?;
    success(value)
}

pub async fn get_rect(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .get_element_rect(&element_id)
        .await?;
    success(value)
}

pub async fn is_enabled(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    let value = executor_for_session(state, &session_id)
        .await?
        .is_element_enabled(&element_id)
        .await?;
    success(value)
}

pub async fn click(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    executor_for_session(state, &session_id)
        .await?
        .click_element_by_id(&element_id)
        .await?;
    null_success()
}

pub async fn clear(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
    executor_for_session(state, &session_id)
        .await?
        .clear_element_by_id(&element_id)
        .await?;
    null_success()
}

pub async fn send_keys(
    State(state): State<Arc<AppState>>,
    Path((session_id, element_id)): Path<(String, String)>,
    Json(request): Json<ElementValueRequest>,
) -> WebDriverResult {
    let text = text_from_request(request);

    executor_for_session(state, &session_id)
        .await?
        .send_keys_to_element(&element_id, &text)
        .await?;
    null_success()
}
