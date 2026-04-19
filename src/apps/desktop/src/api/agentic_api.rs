//! Agentic API

use log::warn;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::api::app_state::AppState;
use crate::api::session_storage_path::desktop_effective_session_storage_path;
use openharness_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogTriggerSource,
    PartnerBootstrapBlockReason, PartnerBootstrapEnsureOutcome, PartnerBootstrapSkipReason,
};
use openharness_core::agentic::{PermissionApprovalRequest, PermissionAuditRecord};
use openharness_core::agentic::core::*;
use openharness_core::agentic::image_analysis::ImageContextData;
use openharness_core::agentic::runtime::{
    AgentMailboxMessage, AgentTaskEvent, AgentTaskFilter, AgentTaskId, AgentTaskKind,
    AgentTaskSnapshot, AgentTaskStatus, AgentTranscript, AgentPatchRecord, AgentPatchSummary,
    AgentTeamStatus, PatchStatus,
};
use openharness_core::agentic::tools::image_context::get_image_context;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub session_id: Option<String>,
    pub session_name: String,
    pub agent_type: String,
    pub workspace_path: String,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    pub config: Option<SessionConfigDTO>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigDTO {
    pub max_context_tokens: Option<usize>,
    pub auto_compact: Option<bool>,
    pub enable_tools: Option<bool>,
    pub safe_mode: Option<bool>,
    pub max_turns: Option<usize>,
    pub enable_context_compression: Option<bool>,
    pub compression_threshold: Option<f32>,
    pub model_name: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionModelRequest {
    pub session_id: String,
    pub model_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionTitleRequest {
    pub session_id: String,
    pub title: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDialogTurnRequest {
    pub session_id: String,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub agent_type: String,
    pub workspace_path: Option<String>,
    pub turn_id: Option<String>,
    #[serde(default)]
    pub image_contexts: Option<Vec<ImageContextData>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDialogTurnResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCoordinatorSessionRequest {
    pub session_id: String,
    pub workspace_path: String,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsurePartnerBootstrapRequest {
    pub session_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsurePartnerBootstrapResponse {
    pub status: String,
    pub reason: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    pub state: String,
    pub turn_count: usize,
    pub created_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDialogTurnRequest {
    pub session_id: String,
    pub dialog_turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelToolRequest {
    pub tool_use_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionRequest {
    pub session_id: String,
    pub workspace_path: String,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSessionRequest {
    pub session_id: String,
    pub workspace_path: String,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsRequest {
    pub workspace_path: String,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmToolRequest {
    pub session_id: String,
    pub tool_id: String,
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectToolRequest {
    pub session_id: String,
    pub tool_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSessionTitleRequest {
    pub session_id: String,
    pub user_message: String,
    pub max_length: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskIdRequest {
    pub task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamStatusRequest {
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub team_name: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub member_task_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMailboxMessageRequest {
    pub to_task_id: String,
    pub content: String,
    #[serde(default)]
    pub from_task_id: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastAgentTeamMessageRequest {
    pub team_id: String,
    pub content: String,
    #[serde(default)]
    pub from_task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitAgentMailboxMessagesRequest {
    pub task_id: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRespondRequest {
    pub tool_id: String,
    pub approved: bool,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRespondBatchRequest {
    pub items: Vec<AgentApprovalRespondRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRespondBatchResult {
    pub tool_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalAuditRequest {
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentTaskRequest {
    pub task_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentTaskPatchStatusRequest {
    pub task_id: String,
    pub patch_id: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskPatchActionRequest {
    pub task_id: String,
    pub patch_id: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentTasksRequest {
    #[serde(default)]
    pub statuses: Option<Vec<String>>,
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    #[serde(default)]
    pub parent_task_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

fn parse_agent_task_status(value: &str) -> Result<AgentTaskStatus, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "queued" => Ok(AgentTaskStatus::Queued),
        "running" => Ok(AgentTaskStatus::Running),
        "waiting_approval" | "waitingapproval" | "waiting-approval" => {
            Ok(AgentTaskStatus::WaitingApproval)
        }
        "succeeded" | "success" => Ok(AgentTaskStatus::Succeeded),
        "failed" | "error" => Ok(AgentTaskStatus::Failed),
        "cancelled" | "canceled" => Ok(AgentTaskStatus::Cancelled),
        "interrupted" => Ok(AgentTaskStatus::Interrupted),
        _ => Err(format!("Unknown agent task status: {}", value)),
    }
}

fn parse_agent_task_kind(value: &str) -> Result<AgentTaskKind, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "foreground" => Ok(AgentTaskKind::Foreground),
        "child" => Ok(AgentTaskKind::Child),
        "background" => Ok(AgentTaskKind::Background),
        "team_member" | "teammember" | "team-member" => Ok(AgentTaskKind::TeamMember),
        _ => Err(format!("Unknown agent task kind: {}", value)),
    }
}

fn parse_patch_status(value: &str) -> Result<PatchStatus, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Ok(PatchStatus::Pending),
        "accepted" => Ok(PatchStatus::Accepted),
        "rejected" => Ok(PatchStatus::Rejected),
        "applied" => Ok(PatchStatus::Applied),
        "conflicted" => Ok(PatchStatus::Conflicted),
        _ => Err(format!("Unknown patch status: {}", value)),
    }
}

fn build_agent_task_filter(
    request: ListAgentTasksRequest,
) -> Result<Option<AgentTaskFilter>, String> {
    let statuses = request
        .statuses
        .map(|values| {
            values
                .iter()
                .map(|value| parse_agent_task_status(value))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;

    let kinds = request
        .kinds
        .map(|values| {
            values
                .iter()
                .map(|value| parse_agent_task_kind(value))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;

    let parent_task_id = request
        .parent_task_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(AgentTaskId::from);
    let session_id = request
        .session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if statuses.is_none() && kinds.is_none() && parent_task_id.is_none() && session_id.is_none() {
        return Ok(None);
    }

    Ok(Some(AgentTaskFilter {
        statuses,
        kinds,
        parent_task_id,
        session_id,
    }))
}

#[tauri::command]
pub async fn create_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CreateSessionRequest,
) -> Result<CreateSessionResponse, String> {
    fn norm_conn(s: Option<String>) -> Option<String> {
        s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
    }
    let remote_conn = norm_conn(request.remote_connection_id.clone()).or_else(|| {
        request
            .config
            .as_ref()
            .and_then(|c| norm_conn(c.remote_connection_id.clone()))
    });
    let remote_ssh_host = norm_conn(request.remote_ssh_host.clone()).or_else(|| {
        request
            .config
            .as_ref()
            .and_then(|c| norm_conn(c.remote_ssh_host.clone()))
    });

    let config = request
        .config
        .map(|c| SessionConfig {
            max_context_tokens: c.max_context_tokens.unwrap_or(128128),
            auto_compact: c.auto_compact.unwrap_or(true),
            enable_tools: c.enable_tools.unwrap_or(true),
            safe_mode: c.safe_mode.unwrap_or(true),
            max_turns: c.max_turns.unwrap_or(200),
            enable_context_compression: c.enable_context_compression.unwrap_or(true),
            compression_threshold: c.compression_threshold.unwrap_or(0.8),
            workspace_path: Some(request.workspace_path.clone()),
            remote_connection_id: remote_conn.clone(),
            remote_ssh_host: remote_ssh_host.clone(),
            model_id: c.model_name,
        })
        .unwrap_or(SessionConfig {
            workspace_path: Some(request.workspace_path.clone()),
            remote_connection_id: remote_conn.clone(),
            remote_ssh_host: remote_ssh_host.clone(),
            ..Default::default()
        });

    let session = coordinator
        .create_session_with_workspace(
            request.session_id,
            request.session_name.clone(),
            request.agent_type.clone(),
            config,
            request.workspace_path,
        )
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(CreateSessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
    })
}

#[tauri::command]
pub async fn update_session_model(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: UpdateSessionModelRequest,
) -> Result<(), String> {
    coordinator
        .update_session_model(&request.session_id, &request.model_name)
        .await
        .map_err(|e| format!("Failed to update session model: {}", e))
}

#[tauri::command]
pub async fn update_session_title(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: UpdateSessionTitleRequest,
) -> Result<String, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        let workspace_path = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "workspace_path is required when the session is not loaded".to_string()
            })?;

        let effective = desktop_effective_session_storage_path(
            &app_state,
            workspace_path,
            request.remote_connection_id.as_deref(),
            request.remote_ssh_host.as_deref(),
        )
        .await;

        coordinator
            .restore_session(&effective, session_id)
            .await
            .map_err(|e| format!("Failed to restore session before renaming: {}", e))?;
    }

    coordinator
        .update_session_title(session_id, &request.title)
        .await
        .map_err(|e| format!("Failed to update session title: {}", e))
}

/// Load the session into the coordinator process when it exists on disk but is not in memory.
/// Uses the same remote→local session path mapping as `restore_session`.
#[tauri::command]
pub async fn ensure_coordinator_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: EnsureCoordinatorSessionRequest,
) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_some()
    {
        return Ok(());
    }

    let wp = request.workspace_path.trim();
    if wp.is_empty() {
        return Err("workspace_path is required when the session is not loaded".to_string());
    }

    let effective = desktop_effective_session_storage_path(
        &app_state,
        wp,
        request.remote_connection_id.as_deref(),
        request.remote_ssh_host.as_deref(),
    )
    .await;
    coordinator
        .restore_session(&effective, session_id)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_dialog_turn(
    _app: AppHandle,
    _coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: StartDialogTurnRequest,
) -> Result<StartDialogTurnResponse, String> {
    let StartDialogTurnRequest {
        session_id,
        user_input,
        original_user_input,
        agent_type,
        workspace_path,
        turn_id,
        image_contexts,
    } = request;

    let policy = DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi);
    let resolved_images = if let Some(image_contexts) = image_contexts
        .as_ref()
        .filter(|images| !images.is_empty())
        .cloned()
    {
        Some(resolve_missing_image_payloads(image_contexts)?)
    } else {
        None
    };

    scheduler
        .submit(
            session_id,
            user_input,
            original_user_input,
            turn_id,
            agent_type,
            workspace_path,
            policy,
            None,
            resolved_images,
        )
        .await
        .map_err(|e| format!("Failed to start dialog turn: {}", e))?;

    Ok(StartDialogTurnResponse {
        success: true,
        message: "Dialog turn started".to_string(),
    })
}

#[tauri::command]
pub async fn compact_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: CompactSessionRequest,
) -> Result<StartDialogTurnResponse, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        let workspace_path = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "workspace_path is required when the session is not loaded".to_string()
            })?;
        let effective = desktop_effective_session_storage_path(
            &app_state,
            workspace_path,
            request.remote_connection_id.as_deref(),
            request.remote_ssh_host.as_deref(),
        )
        .await;
        coordinator
            .restore_session(&effective, session_id)
            .await
            .map_err(|e| format!("Failed to restore session before compacting: {}", e))?;
    }

    coordinator
        .compact_session_manually(session_id.to_string())
        .await
        .map_err(|e| format!("Failed to compact session: {}", e))?;

    Ok(StartDialogTurnResponse {
        success: true,
        message: "Session compaction started".to_string(),
    })
}

#[tauri::command]
pub async fn ensure_partner_bootstrap(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: EnsurePartnerBootstrapRequest,
) -> Result<EnsurePartnerBootstrapResponse, String> {
    let outcome = coordinator
        .ensure_partner_bootstrap(request.session_id, request.workspace_path)
        .await
        .map_err(|e| format!("Failed to ensure partner bootstrap: {}", e))?;

    Ok(partner_bootstrap_outcome_to_response(outcome))
}

fn is_blank_text(value: Option<&String>) -> bool {
    value.map(|s| s.trim().is_empty()).unwrap_or(true)
}

fn resolve_missing_image_payloads(
    image_contexts: Vec<ImageContextData>,
) -> Result<Vec<ImageContextData>, String> {
    let mut resolved = Vec::with_capacity(image_contexts.len());

    for mut image in image_contexts {
        let missing_payload =
            is_blank_text(image.image_path.as_ref()) && is_blank_text(image.data_url.as_ref());
        if !missing_payload {
            resolved.push(image);
            continue;
        }

        let stored = get_image_context(&image.id).ok_or_else(|| {
            format!(
                "Image context not found for image_id={}. It may have expired. Please re-attach the image and retry.",
                image.id
            )
        })?;

        if is_blank_text(image.image_path.as_ref()) {
            image.image_path = stored
                .image_path
                .clone()
                .filter(|s: &String| !s.trim().is_empty());
        }
        if is_blank_text(image.data_url.as_ref()) {
            image.data_url = stored
                .data_url
                .clone()
                .filter(|s: &String| !s.trim().is_empty());
        }
        if image.mime_type.trim().is_empty() {
            image.mime_type = stored.mime_type.clone();
        }

        let mut metadata = image
            .metadata
            .take()
            .unwrap_or_else(|| serde_json::json!({}));
        if !metadata.is_object() {
            metadata = serde_json::json!({ "raw_metadata": metadata });
        }
        if let Some(obj) = metadata.as_object_mut() {
            if !obj.contains_key("name") {
                obj.insert("name".to_string(), serde_json::json!(stored.image_name));
            }
            if !obj.contains_key("width") {
                obj.insert("width".to_string(), serde_json::json!(stored.width));
            }
            if !obj.contains_key("height") {
                obj.insert("height".to_string(), serde_json::json!(stored.height));
            }
            if !obj.contains_key("file_size") {
                obj.insert("file_size".to_string(), serde_json::json!(stored.file_size));
            }
            if !obj.contains_key("source") {
                obj.insert("source".to_string(), serde_json::json!(stored.source));
            }
            obj.insert(
                "resolved_from_upload_cache".to_string(),
                serde_json::json!(true),
            );
        }
        image.metadata = Some(metadata);

        let still_missing =
            is_blank_text(image.image_path.as_ref()) && is_blank_text(image.data_url.as_ref());
        if still_missing {
            return Err(format!(
                "Image context {} is missing image_path/data_url after cache resolution",
                image.id
            ));
        }

        resolved.push(image);
    }

    Ok(resolved)
}

#[tauri::command]
pub async fn cancel_dialog_turn(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CancelDialogTurnRequest,
) -> Result<(), String> {
    coordinator
        .cancel_dialog_turn(&request.session_id, &request.dialog_turn_id)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to cancel dialog turn: session_id={}, dialog_turn_id={}, error={}",
                request.session_id,
                request.dialog_turn_id,
                e
            );
            format!("Failed to cancel dialog turn: {}", e)
        })
}

#[tauri::command]
pub async fn cancel_tool(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CancelToolRequest,
) -> Result<(), String> {
    let reason = request
        .reason
        .unwrap_or_else(|| "User cancelled".to_string());

    coordinator
        .cancel_tool(&request.tool_use_id, reason)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to cancel tool execution: tool_use_id={}, error={}",
                request.tool_use_id,
                e
            );
            format!("Failed to cancel tool execution: {}", e)
        })
}

#[tauri::command]
pub async fn delete_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: DeleteSessionRequest,
) -> Result<(), String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        &request.workspace_path,
        request.remote_connection_id.as_deref(),
        request.remote_ssh_host.as_deref(),
    )
    .await;
    coordinator
        .delete_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to delete session: {}", e))
}

#[tauri::command]
pub async fn restore_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: RestoreSessionRequest,
) -> Result<SessionResponse, String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        &request.workspace_path,
        request.remote_connection_id.as_deref(),
        request.remote_ssh_host.as_deref(),
    )
    .await;
    let session = coordinator
        .restore_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to restore session: {}", e))?;

    Ok(session_to_response(session))
}

#[tauri::command]
pub async fn list_sessions(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: ListSessionsRequest,
) -> Result<Vec<SessionResponse>, String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        &request.workspace_path,
        request.remote_connection_id.as_deref(),
        request.remote_ssh_host.as_deref(),
    )
    .await;
    let summaries = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list sessions: {}", e))?;

    let responses = summaries
        .into_iter()
        .map(|summary| SessionResponse {
            session_id: summary.session_id,
            session_name: summary.session_name,
            agent_type: summary.agent_type,
            state: format!("{:?}", summary.state),
            turn_count: summary.turn_count,
            created_at: system_time_to_unix_secs(summary.created_at),
        })
        .collect();

    Ok(responses)
}

