use crate::agentic::agents::{get_agent_registry, AgentInfo};
use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::runtime::{
    AgentTaskConfig, AgentTaskId, AgentTaskKind, AgentTaskStatus, CleanupPolicy, ForkContextMode,
    PatchStatus, WorkspaceBinding as RuntimeWorkspaceBinding, WorkspaceIsolation,
};
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic::tools::InputValidator;
use crate::service::git::GitService;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

pub struct TaskTool;

impl Default for TaskTool {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskTool {
    pub fn new() -> Self {
        Self
    }

    fn format_agent_descriptions(&self, agents: &[AgentInfo]) -> String {
        if agents.is_empty() {
            return String::new();
        }
        let mut out = String::from("<available_agents>\n");
        for agent in agents {
            out.push_str(&format!(
                "<agent type=\"{}\">\n<description>\n{}\n</description>\n<tools>{}</tools>\n</agent>\n",
                agent.id,
                agent.description,
                agent.default_tools.join(", ")
            ));
        }
        out.push_str("</available_agents>");
        out
    }

    fn render_description(&self, agent_descriptions: String) -> String {
        let agent_descriptions = if agent_descriptions.is_empty() {
            "<agents>No agents available</agents>".to_string()
        } else {
            agent_descriptions
        };

        format!(
            r#"Launch or inspect a native OpenHarness agent task for complex, multi-step work.

The Task tool launches specialized agents through OpenHarness's native agent runtime. These are real agent tasks with task IDs, status, events, transcripts, cancellation, and parent/child tracking. They are not subprocess-based sidecars.

Available agents and the tools they have access to:
{}

When using the Task tool to start work, use action="spawn" and specify subagent_type to select which agent type to use.
When a background task has already been started, use action="status", "events", "transcript", "wait", or "cancel" with task_id.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly
- For subagent_type=Explore: do not use it for simple lookups above; reserve it for broad or multi-area exploration where many tool rounds would be needed
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Provide clear, detailed prompt so the agent can work autonomously and return exactly the information you need.
- If 'workspace_path' is omitted, the task inherits the current workspace by default.
- The 'workspace_path' parameter must still be provided explicitly for the Explore and FileFinder agent.
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool calls
- When the agent is done, it will return a single message back to you.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Task tool calls. For example, if you need to launch both a code-reviewer agent and a test-runner agent in parallel, send a single message with both tool calls.

Example usage:

<example_agent_descriptions>
"code-reviewer": use this agent after you are done writing a signficant piece of code
"greeting-responder": use this agent when to respond to user greetings with a friendly joke
</example_agent_description>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {{
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {{
    if (n % i === 0) return false
  }}
  return true
}}
</code>
<commentary>
Since a signficant piece of code was written and the task was completed, now use the code-reviewer agent to review the code
</commentary>
assistant: Now let me use the code-reviewer agent to review the code
assistant: Uses the Task tool to launch the code-reviewer agent 
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Task tool to launch the greeting-responder agent"
</example>"#,
            agent_descriptions
        )
    }

    async fn build_description(&self, workspace_root: Option<&Path>) -> String {
        let agents = self.get_enabled_agents(workspace_root).await;
        let agent_descriptions = self.format_agent_descriptions(&agents);
        self.render_description(agent_descriptions)
    }

    async fn get_enabled_agents(&self, workspace_root: Option<&Path>) -> Vec<AgentInfo> {
        let registry = get_agent_registry();
        if let Some(workspace_root) = workspace_root {
            registry.load_custom_subagents(workspace_root).await;
        }
        registry
            .get_subagents_info(workspace_root)
            .await
            .into_iter()
            .filter(|agent| agent.enabled) // Only return enabled subagents
            .collect()
    }

    async fn get_agents_types(&self, workspace_root: Option<&Path>) -> Vec<String> {
        self.get_enabled_agents(workspace_root)
            .await
            .into_iter()
            .map(|agent| agent.id)
            .collect()
    }

