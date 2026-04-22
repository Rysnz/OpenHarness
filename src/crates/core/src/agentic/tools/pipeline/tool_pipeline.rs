//! Tool pipeline
//!
//! Manages the complete lifecycle of tools:
//! confirmation, execution, caching, retries, etc.

use super::state_manager::ToolStateManager;
use super::types::*;
use crate::agentic::core::{ToolCall, ToolExecutionState, ToolResult as ModelToolResult};
use crate::agentic::permissions::{
    AgentPermissionMode, PermissionApprovalQueue, PermissionApprovalRequest, PermissionAuditRecord,
    PermissionAuditStore, PermissionDecision, PermissionEngine, PermissionEvaluation,
    PermissionRule,
};
use crate::agentic::runtime::{AgentPatchStore, AgentTaskRegistry};
use crate::agentic::tools::computer_use_host::ComputerUseHostRef;
use crate::agentic::tools::framework::{
    ToolResult as FrameworkToolResult, ToolStreamSink, ToolUseContext,
};
use crate::agentic::tools::registry::ToolRegistry;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use dashmap::DashMap;
use futures::future::join_all;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Instant;
use tokio::sync::{oneshot, RwLock as TokioRwLock};
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

/// A batch of tool tasks to execute together.
struct ToolBatch {
    task_ids: Vec<String>,
    is_concurrent: bool,
}

/// Convert framework::ToolResult to core::ToolResult
///
/// Ensure always has result_for_assistant, avoid tool message content being empty
fn convert_tool_result(
    framework_result: FrameworkToolResult,
    tool_id: &str,
    tool_name: &str,
) -> ModelToolResult {
    match framework_result {
        FrameworkToolResult::Result {
            data,
            result_for_assistant,
            image_attachments,
        } => {
            // If the tool does not provide result_for_assistant, generate default friendly description
            let assistant_text = result_for_assistant.or_else(|| {
                // Generate natural language description based on data
                generate_default_assistant_text(tool_name, &data)
            });

            ModelToolResult {
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                result: data,
                result_for_assistant: assistant_text,
                is_error: false,
                duration_ms: None,
                image_attachments,
            }
        }
        FrameworkToolResult::Progress { content, .. } => {
            // Progress message also generates friendly text
            let assistant_text = generate_default_assistant_text(tool_name, &content);

            ModelToolResult {
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                result: content,
                result_for_assistant: assistant_text,
                is_error: false,
                duration_ms: None,
                image_attachments: None,
            }
        }
        FrameworkToolResult::StreamChunk { data, .. } => {
            // Streaming data block also generates friendly text
            let assistant_text = generate_default_assistant_text(tool_name, &data);

            ModelToolResult {
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                result: data,
                result_for_assistant: assistant_text,
                is_error: false,
                duration_ms: None,
                image_attachments: None,
            }
        }
    }
}

/// Generate default tool result description
fn generate_default_assistant_text(tool_name: &str, data: &serde_json::Value) -> Option<String> {
    // Check if data is null or empty
    if data.is_null() {
        return Some(format!(
            "Tool {} completed, but no result returned.",
            tool_name
        ));
    }

    // If it is an empty object or empty array
    if (data.is_object() && data.as_object().is_some_and(|o| o.is_empty()))
        || (data.is_array() && data.as_array().is_some_and(|a| a.is_empty()))
    {
        return Some(format!(
            "Tool {} completed, returned empty result.",
            tool_name
        ));
    }

    // Try to extract common fields to generate description
    if let Some(obj) = data.as_object() {
        // Check if there is a success field
        if let Some(success) = obj.get("success").and_then(|v| v.as_bool()) {
            if success {
                if let Some(message) = obj.get("message").and_then(|v| v.as_str()) {
                    return Some(format!(
                        "Tool {} completed successfully: {}",
                        tool_name, message
                    ));
                }
                return Some(format!("Tool {} completed successfully.", tool_name));
            } else {
                if let Some(error) = obj.get("error").and_then(|v| v.as_str()) {
                    return Some(format!(
                        "Tool {} completed with error: {}",
                        tool_name, error
                    ));
                }
                return Some(format!("Tool {} completed with error.", tool_name));
            }
        }

        // Check if there is a result/data/content field
        for key in &["result", "data", "content", "output"] {
            if let Some(value) = obj.get(*key) {
                if let Some(text) = value.as_str() {
                    if !text.is_empty() && text.len() < 500 {
                        return Some(format!("Tool {} completed, returned: {}", tool_name, text));
                    }
                }
            }
        }

        // If there are multiple fields, provide field list
        let field_names: Vec<&str> = obj.keys().take(5).map(|s| s.as_str()).collect();
        if !field_names.is_empty() {
            return Some(format!(
                "Tool {} completed, returned data with the following fields: {}",
                tool_name,
                field_names.join(", ")
            ));
        }
    }

    // If it is a string, return directly (but limit length)
    if let Some(text) = data.as_str() {
        if !text.is_empty() {
            if text.len() <= 500 {
                return Some(format!("Tool {} completed: {}", tool_name, text));
            } else {
                return Some(format!(
                    "Tool {} completed, returned {} characters of text result.",
                    tool_name,
                    text.len()
                ));
            }
        }
    }

    // If it is a number or boolean
    if data.is_number() || data.is_boolean() {
        return Some(format!("Tool {} completed, returned: {}", tool_name, data));
    }

    // Default: simply describe data type
    Some(format!(
        "Tool {} completed, returned {} type of result.",
        tool_name,
        if data.is_object() {
            "object"
        } else if data.is_array() {
            "array"
        } else {
            "data"
        }
    ))
}

/// Convert core::ToolResult to framework::ToolResult
fn convert_to_framework_result(model_result: &ModelToolResult) -> FrameworkToolResult {
    FrameworkToolResult::Result {
        data: model_result.result.clone(),
        result_for_assistant: model_result.result_for_assistant.clone(),
        image_attachments: model_result.image_attachments.clone(),
    }
}

/// Confirmation response type
#[derive(Debug, Clone)]
pub enum ConfirmationResponse {
    Confirmed,
    Rejected(String),
    Denied(String),
}

