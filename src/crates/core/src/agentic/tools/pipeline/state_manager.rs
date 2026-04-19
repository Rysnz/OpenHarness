//! Tool state manager
//!
//! Manages the status and lifecycle of tool execution tasks

use super::types::ToolTask;
use crate::agentic::core::ToolExecutionState;
use crate::agentic::events::{AgenticEvent, EventQueue, ToolEventData};
use crate::agentic::runtime::{
    AgentPatchRecord, AgentPatchStore, AgentTaskEvent, AgentTaskEventKind, AgentTaskId,
    AgentTaskRegistry, PatchStatus,
};
use crate::agentic::tools::framework::ToolResult as FrameworkToolResult;
use dashmap::DashMap;
use log::debug;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

/// Tool state manager
pub struct ToolStateManager {
    /// Tool task status (by tool ID)
    tasks: Arc<DashMap<String, ToolTask>>,

    /// Event queue
    event_queue: Arc<EventQueue>,

    /// Agent task registry used to mirror real tool state transitions into task events.
    agent_task_registry: Arc<RwLock<Option<Arc<AgentTaskRegistry>>>>,

    /// Agent patch store used to mirror file-mutating tool outputs into patch records.
    agent_patch_store: Arc<RwLock<Option<Arc<AgentPatchStore>>>>,
}

impl ToolStateManager {
    fn sanitize_tool_result_for_event(result: &serde_json::Value) -> serde_json::Value {
        let mut sanitized = result.clone();
        Self::redact_data_url_in_json(&mut sanitized);
        sanitized
    }

