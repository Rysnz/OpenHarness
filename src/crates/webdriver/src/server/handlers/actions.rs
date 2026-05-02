use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::ensure_session;
use crate::executor::BridgeExecutor;
use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformActionsRequest {
    actions: Vec<ActionSequence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionSequence {
    #[serde(rename = "key")]
    Key { id: String, actions: Vec<KeyAction> },
    #[serde(rename = "pointer")]
    Pointer {
        id: String,
        #[serde(default)]
        parameters: Option<Value>,
        actions: Vec<PointerAction>,
    },
    #[serde(rename = "wheel")]
    Wheel {
        id: String,
        actions: Vec<WheelAction>,
    },
    #[serde(rename = "none")]
    None {
        id: String,
        actions: Vec<PauseAction>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum KeyAction {
    #[serde(rename = "keyDown")]
    KeyDown { value: String },
    #[serde(rename = "keyUp")]
    KeyUp { value: String },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PointerAction {
    #[serde(rename = "pointerDown")]
    PointerDown { button: u32 },
    #[serde(rename = "pointerUp")]
    PointerUp { button: u32 },
    #[serde(rename = "pointerMove")]
    PointerMove {
        x: i32,
        y: i32,
        duration: Option<u64>,
        #[serde(default)]
        origin: Option<Value>,
    },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WheelAction {
    #[serde(rename = "scroll")]
    Scroll {
        x: i32,
        y: i32,
        #[serde(rename = "deltaX")]
        delta_x: i32,
        #[serde(rename = "deltaY")]
        delta_y: i32,
        #[serde(default)]
        duration: Option<u64>,
        #[serde(default)]
        origin: Option<Value>,
    },
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PauseAction {
    #[serde(rename = "pause")]
    Pause { duration: Option<u64> },
}

fn update_action_state(state: &mut crate::webdriver::ActionState, actions: &[ActionSequence]) {
    for action_sequence in actions {
        match action_sequence {
            ActionSequence::Key { actions, .. } => {
                update_key_state(state, actions);
            }
            ActionSequence::Pointer { id, actions, .. } => {
                update_pointer_state(state, id, actions);
            }
            ActionSequence::Wheel { .. } | ActionSequence::None { .. } => {}
        }
    }
}

fn update_key_state(state: &mut crate::webdriver::ActionState, actions: &[KeyAction]) {
    for action in actions {
        match action {
            KeyAction::KeyDown { value } => {
                state.pressed_keys.insert(value.clone());
            }
            KeyAction::KeyUp { value } => {
                state.pressed_keys.remove(value);
            }
            KeyAction::Pause { .. } => {}
        }
    }
}

fn update_pointer_state(
    state: &mut crate::webdriver::ActionState,
    pointer_id: &str,
    actions: &[PointerAction],
) {
    for action in actions {
        match action {
            PointerAction::PointerDown { button } => {
                state
                    .pressed_buttons
                    .entry(pointer_id.to_string())
                    .or_default()
                    .insert(*button);
            }
            PointerAction::PointerUp { button } => {
                release_pointer_button(state, pointer_id, *button);
            }
            PointerAction::PointerMove { .. } | PointerAction::Pause { .. } => {}
        }
    }
}

fn release_pointer_button(state: &mut crate::webdriver::ActionState, pointer_id: &str, button: u32) {
    let should_remove_source = state
        .pressed_buttons
        .get_mut(pointer_id)
        .map(|buttons| {
            buttons.remove(&button);
            buttons.is_empty()
        })
        .unwrap_or(false);

    if should_remove_source {
        state.pressed_buttons.remove(pointer_id);
    }
}

fn action_sequences_as_values(actions: &[ActionSequence]) -> Vec<Value> {
    serde_json::to_value(actions)
        .unwrap_or(Value::Array(Vec::new()))
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn release_payloads(action_state: crate::webdriver::ActionState) -> (Vec<String>, Vec<Value>) {
    let pressed_keys = action_state.pressed_keys.into_iter().collect::<Vec<_>>();
    let pressed_buttons = action_state
        .pressed_buttons
        .into_iter()
        .flat_map(|(source_id, buttons)| {
            buttons
                .into_iter()
                .map(move |button| json!({ "sourceId": source_id, "button": button }))
        })
        .collect();

    (pressed_keys, pressed_buttons)
}

pub async fn perform(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<PerformActionsRequest>,
) -> WebDriverResult {
    ensure_session(&state, &session_id).await?;
    let actions_value = action_sequences_as_values(&request.actions);
    BridgeExecutor::from_session_id(state.clone(), &session_id)
        .await?
        .perform_actions(&actions_value)
        .await?;

    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    update_action_state(&mut session.action_state, &request.actions);
    Ok(WebDriverResponse::null())
}

pub async fn release(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    ensure_session(&state, &session_id).await?;
    let action_state = {
        let sessions = state.sessions.read().await;
        sessions.get(&session_id)?.action_state.clone()
    };

    let (pressed_keys, pressed_buttons) = release_payloads(action_state);

    BridgeExecutor::from_session_id(state.clone(), &session_id)
        .await?
        .release_actions(pressed_keys, pressed_buttons)
        .await?;

    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    session.action_state = Default::default();
    Ok(WebDriverResponse::null())
}
