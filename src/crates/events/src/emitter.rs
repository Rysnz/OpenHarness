use async_trait::async_trait;
use log::{debug, info};
use serde_json::{json, Value};

const LSP_EVENT: &str = "lsp-event";
const PROFILE_EVENT: &str = "profile-event";
const FILE_SYSTEM_CHANGED: &str = "file-system-changed";
const TERMINAL_OUTPUT: &str = "terminal-output";
const SNAPSHOT_EVENT: &str = "snapshot-event";

#[async_trait]
pub trait EventEmitter: Send + Sync {
    async fn emit(&self, event_name: &str, payload: Value) -> anyhow::Result<()>;

    async fn emit_lsp(&self, workspace_path: &str, event_data: Value) -> anyhow::Result<()> {
        self.emit(LSP_EVENT, workspace_event_payload(workspace_path, event_data))
            .await
    }

    async fn emit_profile(&self, workspace_path: &str, event_data: Value) -> anyhow::Result<()> {
        self.emit(PROFILE_EVENT, workspace_event_payload(workspace_path, event_data))
            .await
    }

    async fn emit_file_watch(&self, path: &str, event_type: &str) -> anyhow::Result<()> {
        self.emit(
            FILE_SYSTEM_CHANGED,
            json!({
                "path": path,
                "kind": event_type,
                "timestamp": chrono::Utc::now().timestamp()
            }),
        )
        .await
    }

    async fn emit_terminal(
        &self,
        session_id: &str,
        output: &str,
        stream_type: &str,
    ) -> anyhow::Result<()> {
        self.emit(
            TERMINAL_OUTPUT,
            json!({
                "session_id": session_id,
                "output": output,
                "stream_type": stream_type
            }),
        )
        .await
    }

    async fn emit_snapshot(&self, snapshot_id: &str, event_data: Value) -> anyhow::Result<()> {
        self.emit(
            SNAPSHOT_EVENT,
            json!({
                "snapshot_id": snapshot_id,
                "event_data": event_data
            }),
        )
        .await
    }
}

fn workspace_event_payload(workspace_path: &str, event_data: Value) -> Value {
    json!({
        "workspace_path": workspace_path,
        "event_data": event_data
    })
}

#[derive(Debug, Clone, Copy)]
pub struct NullEmitter;

#[async_trait]
impl EventEmitter for NullEmitter {
    async fn emit(&self, event_name: &str, _payload: Value) -> anyhow::Result<()> {
        debug!("NullEmitter: ignore event {}", event_name);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LoggingEmitter;

#[async_trait]
impl EventEmitter for LoggingEmitter {
    async fn emit(&self, event_name: &str, payload: Value) -> anyhow::Result<()> {
        info!("Event [{}]: {:?}", event_name, payload);
        Ok(())
    }
}