    fn redact_data_url_in_json(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                let had_data_url = map.remove("data_url").is_some();
                if had_data_url {
                    map.insert("has_data_url".to_string(), serde_json::json!(true));
                }
                for child in map.values_mut() {
                    Self::redact_data_url_in_json(child);
                }
            }
            serde_json::Value::Array(arr) => {
                for child in arr {
                    Self::redact_data_url_in_json(child);
                }
            }
            _ => {}
        }
    }

    pub fn new(event_queue: Arc<EventQueue>) -> Self {
        Self {
            tasks: Arc::new(DashMap::new()),
            event_queue,
            agent_task_registry: Arc::new(RwLock::new(None)),
            agent_patch_store: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_agent_task_registry(&self, registry: Arc<AgentTaskRegistry>) {
        if let Ok(mut slot) = self.agent_task_registry.write() {
            *slot = Some(registry);
        }
    }

    pub fn set_agent_patch_store(&self, patch_store: Arc<AgentPatchStore>) {
        if let Ok(mut slot) = self.agent_patch_store.write() {
            *slot = Some(patch_store);
        }
    }

    fn agent_task_registry(&self) -> Option<Arc<AgentTaskRegistry>> {
        self.agent_task_registry
            .read()
            .ok()
            .and_then(|slot| slot.clone())
    }

    fn agent_patch_store(&self) -> Option<Arc<AgentPatchStore>> {
        self.agent_patch_store
            .read()
            .ok()
            .and_then(|slot| slot.clone())
    }

    fn truncate_stream_text(raw: &str, max_chars: usize) -> String {
        let mut truncated = raw.chars().take(max_chars).collect::<String>();
        if raw.chars().count() > max_chars {
            truncated.push_str("...");
        }
        truncated
    }

    async fn emit_agent_task_stream_chunk_event(
        &self,
        task: &ToolTask,
        stream_type: &str,
        payload: serde_json::Value,
    ) {
        let Some(task_id) = task
            .context
            .context_vars
            .get("agent_task_id")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(AgentTaskId::from)
        else {
            return;
        };

        let Some(registry) = self.agent_task_registry() else {
            return;
        };

        let _ = registry
            .push_event(AgentTaskEvent::new(
                task_id,
                AgentTaskEventKind::ToolCallStreamChunk,
                Some(format!(
                    "Tool stream chunk ({}): {}",
                    stream_type, task.tool_call.tool_name
                )),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "stream_type": stream_type,
                    "payload": payload,
                })),
            ))
            .await;
    }

    pub async fn emit_stream_chunk_event(
        &self,
        task: &ToolTask,
        data: serde_json::Value,
        chunk_index: usize,
    ) {
        let event_subagent_parent_info = task
            .context
            .subagent_parent_info
            .clone()
            .map(|info| info.into());
        let event = AgenticEvent::ToolEvent {
            session_id: task.context.session_id.clone(),
            turn_id: task.context.dialog_turn_id.clone(),
            tool_event: ToolEventData::StreamChunk {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                data: data.clone(),
            },
            subagent_parent_info: event_subagent_parent_info,
        };
        let _ = self.event_queue.enqueue(event, None).await;

        self.emit_agent_task_stream_chunk_event(
            task,
            "stream_chunk",
            serde_json::json!({
                "chunk_index": chunk_index,
                "data": Self::sanitize_tool_result_for_event(&data),
            }),
        )
        .await;
    }

    pub async fn emit_progress_event(
        &self,
        task: &ToolTask,
        message: String,
        percentage: f32,
        raw: serde_json::Value,
    ) {
        let event_subagent_parent_info = task
            .context
            .subagent_parent_info
            .clone()
            .map(|info| info.into());
        let event = AgenticEvent::ToolEvent {
            session_id: task.context.session_id.clone(),
            turn_id: task.context.dialog_turn_id.clone(),
            tool_event: ToolEventData::Progress {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                message: message.clone(),
                percentage,
            },
            subagent_parent_info: event_subagent_parent_info,
        };
        let _ = self.event_queue.enqueue(event, None).await;

        self.emit_agent_task_stream_chunk_event(
            task,
            "progress",
            serde_json::json!({
                "message": message,
                "percentage": percentage,
                "raw": Self::sanitize_tool_result_for_event(&raw),
            }),
        )
        .await;
    }

    fn is_patch_generating_tool(tool_name: &str) -> bool {
        matches!(
            tool_name.to_ascii_lowercase().as_str(),
            "write"
                | "edit"
                | "delete"
                | "search_replace"
                | "apply_patch"
                | "create_file"
                | "str_replace"
        )
    }

    fn extract_candidate_paths(
        tool_name: &str,
        result_data: &serde_json::Value,
    ) -> Vec<String> {
        let mut paths = Vec::new();

        let mut push_path = |value: Option<&serde_json::Value>| {
            if let Some(path) = value.and_then(|raw| raw.as_str()) {
                let trimmed = path.trim();
                if !trimmed.is_empty() && !paths.iter().any(|existing| existing == trimmed) {
                    paths.push(trimmed.to_string());
                }
            }
        };

        if tool_name.eq_ignore_ascii_case("Delete") {
            push_path(result_data.get("path"));
        } else {
            push_path(result_data.get("file_path"));
            push_path(result_data.get("path"));
        }

        for key in ["relative_path", "filePath", "path"] {
            push_path(result_data.get(key));
        }

        for key in ["paths", "file_paths", "changed_files"] {
            if let Some(values) = result_data.get(key).and_then(|value| value.as_array()) {
                for value in values {
                    push_path(Some(value));
                }
            }
        }

        paths
    }

    fn normalize_patch_path(task: &ToolTask, path_str: &str) -> PathBuf {
        let path = PathBuf::from(path_str);
        if path.is_relative() {
            return path;
        }

        if let Some(workspace) = task.context.workspace.as_ref() {
            if let Ok(relative) = path.strip_prefix(workspace.root_path()) {
                if !relative.as_os_str().is_empty() {
                    return relative.to_path_buf();
                }
            }
        }

        path
    }

    fn truncate_preview_text(value: Option<&str>, max_chars: usize) -> String {
        let raw = value.unwrap_or_default();
        let mut truncated = raw.chars().take(max_chars).collect::<String>();
        if raw.chars().count() > max_chars {
            truncated.push_str("...");
        }
        truncated
    }

    fn build_patch_diff_preview(
        task: &ToolTask,
        relative_path: &Path,
        result_data: &serde_json::Value,
    ) -> String {
        let display_path = if relative_path.as_os_str().is_empty() {
            "<unknown>".to_string()
        } else {
            relative_path.display().to_string()
        };

        if task.tool_call.tool_name.eq_ignore_ascii_case("Write") {
            let bytes_written = result_data
                .get("bytes_written")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            return format!(
                "Write updated {} ({} bytes written).",
                display_path, bytes_written
            );
        }

        if task.tool_call.tool_name.eq_ignore_ascii_case("Edit") {
            let start_line = result_data
                .get("start_line")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let old_end_line = result_data
                .get("old_end_line")
                .and_then(|value| value.as_u64())
                .unwrap_or(start_line);
            let old_preview = Self::truncate_preview_text(
                result_data.get("old_string").and_then(|value| value.as_str()),
                160,
            );
            let new_preview = Self::truncate_preview_text(
                result_data.get("new_string").and_then(|value| value.as_str()),
                160,
            );

            return format!(
                "Edit updated {} (lines {}-{}).\n- {}\n+ {}",
                display_path, start_line, old_end_line, old_preview, new_preview
            );
        }

        if task.tool_call.tool_name.eq_ignore_ascii_case("Delete") {
            let recursive = result_data
                .get("recursive")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let scope = if recursive { " recursively" } else { "" };
            return format!("Delete removed {}{}.", display_path, scope);
        }

        format!("{} modified {}.", task.tool_call.tool_name, display_path)
    }

    fn build_patch_id(task_id: &AgentTaskId, tool_call_id: &str, relative_path: &Path) -> String {
        let mut hasher = DefaultHasher::new();
        task_id.as_str().hash(&mut hasher);
        tool_call_id.hash(&mut hasher);
        relative_path
            .to_string_lossy()
            .replace('\\', "/")
            .hash(&mut hasher);
        format!("patch-{}-{:016x}", tool_call_id, hasher.finish())
    }

    async fn mirror_tool_patches(
        &self,
        registry: &Arc<AgentTaskRegistry>,
        task: &ToolTask,
        task_id: &AgentTaskId,
        result: &FrameworkToolResult,
    ) {
        if !Self::is_patch_generating_tool(&task.tool_call.tool_name) {
            return;
        }

        let Some(patch_store) = self.agent_patch_store() else {
            return;
        };

        let result_data = result.content();
        let candidate_paths = Self::extract_candidate_paths(&task.tool_call.tool_name, &result_data);
        if candidate_paths.is_empty() {
            return;
        }

        let patch_records = candidate_paths
            .into_iter()
            .map(|path| {
                let relative_path = Self::normalize_patch_path(task, &path);
                AgentPatchRecord {
                    patch_id: Self::build_patch_id(task_id, &task.tool_call.tool_id, &relative_path),
                    task_id: task_id.clone(),
                    tool_call_id: task.tool_call.tool_id.clone(),
                    relative_path: relative_path.clone(),
                    diff_preview: Self::build_patch_diff_preview(task, &relative_path, &result_data),
                    full_diff_ref: None,
                    status: PatchStatus::Pending,
                }
            })
            .collect::<Vec<_>>();

        if patch_records.is_empty() {
            return;
        }

        patch_store.upsert_many(patch_records.clone()).await;

        let patch_ids = patch_records
            .iter()
            .map(|record| record.patch_id.clone())
            .collect::<Vec<_>>();
        let changed_files = patch_records
            .iter()
            .map(|record| record.relative_path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        let primary_patch_id = patch_ids.first().cloned().unwrap_or_default();

        let _ = registry
            .push_event(AgentTaskEvent::new(
                task_id.clone(),
                AgentTaskEventKind::PatchReady,
                Some(format!(
                    "Tool produced {} patch record(s): {}",
                    patch_records.len(),
                    task.tool_call.tool_name
                )),
                Some(serde_json::json!({
                    "patch_id": primary_patch_id,
                    "patch_ids": patch_ids,
                    "patch_count": patch_records.len(),
                    "task_id": task_id,
                    "source": "tool_call",
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "changed_files": changed_files,
                })),
            ))
            .await;
    }

    async fn emit_completed_stdout_stderr_chunks(
        &self,
        registry: &Arc<AgentTaskRegistry>,
        task: &ToolTask,
        task_id: &AgentTaskId,
        result: &FrameworkToolResult,
    ) {
        let data = result.content();
        let Some(obj) = data.as_object() else {
            return;
        };

        for key in ["stdout", "stderr"] {
            let Some(raw_text) = obj.get(key).and_then(|value| value.as_str()) else {
                continue;
            };
            if raw_text.trim().is_empty() {
                continue;
            }

            let content = Self::truncate_stream_text(raw_text, 4000);
            let _ = registry
                .push_event(AgentTaskEvent::new(
                    task_id.clone(),
                    AgentTaskEventKind::ToolCallStreamChunk,
                    Some(format!(
                        "Tool {} {} output captured",
                        task.tool_call.tool_name, key
                    )),
                    Some(serde_json::json!({
                        "tool_call_id": task.tool_call.tool_id,
                        "tool_name": task.tool_call.tool_name,
                        "session_id": task.context.session_id,
                        "dialog_turn_id": task.context.dialog_turn_id,
                        "stream_type": key,
                        "content": content,
                        "content_length": raw_text.len(),
                    })),
                ))
                .await;
        }
    }

    /// Create task
    pub async fn create_task(&self, task: ToolTask) -> String {
        let tool_id = task.tool_call.tool_id.clone();
        self.tasks.insert(tool_id.clone(), task.clone());
        self.emit_state_change_event(task, None).await;
        tool_id
    }

    /// Update task state
    pub async fn update_state(&self, tool_id: &str, new_state: ToolExecutionState) {
        if let Some(mut task) = self.tasks.get_mut(tool_id) {
            let old_state = task.state.clone();
            task.state = new_state.clone();

            // Update timestamp
            match &new_state {
                ToolExecutionState::Running { .. } | ToolExecutionState::Streaming { .. } => {
                    task.started_at = Some(std::time::SystemTime::now());
                }
                ToolExecutionState::Completed { .. }
                | ToolExecutionState::Failed { .. }
                | ToolExecutionState::Cancelled { .. } => {
                    task.completed_at = Some(std::time::SystemTime::now());
                }
                _ => {}
            }

            debug!(
                "Tool state changed: tool_id={}, old_state={:?}, new_state={:?}",
                tool_id,
                format!("{:?}", old_state).split('{').next().unwrap_or(""),
                format!("{:?}", new_state).split('{').next().unwrap_or("")
            );

            // Send state change event
            self.emit_state_change_event(task.clone(), Some(old_state))
                .await;
        }
    }

    /// Get task
    pub fn get_task(&self, tool_id: &str) -> Option<ToolTask> {
        self.tasks.get(tool_id).map(|t| t.clone())
    }

    /// Update task arguments
    pub fn update_task_arguments(&self, tool_id: &str, new_arguments: serde_json::Value) {
        if let Some(mut task) = self.tasks.get_mut(tool_id) {
            debug!(
                "Updated tool arguments: tool_id={}, old_args={:?}, new_args={:?}",
                tool_id, task.tool_call.arguments, new_arguments
            );
            task.tool_call.arguments = new_arguments;
        }
    }

    /// Get all tasks of a session
    pub fn get_session_tasks(&self, session_id: &str) -> Vec<ToolTask> {
        self.tasks
            .iter()
            .filter(|entry| entry.value().context.session_id == session_id)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Get all tasks of a dialog turn
    pub fn get_dialog_turn_tasks(&self, dialog_turn_id: &str) -> Vec<ToolTask> {
        self.tasks
            .iter()
            .filter(|entry| entry.value().context.dialog_turn_id == dialog_turn_id)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Delete task
    pub fn remove_task(&self, tool_id: &str) {
        self.tasks.remove(tool_id);
    }

    /// Clear all tasks of a session
    pub fn clear_session(&self, session_id: &str) {
        let to_remove: Vec<_> = self
            .tasks
            .iter()
            .filter(|entry| entry.value().context.session_id == session_id)
            .map(|entry| entry.key().clone())
            .collect();

        for tool_id in to_remove {
            self.tasks.remove(&tool_id);
        }

        debug!("Cleared session tool tasks: session_id={}", session_id);
    }

    /// Send state change event (full version)
    async fn emit_state_change_event(&self, task: ToolTask, old_state: Option<ToolExecutionState>) {
        let tool_event = match &task.state {
            ToolExecutionState::Queued { position } => ToolEventData::Queued {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                position: *position,
            },

            ToolExecutionState::Waiting { dependencies } => ToolEventData::Waiting {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                dependencies: dependencies.clone(),
            },

            ToolExecutionState::Running { .. } => ToolEventData::Started {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                params: task.tool_call.arguments.clone(),
            },

            ToolExecutionState::Streaming {
                chunks_received, ..
            } => ToolEventData::Streaming {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                chunks_received: *chunks_received,
            },

            ToolExecutionState::AwaitingConfirmation { params, .. } => {
                ToolEventData::ConfirmationNeeded {
                    tool_id: task.tool_call.tool_id.clone(),
                    tool_name: task.tool_call.tool_name.clone(),
                    params: params.clone(),
                }
            }

            ToolExecutionState::Completed {
                result,
                duration_ms,
            } => ToolEventData::Completed {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                result: Self::sanitize_tool_result_for_event(&result.content()),
                result_for_assistant: match result {
                    crate::agentic::tools::framework::ToolResult::Result {
                        result_for_assistant,
                        ..
                    } => result_for_assistant.clone(),
                    _ => None,
                },
                duration_ms: *duration_ms,
            },

            ToolExecutionState::Failed {
                error,
                is_retryable: _,
            } => ToolEventData::Failed {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                error: error.clone(),
            },

            ToolExecutionState::Cancelled { reason } => ToolEventData::Cancelled {
                tool_id: task.tool_call.tool_id.clone(),
                tool_name: task.tool_call.tool_name.clone(),
                reason: reason.clone(),
            },
        };

        let event_subagent_parent_info = task
            .context
            .subagent_parent_info
            .clone()
            .map(|info| info.into());
        let event = AgenticEvent::ToolEvent {
            session_id: task.context.session_id.clone(),
            turn_id: task.context.dialog_turn_id.clone(),
            tool_event,
            subagent_parent_info: event_subagent_parent_info,
        };

        let _ = self.event_queue.enqueue(event, None).await;
        self.emit_agent_task_event(&task, old_state.as_ref()).await;
    }

    async fn emit_agent_task_event(&self, task: &ToolTask, old_state: Option<&ToolExecutionState>) {
        let Some(task_id) = task
            .context
            .context_vars
            .get("agent_task_id")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(AgentTaskId::from)
        else {
            return;
        };

        let Some(registry) = self.agent_task_registry() else {
            return;
        };

        let tool_call_id = task.tool_call.tool_id.clone();
        let tool_name = task.tool_call.tool_name.clone();
        let base_data = || {
            serde_json::json!({
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "session_id": task.context.session_id,
                "dialog_turn_id": task.context.dialog_turn_id,
            })
        };

        let (kind, message, data) = match &task.state {
            ToolExecutionState::Queued { position } => (
                AgentTaskEventKind::ToolCallQueued,
                Some(format!("Tool queued: {}", task.tool_call.tool_name)),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "position": position,
                    "input": task.tool_call.arguments,
                })),
            ),
            ToolExecutionState::Running { .. } => {
                if matches!(old_state, Some(ToolExecutionState::Running { .. })) {
                    return;
                }
                (
                    AgentTaskEventKind::ToolCallStarted,
                    Some(format!("Tool started: {}", task.tool_call.tool_name)),
                    Some(serde_json::json!({
                        "tool_call_id": task.tool_call.tool_id,
                        "tool_name": task.tool_call.tool_name,
                        "session_id": task.context.session_id,
                        "dialog_turn_id": task.context.dialog_turn_id,
                        "input": task.tool_call.arguments,
                    })),
                )
            }
            ToolExecutionState::Streaming {
                chunks_received, ..
            } => {
                if matches!(
                    old_state,
                    Some(ToolExecutionState::Streaming { .. })
                        | Some(ToolExecutionState::Running { .. })
                ) {
                    (
                        AgentTaskEventKind::ToolCallStreamChunk,
                        Some(format!(
                            "Streaming chunk received: {}",
                            task.tool_call.tool_name
                        )),
                        Some(serde_json::json!({
                            "tool_call_id": task.tool_call.tool_id,
                            "tool_name": task.tool_call.tool_name,
                            "session_id": task.context.session_id,
                            "dialog_turn_id": task.context.dialog_turn_id,
                            "chunks_received": chunks_received,
                        })),
                    )
                } else {
                    (
                        AgentTaskEventKind::ToolCallStarted,
                        Some(format!(
                            "Streaming tool started: {}",
                            task.tool_call.tool_name
                        )),
                        Some(serde_json::json!({
                            "tool_call_id": task.tool_call.tool_id,
                            "tool_name": task.tool_call.tool_name,
                            "session_id": task.context.session_id,
                            "dialog_turn_id": task.context.dialog_turn_id,
                            "input": task.tool_call.arguments,
                            "chunks_received": chunks_received,
                        })),
                    )
                }
            }
            ToolExecutionState::AwaitingConfirmation { params, .. } => (
                AgentTaskEventKind::ToolCallWaitingApproval,
                Some(format!(
                    "Tool waiting approval: {}",
                    task.tool_call.tool_name
                )),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "input": params,
                })),
            ),
            ToolExecutionState::Completed {
                result,
                duration_ms,
            } => (
                AgentTaskEventKind::ToolCallCompleted,
                Some(format!("Tool completed: {}", task.tool_call.tool_name)),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "result": Self::sanitize_tool_result_for_event(&result.content()),
                    "duration_ms": duration_ms,
                })),
            ),
            ToolExecutionState::Failed { error, .. } => (
                AgentTaskEventKind::ToolCallFailed,
                Some(format!("Tool failed: {}", task.tool_call.tool_name)),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "error": error,
                })),
            ),
            ToolExecutionState::Cancelled { reason } => (
                AgentTaskEventKind::ToolCallCancelled,
                Some(format!("Tool cancelled: {}", task.tool_call.tool_name)),
                Some(serde_json::json!({
                    "tool_call_id": task.tool_call.tool_id,
                    "tool_name": task.tool_call.tool_name,
                    "session_id": task.context.session_id,
                    "dialog_turn_id": task.context.dialog_turn_id,
                    "reason": reason,
                })),
            ),
            ToolExecutionState::Waiting { dependencies } => (
                AgentTaskEventKind::ToolCallQueued,
                Some(format!("Tool waiting: {}", task.tool_call.tool_name)),
                Some({
                    let mut data = base_data();
                    if let Some(map) = data.as_object_mut() {
                        map.insert("dependencies".to_string(), serde_json::json!(dependencies));
                    }
                    data
                }),
            ),
        };

        let _ = registry
            .push_event(AgentTaskEvent::new(task_id.clone(), kind, message, data))
            .await;

        if let ToolExecutionState::Completed { result, .. } = &task.state {
            self.emit_completed_stdout_stderr_chunks(&registry, task, &task_id, result)
                .await;
            self.mirror_tool_patches(&registry, task, &task_id, result)
                .await;
        }
    }

    /// Get statistics
    pub fn get_stats(&self) -> ToolStats {
        let tasks: Vec<_> = self.tasks.iter().map(|e| e.value().clone()).collect();

        let mut stats = ToolStats {
            total: tasks.len(),
            ..ToolStats::default()
        };

        for task in tasks {
            match task.state {
                ToolExecutionState::Queued { .. } => stats.queued += 1,
                ToolExecutionState::Waiting { .. } => stats.waiting += 1,
                ToolExecutionState::Running { .. } => stats.running += 1,
                ToolExecutionState::Streaming { .. } => stats.streaming += 1,
                ToolExecutionState::AwaitingConfirmation { .. } => stats.awaiting_confirmation += 1,
                ToolExecutionState::Completed { .. } => stats.completed += 1,
                ToolExecutionState::Failed { .. } => stats.failed += 1,
                ToolExecutionState::Cancelled { .. } => stats.cancelled += 1,
            }
        }

        stats
    }
}

