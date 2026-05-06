use crate::infrastructure::events::EventEmitter;
use crate::util::types::event::{ToolExecutionProgressInfo, ToolTerminalReadyInfo};
use anyhow::Result;
use log::{error, trace, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

const TOOL_PROGRESS_EVENT: &str = "backend-event-toolexecutionprogress";
const TOOL_TERMINAL_READY_EVENT: &str = "backend-event-toolterminalready";
const TOOL_AWAITING_INPUT_EVENT: &str = "backend-event-toolawaitinguserinput";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum BackendEvent {
    ToolExecutionProgress(ToolExecutionProgressInfo),
    ToolTerminalReady(ToolTerminalReadyInfo),
    ToolAwaitingUserInput {
        tool_id: String,
        session_id: String,
        questions: serde_json::Value,
    },
    Custom {
        event_name: String,
        payload: Value,
    },
}

pub struct BackendEventSystem {
    emitter: Arc<Mutex<Option<Arc<dyn EventEmitter>>>>,
}

impl BackendEventSystem {
    pub fn new() -> Self {
        Self {
            emitter: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn set_emitter(&self, emitter: Arc<dyn EventEmitter>) {
        let mut e = self.emitter.lock().await;
        *e = Some(emitter);
    }

    pub async fn emit(&self, event: BackendEvent) -> Result<()> {
        trace!("Emitting event: {:?}", event);

        let emitter_guard = self.emitter.lock().await;
        if let Some(ref emitter) = *emitter_guard {
            let event_name = frontend_event_name(&event);
            let Some(event_data) = frontend_event_payload(&event) else {
                return Ok(());
            };

            if let Err(error) = emitter.emit(&event_name, event_data).await {
                warn!("Failed to emit to frontend: {}", error);
            }
        }

        Ok(())
    }
}

fn frontend_event_name(event: &BackendEvent) -> String {
    match event {
        BackendEvent::Custom { event_name, .. } => event_name.clone(),
        BackendEvent::ToolExecutionProgress(_) => TOOL_PROGRESS_EVENT.to_string(),
        BackendEvent::ToolTerminalReady(_) => TOOL_TERMINAL_READY_EVENT.to_string(),
        BackendEvent::ToolAwaitingUserInput { .. } => TOOL_AWAITING_INPUT_EVENT.to_string(),
    }
}

fn frontend_event_payload(event: &BackendEvent) -> Option<Value> {
    match event {
        BackendEvent::Custom { payload, .. } => Some(payload.clone()),
        _ => match serde_json::to_value(event) {
            Ok(value) => Some(value),
            Err(error) => {
                error!("Failed to serialize event: {}", error);
                None
            }
        },
    }
}

impl Default for BackendEventSystem {
    fn default() -> Self {
        Self::new()
    }
}

static GLOBAL_EVENT_SYSTEM: std::sync::OnceLock<Arc<BackendEventSystem>> =
    std::sync::OnceLock::new();

pub fn get_global_event_system() -> Arc<BackendEventSystem> {
    GLOBAL_EVENT_SYSTEM
        .get_or_init(|| Arc::new(BackendEventSystem::new()))
        .clone()
}

pub async fn emit_global_event(event: BackendEvent) -> Result<()> {
    get_global_event_system().emit(event).await
}
