use crate::agentic::permissions::{
    AgentPermissionMode, PermissionAuditRecord, PermissionAuditStore, PermissionDecision,
    PermissionEngine,
};
use crate::agentic::runtime::workspace_binding::WorkspaceIsolation;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Standard,
    Plan,
    Debug,
    Explore,
    Review,
    Custom(String),
}

impl Default for AgentMode {
    fn default() -> Self {
        Self::Standard
    }
}

impl AgentMode {
    pub fn from_str(raw: &str) -> Self {
        match raw.trim().to_lowercase().as_str() {
            "" | "standard" | "agentic" => Self::Standard,
            "plan" | "planning" => Self::Plan,
            "debug" => Self::Debug,
            "explore" => Self::Explore,
            "review" | "code_review" | "code-review" => Self::Review,
            other => Self::Custom(other.to_string()),
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Self::Standard => "standard".to_string(),
            Self::Plan => "plan".to_string(),
            Self::Debug => "debug".to_string(),
            Self::Explore => "explore".to_string(),
            Self::Review => "review".to_string(),
            Self::Custom(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    Default,
    Ask,
    Allow,
    Deny,
    Custom(String),
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::Default
    }
}

impl PermissionMode {
    pub fn from_str(raw: &str) -> Self {
        match raw.trim().to_lowercase().as_str() {
            "" | "default" => Self::Default,
            "ask" => Self::Ask,
            "allow" | "allow_all" | "always_allow" => Self::Allow,
            "deny" | "deny_all" => Self::Deny,
            other => Self::Custom(other.to_string()),
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Self::Default => "default".to_string(),
            Self::Ask => "ask".to_string(),
            Self::Allow => "allow".to_string(),
            Self::Deny => "deny".to_string(),
            Self::Custom(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentMemoryConfig {
    pub enabled: bool,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentHookConfig {
    pub before_agent_start: Vec<String>,
    pub before_model_request: Vec<String>,
    pub before_tool_call: Vec<String>,
    pub after_tool_result: Vec<String>,
    pub before_agent_finish: Vec<String>,
}

impl AgentHookConfig {
    /// Execute hooks for a given hook point
    /// shell: prefix runs the command via shell; other hooks are logged
    pub async fn execute_hooks(
        &self,
        hook_point: &str,
        context: &std::collections::HashMap<String, String>,
        permission_engine: Option<&PermissionEngine>,
        audit_store: Option<&PermissionAuditStore>,
    ) {
        let hooks = match hook_point {
            "before_agent_start" => &self.before_agent_start,
            "before_model_request" => &self.before_model_request,
            "before_tool_call" => &self.before_tool_call,
            "after_tool_result" => &self.after_tool_result,
            "before_agent_finish" => &self.before_agent_finish,
            _ => return,
        };

        for hook in hooks {
            if hook.starts_with("shell:") {
                let cmd = hook.trim_start_matches("shell:");
                // Execute shell command (best-effort, don't fail the main flow)
                match Self::execute_shell_command(
                    hook_point,
                    cmd,
                    context,
                    permission_engine,
                    audit_store,
                )
                .await
                {
                    Ok(output) => {
                        log::debug!("Hook '{}' output: {}", hook_point, output);
                    }
                    Err(e) => {
                        log::warn!("Hook '{}' failed: {}", hook_point, e);
                    }
                }
            } else {
                // Plain action/log hook - substitute context variables
                let resolved = Self::resolve_hook_variables(hook, context);
                log::debug!("Hook '{}' invoked: {}", hook_point, resolved);
            }
        }
    }

    /// Execute a shell command with timeout
    async fn execute_shell_command(
        hook_point: &str,
        cmd: &str,
        context: &std::collections::HashMap<String, String>,
        permission_engine: Option<&PermissionEngine>,
        audit_store: Option<&PermissionAuditStore>,
    ) -> Result<String, String> {
        use std::time::Duration;
        use tokio::time::timeout;

        let resolved_cmd = Self::resolve_hook_variables(cmd, context);

        if let Some(engine) = permission_engine {
            let permission_input = serde_json::json!({
                "command": resolved_cmd.clone(),
                "hook_point": hook_point,
                "_permission_context": {
                    "agent_type": context.get("agent_type").cloned().unwrap_or_default(),
                    "session_id": context.get("session_id").cloned().unwrap_or_default(),
                    "dialog_turn_id": context
                        .get("dialog_turn_id")
                        .or_else(|| context.get("turn_id"))
                        .cloned()
                        .unwrap_or_default(),
                    "tool_call_id": context.get("tool_call_id").cloned().unwrap_or_default(),
                },
            });
            let mode_override = context
                .get("permission_mode")
                .and_then(|mode| AgentPermissionMode::from_string(mode));

            let evaluation = engine
                .evaluate("HookShell", &permission_input, false, mode_override)
                .await;

            if let Some(store) = audit_store {
                let tool_call_id = context
                    .get("tool_call_id")
                    .cloned()
                    .unwrap_or_else(|| format!("hook-{}", uuid::Uuid::new_v4()));
                let session_id = context.get("session_id").cloned().unwrap_or_default();
                let dialog_turn_id = context
                    .get("dialog_turn_id")
                    .or_else(|| context.get("turn_id"))
                    .cloned()
                    .unwrap_or_default();
                let record = PermissionAuditRecord::from_evaluation(
                    tool_call_id,
                    format!("hook:{}", hook_point),
                    session_id,
                    dialog_turn_id,
                    &evaluation,
                    Some(matches!(
                        evaluation.effective_decision,
                        PermissionDecision::Allow
                    )),
                    Some(format!("Hook '{}' shell command evaluated", hook_point)),
                );
                store.append(record).await;
            }

            if matches!(evaluation.effective_decision, PermissionDecision::Deny) {
                return Err(format!("Hook command blocked: {}", evaluation.reason));
            }
            if matches!(evaluation.effective_decision, PermissionDecision::Ask) {
                return Err(format!(
                    "Hook command requires approval and was not executed: {}",
                    evaluation.reason
                ));
            }
        } else {
            let risk =
                crate::agentic::security::shell::ShellRiskAnalyzer::new().analyze(&resolved_cmd);
            if matches!(
                risk.level,
                crate::agentic::security::shell::RiskLevel::Blocked
            ) {
                return Err(format!(
                    "Hook command blocked: {} - {}",
                    risk.category, risk.reason
                ));
            }

            if matches!(
                risk.level,
                crate::agentic::security::shell::RiskLevel::High
                    | crate::agentic::security::shell::RiskLevel::Medium
            ) {
                log::warn!(
                    "Hook command risk detected: level={:?}, category={}, reason={}",
                    risk.level,
                    risk.category,
                    risk.reason
                );
            }
        }

        let mut command = if cfg!(windows) {
            let mut command = tokio::process::Command::new("cmd");
            command.arg("/C").arg(&resolved_cmd);
            command
        } else {
            let mut command = tokio::process::Command::new("sh");
            command.arg("-c").arg(&resolved_cmd);
            command
        };

        // Execute with 10 second timeout
        let result = timeout(Duration::from_secs(10), command.output())
            .await
            .map_err(|_| "Hook timed out".to_string())?
            .map_err(|e| format!("Hook execution failed: {}", e))?;

        if result.status.success() {
            Ok(String::from_utf8_lossy(&result.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).trim().to_string())
        }
    }

    /// Replace ${var} placeholders in hook strings with context values
    fn resolve_hook_variables(
        hook: &str,
        context: &std::collections::HashMap<String, String>,
    ) -> String {
        let mut result = hook.to_string();
        for (key, value) in context {
            let placeholder = format!("${{{}}}", key);
            result = result.replace(&placeholder, value);
        }
        result
    }

    /// Check if any hooks are configured
    pub fn has_hooks(&self) -> bool {
        !self.before_agent_start.is_empty()
            || !self.before_model_request.is_empty()
            || !self.before_tool_call.is_empty()
            || !self.after_tool_result.is_empty()
            || !self.before_agent_finish.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::permissions::{
        PermissionAuditStore, PermissionDecision, PermissionEngine, PermissionRule,
    };
    use std::collections::HashMap;

    #[tokio::test]
    async fn hook_shell_safe_command_executes_through_permission_engine() {
        let engine = PermissionEngine::default();
        let audit_store = PermissionAuditStore::default();
        let context = HashMap::new();

        let output = AgentHookConfig::execute_shell_command(
            "before_agent_start",
            "echo hook-ok",
            &context,
            Some(&engine),
            Some(&audit_store),
        )
        .await
        .expect("safe hook shell command should execute");

        assert!(output.contains("hook-ok"));
        let audits = audit_store.list_recent(10).await;
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].approved, Some(true));
        assert_eq!(
            audits[0].action,
            crate::agentic::permissions::PermissionAction::Shell
        );
    }

    #[tokio::test]
    async fn hook_shell_high_risk_command_requires_approval_and_is_not_executed() {
        let engine = PermissionEngine::default();
        let context = HashMap::new();

        let error = AgentHookConfig::execute_shell_command(
            "before_agent_start",
            "git reset --hard HEAD",
            &context,
            Some(&engine),
            None,
        )
        .await
        .expect_err("high risk hook shell command should not run without approval");

        assert!(error.contains("requires approval"));
    }

    #[tokio::test]
    async fn hook_shell_denied_rule_blocks_and_audits() {
        let engine = PermissionEngine::default();
        let audit_store = PermissionAuditStore::default();
        let mut rule = PermissionRule::new("deny-hook-echo", PermissionDecision::Deny);
        rule.command_contains = Some("echo blocked".to_string());
        rule.reason = "Blocked hook test command".to_string();
        engine.upsert_rule(rule).await;

        let error = AgentHookConfig::execute_shell_command(
            "before_agent_start",
            "echo blocked",
            &HashMap::new(),
            Some(&engine),
            Some(&audit_store),
        )
        .await
        .expect_err("denied hook shell command should not run");

        assert!(error.contains("Blocked hook test command"));
        let audits = audit_store.list_recent(10).await;
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].approved, Some(false));
    }

    #[tokio::test]
    async fn hook_shell_agent_scoped_rule_uses_hook_context() {
        let engine = PermissionEngine::default();
        let mut rule = PermissionRule::new("deny-reviewer-hook", PermissionDecision::Deny);
        rule.agent_name = Some("reviewer".to_string());
        rule.command_contains = Some("echo scoped".to_string());
        rule.reason = "Reviewer hook command is blocked".to_string();
        engine.upsert_rule(rule).await;

        let mut context = HashMap::new();
        context.insert("agent_type".to_string(), "reviewer".to_string());
        context.insert("session_id".to_string(), "session-1".to_string());
        context.insert("dialog_turn_id".to_string(), "turn-1".to_string());

        let error = AgentHookConfig::execute_shell_command(
            "before_agent_start",
            "echo scoped",
            &context,
            Some(&engine),
            None,
        )
        .await
        .expect_err("agent-scoped hook shell rule should block matching hook context");

        assert!(error.contains("Reviewer hook command is blocked"));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub mode: AgentMode,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub max_turns: Option<u32>,
    pub permission_mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub skills: Vec<String>,
    pub memory: AgentMemoryConfig,
    pub hooks: AgentHookConfig,
    pub isolation: WorkspaceIsolation,
    pub cwd: Option<PathBuf>,
}
