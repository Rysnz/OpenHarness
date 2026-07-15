//! AI Request/Response Logger
//!
//! Records the full input and output of each AI model invocation for debugging.
//! Each round produces one JSON file under the session's `ai_requests/{session_id}/` directory.
//! Old logs are pruned to keep the most recent 50 per session.

use crate::util::errors::OpenHarnessResult;
use crate::util::types::Message as AIMessage;
use crate::util::types::ToolDefinition;
use log::{debug, info, warn};

/// Safely truncate a string to at most `max_bytes` bytes by
/// falling back to the nearest valid char boundary.
fn truncate_to_bytes(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;

const AI_LOGS_DIR: &str = "ai_requests";
const MAX_LOG_FILES_PER_SESSION: usize = 50;

/// Global base directory for AI request logs.
/// Set once at app startup; if not set, logs are not written.
static AI_LOG_BASE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Complete log entry for a single model round.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoundLogEntry {
    /// Timestamp (ISO 8601)
    timestamp: String,
    /// Session ID
    session_id: String,
    /// Dialog turn ID
    dialog_turn_id: String,
    /// Round ID
    round_id: String,
    /// Agent type (Partner, Agentic, etc.)
    agent_type: String,
    /// Model name used for this request
    model: String,
    /// Whether thinking process was enabled in the request
    thinking_enabled: bool,
    /// Retry attempt index (0 = first attempt)
    attempt_index: usize,

    // ── Request ──
    request: RequestSection,

    // ── Response ──
    response: ResponseSection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestSection {
    /// Number of messages sent (system + history + current user)
    message_count: usize,
    /// System prompt (first message if it's system role)
    system_prompt_preview: String,
    /// Last user message content
    last_user_message: String,
    /// Total characters in all messages
    total_message_chars: usize,
    /// Tool definitions sent
    tools: Vec<String>,
    /// Tool count
    tool_count: usize,
    /// Full message dump (role + content preview) for debugging
    message_summary: Vec<MessageSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageSummary {
    role: String,
    content_len: usize,
    content_preview: String, // first 500 chars
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseSection {
    /// Full thinking/reasoning content
    thinking_full: String,
    /// Thinking content length in chars
    thinking_len: usize,
    /// Full text content
    text_full: String,
    /// Text content length in chars
    text_len: usize,
    /// Tool calls invoked by this round
    tool_calls: Vec<ToolCallInfo>,
    /// Finish reason from the API
    finish_reason: Option<String>,
    /// Token usage (input/output/total)
    usage: Option<UsageInfo>,
    /// Whether this round produced any user-visible output
    has_effective_output: bool,
    /// Partial recovery reason if stream was interrupted
    partial_recovery_reason: Option<String>,
    /// Any error encountered
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallInfo {
    name: String,
    arguments_preview: String, // truncated to avoid huge logs
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageInfo {
    input_tokens: u32,
    output_tokens: u32,
    total_tokens: u32,
}

/// Logger for AI request/response pairs. Thread-safe and idempotent.
pub struct AiRequestLogger;

impl AiRequestLogger {
    /// Set the global base directory for AI request logs.
    /// Should be called once during app startup with the session log dir.
    pub fn set_log_base_dir(dir: PathBuf) {
        // Ensure the directory exists even on first access
        let _ = std::fs::create_dir_all(&dir);
        let _ = AI_LOG_BASE_DIR.set(dir);
    }

    /// Save a complete log entry for one model round.
    ///
    /// Uses the global `AI_LOG_BASE_DIR` if set; otherwise falls back to `log_root_dir`.
    #[allow(clippy::too_many_arguments)]
    pub async fn save_round_log(
        log_root_dir: &Path,
        session_id: &str,
        dialog_turn_id: &str,
        round_id: &str,
        agent_type: &str,
        model: &str,
        thinking_enabled: bool,
        attempt_index: usize,
        messages: &[AIMessage],
        tool_definitions: &[ToolDefinition],
        thinking_full: &str,
        text_full: &str,
        tool_calls: &[(String, String)], // (name, arguments_json_preview)
        finish_reason: Option<&str>,
        usage_input: Option<u32>,
        usage_output: Option<u32>,
        usage_total: Option<u32>,
        has_effective_output: bool,
        partial_recovery_reason: Option<&str>,
        error: Option<&str>,
    ) {
        let base_dir = AI_LOG_BASE_DIR
            .get()
            .map(|p| p.clone())
            .unwrap_or_else(|| log_root_dir.to_path_buf());
        info!("save_round_log: base_dir={} session={} round={} model={} text={} think={} tc={}",
            base_dir.display(), session_id, round_id, model,
            text_full.len(), thinking_full.len(), tool_calls.len());
        let session_log_dir = base_dir.join(AI_LOGS_DIR).join(session_id);
        let log_dir = session_log_dir.clone();
        if let Err(e) = fs::create_dir_all(&log_dir).await {
            warn!("Failed to create ai_logs dir {}: {}", log_dir.display(), e);
            return;
        }

        // System prompt = first system-role message (if any)
        let system_prompt_preview = messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| {
                let text = m.content.as_deref().unwrap_or("");
                let limit = 2000usize;
                if text.len() > limit {
                    let truncated = truncate_to_bytes(text, limit);
                    format!("{}…(+{} chars)", truncated, text.len() - limit)
                } else {
                    text.to_string()
                }
            })
            .next()
            .unwrap_or_default();

        let last_user_message = messages
            .iter()
            .rev()
            .filter(|m| m.role == "user")
            .map(|m| m.content.as_deref().unwrap_or("").to_string())
            .next()
            .unwrap_or_default();

        let total_message_chars: usize = messages
            .iter()
            .map(|m| m.content.as_deref().unwrap_or("").len())
            .sum();

        let message_summary: Vec<MessageSummary> = messages
            .iter()
            .map(|m| {
                let content = m.content.as_deref().unwrap_or("");
                MessageSummary {
                    role: m.role.clone(),
                    content_len: content.len(),
                    content_preview: if content.len() > 500 {
                        let truncated = truncate_to_bytes(content, 500);
                        format!("{}…", truncated)
                    } else {
                        content.to_string()
                    },
                }
            })
            .collect();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        let entry = RoundLogEntry {
            timestamp: chrono::DateTime::from_timestamp_millis(now as i64)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| now.to_string()),
            session_id: session_id.to_string(),
            dialog_turn_id: dialog_turn_id.to_string(),
            round_id: round_id.to_string(),
            agent_type: agent_type.to_string(),
            model: model.to_string(),
            thinking_enabled,
            attempt_index,
            request: RequestSection {
                message_count: messages.len(),
                system_prompt_preview,
                last_user_message,
                total_message_chars,
                tools: tool_definitions.iter().map(|t| t.name.clone()).collect(),
                tool_count: tool_definitions.len(),
                message_summary,
            },
            response: ResponseSection {
                thinking_full: (if thinking_full.len() > 5000 {
                    let truncated = truncate_to_bytes(thinking_full, 5000);
                    format!(
                        "{}…(+{} chars)",
                        truncated,
                        thinking_full.len() - 5000
                    )
                } else {
                    thinking_full.to_string()
                }),
                thinking_len: thinking_full.len(),
                text_full: text_full.to_string(),
                text_len: text_full.len(),
                tool_calls: tool_calls
                    .iter()
                    .map(|(name, args)| ToolCallInfo {
                        name: name.clone(),
                        arguments_preview: {
                            let limit = 500usize;
                            if args.len() > limit {
                                let truncated = truncate_to_bytes(args, limit);
                                format!("{}…", truncated)
                            } else {
                                args.clone()
                            }
                        },
                    })
                    .collect(),
                finish_reason: finish_reason.map(str::to_string),
                usage: usage_input.map(|input| UsageInfo {
                    input_tokens: input,
                    output_tokens: usage_output.unwrap_or(0),
                    total_tokens: usage_total.unwrap_or(0),
                }),
                has_effective_output,
                partial_recovery_reason: partial_recovery_reason.map(str::to_string),
                error: error.map(str::to_string),
            },
        };

        let ts = now;
        let filename = format!("{}_{}.json", ts, attempt_index);
        let file_path = log_dir.join(&filename);

        match serde_json::to_string_pretty(&entry) {
            Ok(json) => {
                if let Err(e) = fs::write(&file_path, &json).await {
                    warn!(
                        "Failed to write ai log {}: {}",
                        file_path.display(),
                        e
                    );
                } else {
                    debug!("AI round log saved: {}", file_path.display());
                }
            }
            Err(e) => {
                warn!("Failed to serialize ai log entry: {}", e);
            }
        }

        // Prune old logs
        Self::prune_old_logs(&log_dir).await;
    }

    /// Remove oldest log files, keeping at most MAX_LOG_FILES_PER_SESSION.
    async fn prune_old_logs(log_dir: &Path) {
        let mut entries: Vec<(u64, PathBuf)> = match tokio::fs::read_dir(log_dir).await {
            Ok(mut dir) => {
                let mut files = Vec::new();
                while let Ok(Some(entry)) = dir.next_entry().await {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("json") {
                        if let Ok(meta) = entry.metadata().await {
                            if let Ok(mod_time) = meta.modified() {
                                if let Ok(ts) = mod_time.duration_since(UNIX_EPOCH) {
                                    files.push((ts.as_millis() as u64, path));
                                }
                            }
                        }
                    }
                }
                files
            }
            Err(_) => return,
        };

        if entries.len() <= MAX_LOG_FILES_PER_SESSION {
            return;
        }

        // Sort oldest first and remove excess
        entries.sort_by_key(|(ts, _)| *ts);
        let to_remove = entries.len() - MAX_LOG_FILES_PER_SESSION;

        for (_, path) in entries.iter().take(to_remove) {
            if let Err(e) = tokio::fs::remove_file(path).await {
                warn!("Failed to prune old ai log {}: {}", path.display(), e);
            }
        }
    }

    /// List all session directories under `ai_requests/` with their file metadata.
    pub async fn list_sessions() -> OpenHarnessResult<Vec<SessionLogSummary>> {
        use serde::Serialize;
        use crate::util::errors::OpenHarnessError;

        let base_dir = AI_LOG_BASE_DIR
            .get()
            .ok_or_else(|| OpenHarnessError::service("AI log base dir not set"))?;
        let ai_requests = base_dir.join(AI_LOGS_DIR);

        // Directory doesn't exist yet (no logs have been written) → empty list
        if !tokio::fs::try_exists(&ai_requests).await.unwrap_or(false) {
            return Ok(Vec::new());
        }

        let mut sessions = Vec::new();
        let mut dir = tokio::fs::read_dir(&ai_requests).await.map_err(|e| {
            OpenHarnessError::service(format!("Cannot read ai_requests dir: {}", e))
        })?;

        while let Ok(Some(entry)) = dir.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let session_id = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let mut files: Vec<LogFileMeta> = Vec::new();
            if let Ok(mut sub_dir) = tokio::fs::read_dir(&path).await {
                while let Ok(Some(file_entry)) = sub_dir.next_entry().await {
                    let fp = file_entry.path();
                    if fp.extension().and_then(|e| e.to_str()) != Some("json") {
                        continue;
                    }
                    if let Ok(meta) = file_entry.metadata().await {
                        let ts = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64);
                        files.push(LogFileMeta {
                            filename: fp
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown")
                                .to_string(),
                            timestamp_ms: ts,
                            size_bytes: meta.len(),
                        });
                    }
                }
            }

            files.sort_by_key(|f| f.timestamp_ms.unwrap_or(0));
            let latest_ts = files.last().and_then(|f| f.timestamp_ms).map(|ms| {
                chrono::DateTime::from_timestamp_millis(ms as i64)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| ms.to_string())
            });

            sessions.push(SessionLogSummary {
                session_id,
                file_count: files.len(),
                latest_timestamp: latest_ts,
                files,
            });
        }

        sessions.sort_by(|a, b| b.latest_timestamp.cmp(&a.latest_timestamp));
        Ok(sessions)
    }

    /// Read a specific AI log entry as raw JSON.
    pub async fn read_log(
        session_id: &str,
        filename: &str,
    ) -> OpenHarnessResult<serde_json::Value> {
        use crate::util::errors::OpenHarnessError;

        let base_dir = AI_LOG_BASE_DIR
            .get()
            .ok_or_else(|| OpenHarnessError::service("AI log base dir not set"))?;
        let file_path = base_dir
            .join(AI_LOGS_DIR)
            .join(session_id)
            .join(filename);

        let content = tokio::fs::read_to_string(&file_path).await.map_err(|e| {
            OpenHarnessError::service(format!("Cannot read log {}: {}", file_path.display(), e))
        })?;
        serde_json::from_str(&content)
            .map_err(|e| OpenHarnessError::service(format!("Invalid JSON: {}", e)))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogSummary {
    pub session_id: String,
    pub file_count: usize,
    pub latest_timestamp: Option<String>,
    pub files: Vec<LogFileMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileMeta {
    pub filename: String,
    pub timestamp_ms: Option<u64>,
    pub size_bytes: u64,
}