/// Tool pipeline
pub struct ToolPipeline {
    tool_registry: Arc<TokioRwLock<ToolRegistry>>,
    state_manager: Arc<ToolStateManager>,
    permission_engine: Arc<PermissionEngine>,
    approval_queue: Arc<PermissionApprovalQueue>,
    permission_audit_store: Arc<PermissionAuditStore>,
    /// Confirmation channel management (tool_id -> oneshot sender)
    confirmation_channels: Arc<DashMap<String, oneshot::Sender<ConfirmationResponse>>>,
    /// Cancellation token management (tool_id -> CancellationToken)
    cancellation_tokens: Arc<DashMap<String, CancellationToken>>,
    computer_use_host: Option<ComputerUseHostRef>,
}

impl ToolPipeline {
    pub fn new(
        tool_registry: Arc<TokioRwLock<ToolRegistry>>,
        state_manager: Arc<ToolStateManager>,
        computer_use_host: Option<ComputerUseHostRef>,
    ) -> Self {
        // Initialize permission engine with default shell analyzer
        let permission_engine = Arc::new(PermissionEngine::default());

        Self {
            tool_registry,
            state_manager,
            permission_engine,
            approval_queue: Arc::new(PermissionApprovalQueue::default()),
            permission_audit_store: Arc::new(PermissionAuditStore::default()),
            confirmation_channels: Arc::new(DashMap::new()),
            cancellation_tokens: Arc::new(DashMap::new()),
            computer_use_host,
        }
    }

    pub fn computer_use_host(&self) -> Option<ComputerUseHostRef> {
        self.computer_use_host.clone()
    }

    pub fn set_agent_task_registry(&self, registry: Arc<AgentTaskRegistry>) {
        self.state_manager.set_agent_task_registry(registry);
    }

    pub fn set_agent_patch_store(&self, patch_store: Arc<AgentPatchStore>) {
        self.state_manager.set_agent_patch_store(patch_store);
    }

    pub fn permission_engine(&self) -> Arc<PermissionEngine> {
        Arc::clone(&self.permission_engine)
    }

    pub fn approval_queue(&self) -> Arc<PermissionApprovalQueue> {
        Arc::clone(&self.approval_queue)
    }

    pub fn permission_audit_store(&self) -> Arc<PermissionAuditStore> {
        Arc::clone(&self.permission_audit_store)
    }

    pub async fn list_pending_approvals(&self) -> Vec<PermissionApprovalRequest> {
        self.approval_queue.list_pending().await
    }

    pub async fn list_permission_audits(&self, limit: usize) -> Vec<PermissionAuditRecord> {
        self.permission_audit_store.list_recent(limit).await
    }

    pub async fn list_permission_rules(&self) -> Vec<PermissionRule> {
        self.permission_engine.list_rules().await
    }

    pub async fn upsert_permission_rule(&self, rule: PermissionRule) {
        self.permission_engine.upsert_rule(rule).await;
    }

    pub async fn remove_permission_rule(&self, rule_id: &str) -> bool {
        self.permission_engine.remove_rule(rule_id).await
    }

    pub async fn clear_permission_rules(&self) {
        self.permission_engine.clear_rules().await;
    }

    pub async fn replace_permission_rules(&self, rules: Vec<PermissionRule>) {
        self.permission_engine.replace_rules(rules).await;
    }

    async fn append_permission_audit(
        &self,
        task: &ToolTask,
        evaluation: &PermissionEvaluation,
        approved: Option<bool>,
        reason: Option<String>,
    ) {
        let record = PermissionAuditRecord::from_evaluation(
            task.tool_call.tool_id.clone(),
            task.tool_call.tool_name.clone(),
            task.context.session_id.clone(),
            task.context.dialog_turn_id.clone(),
            evaluation,
            approved,
            reason,
        );
        self.permission_audit_store.append(record).await;
    }

    fn hook_context_for_task(
        task: &ToolTask,
        tool_result: Option<&str>,
        error: Option<&str>,
    ) -> HashMap<String, String> {
        let mut context = task.context.context_vars.clone();
        context.insert("session_id".to_string(), task.context.session_id.clone());
        context.insert(
            "dialog_turn_id".to_string(),
            task.context.dialog_turn_id.clone(),
        );
        context.insert("agent_type".to_string(), task.context.agent_type.clone());
        context.insert("tool_call_id".to_string(), task.tool_call.tool_id.clone());
        context.insert("tool_name".to_string(), task.tool_call.tool_name.clone());

        if let Some(result) = tool_result {
            context.insert("tool_result".to_string(), result.to_string());
        }
        if let Some(error) = error {
            context.insert("error".to_string(), error.to_string());
        }

        context
    }

    async fn evaluate_permission_for_task(&self, task: &ToolTask) -> PermissionEvaluation {
        let needs_permissions = {
            let registry = self.tool_registry.read().await;
            registry
                .get_tool(&task.tool_call.tool_name)
                .map(|tool| tool.needs_permissions(Some(&task.tool_call.arguments)))
                .unwrap_or(true)
        };

        // Check for agent-specific permission mode override (does NOT modify global state)
        let agent_permission_mode = task
            .context
            .permission_mode
            .as_ref()
            .or_else(|| task.context.context_vars.get("permission_mode"))
            .and_then(|mode_str| AgentPermissionMode::from_string(mode_str));

        // Pass override to evaluation (no global mutation)
        let mut permission_input = task.tool_call.arguments.clone();
        if let serde_json::Value::Object(ref mut object) = permission_input {
            object.insert(
                "_permission_context".to_string(),
                serde_json::json!({
                    "agent_type": task.context.agent_type.clone(),
                    "session_id": task.context.session_id.clone(),
                    "dialog_turn_id": task.context.dialog_turn_id.clone(),
                    "tool_call_id": task.tool_call.tool_id.clone(),
                }),
            );
        }

        self.permission_engine
            .evaluate(
                &task.tool_call.tool_name,
                &permission_input,
                needs_permissions,
                agent_permission_mode,
            )
            .await
    }