/// Tool statistics
#[derive(Debug, Clone, Default)]
pub struct ToolStats {
    pub total: usize,
    pub queued: usize,
    pub waiting: usize,
    pub running: usize,
    pub streaming: usize,
    pub awaiting_confirmation: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::core::ToolCall;
    use crate::agentic::events::{EventQueue, EventQueueConfig};
    use crate::agentic::runtime::{
        AgentPatchStore, AgentTaskConfig, AgentTaskKind, AgentTaskStatus, ForkContextMode,
        PatchStatus, WorkspaceBinding as RuntimeWorkspaceBinding,
    };
    use crate::agentic::tools::framework::ToolResult as FrameworkToolResult;
    use crate::agentic::tools::pipeline::{ToolExecutionContext, ToolExecutionOptions};
    use crate::agentic::workspace::WorkspaceBinding as AgentWorkspaceBinding;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn build_task_config() -> AgentTaskConfig {
        let root = std::env::temp_dir();
        AgentTaskConfig {
            agent_name: "test-agent".to_string(),
            prompt: "run test tool".to_string(),
            parent_task_id: None,
            session_id: Some("session_1".to_string()),
            workspace_binding: RuntimeWorkspaceBinding::shared(root),
            fork_context: ForkContextMode::Fresh,
            max_turns: Some(1),
            allowed_tools: Vec::new(),
            model: None,
        }
    }

