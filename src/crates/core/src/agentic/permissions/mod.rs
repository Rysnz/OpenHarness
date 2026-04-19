use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    Enforce,
    DryRun,
    Off,
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::Enforce
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    Read,
    Write,
    Shell,
    Mcp,
    Worktree,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionEvaluation {
    pub action: PermissionAction,
    pub risk_level: PermissionRiskLevel,
    pub decision: PermissionDecision,
    pub effective_decision: PermissionDecision,
    pub reason: String,
}

impl PermissionEvaluation {
    pub fn requires_approval(&self) -> bool {
        matches!(self.effective_decision, PermissionDecision::Ask)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionApprovalRequest {
    pub request_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub action: PermissionAction,
    pub risk_level: PermissionRiskLevel,
    pub reason: String,
    pub session_id: String,
    pub dialog_turn_id: String,
    pub params: Value,
    pub created_at_ms: u64,
}

impl PermissionApprovalRequest {
    pub fn new(
        tool_call_id: String,
        tool_name: String,
        action: PermissionAction,
        risk_level: PermissionRiskLevel,
        reason: String,
        session_id: String,
        dialog_turn_id: String,
        params: Value,
    ) -> Self {
        Self {
            request_id: format!("agapprove-{}", uuid::Uuid::new_v4()),
            tool_call_id,
            tool_name,
            action,
            risk_level,
            reason,
            session_id,
            dialog_turn_id,
            params,
            created_at_ms: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionAuditRecord {
    pub audit_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub action: PermissionAction,
    pub risk_level: PermissionRiskLevel,
    pub decision: PermissionDecision,
    pub effective_decision: PermissionDecision,
    pub reason: String,
    pub session_id: String,
    pub dialog_turn_id: String,
    pub approved: Option<bool>,
    pub timestamp_ms: u64,
}

impl PermissionAuditRecord {
    pub fn from_evaluation(
        tool_call_id: String,
        tool_name: String,
        session_id: String,
        dialog_turn_id: String,
        evaluation: &PermissionEvaluation,
        approved: Option<bool>,
        reason: Option<String>,
    ) -> Self {
        Self {
            audit_id: format!("agaudit-{}", uuid::Uuid::new_v4()),
            tool_call_id,
            tool_name,
            action: evaluation.action,
            risk_level: evaluation.risk_level,
            decision: evaluation.decision,
            effective_decision: evaluation.effective_decision,
            reason: reason.unwrap_or_else(|| evaluation.reason.clone()),
            session_id,
            dialog_turn_id,
            approved,
            timestamp_ms: now_ms(),
        }
    }
}

#[derive(Default)]
pub struct PermissionApprovalQueue {
    pending: RwLock<HashMap<String, PermissionApprovalRequest>>,
}

impl PermissionApprovalQueue {
    pub async fn upsert(&self, request: PermissionApprovalRequest) {
        self.pending
            .write()
            .await
            .insert(request.tool_call_id.clone(), request);
    }

    pub async fn remove_by_tool_call(
        &self,
        tool_call_id: &str,
    ) -> Option<PermissionApprovalRequest> {
        self.pending.write().await.remove(tool_call_id)
    }

    pub async fn list_pending(&self) -> Vec<PermissionApprovalRequest> {
        self.pending.read().await.values().cloned().collect()
    }
}

#[derive(Default)]
pub struct PermissionAuditStore {
    records: RwLock<Vec<PermissionAuditRecord>>,
}

impl PermissionAuditStore {
    pub async fn append(&self, record: PermissionAuditRecord) {
        self.records.write().await.push(record);
    }

    pub async fn list_recent(&self, limit: usize) -> Vec<PermissionAuditRecord> {
        let records = self.records.read().await;
        if limit == 0 || records.len() <= limit {
            return records.clone();
        }
        records[records.len().saturating_sub(limit)..].to_vec()
    }
}

#[derive(Default)]
pub struct PermissionEngine {
    mode: RwLock<PermissionMode>,
    denied_tools: RwLock<HashSet<String>>,
}

impl PermissionEngine {
    pub async fn mode(&self) -> PermissionMode {
        *self.mode.read().await
    }

    pub async fn set_mode(&self, mode: PermissionMode) {
        *self.mode.write().await = mode;
    }

    pub async fn add_denied_tool(&self, tool_name: &str) {
        let mut denied = self.denied_tools.write().await;
        denied.insert(tool_name.trim().to_ascii_lowercase());
    }

    pub async fn evaluate(
        &self,
        tool_name: &str,
        input: &Value,
        needs_permissions: bool,
    ) -> PermissionEvaluation {
        let action = infer_permission_action(tool_name, input);
        let normalized_name = tool_name.trim().to_ascii_lowercase();

        let denied = self.denied_tools.read().await;
        let base = if denied.contains(&normalized_name) {
            PermissionEvaluation {
                action,
                risk_level: PermissionRiskLevel::High,
                decision: PermissionDecision::Deny,
                effective_decision: PermissionDecision::Deny,
                reason: format!("Tool '{}' is denied by explicit policy", tool_name),
            }
        } else {
            default_evaluation(action, tool_name, needs_permissions)
        };
        drop(denied);

        let mode = self.mode().await;
        match mode {
            PermissionMode::Off => PermissionEvaluation {
                effective_decision: PermissionDecision::Allow,
                reason: format!("{} (permission mode=off)", base.reason),
                ..base
            },
            PermissionMode::DryRun => {
                if matches!(base.effective_decision, PermissionDecision::Allow) {
                    base
                } else {
                    PermissionEvaluation {
                        effective_decision: PermissionDecision::Allow,
                        reason: format!("{} (permission mode=dry_run)", base.reason),
                        ..base
                    }
                }
            }
            PermissionMode::Enforce => base,
        }
    }
}

fn default_evaluation(
    action: PermissionAction,
    tool_name: &str,
    needs_permissions: bool,
) -> PermissionEvaluation {
    match action {
        PermissionAction::Write => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::High,
            decision: PermissionDecision::Ask,
            effective_decision: PermissionDecision::Ask,
            reason: format!("Tool '{}' mutates files and requires approval", tool_name),
        },
        PermissionAction::Shell => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::High,
            decision: PermissionDecision::Ask,
            effective_decision: PermissionDecision::Ask,
            reason: format!("Tool '{}' executes shell commands and requires approval", tool_name),
        },
        PermissionAction::Mcp => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::Medium,
            decision: PermissionDecision::Ask,
            effective_decision: PermissionDecision::Ask,
            reason: format!("Tool '{}' accesses MCP resources and requires approval", tool_name),
        },
        PermissionAction::Worktree => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::High,
            decision: PermissionDecision::Ask,
            effective_decision: PermissionDecision::Ask,
            reason: format!(
                "Tool '{}' changes workspace isolation/worktree and requires approval",
                tool_name
            ),
        },
        PermissionAction::Read => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::Low,
            decision: PermissionDecision::Allow,
            effective_decision: PermissionDecision::Allow,
            reason: format!("Tool '{}' is treated as read-only", tool_name),
        },
        PermissionAction::Other => {
            if needs_permissions {
                PermissionEvaluation {
                    action,
                    risk_level: PermissionRiskLevel::Medium,
                    decision: PermissionDecision::Ask,
                    effective_decision: PermissionDecision::Ask,
                    reason: format!(
                        "Tool '{}' is marked as permission-sensitive and requires approval",
                        tool_name
                    ),
                }
            } else {
                PermissionEvaluation {
                    action,
                    risk_level: PermissionRiskLevel::Low,
                    decision: PermissionDecision::Allow,
                    effective_decision: PermissionDecision::Allow,
                    reason: format!(
                        "Tool '{}' does not require permissions and is allowed",
                        tool_name
                    ),
                }
            }
        }
    }
}