    /// Execute multiple tool calls using partitioned mixed scheduling.
    ///
    /// Consecutive concurrency-safe calls are grouped into a single batch and
    /// run in parallel; each non-safe call forms its own batch and runs serially.
    /// Batches are executed in order so that write-after-read dependencies are
    /// respected while reads still benefit from parallelism.
    pub async fn execute_tools(
        &self,
        tool_calls: Vec<ToolCall>,
        context: ToolExecutionContext,
        options: ToolExecutionOptions,
    ) -> OpenHarnessResult<Vec<ToolExecutionResult>> {
        if tool_calls.is_empty() {
            return Ok(vec![]);
        }

        info!("Executing tools: count={}", tool_calls.len());

        // Determine concurrency safety for each tool call
        let concurrency_flags: Vec<bool> = {
            let registry = self.tool_registry.read().await;
            tool_calls
                .iter()
                .map(|tc| {
                    registry
                        .get_tool(&tc.tool_name)
                        .map(|tool| tool.is_concurrency_safe(Some(&tc.arguments)))
                        .unwrap_or(false)
                })
                .collect()
        };

        // Create tasks for all tool calls
        let mut task_ids = Vec::with_capacity(tool_calls.len());
        for (position, tool_call) in tool_calls.into_iter().enumerate() {
            let mut task = ToolTask::new(tool_call, context.clone(), options.clone());
            task.state = ToolExecutionState::Queued { position };
            let tool_id = self.state_manager.create_task(task).await;
            task_ids.push(tool_id);
        }

        if !options.allow_parallel {
            debug!("Parallel execution disabled by options, running all tools sequentially");
            return self.execute_sequential(task_ids).await;
        }

        // Partition into batches of consecutive same-safety tool calls
        let batches = Self::partition_tool_batches(&task_ids, &concurrency_flags);

        if batches.len() == 1 {
            let batch = &batches[0];
            if batch.is_concurrent {
                return self.execute_parallel(batch.task_ids.clone()).await;
            } else {
                return self.execute_sequential(batch.task_ids.clone()).await;
            }
        }

        debug!(
            "Partitioned {} tools into {} batches for mixed execution",
            task_ids.len(),
            batches.len()
        );

        let mut all_results = Vec::with_capacity(task_ids.len());
        for (batch_idx, batch) in batches.into_iter().enumerate() {
            debug!(
                "Executing batch {}: {} tool(s), concurrent={}",
                batch_idx,
                batch.task_ids.len(),
                batch.is_concurrent
            );
            let batch_results = if batch.is_concurrent {
                self.execute_parallel(batch.task_ids).await?
            } else {
                self.execute_sequential(batch.task_ids).await?
            };
            all_results.extend(batch_results);
        }

        Ok(all_results)
    }

    /// Partition task IDs into batches where consecutive concurrency-safe tasks
    /// are grouped together (parallel batch) and each non-safe task forms its
    /// own batch (serial batch).
    fn partition_tool_batches(task_ids: &[String], flags: &[bool]) -> Vec<ToolBatch> {
        let mut batches: Vec<ToolBatch> = Vec::new();

        for (id, &is_safe) in task_ids.iter().zip(flags.iter()) {
            if is_safe {
                if let Some(last) = batches.last_mut() {
                    if last.is_concurrent {
                        last.task_ids.push(id.clone());
                        continue;
                    }
                }
            }
            batches.push(ToolBatch {
                task_ids: vec![id.clone()],
                is_concurrent: is_safe,
            });
        }

        batches
    }

    /// Execute tools in parallel
    async fn execute_parallel(
        &self,
        task_ids: Vec<String>,
    ) -> OpenHarnessResult<Vec<ToolExecutionResult>> {
        let futures: Vec<_> = task_ids
            .iter()
            .map(|id| self.execute_single_tool(id.clone()))
            .collect();

        let results = join_all(futures).await;

        // Collect results, including failed results
        let mut all_results = Vec::new();
        for (idx, result) in results.into_iter().enumerate() {
            match result {
                Ok(r) => all_results.push(r),
                Err(e) => {
                    error!("Tool execution failed: error={}", e);

                    let task_id = &task_ids[idx];
                    let (tool_id, tool_name) =
                        if let Some(task) = self.state_manager.get_task(task_id) {
                            (
                                task.tool_call.tool_id.clone(),
                                task.tool_call.tool_name.clone(),
                            )
                        } else {
                            warn!("Task not found in state manager: {}", task_id);
                            (task_id.clone(), "unknown".to_string())
                        };
                    let error_result = ToolExecutionResult {
                        tool_id: tool_id.clone(),
                        tool_name: tool_name.clone(),
                        result: ModelToolResult {
                            tool_id,
                            tool_name,
                            result: serde_json::json!({
                                "error": e.to_string(),
                                "message": format!("Tool execution failed: {}", e)
                            }),
                            result_for_assistant: Some(format!("Tool execution failed: {}", e)),
                            is_error: true,
                            duration_ms: None,
                            image_attachments: None,
                        },
                        execution_time_ms: 0,
                    };
                    all_results.push(error_result);
                }
            }
        }

        Ok(all_results)
    }