    fn build_tool_task_with(
        agent_task_id: &AgentTaskId,
        tool_id: &str,
        tool_name: &str,
        arguments: serde_json::Value,
        workspace: Option<AgentWorkspaceBinding>,
    ) -> ToolTask {
        let mut context_vars = HashMap::new();
        context_vars.insert("agent_task_id".to_string(), agent_task_id.to_string());

        ToolTask::new(
            ToolCall {
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                arguments,
                is_error: false,
            },
            ToolExecutionContext {
                session_id: "session_1".to_string(),
                dialog_turn_id: "turn_1".to_string(),
                agent_type: "agentic".to_string(),
                workspace,
                context_vars,
                subagent_parent_info: None,
                allowed_tools: Vec::new(),
                workspace_services: None,
            },
            ToolExecutionOptions::default(),
        )
    }

    fn build_tool_task(agent_task_id: &AgentTaskId) -> ToolTask {
        build_tool_task_with(
            agent_task_id,
            "call_1",
            "Read",
            serde_json::json!({"file_path": "README.md"}),
            None,
        )
    }

    #[tokio::test]
    async fn mirrors_real_tool_state_changes_to_agent_task_events() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-tool-events-{}.json",
            uuid::Uuid::new_v4()
        ));
        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let task_snapshot = registry
            .create_task(build_task_config(), AgentTaskKind::Background)
            .await;
        assert_eq!(task_snapshot.status, AgentTaskStatus::Queued);

        let manager = ToolStateManager::new(Arc::new(EventQueue::new(EventQueueConfig::default())));
        manager.set_agent_task_registry(Arc::clone(&registry));

        let tool_task = build_tool_task(&task_snapshot.task_id);
        manager.create_task(tool_task).await;
        manager
            .update_state(
                "call_1",
                ToolExecutionState::Running {
                    started_at: std::time::SystemTime::now(),
                    progress: None,
                },
            )
            .await;
        manager
            .update_state(
                "call_1",
                ToolExecutionState::Completed {
                    result: FrameworkToolResult::Result {
                        data: serde_json::json!({"ok": true}),
                        result_for_assistant: Some("read ok".to_string()),
                        image_attachments: None,
                    },
                    duration_ms: 12,
                },
            )
            .await;

        let events = registry.events(&task_snapshot.task_id).await.unwrap();
        let kinds: Vec<_> = events.iter().map(|event| event.kind.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                AgentTaskEventKind::ToolCallQueued,
                AgentTaskEventKind::ToolCallStarted,
                AgentTaskEventKind::ToolCallCompleted,
            ]
        );
        assert_eq!(
            events[1]
                .data
                .as_ref()
                .and_then(|data| data.get("tool_call_id"))
                .and_then(|value| value.as_str()),
            Some("call_1")
        );

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn mirrors_write_tool_completion_to_patch_store() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-tool-patch-events-{}.json",
            uuid::Uuid::new_v4()
        ));
        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let task_snapshot = registry
            .create_task(build_task_config(), AgentTaskKind::Background)
            .await;

        let patch_store = Arc::new(AgentPatchStore::default());
        let manager = ToolStateManager::new(Arc::new(EventQueue::new(EventQueueConfig::default())));
        manager.set_agent_task_registry(Arc::clone(&registry));
        manager.set_agent_patch_store(Arc::clone(&patch_store));

        let workspace_root = std::env::temp_dir().join(format!(
            "openharness-agent-tool-patch-workspace-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let file_path = workspace_root.join("README.md");
        let file_path_str = file_path.to_string_lossy().to_string();

        manager
            .create_task(build_tool_task_with(
                &task_snapshot.task_id,
                "call_write_1",
                "Write",
                serde_json::json!({
                    "file_path": file_path_str,
                    "content": "hello patch"
                }),
                Some(AgentWorkspaceBinding::new(None, workspace_root)),
            ))
            .await;

        manager
            .update_state(
                "call_write_1",
                ToolExecutionState::Completed {
                    result: FrameworkToolResult::Result {
                        data: serde_json::json!({
                            "file_path": file_path.to_string_lossy(),
                            "bytes_written": 11,
                            "success": true
                        }),
                        result_for_assistant: Some("write ok".to_string()),
                        image_attachments: None,
                    },
                    duration_ms: 8,
                },
            )
            .await;

        let patches = patch_store.list_by_task(&task_snapshot.task_id).await;
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].tool_call_id, "call_write_1");
        assert_eq!(patches[0].relative_path, PathBuf::from("README.md"));
        assert_eq!(patches[0].status, PatchStatus::Pending);

        let events = registry.events(&task_snapshot.task_id).await.unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event.kind, AgentTaskEventKind::PatchReady)));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn streaming_transition_does_not_duplicate_tool_started_event() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-tool-events-streaming-{}.json",
            uuid::Uuid::new_v4()
        ));
        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let task_snapshot = registry
            .create_task(build_task_config(), AgentTaskKind::Background)
            .await;

        let manager = ToolStateManager::new(Arc::new(EventQueue::new(EventQueueConfig::default())));
        manager.set_agent_task_registry(Arc::clone(&registry));

        manager.create_task(build_tool_task(&task_snapshot.task_id)).await;

        manager
            .update_state(
                "call_1",
                ToolExecutionState::Running {
                    started_at: std::time::SystemTime::now(),
                    progress: None,
                },
            )
            .await;

        manager
            .update_state(
                "call_1",
                ToolExecutionState::Streaming {
                    started_at: std::time::SystemTime::now(),
                    chunks_received: 1,
                },
            )
            .await;

        manager
            .update_state(
                "call_1",
                ToolExecutionState::Streaming {
                    started_at: std::time::SystemTime::now(),
                    chunks_received: 2,
                },
            )
            .await;

        manager
            .update_state(
                "call_1",
                ToolExecutionState::Completed {
                    result: FrameworkToolResult::Result {
                        data: serde_json::json!({"ok": true}),
                        result_for_assistant: Some("stream done".to_string()),
                        image_attachments: None,
                    },
                    duration_ms: 21,
                },
            )
            .await;

        let events = registry.events(&task_snapshot.task_id).await.unwrap();
        let start_count = events
            .iter()
            .filter(|event| matches!(event.kind, AgentTaskEventKind::ToolCallStarted))
            .count();
        assert_eq!(start_count, 1);

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }

    #[tokio::test]
    async fn completed_result_emits_stdout_and_stderr_stream_chunks() {
        let snapshot_file = std::env::temp_dir().join(format!(
            "openharness-agent-tool-events-stdout-stderr-{}.json",
            uuid::Uuid::new_v4()
        ));
        let registry = Arc::new(AgentTaskRegistry::new(snapshot_file.clone()));
        let task_snapshot = registry
            .create_task(build_task_config(), AgentTaskKind::Background)
            .await;

        let manager = ToolStateManager::new(Arc::new(EventQueue::new(EventQueueConfig::default())));
        manager.set_agent_task_registry(Arc::clone(&registry));

        manager
            .create_task(build_tool_task_with(
                &task_snapshot.task_id,
                "call_bash_1",
                "Bash",
                serde_json::json!({"command": "echo hi"}),
                None,
            ))
            .await;

        manager
            .update_state(
                "call_bash_1",
                ToolExecutionState::Running {
                    started_at: std::time::SystemTime::now(),
                    progress: None,
                },
            )
            .await;

        manager
            .update_state(
                "call_bash_1",
                ToolExecutionState::Completed {
                    result: FrameworkToolResult::Result {
                        data: serde_json::json!({
                            "stdout": "stdout line\n",
                            "stderr": "stderr line\n",
                            "exit_code": 0
                        }),
                        result_for_assistant: Some("bash done".to_string()),
                        image_attachments: None,
                    },
                    duration_ms: 42,
                },
            )
            .await;

        let events = registry.events(&task_snapshot.task_id).await.unwrap();
        let stream_chunks = events
            .iter()
            .filter(|event| matches!(event.kind, AgentTaskEventKind::ToolCallStreamChunk))
            .collect::<Vec<_>>();

        assert_eq!(stream_chunks.len(), 2);
        assert!(stream_chunks.iter().any(|event| {
            event
                .data
                .as_ref()
                .and_then(|data| data.get("stream_type"))
                .and_then(|value| value.as_str())
                == Some("stdout")
        }));
        assert!(stream_chunks.iter().any(|event| {
            event
                .data
                .as_ref()
                .and_then(|data| data.get("stream_type"))
                .and_then(|value| value.as_str())
                == Some("stderr")
        }));

        let _ = tokio::fs::remove_file(snapshot_file).await;
    }
}