#[tauri::command]
pub async fn confirm_tool_execution(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: ConfirmToolRequest,
) -> Result<(), String> {
    coordinator
        .confirm_tool(&request.tool_id, request.updated_input)
        .await
        .map_err(|e| format!("Confirm tool failed: {}", e))
}

#[tauri::command]
pub async fn reject_tool_execution(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: RejectToolRequest,
) -> Result<(), String> {
    let reason = request
        .reason
        .unwrap_or_else(|| "User rejected".to_string());

    coordinator
        .reject_tool(&request.tool_id, reason)
        .await
        .map_err(|e| format!("Reject tool failed: {}", e))
}

#[tauri::command]
pub async fn generate_session_title(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: GenerateSessionTitleRequest,
) -> Result<String, String> {
    coordinator
        .generate_session_title(
            &request.session_id,
            &request.user_message,
            request.max_length,
        )
        .await
        .map_err(|e| format!("Failed to generate session title: {}", e))
}

#[tauri::command]
pub async fn list_agent_tasks(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: ListAgentTasksRequest,
) -> Result<Vec<AgentTaskSnapshot>, String> {
    let filter = build_agent_task_filter(request)?;
    Ok(coordinator.list_agent_tasks(filter.as_ref()).await)
}

#[tauri::command]
pub async fn get_agent_task(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<Option<AgentTaskSnapshot>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    Ok(coordinator
        .list_agent_tasks(None)
        .await
        .into_iter()
        .find(|snapshot| snapshot.task_id.as_str() == task_id))
}