    fn parse_string_array(input: &Value, field: &str) -> OpenHarnessResult<Vec<String>> {
        let Some(value) = input.get(field) else {
            return Ok(Vec::new());
        };

        let list = value
            .as_array()
            .ok_or_else(|| {
                OpenHarnessError::tool(format!("Field '{}' must be an array of strings", field))
            })?
            .iter()
            .map(|item| {
                item.as_str().map(|s| s.trim().to_string()).ok_or_else(|| {
                    OpenHarnessError::tool(format!("Field '{}' must contain only strings", field))
                })
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();

        Ok(list)
    }

    fn parse_workspace_isolation(raw: Option<&str>) -> OpenHarnessResult<WorkspaceIsolation> {
        let isolation = match raw.map(|value| value.trim().to_lowercase()) {
            None => WorkspaceIsolation::None,
            Some(value) if value.is_empty() || value == "none" => WorkspaceIsolation::None,
            Some(value) if value == "worktree" => WorkspaceIsolation::GitWorktree,
            Some(value) if value == "scratch" => WorkspaceIsolation::Scratch,
            Some(value) => {
                return Err(OpenHarnessError::tool(format!(
                    "Unsupported isolation '{}'. Allowed values: none, worktree, scratch",
                    value
                )));
            }
        };

        Ok(isolation)
    }

    fn resolve_working_dir(root: &Path, cwd: Option<&str>) -> OpenHarnessResult<PathBuf> {
        let Some(cwd) = cwd else {
            return Ok(root.to_path_buf());
        };

        let cwd = cwd.trim();
        if cwd.is_empty() {
            return Ok(root.to_path_buf());
        }

        let candidate = PathBuf::from(cwd);
        if candidate.is_absolute() {
            return Ok(candidate);
        }

        Ok(root.join(candidate))
    }

    fn relative_cwd(cwd: Option<&str>) -> OpenHarnessResult<Option<PathBuf>> {
        let Some(cwd) = cwd else {
            return Ok(None);
        };

        let cwd = cwd.trim();
        if cwd.is_empty() {
            return Ok(None);
        }

        let path = PathBuf::from(cwd);
        if path.is_absolute() {
            return Err(OpenHarnessError::tool(
                "cwd must be relative when workspace isolation is enabled".to_string(),
            ));
        }

        Ok(Some(path))
    }

    fn safe_task_branch_name(subagent_type: &str) -> String {
        let mut safe_agent = subagent_type
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                    ch.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>();
        safe_agent = safe_agent.trim_matches('-').to_string();
        if safe_agent.is_empty() {
            safe_agent = "agent".to_string();
        }

        format!(
            "openharness-agent-{}-{}",
            safe_agent,
            uuid::Uuid::new_v4().simple()
        )
    }

    async fn prepare_workspace_binding(
        isolation: WorkspaceIsolation,
        workspace_root: PathBuf,
        requested_cwd: Option<&str>,
        subagent_type: &str,
        is_remote: bool,
    ) -> OpenHarnessResult<RuntimeWorkspaceBinding> {
        if is_remote && !matches!(isolation, WorkspaceIsolation::None) {
            return Err(OpenHarnessError::tool(
                "workspace isolation is not available for remote workspaces yet".to_string(),
            ));
        }

        match isolation {
            WorkspaceIsolation::None => {
                let working_dir = Self::resolve_working_dir(&workspace_root, requested_cwd)?;
                if !is_remote {
                    if !working_dir.exists() {
                        return Err(OpenHarnessError::tool(format!(
                            "cwd '{}' does not exist",
                            working_dir.display()
                        )));
                    }
                    if !working_dir.is_dir() {
                        return Err(OpenHarnessError::tool(format!(
                            "cwd '{}' is not a directory",
                            working_dir.display()
                        )));
                    }
                }

                Ok(RuntimeWorkspaceBinding {
                    isolation,
                    root: workspace_root,
                    working_dir,
                    branch_name: None,
                    worktree_path: None,
                    cleanup_policy: CleanupPolicy::Keep,
                })
            }
            WorkspaceIsolation::GitWorktree => {
                if !GitService::is_repository(&workspace_root)
                    .await
                    .map_err(|error| {
                        OpenHarnessError::tool(format!(
                            "Failed to inspect git repository '{}': {}",
                            workspace_root.display(),
                            error
                        ))
                    })?
                {
                    return Err(OpenHarnessError::tool(format!(
                        "workspace_path '{}' is not a git repository; isolation=worktree requires a real git repository",
                        workspace_root.display()
                    )));
                }

                let branch_name = Self::safe_task_branch_name(subagent_type);
                let worktree_path = std::env::temp_dir()
                    .join("openharness-agent-worktrees")
                    .join(&branch_name);
                tokio::fs::create_dir_all(
                    worktree_path.parent().ok_or_else(|| {
                        OpenHarnessError::tool("Invalid worktree path".to_string())
                    })?,
                )
                .await
                .map_err(|error| {
                    OpenHarnessError::tool(format!(
                        "Failed to create agent worktree directory '{}': {}",
                        worktree_path.display(),
                        error
                    ))
                })?;

                let output = Command::new("git")
                    .arg("worktree")
                    .arg("add")
                    .arg("-b")
                    .arg(&branch_name)
                    .arg(&worktree_path)
                    .current_dir(&workspace_root)
                    .output()
                    .await
                    .map_err(|error| {
                        OpenHarnessError::tool(format!(
                            "Failed to run git worktree add for agent task: {}",
                            error
                        ))
                    })?;

                if !output.status.success() {
                    let _ = tokio::fs::remove_dir_all(&worktree_path).await;
                    return Err(OpenHarnessError::tool(format!(
                        "Failed to create git worktree for agent task: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    )));
                }

                let relative_cwd = Self::relative_cwd(requested_cwd)?;
                let working_dir = relative_cwd
                    .as_ref()
                    .map(|relative| worktree_path.join(relative))
                    .unwrap_or_else(|| worktree_path.clone());

                if !working_dir.exists() {
                    return Err(OpenHarnessError::tool(format!(
                        "isolated cwd '{}' does not exist in worktree '{}'",
                        working_dir.display(),
                        worktree_path.display()
                    )));
                }
                if !working_dir.is_dir() {
                    return Err(OpenHarnessError::tool(format!(
                        "isolated cwd '{}' is not a directory",
                        working_dir.display()
                    )));
                }

                Ok(RuntimeWorkspaceBinding {
                    isolation,
                    root: workspace_root,
                    working_dir,
                    branch_name: Some(branch_name),
                    worktree_path: Some(worktree_path),
                    cleanup_policy: CleanupPolicy::Keep,
                })
            }
            WorkspaceIsolation::Scratch => {
                let scratch_root = std::env::temp_dir()
                    .join("openharness-agent-scratch")
                    .join(format!("scratch-{}", uuid::Uuid::new_v4().simple()));
                tokio::fs::create_dir_all(&scratch_root)
                    .await
                    .map_err(|error| {
                        OpenHarnessError::tool(format!(
                            "Failed to create scratch workspace '{}': {}",
                            scratch_root.display(),
                            error
                        ))
                    })?;

                let relative_cwd = Self::relative_cwd(requested_cwd)?;
                let working_dir = relative_cwd
                    .as_ref()
                    .map(|relative| scratch_root.join(relative))
                    .unwrap_or_else(|| scratch_root.clone());
                tokio::fs::create_dir_all(&working_dir)
                    .await
                    .map_err(|error| {
                        OpenHarnessError::tool(format!(
                            "Failed to create scratch cwd '{}': {}",
                            working_dir.display(),
                            error
                        ))
                    })?;

                Ok(RuntimeWorkspaceBinding {
                    isolation,
                    root: scratch_root.clone(),
                    working_dir,
                    branch_name: None,
                    worktree_path: Some(scratch_root),
                    cleanup_policy: CleanupPolicy::Keep,
                })
            }
        }
    }

    fn validation_error(message: impl Into<String>) -> ValidationResult {
        ValidationResult {
            result: false,
            message: Some(message.into()),
            error_code: None,
            meta: None,
        }
    }

    fn action(input: &Value) -> OpenHarnessResult<String> {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("spawn")
            .trim()
            .to_ascii_lowercase();

        match action.as_str() {
            ""
            | "spawn"
            | "status"
            | "wait"
            | "cancel"
            | "events"
            | "transcript"
            | "list"
            | "patches"
            | "patch_summary"
            | "patch_merge"
            | "patch_status" => {
                Ok(if action.is_empty() {
                    "spawn".to_string()
                } else {
                    action
                })
            }
            _ => Err(OpenHarnessError::tool(format!(
                "Unsupported Task action '{}'. Allowed actions: spawn, status, wait, cancel, events, transcript, list, patches, patch_summary, patch_merge, patch_status",
                action
            ))),
        }
    }

    fn task_id(input: &Value) -> OpenHarnessResult<String> {
        input
            .get("task_id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                OpenHarnessError::tool("task_id is required for this Task action".to_string())
            })
    }

    fn patch_id(input: &Value) -> OpenHarnessResult<String> {
        input
            .get("patch_id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                OpenHarnessError::tool("patch_id is required for patch_status action".to_string())
            })
    }

    fn parse_patch_status(input: &Value) -> OpenHarnessResult<PatchStatus> {
        let raw = input
            .get("patch_status")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                OpenHarnessError::tool(
                    "patch_status is required for patch_status action".to_string(),
                )
            })?
            .to_ascii_lowercase();

        match raw.as_str() {
            "pending" => Ok(PatchStatus::Pending),
            "accepted" => Ok(PatchStatus::Accepted),
            "rejected" => Ok(PatchStatus::Rejected),
            "applied" => Ok(PatchStatus::Applied),
            "conflicted" => Ok(PatchStatus::Conflicted),
            _ => Err(OpenHarnessError::tool(format!(
                "Unsupported patch_status '{}'. Allowed values: pending, accepted, rejected, applied, conflicted",
                raw
            ))),
        }
    }
}

#[async_trait]
impl Tool for TaskTool {
    fn name(&self) -> &str {
        "Task"
    }

