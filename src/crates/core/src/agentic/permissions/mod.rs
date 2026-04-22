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

impl PermissionMode {
    /// Parse PermissionMode from string (case-insensitive)
    pub fn from_string(s: &str) -> Result<Self, ()> {
        match s.to_lowercase().as_str() {
            "enforce" => Ok(Self::Enforce),
            "dry_run" | "dryrun" | "dry" => Ok(Self::DryRun),
            "off" | "disabled" => Ok(Self::Off),
            _ => Err(()),
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Enforce => "enforce",
            Self::DryRun => "dry_run",
            Self::Off => "off",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPermissionMode {
    Default,
    Ask,
    Allow,
    Deny,
}

impl Default for AgentPermissionMode {
    fn default() -> Self {
        Self::Default
    }
}

impl AgentPermissionMode {
    /// Parse the per-agent permission mode used by agent definitions.
    pub fn from_string(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "" | "default" => Some(Self::Default),
            "ask" | "ask_before_run" => Some(Self::Ask),
            "allow" | "allow_all" | "always_allow" => Some(Self::Allow),
            "deny" | "deny_all" | "always_deny" => Some(Self::Deny),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Ask => "ask",
            Self::Allow => "allow",
            Self::Deny => "deny",
        }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRule {
    #[serde(alias = "rule_id")]
    pub rule_id: String,
    #[serde(alias = "agent_name")]
    pub agent_name: Option<String>,
    #[serde(alias = "tool_name")]
    pub tool_name: Option<String>,
    #[serde(alias = "path_prefix")]
    pub path_prefix: Option<String>,
    #[serde(alias = "command_contains")]
    pub command_contains: Option<String>,
    #[serde(alias = "mcp_server")]
    pub mcp_server: Option<String>,
    pub decision: PermissionDecision,
    #[serde(alias = "risk_level")]
    pub risk_level: PermissionRiskLevel,
    pub reason: String,
}

impl PermissionRule {
    pub fn new(rule_id: impl Into<String>, decision: PermissionDecision) -> Self {
        Self {
            rule_id: rule_id.into(),
            agent_name: None,
            tool_name: None,
            path_prefix: None,
            command_contains: None,
            mcp_server: None,
            decision,
            risk_level: PermissionRiskLevel::Medium,
            reason: "Matched permission rule".to_string(),
        }
    }

    fn matches(&self, tool_name: &str, input: &Value) -> bool {
        if let Some(agent_name) = &self.agent_name {
            let input_agent = input
                .get("_permission_context")
                .and_then(|context| context.get("agent_type"))
                .and_then(|value| value.as_str());
            if !input_agent.is_some_and(|input_agent| input_agent.eq_ignore_ascii_case(agent_name))
            {
                return false;
            }
        }

        if let Some(rule_tool_name) = &self.tool_name {
            if !tool_name.eq_ignore_ascii_case(rule_tool_name) {
                return false;
            }
        }

        if let Some(rule_mcp_server) = &self.mcp_server {
            let server_name = mcp_server_name_from_tool(tool_name);
            if !server_name.is_some_and(|server| server.eq_ignore_ascii_case(rule_mcp_server)) {
                return false;
            }
        }

        if let Some(path_prefix) = &self.path_prefix {
            let path_matches = ["file_path", "path", "relative_path", "working_directory"]
                .iter()
                .filter_map(|key| input.get(*key).and_then(|value| value.as_str()))
                .any(|path| path.starts_with(path_prefix));
            if !path_matches {
                return false;
            }
        }

        if let Some(command_contains) = &self.command_contains {
            let command_contains = command_contains.to_ascii_lowercase();
            let command = input
                .get("command")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !command.contains(&command_contains) {
                return false;
            }
        }

        true
    }
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

pub struct PermissionEngine {
    mode: RwLock<PermissionMode>,
    denied_tools: RwLock<HashSet<String>>,
    rules: RwLock<Vec<PermissionRule>>,
    // Optional shell risk analyzer for integrated shell security
    shell_analyzer: RwLock<Option<crate::agentic::security::shell::ShellRiskAnalyzer>>,
}

impl Default for PermissionEngine {
    fn default() -> Self {
        Self {
            mode: RwLock::new(PermissionMode::default()),
            denied_tools: RwLock::new(HashSet::new()),
            rules: RwLock::new(Vec::new()),
            shell_analyzer: RwLock::new(Some(
                crate::agentic::security::shell::ShellRiskAnalyzer::new(),
            )),
        }
    }
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

    pub async fn add_rule(&self, rule: PermissionRule) {
        self.upsert_rule(rule).await;
    }

    pub async fn upsert_rule(&self, rule: PermissionRule) {
        let mut rules = self.rules.write().await;
        if let Some(existing) = rules
            .iter_mut()
            .find(|existing| existing.rule_id == rule.rule_id)
        {
            *existing = rule;
        } else {
            rules.push(rule);
        }
    }

    pub async fn remove_rule(&self, rule_id: &str) -> bool {
        let mut rules = self.rules.write().await;
        let before = rules.len();
        rules.retain(|rule| rule.rule_id != rule_id);
        rules.len() != before
    }

    pub async fn replace_rules(&self, rules: Vec<PermissionRule>) {
        *self.rules.write().await = rules;
    }

    pub async fn clear_rules(&self) {
        self.rules.write().await.clear();
    }

    pub async fn list_rules(&self) -> Vec<PermissionRule> {
        self.rules.read().await.clone()
    }

    /// Set the shell risk analyzer for command risk detection
    pub async fn set_shell_analyzer(
        &self,
        analyzer: crate::agentic::security::shell::ShellRiskAnalyzer,
    ) {
        *self.shell_analyzer.write().await = Some(analyzer);
    }

    /// Get reference to the shell analyzer (for testing/debugging)
    pub async fn shell_analyzer(
        &self,
    ) -> Option<crate::agentic::security::shell::ShellRiskAnalyzer> {
        self.shell_analyzer.read().await.clone()
    }

    pub async fn evaluate(
        &self,
        tool_name: &str,
        input: &Value,
        needs_permissions: bool,
        mode_override: Option<AgentPermissionMode>,
    ) -> PermissionEvaluation {
        let action = infer_permission_action(tool_name, input);
        let normalized_name = tool_name.trim().to_ascii_lowercase();

        // Check if tool is explicitly denied
        let denied = self.denied_tools.read().await;
        let mut base = if denied.contains(&normalized_name) {
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

        if let Some(rule) = self
            .rules
            .read()
            .await
            .iter()
            .find(|rule| rule.matches(tool_name, input))
            .cloned()
        {
            base = PermissionEvaluation {
                action,
                risk_level: rule.risk_level,
                decision: rule.decision,
                effective_decision: rule.decision,
                reason: format!("{} (rule={})", rule.reason, rule.rule_id),
            };

            if matches!(rule.decision, PermissionDecision::Deny) {
                return base;
            }
        }

        // Check shell command risk if this is a shell tool (only if analyzer is configured)
        if (normalized_name == "bash"
            || normalized_name == "shell"
            || normalized_name == "hookshell"
            || normalized_name == "hook_shell")
            && !normalized_name.is_empty()
        {
            if let Some(ref analyzer) = *self.shell_analyzer.read().await {
                if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
                    let risk = analyzer.analyze(command);
                    // Override decision based on shell risk level
                    if risk.level == crate::agentic::security::shell::RiskLevel::Blocked {
                        return PermissionEvaluation {
                            action,
                            risk_level: PermissionRiskLevel::High,
                            decision: PermissionDecision::Deny,
                            effective_decision: PermissionDecision::Deny,
                            reason: format!(
                                "Shell command blocked: {} - {}",
                                risk.category, risk.reason
                            ),
                        };
                    } else if risk.level == crate::agentic::security::shell::RiskLevel::High {
                        // High risk shell commands require approval even if tool normally doesn't
                        if !matches!(base.decision, PermissionDecision::Deny) {
                            base.decision = PermissionDecision::Ask;
                            base.effective_decision = PermissionDecision::Ask;
                            base.risk_level = PermissionRiskLevel::High;
                            base.reason = format!(
                                "{}; Shell command high risk: {} - {}",
                                base.reason, risk.category, risk.reason
                            );
                        }
                    } else if risk.level == crate::agentic::security::shell::RiskLevel::Medium {
                        // Medium risk - elevate to Ask if currently Allow
                        if base.decision == PermissionDecision::Allow {
                            base.decision = PermissionDecision::Ask;
                            base.effective_decision = PermissionDecision::Ask;
                            base.risk_level = PermissionRiskLevel::Medium;
                            base.reason = format!(
                                "{}; Shell command medium risk: {} - {}",
                                base.reason, risk.category, risk.reason
                            );
                        }
                    }
                }
            }
        }

        let base_effective_decision = base.effective_decision;

        // Apply global engine mode first. Agent modes below are scoped to this
        // single evaluation and never mutate this shared engine state.
        let global_mode = self.mode().await;
        let global_evaluation = match global_mode {
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
        };

        match mode_override.unwrap_or_default() {
            AgentPermissionMode::Default => global_evaluation,
            AgentPermissionMode::Ask => apply_agent_ask(global_evaluation, base_effective_decision),
            AgentPermissionMode::Allow => {
                apply_agent_allow(global_evaluation, base_effective_decision)
            }
            AgentPermissionMode::Deny => apply_agent_deny(global_evaluation),
        }
    }
}

fn apply_agent_ask(
    evaluation: PermissionEvaluation,
    base_effective_decision: PermissionDecision,
) -> PermissionEvaluation {
    if matches!(base_effective_decision, PermissionDecision::Deny)
        || matches!(evaluation.action, PermissionAction::Read)
    {
        return evaluation;
    }

    PermissionEvaluation {
        effective_decision: PermissionDecision::Ask,
        reason: format!("{} (agent permission mode=ask)", evaluation.reason),
        ..evaluation
    }
}

fn apply_agent_allow(
    evaluation: PermissionEvaluation,
    base_effective_decision: PermissionDecision,
) -> PermissionEvaluation {
    if matches!(base_effective_decision, PermissionDecision::Deny) {
        return evaluation;
    }

    PermissionEvaluation {
        effective_decision: PermissionDecision::Allow,
        reason: format!("{} (agent permission mode=allow)", evaluation.reason),
        ..evaluation
    }
}

fn apply_agent_deny(evaluation: PermissionEvaluation) -> PermissionEvaluation {
    if matches!(evaluation.action, PermissionAction::Read) {
        return evaluation;
    }

    PermissionEvaluation {
        decision: PermissionDecision::Deny,
        effective_decision: PermissionDecision::Deny,
        reason: format!("{} (agent permission mode=deny)", evaluation.reason),
        ..evaluation
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
        PermissionAction::Shell => {
            if needs_permissions {
                PermissionEvaluation {
                    action,
                    risk_level: PermissionRiskLevel::High,
                    decision: PermissionDecision::Ask,
                    effective_decision: PermissionDecision::Ask,
                    reason: format!(
                        "Tool '{}' executes shell commands and requires approval",
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
                        "Tool '{}' executes shell commands but does not require approval by default",
                        tool_name
                    ),
                }
            }
        }
        PermissionAction::Mcp => PermissionEvaluation {
            action,
            risk_level: PermissionRiskLevel::Medium,
            decision: PermissionDecision::Ask,
            effective_decision: PermissionDecision::Ask,
            reason: format!(
                "Tool '{}' accesses MCP resources and requires approval",
                tool_name
            ),
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

    let shell_tools = [
        "bash",
        "terminal_control",
        "run_in_terminal",
        "shell",
        "hookshell",
        "hook_shell",
    ];
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

fn mcp_server_name_from_tool(tool_name: &str) -> Option<&str> {
    tool_name
        .strip_prefix("mcp__")
        .and_then(|rest| rest.split_once("__").map(|(server, _)| server))
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
            .evaluate(
                "Write",
                &serde_json::json!({"file_path":"a.txt"}),
                true,
                None,
            )
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
            .evaluate(
                "Bash",
                &serde_json::json!({"command":"echo hi"}),
                true,
                None,
            )
            .await;

        assert_eq!(evaluation.decision, PermissionDecision::Ask);
        assert_eq!(evaluation.effective_decision, PermissionDecision::Allow);
    }

    #[tokio::test]
    async fn parses_agent_permission_modes() {
        assert_eq!(
            AgentPermissionMode::from_string("ask"),
            Some(AgentPermissionMode::Ask)
        );
        assert_eq!(
            AgentPermissionMode::from_string("allow"),
            Some(AgentPermissionMode::Allow)
        );
        assert_eq!(
            AgentPermissionMode::from_string("deny"),
            Some(AgentPermissionMode::Deny)
        );
        assert_eq!(
            AgentPermissionMode::from_string("default"),
            Some(AgentPermissionMode::Default)
        );
    }

    #[tokio::test]
    async fn agent_allow_converts_ask_to_allow_without_mutating_global_mode() {
        let engine = PermissionEngine::default();

        let evaluation = engine
            .evaluate(
                "Bash",
                &serde_json::json!({"command":"echo hi"}),
                true,
                Some(AgentPermissionMode::Allow),
            )
            .await;

        assert_eq!(evaluation.decision, PermissionDecision::Ask);
        assert_eq!(evaluation.effective_decision, PermissionDecision::Allow);
        assert_eq!(engine.mode().await, PermissionMode::Enforce);
    }

    #[tokio::test]
    async fn agent_deny_blocks_non_read_tools() {
        let engine = PermissionEngine::default();

        let evaluation = engine
            .evaluate(
                "Bash",
                &serde_json::json!({"command":"echo hi"}),
                true,
                Some(AgentPermissionMode::Deny),
            )
            .await;

        assert_eq!(evaluation.effective_decision, PermissionDecision::Deny);
    }

    #[tokio::test]
    async fn deny_rule_blocks_matching_command() {
        let engine = PermissionEngine::default();
        let mut rule = PermissionRule::new("deny-git-reset", PermissionDecision::Deny);
        rule.tool_name = Some("Bash".to_string());
        rule.command_contains = Some("git reset --hard".to_string());
        rule.risk_level = PermissionRiskLevel::High;
        rule.reason = "Destructive git reset is denied".to_string();
        engine.add_rule(rule).await;

        let evaluation = engine
            .evaluate(
                "Bash",
                &serde_json::json!({"command":"git reset --hard HEAD"}),
                true,
                Some(AgentPermissionMode::Allow),
            )
            .await;

        assert_eq!(evaluation.effective_decision, PermissionDecision::Deny);
        assert!(evaluation.reason.contains("deny-git-reset"));
    }

    #[tokio::test]
    async fn agent_scoped_rule_only_matches_same_agent() {
        let engine = PermissionEngine::default();
        let mut rule = PermissionRule::new("ask-review-agent-write", PermissionDecision::Ask);
        rule.agent_name = Some("reviewer".to_string());
        rule.tool_name = Some("Write".to_string());
        rule.reason = "Reviewer writes require approval".to_string();
        engine.add_rule(rule).await;

        let matching = engine
            .evaluate(
                "Write",
                &serde_json::json!({
                    "file_path":"notes.txt",
                    "_permission_context": {"agent_type":"reviewer"}
                }),
                true,
                None,
            )
            .await;
        assert_eq!(matching.effective_decision, PermissionDecision::Ask);
        assert!(matching.reason.contains("ask-review-agent-write"));

        let non_matching = engine
            .evaluate(
                "Write",
                &serde_json::json!({
                    "file_path":"notes.txt",
                    "_permission_context": {"agent_type":"builder"}
                }),
                true,
                Some(AgentPermissionMode::Allow),
            )
            .await;
        assert_eq!(non_matching.effective_decision, PermissionDecision::Allow);
    }

    #[tokio::test]
    async fn mcp_server_rule_matches_namespaced_tool() {
        let engine = PermissionEngine::default();
        let mut rule = PermissionRule::new("deny-private-mcp", PermissionDecision::Deny);
        rule.mcp_server = Some("private".to_string());
        rule.reason = "Private MCP server is denied".to_string();
        engine.add_rule(rule).await;

        let evaluation = engine
            .evaluate(
                "mcp__private__read_secret",
                &serde_json::json!({}),
                false,
                Some(AgentPermissionMode::Allow),
            )
            .await;

        assert_eq!(evaluation.action, PermissionAction::Mcp);
        assert_eq!(evaluation.effective_decision, PermissionDecision::Deny);
    }

    #[test]
    fn permission_rule_accepts_frontend_and_legacy_field_names() {
        let frontend_json = serde_json::json!({
            "ruleId": "frontend-rule",
            "agentName": "agentic",
            "toolName": "Bash",
            "pathPrefix": "F:/workspace",
            "commandContains": "npm install",
            "mcpServer": "github",
            "decision": "ask",
            "riskLevel": "medium",
            "reason": "Frontend rule"
        });

        let frontend_rule: PermissionRule =
            serde_json::from_value(frontend_json).expect("camelCase rule should deserialize");
        assert_eq!(frontend_rule.rule_id, "frontend-rule");
        assert_eq!(frontend_rule.agent_name.as_deref(), Some("agentic"));
        assert_eq!(frontend_rule.tool_name.as_deref(), Some("Bash"));
        assert_eq!(frontend_rule.path_prefix.as_deref(), Some("F:/workspace"));
        assert_eq!(
            frontend_rule.command_contains.as_deref(),
            Some("npm install")
        );
        assert_eq!(frontend_rule.mcp_server.as_deref(), Some("github"));

        let legacy_json = serde_json::json!({
            "rule_id": "legacy-rule",
            "agent_name": "reviewer",
            "tool_name": "Write",
            "path_prefix": "/repo/src",
            "command_contains": "cargo test",
            "mcp_server": "private",
            "decision": "deny",
            "risk_level": "high",
            "reason": "Legacy rule"
        });

        let legacy_rule: PermissionRule =
            serde_json::from_value(legacy_json).expect("snake_case rule should deserialize");
        assert_eq!(legacy_rule.rule_id, "legacy-rule");
        assert_eq!(legacy_rule.agent_name.as_deref(), Some("reviewer"));
        assert_eq!(legacy_rule.tool_name.as_deref(), Some("Write"));
        assert_eq!(legacy_rule.path_prefix.as_deref(), Some("/repo/src"));
        assert_eq!(legacy_rule.command_contains.as_deref(), Some("cargo test"));
        assert_eq!(legacy_rule.mcp_server.as_deref(), Some("private"));
        assert_eq!(legacy_rule.decision, PermissionDecision::Deny);
        assert_eq!(legacy_rule.risk_level, PermissionRiskLevel::High);

        let serialized = serde_json::to_value(&legacy_rule).expect("rule should serialize");
        assert!(serialized.get("ruleId").is_some());
        assert!(serialized.get("rule_id").is_none());
        assert_eq!(serialized["commandContains"], "cargo test");
    }

    #[tokio::test]
    async fn permission_rules_can_be_upserted_replaced_and_removed() {
        let engine = PermissionEngine::default();
        let mut initial = PermissionRule::new("rule-1", PermissionDecision::Ask);
        initial.tool_name = Some("Write".to_string());
        engine.upsert_rule(initial).await;

        let mut updated = PermissionRule::new("rule-1", PermissionDecision::Deny);
        updated.tool_name = Some("Write".to_string());
        updated.reason = "Writes denied by updated rule".to_string();
        engine.upsert_rule(updated).await;

        let rules = engine.list_rules().await;
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].decision, PermissionDecision::Deny);

        let mut replacement = PermissionRule::new("rule-2", PermissionDecision::Allow);
        replacement.tool_name = Some("Read".to_string());
        engine.replace_rules(vec![replacement]).await;
        assert_eq!(engine.list_rules().await[0].rule_id, "rule-2");

        assert!(engine.remove_rule("rule-2").await);
        assert!(engine.list_rules().await.is_empty());
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