#[tauri::command]
pub async fn cancel_agent_task(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CancelAgentTaskRequest,
) -> Result<AgentTaskSnapshot, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    let reason = request
        .reason
        .unwrap_or_else(|| "User cancelled agent task".to_string());

    coordinator
        .cancel_agent_task(task_id, reason)
        .await
        .map_err(|e| format!("Failed to cancel agent task: {}", e))
}

#[tauri::command]
pub async fn get_agent_task_events(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<Vec<AgentTaskEvent>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    coordinator
        .agent_task_events(task_id)
        .await
        .map_err(|e| format!("Failed to get agent task events: {}", e))
}

#[tauri::command]
pub async fn get_agent_task_transcript(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<Option<AgentTranscript>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    Ok(coordinator.agent_task_transcript(task_id).await)
}

#[tauri::command]
pub async fn get_agent_task_patches(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<Vec<AgentPatchRecord>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    Ok(coordinator.agent_task_patches(task_id).await)
}

#[tauri::command]
pub async fn update_agent_task_patch_status(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: UpdateAgentTaskPatchStatusRequest,
) -> Result<AgentPatchRecord, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    let patch_id = request.patch_id.trim();
    if patch_id.is_empty() {
        return Err("patch_id is required".to_string());
    }

    let status = parse_patch_status(&request.status)?;

    coordinator
        .set_agent_task_patch_status(task_id, patch_id, status)
        .await
        .map_err(|e| format!("Failed to update patch status: {}", e))
}