fn infer_permission_action(tool_name: &str, input: &Value) -> PermissionAction {
    let normalized = tool_name.trim().to_ascii_lowercase();

    let write_tools = [
        "write",
        "edit",
        "delete",
        "search_replace",
        "apply_patch",
        "create_file",
        "str_replace",
        "file_write",
        "delete_file",
    ];
    if write_tools.contains(&normalized.as_str()) {
        return PermissionAction::Write;
    }

    let shell_tools = ["bash", "terminal_control", "run_in_terminal", "shell"];
    if shell_tools.contains(&normalized.as_str()) {
        return PermissionAction::Shell;
    }

    if normalized.contains("mcp") {
        return PermissionAction::Mcp;
    }

    let read_tools = ["read", "ls", "glob", "grep", "get_file_diff", "file_read"];
    if read_tools.contains(&normalized.as_str()) {
        return PermissionAction::Read;
    }

    if normalized == "task" {
        let isolation = input
            .get("workspace_isolation")
            .or_else(|| input.get("isolation"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();
        if isolation.contains("worktree") {
            return PermissionAction::Worktree;
        }
    }

    if normalized == "git" {
        if let Some(args) = input.get("args").and_then(|value| value.as_array()) {
            if args
                .iter()
                .filter_map(|value| value.as_str())
                .any(|value| value.eq_ignore_ascii_case("worktree"))
            {
                return PermissionAction::Worktree;
            }
        }
    }

    PermissionAction::Other
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn evaluates_write_tool_as_ask_by_default() {
        let engine = PermissionEngine::default();
        let evaluation = engine
            .evaluate("Write", &serde_json::json!({"file_path":"a.txt"}), true)
            .await;

        assert_eq!(evaluation.action, PermissionAction::Write);
        assert_eq!(evaluation.decision, PermissionDecision::Ask);
        assert_eq!(evaluation.effective_decision, PermissionDecision::Ask);
    }

    #[tokio::test]
    async fn dry_run_mode_converts_ask_to_allow() {
        let engine = PermissionEngine::default();
        engine.set_mode(PermissionMode::DryRun).await;

        let evaluation = engine
            .evaluate("Bash", &serde_json::json!({"command":"echo hi"}), true)
            .await;

        assert_eq!(evaluation.decision, PermissionDecision::Ask);
        assert_eq!(evaluation.effective_decision, PermissionDecision::Allow);
    }

    #[tokio::test]
    async fn approval_queue_roundtrip() {
        let queue = PermissionApprovalQueue::default();
        let req = PermissionApprovalRequest::new(
            "tool-1".to_string(),
            "Write".to_string(),
            PermissionAction::Write,
            PermissionRiskLevel::High,
            "needs approval".to_string(),
            "session-1".to_string(),
            "turn-1".to_string(),
            serde_json::json!({"file_path":"a.txt"}),
        );

        queue.upsert(req.clone()).await;
        assert_eq!(queue.list_pending().await.len(), 1);

        let removed = queue.remove_by_tool_call("tool-1").await;
        assert!(removed.is_some());
        assert_eq!(queue.list_pending().await.len(), 0);
    }
}