    async fn description(&self) -> OpenHarnessResult<String> {
        Ok(self.build_description(None).await)
    }

    async fn description_with_context(
        &self,
        context: Option<&ToolUseContext>,
    ) -> OpenHarnessResult<String> {
        Ok(self
            .build_description(context.and_then(|ctx| ctx.workspace_root()))
            .await)
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Task operation. Use 'spawn' to launch an agent; use status/wait/cancel/events/transcript/list to inspect or control real agent tasks; use patches/patch_summary/patch_merge/patch_status for patch review.",
                    "enum": ["spawn", "status", "wait", "cancel", "events", "transcript", "list", "patches", "patch_summary", "patch_merge", "patch_status"],
                    "default": "spawn"
                },
                "task_id": {
                    "type": "string",
                    "description": "Agent task id for status, wait, cancel, events, transcript, patches, patch_summary, patch_merge, or patch_status actions"
                },
                "patch_id": {
                    "type": "string",
                    "description": "Patch id for patch_status action"
                },
                "patch_status": {
                    "type": "string",
                    "description": "Target patch status for patch_status action. On git workspaces, accepted/applied stage changes with git add, and rejected performs rollback.",
                    "enum": ["pending", "accepted", "rejected", "applied", "conflicted"]
                },
                "description": {
                    "type": "string",
                    "description": "A short (3-5 word) description of the task"
                },
                "prompt": {
                    "type": "string",
                    "description": "The task for the agent to perform"
                },
                "subagent_type": {
                    "type": "string",
                    "description": "The type of specialized agent to use for this task"
                },
                "model": {
                    "type": "string",
                    "description": "Optional model ID override for the subagent task"
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "When true, return task id immediately and keep task running asynchronously"
                },
                "wait_timeout_ms": {
                    "type": "number",
                    "description": "Optional timeout for action='wait'. If omitted, wait until the task reaches a terminal state."
                },
                "reason": {
                    "type": "string",
                    "description": "Optional cancellation reason for action='cancel'"
                },
                "name": {
                    "type": "string",
                    "description": "Optional task display name"
                },
                "team_name": {
                    "type": "string",
                    "description": "Reserved for team/swarm runtime, currently not used"
                },
                "mode": {
                    "type": "string",
                    "description": "Optional mode override from agent definition"
                },
                "isolation": {
                    "type": "string",
                    "description": "Workspace isolation mode. 'worktree' creates a real git worktree; 'scratch' creates a real empty scratch directory; 'none' shares the current workspace.",
                    "enum": ["none", "worktree", "scratch"]
                },
                "cwd": {
                    "type": "string",
                    "description": "Optional working directory for the subagent task"
                },
                "allowed_tools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional tool whitelist, intersected with subagent defaults"
                },
                "fork_context": {
                    "type": "boolean",
                    "description": "Whether to inherit parent context metadata"
                },
                "max_turns": {
                    "type": "number",
                    "description": "Optional max rounds limit for this subagent task"
                },
                "workspace_path": {
                    "type": "string",
                    "description": "The absolute path of the workspace for this task. If omitted, inherits the current workspace. Explore/FileFinder must provide it explicitly."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn is_concurrency_safe(&self, input: Option<&Value>) -> bool {
        let subagent_type = input
            .and_then(|v| v.get("subagent_type"))
            .and_then(|v| v.as_str());
        match subagent_type {
            Some(id) => get_agent_registry()
                .get_subagent_is_readonly(id)
                .unwrap_or(false),
            None => false,
        }
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("spawn")
            .trim()
            .to_ascii_lowercase();

        match action.as_str() {
            "" | "spawn" => InputValidator::new(input)
                .validate_required("prompt")
                .validate_required("subagent_type")
                .finish(),
            "list" => ValidationResult::default(),
            "status" | "wait" | "cancel" | "events" | "transcript" | "patches" | "patch_summary" | "patch_merge" => {
                if input
                    .get("task_id")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    Self::validation_error("task_id is required for this Task action")
                } else {
                    ValidationResult::default()
                }
            }
            "patch_status" => {
                let task_ok = input
                    .get("task_id")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some();
                if !task_ok {
                    return Self::validation_error("task_id is required for patch_status action");
                }

                let patch_ok = input
                    .get("patch_id")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some();
                if !patch_ok {
                    return Self::validation_error("patch_id is required for patch_status action");
                }

                let status_ok = input
                    .get("patch_status")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some();
                if !status_ok {
                    return Self::validation_error("patch_status is required for patch_status action");
                }

                ValidationResult::default()
            }
            _ => Self::validation_error(format!(
                "Unsupported Task action '{}'. Allowed actions: spawn, status, wait, cancel, events, transcript, list, patches, patch_summary, patch_merge, patch_status",
                action
            )),
        }
    }