#[tauri::command]
pub async fn apply_agent_task_patch(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskPatchActionRequest,
) -> Result<AgentPatchRecord, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    let patch_id = request.patch_id.trim();
    if patch_id.is_empty() {
        return Err("patch_id is required".to_string());
    }

    coordinator
        .apply_agent_task_patch(task_id, patch_id)
        .await
        .map_err(|e| format!("Failed to apply patch: {}", e))
}

#[tauri::command]
pub async fn reject_agent_task_patch(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskPatchActionRequest,
) -> Result<AgentPatchRecord, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    let patch_id = request.patch_id.trim();
    if patch_id.is_empty() {
        return Err("patch_id is required".to_string());
    }

    coordinator
        .reject_agent_task_patch(task_id, patch_id)
        .await
        .map_err(|e| format!("Failed to reject patch: {}", e))
}

#[tauri::command]
pub async fn merge_agent_task_patches(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<Vec<AgentPatchRecord>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    coordinator
        .merge_agent_task_patches(task_id)
        .await
        .map_err(|e| format!("Failed to merge task patches: {}", e))
}

#[tauri::command]
pub async fn get_agent_task_patch_summary(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTaskIdRequest,
) -> Result<AgentPatchSummary, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    Ok(coordinator.agent_task_patch_summary(task_id).await)
}