    /// Execute tools sequentially
    async fn execute_sequential(
        &self,
        task_ids: Vec<String>,
    ) -> OpenHarnessResult<Vec<ToolExecutionResult>> {
        let mut results = Vec::new();

        for task_id in task_ids {
            match self.execute_single_tool(task_id.clone()).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    error!("Tool execution failed: error={}", e);

                    let (tool_id, tool_name) =
                        if let Some(task) = self.state_manager.get_task(&task_id) {
                            (
                                task.tool_call.tool_id.clone(),
                                task.tool_call.tool_name.clone(),
                            )
                        } else {
                            warn!("Task not found in state manager: {}", task_id);
                            (task_id.clone(), "unknown".to_string())
                        };
                    let error_result = ToolExecutionResult {
                        tool_id: tool_id.clone(),
                        tool_name: tool_name.clone(),
                        result: ModelToolResult {
                            tool_id,
                            tool_name,
                            result: serde_json::json!({
                                "error": e.to_string(),
                                "message": format!("Tool execution failed: {}", e)
                            }),
                            result_for_assistant: Some(format!("Tool execution failed: {}", e)),
                            is_error: true,
                            duration_ms: None,
                            image_attachments: None,
                        },
                        execution_time_ms: 0,
                    };
                    results.push(error_result);
                }
            }
        }

        Ok(results)
    }

    /// Execute single tool
    async fn execute_single_tool(&self, tool_id: String) -> OpenHarnessResult<ToolExecutionResult> {
        let start_time = Instant::now();

        debug!("Starting tool execution: tool_id={}", tool_id);

        // Get task
        let task = self.state_manager.get_task(&tool_id).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Tool task not found: {}", tool_id))
        })?;

        let tool_name = task.tool_call.tool_name.clone();
        let tool_args = task.tool_call.arguments.clone();
        let tool_is_error = task.tool_call.is_error;

        debug!(
            "Tool task details: tool_name={}, tool_id={}",
            tool_name, tool_id
        );

        if tool_name.is_empty() || tool_is_error {
            let error_msg = if tool_name.is_empty() && tool_is_error {
                "Missing valid tool name and arguments are invalid JSON.".to_string()
            } else if tool_name.is_empty() {
                "Missing valid tool name.".to_string()
            } else {
                "Arguments are invalid JSON.".to_string()
            };
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Failed {
                        error: error_msg.clone(),
                        is_retryable: false,
                    },
                )
                .await;

            return Err(OpenHarnessError::Validation(error_msg));
        }

        // Security check: check if the tool is in the allowed list
        // If allowed_tools is not empty, only allow execution of tools in the whitelist
        if !task.context.allowed_tools.is_empty()
            && !task.context.allowed_tools.contains(&tool_name)
        {
            let error_msg = format!(
                "Tool '{}' is not in the allowed list: {:?}",
                tool_name, task.context.allowed_tools
            );
            warn!("Tool not allowed: {}", error_msg);

            // Update state to failed
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Failed {
                        error: error_msg.clone(),
                        is_retryable: false,
                    },
                )
                .await;

            return Err(OpenHarnessError::Validation(error_msg));
        }

        // Create cancellation token
        let cancellation_token = CancellationToken::new();
        self.cancellation_tokens
            .insert(tool_id.clone(), cancellation_token.clone());

        debug!("Executing tool: tool_name={}", tool_name);

        let tool = {
            let registry = self.tool_registry.read().await;
            registry
                .get_tool(&task.tool_call.tool_name)
                .ok_or_else(|| {
                    let error_msg = format!(
                        "Tool '{}' is not registered or enabled.",
                        task.tool_call.tool_name,
                    );
                    error!("{}", error_msg);
                    OpenHarnessError::tool(error_msg)
                })?
        };

        let is_streaming = tool.supports_streaming();
        let tool_needs_permissions = tool.needs_permissions(Some(&tool_args));

        // Execute before_tool_call hooks if configured
        if let Some(ref hooks) = task.context.hooks {
            let hook_context = Self::hook_context_for_task(&task, None, None);
            hooks
                .execute_hooks(
                    "before_tool_call",
                    &hook_context,
                    Some(self.permission_engine.as_ref()),
                    Some(self.permission_audit_store.as_ref()),
                )
                .await;
        }

        let permission_evaluation = self.evaluate_permission_for_task(&task).await;

        self.append_permission_audit(&task, &permission_evaluation, None, None)
            .await;

        if matches!(
            permission_evaluation.effective_decision,
            PermissionDecision::Deny
        ) {
            let deny_reason = format!(
                "Permission denied for tool '{}': {}",
                tool_name, permission_evaluation.reason
            );
            warn!("{}", deny_reason);

            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Failed {
                        error: deny_reason.clone(),
                        is_retryable: false,
                    },
                )
                .await;

            return Err(OpenHarnessError::Validation(deny_reason));
        }

        let needs_confirmation = permission_evaluation.requires_approval()
            || (task.options.confirm_before_run && tool_needs_permissions);

        if needs_confirmation {
            info!("Tool requires confirmation: tool_name={}", tool_name);

            let approval_reason = if permission_evaluation.requires_approval() {
                permission_evaluation.reason.clone()
            } else {
                format!(
                    "Tool '{}' requires confirmation by runtime settings",
                    tool_name
                )
            };

            self.approval_queue
                .upsert(PermissionApprovalRequest::new(
                    task.tool_call.tool_id.clone(),
                    task.tool_call.tool_name.clone(),
                    permission_evaluation.action,
                    permission_evaluation.risk_level,
                    approval_reason,
                    task.context.session_id.clone(),
                    task.context.dialog_turn_id.clone(),
                    tool_args.clone(),
                ))
                .await;

            let (tx, rx) = oneshot::channel::<ConfirmationResponse>();

            // Use 1 year as an approximation of "infinite" when there is no timeout, to avoid overflow
            const ONE_YEAR_SECS: u64 = 365 * 24 * 60 * 60;
            let timeout_at = match task.options.confirmation_timeout_secs {
                Some(secs) => std::time::SystemTime::now() + Duration::from_secs(secs),
                None => std::time::SystemTime::now() + Duration::from_secs(ONE_YEAR_SECS),
            };

            self.confirmation_channels.insert(tool_id.clone(), tx);

            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::AwaitingConfirmation {
                        params: tool_args.clone(),
                        timeout_at,
                    },
                )
                .await;

            debug!("Waiting for confirmation: tool_name={}", tool_name);

            let confirmation_result = match task.options.confirmation_timeout_secs {
                Some(timeout_secs) => {
                    debug!(
                        "Waiting for user confirmation with timeout: timeout_secs={}, tool_name={}",
                        timeout_secs, tool_name
                    );
                    // There is a timeout limit
                    timeout(Duration::from_secs(timeout_secs), rx).await.ok()
                }
                None => {
                    debug!(
                        "Waiting for user confirmation without timeout: tool_name={}",
                        tool_name
                    );
                    Some(rx.await)
                }
            };

            match confirmation_result {
                Some(Ok(ConfirmationResponse::Confirmed)) => {
                    debug!("Tool confirmed: tool_name={}", tool_name);
                    let _ = self
                        .approval_queue
                        .remove_by_tool_call(&task.tool_call.tool_id)
                        .await;
                }
                Some(Ok(ConfirmationResponse::Rejected(reason))) => {
                    let _ = self
                        .approval_queue
                        .remove_by_tool_call(&task.tool_call.tool_id)
                        .await;

                    self.state_manager
                        .update_state(
                            &tool_id,
                            ToolExecutionState::Cancelled {
                                reason: format!("User rejected: {}", reason),
                            },
                        )
                        .await;

                    return Err(OpenHarnessError::Validation(format!(
                        "Tool was rejected by user: {}",
                        reason
                    )));
                }
                Some(Ok(ConfirmationResponse::Denied(reason))) => {
                    let _ = self
                        .approval_queue
                        .remove_by_tool_call(&task.tool_call.tool_id)
                        .await;

                    self.state_manager
                        .update_state(
                            &tool_id,
                            ToolExecutionState::Failed {
                                error: reason.clone(),
                                is_retryable: false,
                            },
                        )
                        .await;

                    return Err(OpenHarnessError::Validation(format!(
                        "Tool confirmation denied by permission policy: {}",
                        reason
                    )));
                }
                Some(Err(_)) => {
                    // Channel closed
                    let _ = self
                        .approval_queue
                        .remove_by_tool_call(&task.tool_call.tool_id)
                        .await;
                    self.append_permission_audit(
                        &task,
                        &permission_evaluation,
                        Some(false),
                        Some("Approval channel closed".to_string()),
                    )
                    .await;

                    self.state_manager
                        .update_state(
                            &tool_id,
                            ToolExecutionState::Cancelled {
                                reason: "Confirmation channel closed".to_string(),
                            },
                        )
                        .await;

                    return Err(OpenHarnessError::service("Confirmation channel closed"));
                }
                None => {
                    let _ = self
                        .approval_queue
                        .remove_by_tool_call(&task.tool_call.tool_id)
                        .await;
                    self.append_permission_audit(
                        &task,
                        &permission_evaluation,
                        Some(false),
                        Some("Approval timeout".to_string()),
                    )
                    .await;

                    self.state_manager
                        .update_state(
                            &tool_id,
                            ToolExecutionState::Cancelled {
                                reason: "Confirmation timeout".to_string(),
                            },
                        )
                        .await;

                    warn!("Confirmation timeout: {}", tool_name);
                    return Err(OpenHarnessError::Timeout(format!(
                        "Confirmation timeout: {}",
                        tool_name
                    )));
                }
            }

            self.confirmation_channels.remove(&tool_id);
        }

        if cancellation_token.is_cancelled() {
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Cancelled {
                        reason: "Tool was cancelled before execution".to_string(),
                    },
                )
                .await;
            self.cancellation_tokens.remove(&tool_id);
            return Err(OpenHarnessError::Cancelled(
                "Tool was cancelled before execution".to_string(),
            ));
        }

        // Set initial state
        if is_streaming {
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Streaming {
                        started_at: std::time::SystemTime::now(),
                        chunks_received: 0,
                    },
                )
                .await;
        } else {
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Running {
                        started_at: std::time::SystemTime::now(),
                        progress: None,
                    },
                )
                .await;
        }

        // Re-fetch task from state_manager to get any updated arguments after confirmation
        let task = self.state_manager.get_task(&tool_id).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Tool task not found: {}", tool_id))
        })?;

        // Re-evaluate permissions with updated arguments
        let permission_evaluation = self.evaluate_permission_for_task(&task).await;
        if matches!(
            permission_evaluation.effective_decision,
            PermissionDecision::Deny
        ) {
            self.state_manager
                .update_state(
                    &tool_id,
                    ToolExecutionState::Failed {
                        error: permission_evaluation.reason.clone(),
                        is_retryable: false,
                    },
                )
                .await;
            return Err(OpenHarnessError::Validation(permission_evaluation.reason));
        }

        let result = self
            .execute_with_retry(&task, cancellation_token.clone(), tool)
            .await;

        self.cancellation_tokens.remove(&tool_id);

        match result {
            Ok(tool_result) => {
                let duration_ms = start_time.elapsed().as_millis() as u64;

                // Execute after_tool_result hooks if configured
                if let Some(ref hooks) = task.context.hooks {
                    let ctx = Self::hook_context_for_task(&task, Some("success"), None);
                    hooks
                        .execute_hooks(
                            "after_tool_result",
                            &ctx,
                            Some(self.permission_engine.as_ref()),
                            Some(self.permission_audit_store.as_ref()),
                        )
                        .await;
                }

                self.state_manager
                    .update_state(
                        &tool_id,
                        ToolExecutionState::Completed {
                            result: convert_to_framework_result(&tool_result),
                            duration_ms,
                        },
                    )
                    .await;

                info!(
                    "Tool completed: tool_name={}, duration_ms={}",
                    tool_name, duration_ms
                );

                Ok(ToolExecutionResult {
                    tool_id,
                    tool_name,
                    result: tool_result,
                    execution_time_ms: duration_ms,
                })
            }
            Err(e) => {
                let error_msg = e.to_string();
                let is_retryable = task.options.max_retries > 0;

                // Execute after_tool_result hooks even on failure
                if let Some(ref hooks) = task.context.hooks {
                    let ctx =
                        Self::hook_context_for_task(&task, Some("error"), Some(error_msg.as_str()));
                    hooks
                        .execute_hooks(
                            "after_tool_result",
                            &ctx,
                            Some(self.permission_engine.as_ref()),
                            Some(self.permission_audit_store.as_ref()),
                        )
                        .await;
                }

                self.state_manager
                    .update_state(
                        &tool_id,
                        ToolExecutionState::Failed {
                            error: error_msg.clone(),
                            is_retryable,
                        },
                    )
                    .await;

                error!("Tool failed: tool_name={}, error={}", tool_name, error_msg);

                Err(e)
            }
        }
    }

    /// Execute with retry
    async fn execute_with_retry(
        &self,
        task: &ToolTask,
        cancellation_token: CancellationToken,
        tool: Arc<dyn crate::agentic::tools::framework::Tool>,
    ) -> OpenHarnessResult<ModelToolResult> {
        let mut attempts = 0;
        let max_attempts = task.options.max_retries + 1;

        loop {
            // Check cancellation token
            if cancellation_token.is_cancelled() {
                return Err(OpenHarnessError::Cancelled(
                    "Tool execution was cancelled".to_string(),
                ));
            }

            attempts += 1;

            let result = self
                .execute_tool_impl(task, cancellation_token.clone(), tool.clone())
                .await;

            match result {
                Ok(r) => return Ok(r),
                Err(e) => {
                    if attempts >= max_attempts {
                        return Err(e);
                    }

                    debug!(
                        "Retrying tool execution: attempt={}/{}, error={}",
                        attempts, max_attempts, e
                    );

                    // Wait for a period of time and retry
                    tokio::time::sleep(Duration::from_millis(100 * attempts as u64)).await;
                }
            }
        }
    }

    /// Actual execution of tool
    async fn execute_tool_impl(
        &self,
        task: &ToolTask,
        cancellation_token: CancellationToken,
        tool: Arc<dyn crate::agentic::tools::framework::Tool>,
    ) -> OpenHarnessResult<ModelToolResult> {
        // Check cancellation token
        if cancellation_token.is_cancelled() {
            return Err(OpenHarnessError::Cancelled(
                "Tool execution was cancelled".to_string(),
            ));
        }

        let stream_sink = if tool.supports_streaming() {
            let stream_task = task.clone();
            let stream_state_manager = Arc::clone(&self.state_manager);
            let chunk_counter = Arc::new(AtomicUsize::new(0));

            Some(ToolStreamSink::new(move |data| {
                let stream_task = stream_task.clone();
                let stream_state_manager = Arc::clone(&stream_state_manager);
                let chunk_counter = Arc::clone(&chunk_counter);

                async move {
                    let chunk_index = chunk_counter.fetch_add(1, Ordering::SeqCst) + 1;
                    stream_state_manager
                        .emit_stream_chunk_event(&stream_task, data, chunk_index)
                        .await;
                }
            }))
        } else {
            None
        };

        // Build tool context (pass all resource IDs)
        let tool_context = ToolUseContext {
            tool_call_id: Some(task.tool_call.tool_id.clone()),
            agent_type: Some(task.context.agent_type.clone()),
            session_id: Some(task.context.session_id.clone()),
            dialog_turn_id: Some(task.context.dialog_turn_id.clone()),
            workspace: task.context.workspace.clone(),
            custom_data: {
                let mut map = HashMap::new();

                if let Some(turn_index) = task.context.context_vars.get("turn_index") {
                    if let Ok(n) = turn_index.parse::<u64>() {
                        map.insert("turn_index".to_string(), serde_json::json!(n));
                    }
                }

                if let Some(provider) = task.context.context_vars.get("primary_model_provider") {
                    if !provider.is_empty() {
                        map.insert(
                            "primary_model_provider".to_string(),
                            serde_json::json!(provider),
                        );
                    }
                }
                if let Some(supports_images) = task
                    .context
                    .context_vars
                    .get("primary_model_supports_image_understanding")
                {
                    if let Ok(flag) = supports_images.parse::<bool>() {
                        map.insert(
                            "primary_model_supports_image_understanding".to_string(),
                            serde_json::json!(flag),
                        );
                    }
                }

                if let Some(agent_task_id) = task.context.context_vars.get("agent_task_id") {
                    if !agent_task_id.trim().is_empty() {
                        map.insert(
                            "agent_task_id".to_string(),
                            serde_json::json!(agent_task_id),
                        );
                    }
                }

                if let Some(parent_task_id) = task.context.context_vars.get("parent_task_id") {
                    if !parent_task_id.trim().is_empty() {
                        map.insert(
                            "parent_task_id".to_string(),
                            serde_json::json!(parent_task_id),
                        );
                    }
                }

                if let Some(agent_skills) = task.context.context_vars.get("agent_skills") {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(agent_skills) {
                        map.insert("agent_skills".to_string(), value);
                    }
                }

                if let Some(agent_mcp_servers) = task.context.context_vars.get("agent_mcp_servers")
                {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(agent_mcp_servers)
                    {
                        map.insert("agent_mcp_servers".to_string(), value);
                    }
                }

                map
            },
            stream_sink,
            computer_use_host: self.computer_use_host.clone(),
            cancellation_token: Some(cancellation_token),
            workspace_services: task.context.workspace_services.clone(),
        };

        let execution_future = tool.call(&task.tool_call.arguments, &tool_context);

        let tool_results = match task.options.timeout_secs {
            Some(timeout_secs) => {
                let timeout_duration = Duration::from_secs(timeout_secs);
                let result = timeout(timeout_duration, execution_future)
                    .await
                    .map_err(|_| {
                        OpenHarnessError::Timeout(format!(
                            "Tool execution timeout: {}",
                            task.tool_call.tool_name
                        ))
                    })?;
                result?
            }
            None => execution_future.await?,
        };

        if tool.supports_streaming() && !tool_results.is_empty() {
            self.handle_streaming_results(task, &tool_results).await?;
        }

        tool_results
            .into_iter()
            .last()
            .map(|r| convert_tool_result(r, &task.tool_call.tool_id, &task.tool_call.tool_name))
            .ok_or_else(|| {
                OpenHarnessError::Tool(format!(
                    "Tool did not return result: {}",
                    task.tool_call.tool_name
                ))
            })
    }

    /// Handle streaming results
    async fn handle_streaming_results(
        &self,
        task: &ToolTask,
        results: &[FrameworkToolResult],
    ) -> OpenHarnessResult<()> {
        let mut chunks_received = 0;

        for result in results {
            match result {
                FrameworkToolResult::StreamChunk {
                    data,
                    chunk_index: _,
                    is_final: _,
                } => {
                    chunks_received += 1;

                    // Update state
                    self.state_manager
                        .update_state(
                            &task.tool_call.tool_id,
                            ToolExecutionState::Streaming {
                                started_at: std::time::SystemTime::now(),
                                chunks_received,
                            },
                        )
                        .await;

                    self.state_manager
                        .emit_stream_chunk_event(task, data.clone(), chunks_received)
                        .await;
                }
                FrameworkToolResult::Progress { content, .. } => {
                    let message = content
                        .get("message")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .or_else(|| content.as_str().map(|value| value.to_string()))
                        .unwrap_or_else(|| "Tool progress update".to_string());

                    let percentage = content
                        .get("percentage")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0) as f32;

                    self.state_manager
                        .emit_progress_event(task, message, percentage, content.clone())
                        .await;
                }
                _ => {}
            }
        }

        Ok(())
    }

    /// Cancel tool execution
    pub async fn cancel_tool(&self, tool_id: &str, reason: String) -> OpenHarnessResult<()> {
        // 1. Trigger cancellation token
        if let Some((_, token)) = self.cancellation_tokens.remove(tool_id) {
            token.cancel();
            debug!("Cancellation token triggered: tool_id={}", tool_id);
        } else {
            debug!(
                "Cancellation token not found (tool may have completed): tool_id={}",
                tool_id
            );
        }

        // 2. Clean up confirmation channel (if waiting for confirmation)
        if let Some((_, _tx)) = self.confirmation_channels.remove(tool_id) {
            // Channel will be automatically closed, causing await rx to return Err
            debug!("Cleared confirmation channel: tool_id={}", tool_id);
        }

        if let Some(task) = self.state_manager.get_task(tool_id) {
            if matches!(
                task.state,
                ToolExecutionState::Completed { .. }
                    | ToolExecutionState::Failed { .. }
                    | ToolExecutionState::Cancelled { .. }
            ) {
                debug!(
                    "Skip cancelling terminal tool state: tool_id={}, state={:?}",
                    tool_id, task.state
                );
                return Ok(());
            }
        }

        // 3. Update state to cancelled
        self.state_manager
            .update_state(
                tool_id,
                ToolExecutionState::Cancelled {
                    reason: reason.clone(),
                },
            )
            .await;

        info!(
            "Tool execution cancelled: tool_id={}, reason={}",
            tool_id, reason
        );
        Ok(())
    }

    /// Cancel all tools for a dialog turn
    pub async fn cancel_dialog_turn_tools(&self, dialog_turn_id: &str) -> OpenHarnessResult<()> {
        info!(
            "Cancelling all tools for dialog turn: dialog_turn_id={}",
            dialog_turn_id
        );

        let tasks = self.state_manager.get_dialog_turn_tasks(dialog_turn_id);
        debug!("Found {} tool tasks for dialog turn", tasks.len());

        let mut cancelled_count = 0;
        let mut skipped_count = 0;

        for task in tasks {
            // Only cancel tasks in cancellable states
            let can_cancel = matches!(
                task.state,
                ToolExecutionState::Queued { .. }
                    | ToolExecutionState::Waiting { .. }
                    | ToolExecutionState::Running { .. }
                    | ToolExecutionState::Streaming { .. }
                    | ToolExecutionState::AwaitingConfirmation { .. }
            );

            if can_cancel {
                debug!(
                    "Cancelling tool: tool_id={}, state={:?}",
                    task.tool_call.tool_id, task.state
                );
                self.cancel_tool(&task.tool_call.tool_id, "Dialog turn cancelled".to_string())
                    .await?;
                cancelled_count += 1;
            } else {
                debug!(
                    "Skipping tool (state not cancellable): tool_id={}, state={:?}",
                    task.tool_call.tool_id, task.state
                );
                skipped_count += 1;
            }
        }

        info!(
            "Tool cancellation completed: cancelled={}, skipped={}",
            cancelled_count, skipped_count
        );
        Ok(())
    }

    /// Confirm tool execution
    pub async fn confirm_tool(
        &self,
        tool_id: &str,
        updated_input: Option<serde_json::Value>,
    ) -> OpenHarnessResult<()> {
        let task = self.state_manager.get_task(tool_id).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Tool task not found: {}", tool_id))
        })?;

        // Check if the state is waiting for confirmation
        if !matches!(task.state, ToolExecutionState::AwaitingConfirmation { .. }) {
            return Err(OpenHarnessError::Validation(format!(
                "Tool is not in awaiting confirmation state: {:?}",
                task.state
            )));
        }

        // If the user modified the parameters, update the task parameters first
        if let Some(new_args) = updated_input {
            debug!("User updated tool arguments: tool_id={}", tool_id);
            self.state_manager.update_task_arguments(tool_id, new_args);
        }

        let task_after_update = self.state_manager.get_task(tool_id).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Tool task not found after update: {}", tool_id))
        })?;
        let permission_evaluation = self.evaluate_permission_for_task(&task_after_update).await;

        // Check if updated parameters trigger Deny - if so, reject the confirmation
        if matches!(
            permission_evaluation.effective_decision,
            PermissionDecision::Deny
        ) {
            // Must also remove from confirmation_channels and notify waiting thread to prevent hang
            if let Some((_, tx)) = self.confirmation_channels.remove(tool_id) {
                let _ = tx.send(ConfirmationResponse::Denied(
                    permission_evaluation.reason.clone(),
                ));
            }
            let _ = self.approval_queue.remove_by_tool_call(tool_id).await;
            self.append_permission_audit(
                &task_after_update,
                &permission_evaluation,
                Some(false),
                Some("Updated parameters triggered deny".to_string()),
            )
            .await;
            self.state_manager
                .update_state(
                    tool_id,
                    ToolExecutionState::Failed {
                        error: permission_evaluation.reason.clone(),
                        is_retryable: false,
                    },
                )
                .await;
            return Err(OpenHarnessError::Validation(permission_evaluation.reason));
        }

        // Get sender from map and send confirmation response
        if let Some((_, tx)) = self.confirmation_channels.remove(tool_id) {
            let _ = tx.send(ConfirmationResponse::Confirmed);
            let _ = self.approval_queue.remove_by_tool_call(tool_id).await;
            self.append_permission_audit(
                &task_after_update,
                &permission_evaluation,
                Some(true),
                Some("Approval confirmed".to_string()),
            )
            .await;
            info!("User confirmed tool execution: tool_id={}", tool_id);
            Ok(())
        } else {
            Err(OpenHarnessError::NotFound(format!(
                "Confirmation channel not found: {}",
                tool_id
            )))
        }
    }

    /// Reject tool execution
    pub async fn reject_tool(&self, tool_id: &str, reason: String) -> OpenHarnessResult<()> {
        let task = self.state_manager.get_task(tool_id).ok_or_else(|| {
            OpenHarnessError::NotFound(format!("Tool task not found: {}", tool_id))
        })?;

        // Check if the state is waiting for confirmation
        if !matches!(task.state, ToolExecutionState::AwaitingConfirmation { .. }) {
            return Err(OpenHarnessError::Validation(format!(
                "Tool is not in awaiting confirmation state: {:?}",
                task.state
            )));
        }

        let permission_evaluation = self.evaluate_permission_for_task(&task).await;

        // Get sender from map and send rejection response
        if let Some((_, tx)) = self.confirmation_channels.remove(tool_id) {
            let _ = tx.send(ConfirmationResponse::Rejected(reason.clone()));
            let _ = self.approval_queue.remove_by_tool_call(tool_id).await;
            self.append_permission_audit(
                &task,
                &permission_evaluation,
                Some(false),
                Some(format!("Approval rejected: {}", reason)),
            )
            .await;
            info!(
                "User rejected tool execution: tool_id={}, reason={}",
                tool_id, reason
            );
            Ok(())
        } else {
            let _ = self.approval_queue.remove_by_tool_call(tool_id).await;
            self.append_permission_audit(
                &task,
                &permission_evaluation,
                Some(false),
                Some(format!("Approval rejected without channel: {}", reason)),
            )
            .await;

            // If the channel does not exist, mark it as cancelled directly
            self.state_manager
                .update_state(
                    tool_id,
                    ToolExecutionState::Cancelled {
                        reason: format!("User rejected: {}", reason),
                    },
                )
                .await;

            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::events::{AgenticEvent, EventQueue, EventQueueConfig, ToolEventData};
    use crate::agentic::tools::framework::{Tool, ValidationResult};
    use async_trait::async_trait;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Debug)]
    struct PipelineTestTool {
        name: &'static str,
        supports_streaming: bool,
        needs_permissions: bool,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl Tool for PipelineTestTool {
        fn name(&self) -> &str {
            self.name
        }

        async fn description(&self) -> OpenHarnessResult<String> {
            Ok(format!("{} test tool", self.name))
        }

        fn input_schema(&self) -> Value {
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" }
                }
            })
        }

        fn supports_streaming(&self) -> bool {
            self.supports_streaming
        }

        fn needs_permissions(&self, _input: Option<&Value>) -> bool {
            self.needs_permissions
        }

        async fn validate_input(
            &self,
            _input: &Value,
            _context: Option<&ToolUseContext>,
        ) -> ValidationResult {
            ValidationResult::default()
        }

        async fn call_impl(
            &self,
            _input: &Value,
            context: &ToolUseContext,
        ) -> OpenHarnessResult<Vec<FrameworkToolResult>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(stream_sink) = &context.stream_sink {
                stream_sink
                    .emit(json!({
                        "stream": "stdout",
                        "data": "streamed output"
                    }))
                    .await;
            }

            Ok(vec![FrameworkToolResult::ok(
                json!({"ok": true}),
                Some("ok".to_string()),
            )])
        }
    }

    fn test_context(permission_mode: Option<&str>) -> ToolExecutionContext {
        ToolExecutionContext {
            session_id: "session_1".to_string(),
            dialog_turn_id: "turn_1".to_string(),
            agent_type: "agentic".to_string(),
            workspace: None,
            context_vars: HashMap::new(),
            subagent_parent_info: None,
            allowed_tools: Vec::new(),
            workspace_services: None,
            permission_mode: permission_mode.map(|mode| mode.to_string()),
            hooks: None,
        }
    }

    async fn build_pipeline_with_tool(
        tool: PipelineTestTool,
    ) -> (Arc<ToolPipeline>, Arc<ToolStateManager>, Arc<EventQueue>) {
        let event_queue = Arc::new(EventQueue::new(EventQueueConfig::default()));
        let state_manager = Arc::new(ToolStateManager::new(Arc::clone(&event_queue)));
        let registry = Arc::new(TokioRwLock::new(ToolRegistry::new()));
        registry.write().await.register_tool(Arc::new(tool));
        let pipeline = Arc::new(ToolPipeline::new(
            registry,
            Arc::clone(&state_manager),
            None,
        ));
        (pipeline, state_manager, event_queue)
    }

    #[tokio::test]
    async fn initial_permission_evaluation_uses_agent_permission_override() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (pipeline, state_manager, _) = build_pipeline_with_tool(PipelineTestTool {
            name: "PermissionProbe",
            supports_streaming: false,
            needs_permissions: true,
            calls: Arc::clone(&calls),
        })
        .await;

        let results = pipeline
            .execute_tools(
                vec![ToolCall {
                    tool_id: "call-agent-deny".to_string(),
                    tool_name: "PermissionProbe".to_string(),
                    arguments: json!({"command":"echo ok"}),
                    is_error: false,
                }],
                test_context(Some("deny")),
                ToolExecutionOptions {
                    confirm_before_run: false,
                    ..ToolExecutionOptions::default()
                },
            )
            .await
            .expect("pipeline should convert tool denial into an error result");

        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(results.len(), 1);
        assert!(results[0].result.is_error);

        let task = state_manager
            .get_task("call-agent-deny")
            .expect("tool task should be tracked");
        assert!(matches!(task.state, ToolExecutionState::Failed { .. }));
    }

    #[tokio::test]
    async fn updated_approval_denied_by_permissions_unblocks_and_stays_failed() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (pipeline, state_manager, _) = build_pipeline_with_tool(PipelineTestTool {
            name: "Bash",
            supports_streaming: false,
            needs_permissions: true,
            calls: Arc::clone(&calls),
        })
        .await;

        let mut rule = PermissionRule::new("deny-updated-danger", PermissionDecision::Deny);
        rule.tool_name = Some("Bash".to_string());
        rule.command_contains = Some("rm -rf".to_string());
        rule.reason = "Updated command is denied".to_string();
        pipeline.upsert_permission_rule(rule).await;

        let run_pipeline = Arc::clone(&pipeline);
        let execution = tokio::spawn(async move {
            run_pipeline
                .execute_tools(
                    vec![ToolCall {
                        tool_id: "call-updated-deny".to_string(),
                        tool_name: "Bash".to_string(),
                        arguments: json!({"command":"echo ok"}),
                        is_error: false,
                    }],
                    test_context(None),
                    ToolExecutionOptions {
                        confirm_before_run: false,
                        confirmation_timeout_secs: Some(10),
                        ..ToolExecutionOptions::default()
                    },
                )
                .await
        });

        for _ in 0..100 {
            if !pipeline.list_pending_approvals().await.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(pipeline.list_pending_approvals().await.len(), 1);

        let confirm_error = pipeline
            .confirm_tool(
                "call-updated-deny",
                Some(json!({"command":"rm -rf /tmp/openharness-test"})),
            )
            .await
            .expect_err("updated denied arguments should reject confirmation");
        assert!(confirm_error
            .to_string()
            .contains("Updated command is denied"));

        let results = tokio::time::timeout(Duration::from_secs(2), execution)
            .await
            .expect("executor should not hang after denied updated approval")
            .expect("join should succeed")
            .expect("pipeline should return an error result");

        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(results[0].result.is_error);
        let task = state_manager
            .get_task("call-updated-deny")
            .expect("tool task should remain tracked");
        assert!(matches!(task.state, ToolExecutionState::Failed { .. }));
        assert!(pipeline.list_pending_approvals().await.is_empty());
    }

    #[tokio::test]
    async fn streaming_tool_sink_emits_realtime_stream_chunk_event() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (pipeline, _, event_queue) = build_pipeline_with_tool(PipelineTestTool {
            name: "StreamingProbe",
            supports_streaming: true,
            needs_permissions: false,
            calls: Arc::clone(&calls),
        })
        .await;

        let results = pipeline
            .execute_tools(
                vec![ToolCall {
                    tool_id: "call-stream".to_string(),
                    tool_name: "StreamingProbe".to_string(),
                    arguments: json!({}),
                    is_error: false,
                }],
                test_context(None),
                ToolExecutionOptions {
                    confirm_before_run: false,
                    ..ToolExecutionOptions::default()
                },
            )
            .await
            .expect("streaming test tool should execute");

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!results[0].result.is_error);

        let envelopes = event_queue.dequeue_batch(100).await;
        let stream_chunk = envelopes
            .into_iter()
            .find_map(|envelope| match envelope.event {
                AgenticEvent::ToolEvent { tool_event, .. } => match tool_event {
                    ToolEventData::StreamChunk { data, .. } => Some(data),
                    _ => None,
                },
                _ => None,
            });

        assert_eq!(
            stream_chunk,
            Some(json!({
                "stream": "stdout",
                "data": "streamed output"
            }))
        );
    }
}