    fn render_tool_use_message(&self, input: &Value, options: &ToolRenderOptions) -> String {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("spawn");
        if action != "spawn" {
            let task_id = input
                .get("task_id")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            return if task_id.is_empty() {
                format!("Task action: {}", action)
            } else {
                format!("Task action: {} {}", action, task_id)
            };
        }

        if let Some(description) = input.get("description").and_then(|v| v.as_str()) {
            if options.verbose {
                format!("Creating task: {}", description)
            } else {
                format!("Task: {}", description)
            }
        } else {
            "Creating task".to_string()
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        let start_time = std::time::Instant::now();
        let action = Self::action(input)?;
        let coordinator = get_global_coordinator()
            .ok_or_else(|| OpenHarnessError::tool("coordinator not initialized".to_string()))?;

        if action != "spawn" {
            let duration = || start_time.elapsed().as_millis();

            return match action.as_str() {
                "list" => {
                    let tasks = coordinator.list_agent_tasks(None).await;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "tasks": tasks,
                        }),
                        result_for_assistant: Some(format!("Found {} agent task(s).", tasks.len())),
                        image_attachments: None,
                    }])
                }
                "status" => {
                    let task_id = Self::task_id(input)?;
                    let task = coordinator
                        .list_agent_tasks(None)
                        .await
                        .into_iter()
                        .find(|snapshot| snapshot.task_id.as_str() == task_id);
                    let Some(task) = task else {
                        return Err(OpenHarnessError::tool(format!(
                            "Agent task '{}' was not found",
                            task_id
                        )));
                    };
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task": task,
                        }),
                        result_for_assistant: Some(format!(
                            "Agent task {} status: {:?}",
                            task_id, task.status
                        )),
                        image_attachments: None,
                    }])
                }
                "wait" => {
                    let task_id = Self::task_id(input)?;
                    let wait_future = coordinator.wait_agent_task(&task_id);
                    let task = if let Some(timeout_ms) = input
                        .get("wait_timeout_ms")
                        .and_then(|value| value.as_u64())
                    {
                        match tokio::time::timeout(Duration::from_millis(timeout_ms), wait_future)
                            .await
                        {
                            Ok(result) => result?,
                            Err(_) => {
                                return Ok(vec![ToolResult::Result {
                                    data: json!({
                                        "duration": duration(),
                                        "task_id": task_id,
                                        "timed_out": true,
                                    }),
                                    result_for_assistant: Some(format!(
                                        "Agent task {} is still running after {} ms.",
                                        task_id, timeout_ms
                                    )),
                                    image_attachments: None,
                                }]);
                            }
                        }
                    } else {
                        wait_future.await?
                    };

                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task": task,
                            "timed_out": false,
                        }),
                        result_for_assistant: Some(format!(
                            "Agent task {} reached terminal status {:?}. Summary:\n{}",
                            task_id,
                            task.status,
                            task.result_summary.clone().unwrap_or_default()
                        )),
                        image_attachments: None,
                    }])
                }
                "cancel" => {
                    let task_id = Self::task_id(input)?;
                    let reason = input
                        .get("reason")
                        .and_then(|value| value.as_str())
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("Cancelled by parent agent")
                        .to_string();
                    let task = coordinator.cancel_agent_task(&task_id, reason).await?;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task": task,
                        }),
                        result_for_assistant: Some(format!(
                            "Agent task {} cancellation requested. Current status: {:?}",
                            task_id, task.status
                        )),
                        image_attachments: None,
                    }])
                }
                "events" => {
                    let task_id = Self::task_id(input)?;
                    let events = coordinator.agent_task_events(&task_id).await?;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "events": events,
                        }),
                        result_for_assistant: Some(format!(
                            "Agent task {} has {} event(s).",
                            task_id,
                            events.len()
                        )),
                        image_attachments: None,
                    }])
                }
                "transcript" => {
                    let task_id = Self::task_id(input)?;
                    let transcript = coordinator.agent_task_transcript(&task_id).await;
                    let found = transcript.is_some();
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "transcript": transcript,
                        }),
                        result_for_assistant: Some(if found {
                            format!("Agent task {} transcript loaded.", task_id)
                        } else {
                            format!("Agent task {} transcript was not found.", task_id)
                        }),
                        image_attachments: None,
                    }])
                }
                "patches" => {
                    let task_id = Self::task_id(input)?;
                    let patches = coordinator.agent_task_patches(&task_id).await;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "patches": patches,
                        }),
                        result_for_assistant: Some(format!(
                            "Agent task {} has {} patch record(s).",
                            task_id,
                            patches.len()
                        )),
                        image_attachments: None,
                    }])
                }
                "patch_summary" => {
                    let task_id = Self::task_id(input)?;
                    let summary = coordinator.agent_task_patch_summary(&task_id).await;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "summary": summary,
                        }),
                        result_for_assistant: Some(format!(
                            "Patch summary for task {}: total={}, pending={}, accepted={}, rejected={}, applied={}, conflicted={}",
                            task_id,
                            summary.total,
                            summary.pending,
                            summary.accepted,
                            summary.rejected,
                            summary.applied,
                            summary.conflicted,
                        )),
                        image_attachments: None,
                    }])
                }
                "patch_merge" => {
                    let task_id = Self::task_id(input)?;
                    let patches = coordinator.merge_agent_task_patches(&task_id).await?;
                    let applied_count = patches
                        .iter()
                        .filter(|record| matches!(record.status, PatchStatus::Applied))
                        .count();

                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "patches": patches,
                        }),
                        result_for_assistant: Some(format!(
                            "Merged task {} worktree branch and updated {} patch record(s) to applied.",
                            task_id,
                            applied_count,
                        )),
                        image_attachments: None,
                    }])
                }
                "patch_status" => {
                    let task_id = Self::task_id(input)?;
                    let patch_id = Self::patch_id(input)?;
                    let patch_status = Self::parse_patch_status(input)?;
                    let patch = coordinator
                        .set_agent_task_patch_status(&task_id, &patch_id, patch_status)
                        .await?;
                    Ok(vec![ToolResult::Result {
                        data: json!({
                            "duration": duration(),
                            "task_id": task_id,
                            "patch": patch,
                        }),
                        result_for_assistant: Some(format!(
                            "Updated patch {} for task {}. Current status: {:?}.",
                            patch_id, task_id, patch.status,
                        )),
                        image_attachments: None,
                    }])
                }
                _ => unreachable!("validated Task action"),
            };
        }

        let mut prompt = input
            .get("prompt")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                OpenHarnessError::tool(
                    "Required parameters: subagent_type, prompt, description. Missing prompt"
                        .to_string(),
                )
            })?
            .to_string();

        let subagent_type = input
            .get("subagent_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| OpenHarnessError::tool("Required parameters: subagent_type, prompt, description. Missing subagent_type".to_string()))?
            .to_string();
        let workspace_root = context.workspace_root();
        let all_agent_types = self.get_agents_types(workspace_root).await;
        if !all_agent_types.contains(&subagent_type) {
            return Err(OpenHarnessError::tool(format!(
                "subagent_type {} is not valid, must be one of: {}",
                subagent_type,
                all_agent_types.join(", ")
            )));
        }

        let run_in_background = input
            .get("run_in_background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let model = input
            .get("model")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let allowed_tools = Self::parse_string_array(input, "allowed_tools")?;
        let fork_context = input
            .get("fork_context")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let max_turns = input
            .get("max_turns")
            .and_then(|value| value.as_u64())
            .map(|value| u32::try_from(value).unwrap_or(u32::MAX));
        if max_turns == Some(0) {
            return Err(OpenHarnessError::tool(
                "max_turns must be greater than 0".to_string(),
            ));
        }

        let isolation =
            Self::parse_workspace_isolation(input.get("isolation").and_then(|v| v.as_str()))?;

        let requested_workspace_path = input
            .get("workspace_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let current_workspace_path = context
            .workspace_root()
            .map(|path| path.to_string_lossy().into_owned());
        if subagent_type == "Explore" || subagent_type == "FileFinder" {
            let workspace_path = requested_workspace_path
                .as_deref()
                .or(current_workspace_path.as_deref())
                .ok_or_else(|| {
                    OpenHarnessError::tool(
                        "workspace_path is required for Explore/FileFinder agent".to_string(),
                    )
                })?;

            if workspace_path.is_empty() {
                return Err(OpenHarnessError::tool(
                    "workspace_path cannot be empty for Explore/FileFinder agent".to_string(),
                ));
            }

            // For remote workspaces, skip local filesystem validation — the path
            // exists on the remote server, not locally.
            if !context.is_remote() {
                let path = std::path::Path::new(&workspace_path);
                if !path.exists() {
                    return Err(OpenHarnessError::tool(format!(
                        "workspace_path '{}' does not exist",
                        workspace_path
                    )));
                }
                if !path.is_dir() {
                    return Err(OpenHarnessError::tool(format!(
                        "workspace_path '{}' is not a directory",
                        workspace_path
                    )));
                }
            }

            prompt.push_str(&format!(
                "\n\nThe workspace you need to explore: {workspace_path}"
            ));
        }
        let effective_workspace_path = requested_workspace_path
            .clone()
            .or(current_workspace_path)
            .ok_or_else(|| {
                OpenHarnessError::tool(
                    "workspace_path is required when the current workspace is unavailable"
                        .to_string(),
                )
            })?;

        let workspace_root = PathBuf::from(&effective_workspace_path);
        if !context.is_remote() {
            if !workspace_root.exists() {
                return Err(OpenHarnessError::tool(format!(
                    "workspace_path '{}' does not exist",
                    effective_workspace_path
                )));
            }
            if !workspace_root.is_dir() {
                return Err(OpenHarnessError::tool(format!(
                    "workspace_path '{}' is not a directory",
                    effective_workspace_path
                )));
            }
        }

        let workspace_binding = Self::prepare_workspace_binding(
            isolation,
            workspace_root,
            input.get("cwd").and_then(|v| v.as_str()),
            &subagent_type,
            context.is_remote(),
        )
        .await?;

        match workspace_binding.isolation {
            WorkspaceIsolation::GitWorktree => {
                if let Some(path) = workspace_binding.worktree_path.as_ref() {
                    prompt.push_str(&format!(
                        "\n\nWorkspace isolation: use the dedicated git worktree at {}. Do not modify the parent checkout unless explicitly requested.",
                        path.display()
                    ));
                }
            }
            WorkspaceIsolation::Scratch => {
                prompt.push_str(&format!(
                    "\n\nWorkspace isolation: use the scratch workspace at {}. It starts empty and is separate from the source workspace.",
                    workspace_binding.effective_working_dir().display()
                ));
            }
            WorkspaceIsolation::None => {}
        }

        let mut effective_allowed_tools = Vec::new();
        if !allowed_tools.is_empty() {
            let allowed_from_definition = get_agent_registry()
                .get_agent_tools(&subagent_type, context.workspace_root())
                .await;
            let allow_set: HashSet<String> = allowed_from_definition.iter().cloned().collect();

            let invalid_requested = allowed_tools
                .iter()
                .filter(|tool| !allow_set.contains(*tool))
                .cloned()
                .collect::<Vec<_>>();

            if !invalid_requested.is_empty() {
                return Err(OpenHarnessError::tool(format!(
                    "Requested allowed_tools are not available for subagent '{}': {}",
                    subagent_type,
                    invalid_requested.join(", ")
                )));
            }

            effective_allowed_tools = allowed_tools;
        }

        let parent_task_id = context
            .custom_data
            .get("agent_task_id")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(AgentTaskId::from);

        let task_config = AgentTaskConfig {
            agent_name: subagent_type.clone(),
            prompt,
            parent_task_id,
            session_id: context.session_id.clone(),
            workspace_binding,
            fork_context: if fork_context {
                ForkContextMode::InheritParent
            } else {
                ForkContextMode::Fresh
            },
            max_turns,
            allowed_tools: effective_allowed_tools,
            model,
        };

        let task_kind = if run_in_background {
            AgentTaskKind::Background
        } else {
            AgentTaskKind::Child
        };

        let snapshot = coordinator.spawn_agent_task(task_config, task_kind).await?;

        if run_in_background {
            let duration = start_time.elapsed().as_millis();
            return Ok(vec![ToolResult::Result {
                data: json!({
                    "duration": duration,
                    "task_id": snapshot.task_id.to_string(),
                    "status": "queued",
                }),
                result_for_assistant: Some(format!(
                    "Subagent '{}' started in background. task_id={}",
                    subagent_type, snapshot.task_id
                )),
                image_attachments: None,
            }]);
        }

        let completed = coordinator
            .wait_agent_task(snapshot.task_id.as_str())
            .await?;

        if !matches!(completed.status, AgentTaskStatus::Succeeded) {
            let reason = completed
                .last_error
                .unwrap_or_else(|| "Unknown subagent execution failure".to_string());
            return Err(OpenHarnessError::tool(format!(
                "Subagent '{}' failed: {}",
                subagent_type, reason
            )));
        }

        let duration = start_time.elapsed().as_millis();
        let transcript_ref = completed
            .transcript_ref
            .unwrap_or_else(|| completed.task_id.to_string());
        let summary = completed.result_summary.unwrap_or_default();

        Ok(vec![ToolResult::Result {
            data: json!({
                "duration": duration,
                "task_id": completed.task_id.to_string(),
                "status": "succeeded",
                "transcript_ref": transcript_ref,
            }),
            result_for_assistant: Some(format!(
                "Subagent '{}' completed successfully with result:\n<result>\n{}\n</result>\n\ntranscript_ref: {}",
                subagent_type, summary, transcript_ref
            )),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_parses_patch_merge() {
        let action = TaskTool::action(&json!({ "action": "patch_merge" })).unwrap();
        assert_eq!(action, "patch_merge");
    }

    #[tokio::test]
    async fn validates_patch_merge_requires_task_id() {
        let tool = TaskTool::new();

        let missing_task_id = tool
            .validate_input(&json!({ "action": "patch_merge" }), None)
            .await;
        assert!(!missing_task_id.result);

        let ok = tool
            .validate_input(
                &json!({
                    "action": "patch_merge",
                    "task_id": "agtask-test"
                }),
                None,
            )
            .await;
        assert!(ok.result);
    }

    #[tokio::test]
    async fn validates_task_control_actions_without_spawn_fields() {
        let tool = TaskTool::new();

        let status_validation = tool
            .validate_input(
                &json!({
                    "action": "status",
                    "task_id": "agtask-test"
                }),
                None,
            )
            .await;
        assert!(status_validation.result);

        let missing_task_id = tool
            .validate_input(&json!({ "action": "events" }), None)
            .await;
        assert!(!missing_task_id.result);

        let spawn_missing_prompt = tool
            .validate_input(
                &json!({
                    "action": "spawn",
                    "subagent_type": "Explore"
                }),
                None,
            )
            .await;
        assert!(!spawn_missing_prompt.result);
    }

    #[test]
    fn task_schema_does_not_force_spawn_fields_for_control_actions() {
        let schema = TaskTool::new().input_schema();
        assert!(schema.get("required").is_none());
        assert!(schema
            .get("properties")
            .and_then(|properties| properties.get("action"))
            .is_some());
        assert!(schema
            .get("properties")
            .and_then(|properties| properties.get("task_id"))
            .is_some());
    }

    #[tokio::test]
    async fn scratch_isolation_creates_real_workspace_directory() {
        let binding = TaskTool::prepare_workspace_binding(
            WorkspaceIsolation::Scratch,
            std::env::temp_dir(),
            Some("nested"),
            "Explore",
            false,
        )
        .await
        .expect("scratch binding");

        assert_eq!(binding.isolation, WorkspaceIsolation::Scratch);
        assert!(binding.root.exists());
        assert!(binding.working_dir.exists());
        assert!(binding.working_dir.ends_with("nested"));

        let _ = tokio::fs::remove_dir_all(binding.root).await;
    }

    #[tokio::test]
    async fn worktree_isolation_rejects_non_git_workspace() {
        let root = std::env::temp_dir().join(format!(
            "openharness-non-git-workspace-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&root).await.unwrap();

        let err = TaskTool::prepare_workspace_binding(
            WorkspaceIsolation::GitWorktree,
            root.clone(),
            None,
            "Explore",
            false,
        )
        .await
        .expect_err("non-git workspace should fail");
        assert!(err
            .to_string()
            .contains("isolation=worktree requires a real git repository"));

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn worktree_isolation_creates_real_git_worktree() {
        if std::process::Command::new("git")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }

        let root = std::env::temp_dir().join(format!(
            "openharness-git-workspace-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&root).await.unwrap();

        let run_git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .output()
                .expect("git command");
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        };

        run_git(&["init"]);
        run_git(&["config", "user.email", "test@example.invalid"]);
        run_git(&["config", "user.name", "OpenHarness Test"]);
        tokio::fs::write(root.join("README.md"), "hello\n")
            .await
            .unwrap();
        run_git(&["add", "README.md"]);
        run_git(&["commit", "-m", "initial"]);

        let binding = TaskTool::prepare_workspace_binding(
            WorkspaceIsolation::GitWorktree,
            root.clone(),
            None,
            "Explore",
            false,
        )
        .await
        .expect("worktree binding");

        assert_eq!(binding.isolation, WorkspaceIsolation::GitWorktree);
        assert!(binding
            .worktree_path
            .as_ref()
            .is_some_and(|path| path.exists()));
        assert!(binding
            .branch_name
            .as_ref()
            .is_some_and(|branch| { branch.starts_with("openharness-agent-explore-") }));

        let worktree_path = binding.worktree_path.clone();
        let _ = tokio::fs::remove_dir_all(root).await;
        if let Some(path) = worktree_path {
            let _ = tokio::fs::remove_dir_all(path).await;
        }
    }
}