#[tauri::command]
pub async fn get_agent_team_status(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentTeamStatusRequest,
) -> Result<AgentTeamStatus, String> {
    if let Some(team_id) = request
        .team_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return coordinator
            .agent_team_status(team_id)
            .await
            .map_err(|e| format!("Failed to get agent team status by team_id: {}", e));
    }

    coordinator
        .agent_team_status_from_members(
            request.team_name,
            request.objective,
            request.member_task_ids.unwrap_or_default(),
        )
        .await
        .map_err(|e| format!("Failed to get agent team status from member tasks: {}", e))
}

#[tauri::command]
pub async fn send_agent_mailbox_message(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: SendAgentMailboxMessageRequest,
) -> Result<AgentMailboxMessage, String> {
    let to_task_id = request.to_task_id.trim();
    if to_task_id.is_empty() {
        return Err("to_task_id is required".to_string());
    }

    let content = request.content.trim();
    if content.is_empty() {
        return Err("content is required".to_string());
    }

    coordinator
        .send_agent_mailbox_message(
            to_task_id,
            content.to_string(),
            request.from_task_id,
            request.team_id,
        )
        .await
        .map_err(|e| format!("Failed to send agent mailbox message: {}", e))
}

#[tauri::command]
pub async fn broadcast_agent_team_message(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: BroadcastAgentTeamMessageRequest,
) -> Result<Vec<AgentMailboxMessage>, String> {
    let team_id = request.team_id.trim();
    if team_id.is_empty() {
        return Err("team_id is required".to_string());
    }

    let content = request.content.trim();
    if content.is_empty() {
        return Err("content is required".to_string());
    }

    coordinator
        .broadcast_agent_team_message(team_id, content.to_string(), request.from_task_id)
        .await
        .map_err(|e| format!("Failed to broadcast team mailbox message: {}", e))
}

#[tauri::command]
pub async fn wait_agent_mailbox_messages(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: WaitAgentMailboxMessagesRequest,
) -> Result<Vec<AgentMailboxMessage>, String> {
    let task_id = request.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id is required".to_string());
    }

    coordinator
        .wait_agent_mailbox_messages(task_id, request.timeout_ms)
        .await
        .map_err(|e| format!("Failed to wait for agent mailbox messages: {}", e))
}

#[tauri::command]
pub async fn agent_approval_list_pending(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<Vec<PermissionApprovalRequest>, String> {
    Ok(coordinator.agent_approval_list_pending().await)
}

#[tauri::command]
pub async fn agent_approval_respond(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentApprovalRespondRequest,
) -> Result<(), String> {
    let tool_id = request.tool_id.trim();
    if tool_id.is_empty() {
        return Err("tool_id is required".to_string());
    }

    coordinator
        .agent_approval_respond(
            tool_id,
            request.approved,
            request.reason,
            request.updated_input,
        )
        .await
        .map_err(|e| format!("Failed to respond approval: {}", e))
}

#[tauri::command]
pub async fn agent_approval_respond_batch(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentApprovalRespondBatchRequest,
) -> Result<Vec<AgentApprovalRespondBatchResult>, String> {
    let mut results = Vec::with_capacity(request.items.len());

    for item in request.items {
        let tool_id = item.tool_id.trim().to_string();
        if tool_id.is_empty() {
            results.push(AgentApprovalRespondBatchResult {
                tool_id,
                success: false,
                error: Some("tool_id is required".to_string()),
            });
            continue;
        }

        match coordinator
            .agent_approval_respond(
                &tool_id,
                item.approved,
                item.reason,
                item.updated_input,
            )
            .await
        {
            Ok(_) => results.push(AgentApprovalRespondBatchResult {
                tool_id,
                success: true,
                error: None,
            }),
            Err(error) => results.push(AgentApprovalRespondBatchResult {
                tool_id,
                success: false,
                error: Some(error.to_string()),
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn agent_approval_audit_recent(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: AgentApprovalAuditRequest,
) -> Result<Vec<PermissionAuditRecord>, String> {
    let limit = request.limit.unwrap_or(200);
    Ok(coordinator.agent_approval_audit_recent(limit).await)
}

#[tauri::command]
pub async fn get_available_modes(state: State<'_, AppState>) -> Result<Vec<ModeInfoDTO>, String> {
    let mode_infos = state.agent_registry.get_modes_info().await;

    let dtos: Vec<ModeInfoDTO> = mode_infos
        .into_iter()
        .map(|info| ModeInfoDTO {
            id: info.id,
            name: info.name,
            description: info.description,
            is_readonly: info.is_readonly,
            tool_count: info.tool_count,
            default_tools: info.default_tools,
            enabled: info.enabled,
        })
        .collect();

    Ok(dtos)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeInfoDTO {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_readonly: bool,
    pub tool_count: usize,
    pub default_tools: Vec<String>,
    pub enabled: bool,
}

fn partner_bootstrap_outcome_to_response(
    outcome: PartnerBootstrapEnsureOutcome,
) -> EnsurePartnerBootstrapResponse {
    match outcome {
        PartnerBootstrapEnsureOutcome::Started {
            session_id,
            turn_id,
        } => EnsurePartnerBootstrapResponse {
            status: "started".to_string(),
            reason: "bootstrap_started".to_string(),
            session_id,
            turn_id: Some(turn_id),
            detail: None,
        },
        PartnerBootstrapEnsureOutcome::Skipped { session_id, reason } => {
            EnsurePartnerBootstrapResponse {
                status: "skipped".to_string(),
                reason: partner_bootstrap_skip_reason_to_str(reason).to_string(),
                session_id,
                turn_id: None,
                detail: None,
            }
        }
        PartnerBootstrapEnsureOutcome::Blocked {
            session_id,
            reason,
            detail,
        } => EnsurePartnerBootstrapResponse {
            status: "blocked".to_string(),
            reason: partner_bootstrap_block_reason_to_str(reason).to_string(),
            session_id,
            turn_id: None,
            detail: Some(detail),
        },
    }
}

fn partner_bootstrap_skip_reason_to_str(reason: PartnerBootstrapSkipReason) -> &'static str {
    match reason {
        PartnerBootstrapSkipReason::BootstrapNotRequired => "bootstrap_not_required",
        PartnerBootstrapSkipReason::SessionHasExistingTurns => "session_has_existing_turns",
        PartnerBootstrapSkipReason::SessionNotIdle => "session_not_idle",
    }
}

fn partner_bootstrap_block_reason_to_str(reason: PartnerBootstrapBlockReason) -> &'static str {
    match reason {
        PartnerBootstrapBlockReason::ModelUnavailable => "model_unavailable",
    }
}

fn session_to_response(session: Session) -> SessionResponse {
    SessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
        state: format!("{:?}", session.state),
        turn_count: session.dialog_turn_ids.len(),
        created_at: system_time_to_unix_secs(session.created_at),
    }
}

fn system_time_to_unix_secs(time: std::time::SystemTime) -> u64 {
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(err) => {
            warn!("Failed to convert SystemTime to unix timestamp: {}", err);
            0
        }
    }
}
