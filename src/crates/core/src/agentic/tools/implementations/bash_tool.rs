use crate::agentic::security::shell::{RiskLevel, ShellRiskAnalyzer};
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::infrastructure::events::event_system::get_global_event_system;
use crate::infrastructure::events::event_system::BackendEvent::{
    ToolExecutionProgress, ToolTerminalReady,
};
use crate::service::config::global::get_global_config_service;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use crate::util::types::event::{ToolExecutionProgressInfo, ToolTerminalReadyInfo};
use async_trait::async_trait;
use futures::StreamExt;
use log::{debug, error, info, warn};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use terminal_core::session::SessionSource;
use terminal_core::shell::{ShellDetector, ShellType};
use terminal_core::{
    CommandCompletionReason, CommandStreamEvent, ExecuteCommandRequest, SendCommandRequest,
    SignalRequest, TerminalApi, TerminalBindingOptions, TerminalSessionBinding,
};
use tokio::io::AsyncWriteExt;
use tool_runtime::util::ansi_cleaner::strip_ansi;

const MAX_OUTPUT_LENGTH: usize = 30000;
const INTERRUPT_OUTPUT_DRAIN_MS: u64 = 500;

const BANNED_COMMANDS: &[&str] = &[
    "alias",
    "curl",
    "curlie",
    "wget",
    "axel",
    "aria2c",
    "nc",
    "telnet",
    "lynx",
    "w3m",
    "links",
    "httpie",
    "xh",
    "http-prompt",
    "chrome",
    "firefox",
    "safari",
];

fn truncate_output_preserving_tail(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        return s.to_string();
    }

    let tail_bias = max_chars.saturating_mul(4) / 5;
    let separator = "\n... [truncated, middle omitted, tail preserved] ...\n";
    let separator_len = separator.chars().count();

    if separator_len >= max_chars {
        return chars[chars.len() - max_chars..].iter().collect();
    }

    let content_budget = max_chars - separator_len;
    let tail_len = tail_bias.min(content_budget);
    let head_len = content_budget.saturating_sub(tail_len);

    let head: String = chars[..head_len].iter().collect();
    let tail: String = chars[chars.len() - tail_len..].iter().collect();

    format!("{head}{separator}{tail}")
}

/// Result of shell resolution for bash tool
struct ResolvedShell {
    /// Shell type to use (None means use system default)
    shell_type: Option<ShellType>,
    /// Display name for the shell (for tool description)
    display_name: String,
}

/// Bash tool
pub struct BashTool;

impl Default for BashTool {
    fn default() -> Self {
        Self::new()
    }
}

impl BashTool {
    pub fn new() -> Self {
        Self
    }

    /// Build environment variables that suppress interactive behaviors
    /// (pagers, editors, prompts) so agent-driven commands never block.
    pub fn noninteractive_env() -> std::collections::HashMap<String, String> {
        let mut env = std::collections::HashMap::new();
        env.insert("OPENHARNESS_NONINTERACTIVE".to_string(), "1".to_string());
        // Disable git pager globally (prevents `less`/`more` from blocking)
        env.insert("GIT_PAGER".to_string(), "cat".to_string());
        // Disable generic pager for other tools (man, etc.)
        env.insert("PAGER".to_string(), "cat".to_string());
        // Prevent git from prompting for credentials or SSH passphrases
        env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
        // Ensure git never opens an interactive editor (e.g. for commit messages)
        env.insert("GIT_EDITOR".to_string(), "true".to_string());
        env
    }

    /// Resolve shell configuration for bash tool.
    /// If configured shell doesn't support integration, falls back to system default.
    async fn resolve_shell() -> ResolvedShell {
        // Try configured shell first, fall back to system default
        Self::try_configured_shell()
            .await
            .unwrap_or_else(Self::system_default_shell)
    }

    /// Try to get a valid configured shell that supports integration.
    async fn try_configured_shell() -> Option<ResolvedShell> {
        let config_service = get_global_config_service().await.ok()?;
        let shell_str: String = config_service
            .get_config::<String>(Some("terminal.default_shell"))
            .await
            .ok()
            .filter(|s| !s.is_empty())?;

        let parsed = ShellType::from_executable(&shell_str);
        if parsed.supports_integration() {
            Some(ResolvedShell {
                shell_type: Some(parsed.clone()),
                display_name: parsed.name().to_string(),
            })
        } else {
            debug!(
                "Configured shell '{}' does not support integration, using system default",
                shell_str
            );
            None
        }
    }

    /// Get system default shell configuration.
    fn system_default_shell() -> ResolvedShell {
        let detected = ShellDetector::get_default_shell();
        ResolvedShell {
            shell_type: None,
            display_name: detected.display_name,
        }
    }

    fn render_result(
        &self,
        terminal_session_id: &str,
        output_text: &str,
        interrupted: bool,
        timed_out: bool,
        exit_code: i32,
        diagnostic_hint: Option<&str>,
    ) -> String {
        let mut result_string = String::new();

        // Exit code
        result_string.push_str(&format!("<exit_code>{}</exit_code>", exit_code));

        // Main output content
        if !output_text.is_empty() {
            let cleaned_output = strip_ansi(output_text);
            let output_len = cleaned_output.chars().count();
            if output_len > MAX_OUTPUT_LENGTH {
                let truncated = truncate_output_preserving_tail(&cleaned_output, MAX_OUTPUT_LENGTH);
                result_string.push_str(&format!(
                    "<output truncated=\"true\">{}</output>",
                    truncated
                ));
            } else {
                result_string.push_str(&format!("<output>{}</output>", cleaned_output));
            }
        }

        // Interruption notice
        if timed_out {
            result_string.push_str(
                "<status type=\"timeout\">Command timed out before completion. Partial output, if any, is included above.</status>",
            );
        } else if interrupted {
            result_string.push_str(
                "<status type=\"interrupted\">Command was canceled by the user. ASK THE USER what they would like to do next.</status>"
            );
        }

        if let Some(hint) = diagnostic_hint {
            result_string.push_str(&format!("<diagnostic_hint>{}</diagnostic_hint>", hint));
        }

        // Terminal session ID
        result_string.push_str(&format!(
            "<terminal_session_id>{}</terminal_session_id>",
            terminal_session_id
        ));

        result_string
    }

    fn command_failure_hint(command: &str, output: &str, exit_code: i32) -> Option<String> {
        let command_lower = command.trim_start().to_lowercase();
        let cleaned_output = strip_ansi(output);
        let output_lower = cleaned_output.to_lowercase();
        let python_invocation = command_lower.starts_with("python ")
            || command_lower == "python"
            || command_lower.starts_with("python3 ")
            || command_lower == "python3"
            || command_lower.starts_with("python.exe ")
            || command_lower == "python.exe"
            || command_lower.starts_with("py ")
            || command_lower == "py"
            || command_lower.starts_with("py.exe ")
            || command_lower == "py.exe";

        if Self::output_indicates_shell_parser_error(&cleaned_output) {
            return Some(
                "The shell parsed the script body instead of running it as Python. The Bash tool accepts a single command string; avoid PowerShell here-strings or pasted multi-line blocks here. Use a single shell-safe command, or create a temporary script only after the file-write approval flow is accepted.".to_string(),
            );
        }

        if exit_code == 0 {
            return None;
        }

        if python_invocation
            && (output_lower.contains("python was not found")
                || output_lower.contains("microsoft store")
                || output_lower.contains("not recognized")
                || output_lower.contains("not found"))
        {
            return Some(
                "Python command appears unavailable in this shell. On Windows with Python Manager/App Execution Aliases, use the Python Launcher (`py` or `py -`) instead of `python`/`python3`; on macOS/Linux verify `python3` with `command -v python3` and then retry once with the OS-appropriate command.".to_string(),
            );
        }

        if python_invocation
            && command_lower.contains(" -c ")
            && output_lower.contains("syntaxerror")
            && command_lower.contains("; for ")
        {
            return Some(
                "The Python one-liner contains a compound statement after a semicolon. The Bash tool accepts one shell command string, so avoid block syntax in `py -c`; use a shell-safe expression/comprehension, a dedicated file/PDF tool, or an approved temporary script flow.".to_string(),
            );
        }

        if output_lower.contains("is not recognized as an internal or external command")
            || output_lower.contains("the term") && output_lower.contains("is not recognized")
            || output_lower.contains("command not found")
            || output_lower.contains("no such file or directory")
        {
            return Some(
                "The command appears unavailable in the current shell. Verify availability first (`Get-Command <name>` on PowerShell, `where <name>` on cmd, or `command -v <name>` on POSIX), then adapt to an installed tool or use the dedicated file/search/read tools instead of retrying the same command.".to_string(),
            );
        }

        None
    }

    fn output_indicates_shell_parser_error(output: &str) -> bool {
        let output_lower = output.to_lowercase();
        output_lower.contains("parsererror")
            || output_lower.contains("parentcontainserrorrecordexception")
            || output_lower.contains("missingopenparenthesisinifstatement")
            || output.contains("所在位置 行:")
            || output.contains("if 语句中的“if”后面缺少")
            || output.contains("关键字“for”后面缺少")
            || output.contains("并未报告所有分析错误")
    }

    fn emit_terminal_ready_event(tool_use_id: &str, terminal_session_id: &str) {
        let event = ToolTerminalReady(ToolTerminalReadyInfo {
            tool_use_id: tool_use_id.to_string(),
            terminal_session_id: terminal_session_id.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });

        let event_system = get_global_event_system();
        tokio::spawn(async move {
            let _ = event_system.emit(event).await;
        });
    }
}

#[async_trait]
impl Tool for BashTool {
    fn name(&self) -> &str {
        "Bash"
    }

    async fn description(&self) -> OpenHarnessResult<String> {
        let shell_info = Self::resolve_shell().await.display_name;

        Ok(format!(
            r#"Executes a given command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

Shell Environment: {shell_info}

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use `ls foo` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

3. Environment-specific command rules:
   - Match the command to the shell shown above. On Windows this is usually PowerShell, so prefer PowerShell syntax/cmdlets over Unix-only tools unless you have already verified those tools exist.
   - For Python on Windows, prefer `py`; Python Manager/App Execution Aliases can make `python` and `python3` unavailable or redirect to the Microsoft Store. On macOS/Linux, prefer `python3` after checking `command -v python3`.
   - The command field accepts one shell command string. Do not paste PowerShell here-strings or multi-line scripts into Bash.
   - Do not put Python compound statements (`for`, `with`, `try`, function/class definitions) after semicolons in `python -c` / `py -c`. Use shell-safe expressions/comprehensions, dedicated file tools, or an approved temporary script flow when block syntax is needed.
   - Before using optional CLIs, verify them once (`Get-Command` on PowerShell, `where` on cmd, `command -v` on POSIX) or use a known project script.
   - If a command returns "not found", "not recognized", a Microsoft Store Python message, or a shell syntax error, stop and adapt to the correct environment instead of repeating the same command.

Usage notes:
  - The command argument is required and MUST be a single-line command.
  - DO NOT use multiline commands or HEREDOC syntax (e.g., <<EOF, heredoc with newlines). Only single-line commands are supported.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does. For simple commands, keep it brief (5-10 words). For complex commands (piped commands, obscure flags, or anything hard to understand at a glance), add enough context to clarify what it does.
  - If the output exceeds {MAX_OUTPUT_LENGTH} characters, output will be truncated before being returned to you, with the tail of the output preserved because the ending is usually more important.
  - You can use the `run_in_background` parameter to run the command in a new dedicated background terminal session. The tool returns the background session ID immediately without waiting for the command to finish. Only use this for long-running processes (e.g., dev servers, watchers) where you don't need the output right away. You do not need to append '&' to the command. NOTE: `timeout_ms` is ignored when `run_in_background` is true.
  - Each result includes a `<terminal_session_id>` tag identifying the terminal session. The persistent shell session ID remains constant throughout the entire conversation; background sessions each have their own unique ID.
  - The output may include the command echo and/or the shell prompt (e.g., `PS C:\path>`). Do not treat these as part of the command's actual result.
  - Avoid interactive commands that may block waiting for user input or open a pager/editor. Prefer non-interactive variants and explicit flags. For example, use `git --no-pager diff` instead of `git diff`, and avoid commands that prompt for confirmation unless the User explicitly asks for them.
  
  - Avoid using this tool with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m "message" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>"#
        ))
    }

    async fn description_with_context(
        &self,
        context: Option<&ToolUseContext>,
    ) -> OpenHarnessResult<String> {
        let mut base = self.description().await?;
        if context.map(|c| c.is_remote()).unwrap_or(false) {
            base = format!(
                r#"**Remote workspace:** Commands run on the **SSH server** in a shell whose initial working directory is the **remote workspace root** (same as running a terminal on that machine). The shell name shown below may reflect your **local** OpenHarness settings; the actual interpreter on the server is typically `sh`/`bash`. Use **Unix** syntax and POSIX paths — not PowerShell or Windows paths.

{base}"#,
                base = base
            );
        }
        if !context.map(|c| c.is_remote()).unwrap_or(false) {
            base.push_str(
                "\n\n**Desktop automation:** Prefer this tool for anything achievable from the **workspace shell** (build, test, git, scripts, CLIs). On **macOS**, `open -a \"AppName\"` launches or foregrounds an app with fewer steps than GUI workflows. When **Computer use** is enabled, use **`ComputerUse`** **`action: locate`** for **named** on-screen controls before guessing coordinates from **`action: screenshot`** alone.",
            );
        }
        Ok(base)
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute"
                },
                "timeout_ms": {
                    "type": "number",
                    "description": "Optional timeout in milliseconds (default 120000, max 600000). Ignored when run_in_background is true."
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "If true, runs the command in a new dedicated background terminal session and returns the session ID immediately without waiting for completion. Useful for long-running processes like dev servers or file watchers. timeout_ms is ignored when this is true."
                },
                "description": {
                    "type": "string",
                    "description": "Clear, concise description of what this command does in 5-10 words, in active voice. Examples:\nInput: ls\nOutput: List files in current directory\n\nInput: git status\nOutput: Show working tree status\n\nInput: npm install\nOutput: Install package dependencies\n\nInput: mkdir foo\nOutput: Create directory 'foo'"
                }
            },
            "required": ["command"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }

    /// Bash tool supports streaming - it can emit progress events during execution
    fn supports_streaming(&self) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        let command = input.get("command").and_then(|v| v.as_str());
        let run_in_background = input
            .get("run_in_background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if let Some(cmd) = command {
            if cmd.contains('\n') || cmd.contains('\r') {
                return ValidationResult {
                    result: false,
                    message: Some(
                        "Bash command must be a single shell command. Do not paste PowerShell here-strings or multi-line scripts into Bash; use a shell-safe one-liner or an approved file-write/script flow."
                            .to_string(),
                    ),
                    error_code: Some(400),
                    meta: None,
                };
            }

            let parts: Vec<&str> = cmd.split_whitespace().collect();
            if let Some(base_cmd) = parts.first() {
                // Check if command is banned
                if BANNED_COMMANDS.contains(&base_cmd.to_lowercase().as_str()) {
                    return ValidationResult {
                        result: false,
                        message: Some(format!(
                            "Command '{}' is not allowed for security reasons",
                            base_cmd
                        )),
                        error_code: Some(403),
                        meta: None,
                    };
                }
            }
        } else {
            return ValidationResult {
                result: false,
                message: Some("command is required".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        let Some(context) = context else {
            return ValidationResult {
                result: false,
                message: Some("tool context is required for Bash tool".to_string()),
                error_code: Some(400),
                meta: None,
            };
        };

        if context.session_id.as_deref().unwrap_or_default().is_empty() {
            return ValidationResult {
                result: false,
                message: Some("session_id is required for Bash tool".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        if context.workspace_root().is_none() {
            return ValidationResult {
                result: false,
                message: Some("workspace_path is required for Bash tool".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        // Warn if timeout_ms is set alongside run_in_background
        if run_in_background && input.get("timeout_ms").is_some() {
            return ValidationResult {
                result: true,
                message: Some(
                    "Note: timeout_ms is ignored when run_in_background is true".to_string(),
                ),
                error_code: None,
                meta: None,
            };
        }

        ValidationResult {
            result: true,
            message: None,
            error_code: None,
            meta: None,
        }
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
            // Clean up any command that uses the quoted HEREDOC pattern
            if command.contains("\"$(cat <<'EOF'") {
                // Simple regex-like parsing for HEREDOC
                if let Some(start) = command.find("\"$(cat <<'EOF'\n") {
                    if let Some(end) = command.find("\nEOF\n)") {
                        let prefix = &command[..start];
                        let content_start = start + "\"$(cat <<'EOF'\n".len();
                        let content = &command[content_start..end];
                        return format!("{} \"{}\"", prefix.trim(), content.trim());
                    }
                }
            }
            command.to_string()
        } else {
            "Executing command".to_string()
        }
    }

    async fn call_impl(
        &self,
        _input: &Value,
        _context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        Err(OpenHarnessError::tool(
            "Bash tool call_impl should not be called".to_string(),
        ))
    }

    async fn call(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        let start_time = Instant::now();

        // Get command parameter
        let command_str = input
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| OpenHarnessError::tool("command is required".to_string()))?;

        // Security: Analyze shell command for risks
        let workspace_root = context
            .workspace_root()
            .map(|p| p.to_string_lossy().to_string());
        let risk_analyzer = match workspace_root {
            Some(ref root) => ShellRiskAnalyzer::new().with_workspace_root(root.clone()),
            None => ShellRiskAnalyzer::new(),
        };
        let risk = risk_analyzer.analyze(command_str);

        let full_access = context
            .custom_data
            .get("permission_mode")
            .and_then(|value| value.as_str())
            .is_some_and(|mode| {
                matches!(
                    mode.trim().to_ascii_lowercase().as_str(),
                    "full_access" | "fullaccess" | "unrestricted"
                )
            });

        // Block high-risk commands unless the user explicitly selected Full access.
        if risk.level == RiskLevel::Blocked && !full_access {
            return Err(OpenHarnessError::tool(format!(
                "Command blocked: {} - {}",
                risk.category, risk.reason
            )));
        }

        // Log medium/high risk commands
        if risk.level == RiskLevel::High || risk.level == RiskLevel::Medium {
            warn!(
                "Shell risk detected: level={:?}, category={}, reason={}",
                risk.level, risk.category, risk.reason
            );
        }

        // Remote workspace: execute via injected workspace shell
        if context.is_remote() {
            if let Some(ws_shell) = context.ws_shell() {
                info!(
                    "Executing command on remote workspace via SSH: {}",
                    command_str
                );

                let timeout_ms = input
                    .get("timeout_ms")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(120_000);

                let (stdout, stderr, exit_code) = ws_shell
                    .exec(command_str, Some(timeout_ms))
                    .await
                    .map_err(|e| {
                        OpenHarnessError::tool(format!("Remote command execution failed: {}", e))
                    })?;

                let output = if stderr.is_empty() {
                    stdout.clone()
                } else {
                    format!("{}\n{}", stdout, stderr)
                };

                let execution_time_ms = start_time.elapsed().as_millis() as u64;
                let working_directory = context
                    .workspace_root()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let result = ToolResult::Result {
                    data: json!({
                        "success": exit_code == 0,
                        "command": command_str,
                        "stdout": stdout,
                        "stderr": stderr,
                        "output": output,
                        "exit_code": exit_code,
                        "interrupted": false,
                        "timed_out": false,
                        "working_directory": working_directory,
                        "execution_time_ms": execution_time_ms,
                        "duration_ms": execution_time_ms,
                        "is_remote": true
                    }),
                    result_for_assistant: Some(format!(
                        "[Remote SSH] Command executed on remote server:\n{}\n\nExit code: {}",
                        output, exit_code
                    )),
                    image_attachments: None,
                };
                return Ok(vec![result]);
            }
        }

        let run_in_background = input
            .get("run_in_background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Get session_id (for binding terminal session)
        let chat_session_id = context.session_id.as_ref().ok_or_else(|| {
            OpenHarnessError::tool("session_id is required for Bash tool".to_string())
        })?;

        // Get tool call ID (for sending progress events)
        let tool_use_id = context
            .tool_call_id
            .clone()
            .unwrap_or_else(|| format!("bash_{}", uuid::Uuid::new_v4()));

        // 1. Get Terminal API
        let terminal_api = TerminalApi::from_singleton()
            .map_err(|e| OpenHarnessError::tool(format!("Terminal not initialized: {}", e)))?;

        // 2. Resolve shell type
        let shell_type = Self::resolve_shell().await.shell_type;

        let binding = terminal_api.session_manager().binding();
        let workspace_path = context
            .workspace_root()
            .ok_or_else(|| {
                OpenHarnessError::tool("workspace_path is required for Bash tool".to_string())
            })?
            .to_string_lossy()
            .to_string();

        if run_in_background {
            // For background commands, inherit CWD from an already-running primary session
            // if one exists; otherwise fall back to workspace path.  This avoids forcing a
            // primary session to be created just to read its working directory.
            let initial_cwd = if let Some(existing_id) = binding.get(chat_session_id) {
                terminal_api
                    .get_session(&existing_id)
                    .await
                    .map(|s| s.cwd)
                    .unwrap_or_else(|_| workspace_path.clone())
            } else {
                workspace_path.clone()
            };

            return self
                .call_background(
                    command_str,
                    chat_session_id,
                    &initial_cwd,
                    context,
                    shell_type,
                    &terminal_api,
                    &binding,
                    start_time,
                )
                .await;
        }

        // 3. Foreground: get or create the primary terminal session
        let primary_session_id = binding
            .get_or_create(
                chat_session_id,
                TerminalBindingOptions {
                    working_directory: Some(workspace_path.clone()),
                    session_id: Some(chat_session_id.to_string()),
                    session_name: Some(format!(
                        "Chat-{}",
                        &chat_session_id[..8.min(chat_session_id.len())]
                    )),
                    shell_type: shell_type.clone(),
                    env: Some(Self::noninteractive_env()),
                    source: Some(SessionSource::Agent),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| {
                OpenHarnessError::tool(format!("Failed to create Terminal session: {}", e))
            })?;

        Self::emit_terminal_ready_event(&tool_use_id, &primary_session_id);

        // Get actual working directory from primary session
        let primary_cwd = terminal_api
            .get_session(&primary_session_id)
            .await
            .map(|s| s.cwd)
            .unwrap_or_else(|_| workspace_path.clone());

        // --- Foreground execution ---

        let tool_name = self.name().to_string();

        const DEFAULT_TIMEOUT_MS: u64 = 120_000;
        const MAX_TIMEOUT_MS: u64 = 600_000;
        let timeout_ms = Some(
            input
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_MS)
                .min(MAX_TIMEOUT_MS),
        );

        debug!(
            "Bash tool executing command: {}, session_id: {}, tool_id: {}",
            command_str, chat_session_id, tool_use_id
        );

        // 4. Create streaming execution request
        let request = ExecuteCommandRequest {
            session_id: primary_session_id.clone(),
            command: command_str.to_string(),
            timeout_ms,
            prevent_history: Some(true),
        };

        // 5. Execute command and handle streaming output
        let mut stream = terminal_api.execute_command_stream(request);
        let mut accumulated_output = String::new();
        let mut final_exit_code: Option<i32> = None;
        let mut was_interrupted = false;
        let mut timed_out = false;
        let mut interrupt_drain_deadline: Option<tokio::time::Instant> = None;

        // Get event system for sending progress
        let event_system = get_global_event_system();

        loop {
            let next_event = if let Some(deadline) = interrupt_drain_deadline {
                let now = tokio::time::Instant::now();
                if now >= deadline {
                    break;
                }

                match tokio::time::timeout_at(deadline, stream.next()).await {
                    Ok(event) => event,
                    Err(_) => break,
                }
            } else {
                stream.next().await
            };

            let Some(event) = next_event else {
                break;
            };

            // Check cancellation request
            if let Some(token) = &context.cancellation_token {
                if token.is_cancelled() && !was_interrupted {
                    debug!("Bash tool received cancellation request, sending interrupt signal, tool_id: {}", tool_use_id);
                    was_interrupted = true;
                    interrupt_drain_deadline = Some(
                        tokio::time::Instant::now()
                            + Duration::from_millis(INTERRUPT_OUTPUT_DRAIN_MS),
                    );

                    let _ = terminal_api
                        .signal(SignalRequest {
                            session_id: primary_session_id.clone(),
                            signal: "SIGINT".to_string(),
                        })
                        .await;

                    #[cfg(windows)]
                    {
                        final_exit_code = Some(-1073741510);
                    }
                    #[cfg(not(windows))]
                    {
                        final_exit_code = Some(130);
                    }
                }
            }

            match event {
                CommandStreamEvent::Started { command_id } => {
                    debug!("Bash command started execution, command_id: {}", command_id);
                }
                CommandStreamEvent::Output { data } => {
                    accumulated_output.push_str(&data);

                    if let Some(stream_sink) = &context.stream_sink {
                        stream_sink
                            .emit(json!({
                                "stream": "stdout",
                                "data": data.clone(),
                            }))
                            .await;
                    }

                    let progress_event = ToolExecutionProgress(ToolExecutionProgressInfo {
                        tool_use_id: tool_use_id.clone(),
                        tool_name: tool_name.clone(),
                        progress_message: data,
                        percentage: None,
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                    });

                    let event_system_clone = event_system.clone();
                    tokio::spawn(async move {
                        let _ = event_system_clone.emit(progress_event).await;
                    });
                }
                CommandStreamEvent::Completed {
                    exit_code,
                    total_output,
                    completion_reason,
                } => {
                    debug!(
                        "Bash command completed, exit_code: {:?}, tool_id: {}",
                        exit_code, tool_use_id
                    );
                    final_exit_code = exit_code.or(final_exit_code);
                    timed_out = completion_reason == CommandCompletionReason::TimedOut;

                    if !timed_out && matches!(exit_code, Some(130) | Some(-1073741510)) {
                        was_interrupted = true;
                    }

                    if !total_output.is_empty() {
                        accumulated_output = total_output;
                    }
                    break;
                }
                CommandStreamEvent::Error { message } => {
                    error!(
                        "Bash command execution error: {}, tool_id: {}",
                        message, tool_use_id
                    );
                    return Err(OpenHarnessError::tool(format!(
                        "Command execution error: {}",
                        message
                    )));
                }
            }
        }

        // 6. Build result
        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        let raw_exit_code_value = final_exit_code.unwrap_or(-1);
        let inferred_shell_failure = raw_exit_code_value == 0
            && Self::output_indicates_shell_parser_error(&accumulated_output);
        let exit_code_value = if inferred_shell_failure {
            1
        } else {
            raw_exit_code_value
        };
        let result_exit_code = if inferred_shell_failure {
            Some(exit_code_value)
        } else {
            final_exit_code
        };
        let diagnostic_hint =
            Self::command_failure_hint(command_str, &accumulated_output, exit_code_value);

        let result_data = json!({
            "success": exit_code_value == 0,
            "command": command_str,
            "output": accumulated_output,
            "exit_code": result_exit_code,
            "interrupted": was_interrupted,
            "timed_out": timed_out,
            "diagnostic_hint": diagnostic_hint,
            "working_directory": primary_cwd,
            "execution_time_ms": execution_time_ms,
            "terminal_session_id": primary_session_id,
        });

        let result_for_assistant = self.render_result(
            &primary_session_id,
            &accumulated_output,
            was_interrupted,
            timed_out,
            exit_code_value,
            diagnostic_hint.as_deref(),
        );

        Ok(vec![ToolResult::Result {
            data: result_data,
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

impl BashTool {
    /// Execute a command in a new background terminal session.
    /// Returns immediately with the new session ID.
    #[allow(clippy::too_many_arguments)]
    async fn call_background(
        &self,
        command_str: &str,
        chat_session_id: &str,
        initial_cwd: &str,
        context: &ToolUseContext,
        shell_type: Option<ShellType>,
        terminal_api: &TerminalApi,
        binding: &TerminalSessionBinding,
        start_time: Instant,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        debug!(
            "Bash tool starting background command: {}, owner: {}",
            command_str, chat_session_id
        );

        // Create a dedicated background terminal session sharing the primary session's cwd
        let bg_session_id = binding
            .create_background_session(
                chat_session_id,
                TerminalBindingOptions {
                    working_directory: Some(initial_cwd.to_string()),
                    session_id: None,
                    session_name: None,
                    shell_type,
                    env: Some(Self::noninteractive_env()),
                    source: Some(SessionSource::Agent),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| {
                OpenHarnessError::tool(format!(
                    "Failed to create background terminal session: {}",
                    e
                ))
            })?;

        let tool_use_id = context
            .tool_call_id
            .clone()
            .unwrap_or_else(|| format!("bash_{}", uuid::Uuid::new_v4()));
        Self::emit_terminal_ready_event(&tool_use_id, &bg_session_id);

        // Subscribe to session output before sending the command so no data is missed
        let mut output_rx = terminal_api.subscribe_session_output(&bg_session_id);

        // Fire-and-forget: write the command to the PTY without waiting for completion
        terminal_api
            .send_command(SendCommandRequest {
                session_id: bg_session_id.clone(),
                command: command_str.to_string(),
            })
            .await
            .map_err(|e| {
                OpenHarnessError::tool(format!("Failed to send background command: {}", e))
            })?;

        debug!(
            "Background command started, session_id: {}, owner: {}",
            bg_session_id, chat_session_id
        );

        // Determine output file path: <workspace>/.openharness/terminals/<bg_session_id>.txt
        let output_file_path = context.workspace_root().map(|ws| {
            ws.join(".openharness")
                .join("terminals")
                .join(format!("{}.txt", bg_session_id))
        });

        // Spawn task: write PTY output to file, delete when session ends
        if let Some(file_path) = output_file_path.clone() {
            let bg_id_for_log = bg_session_id.clone();
            tokio::spawn(async move {
                if let Some(parent) = file_path.parent() {
                    if let Err(e) = tokio::fs::create_dir_all(parent).await {
                        error!(
                            "Failed to create terminals output dir for bg session {}: {}",
                            bg_id_for_log, e
                        );
                        return;
                    }
                }

                let file = match tokio::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&file_path)
                    .await
                {
                    Ok(f) => f,
                    Err(e) => {
                        error!(
                            "Failed to open output file for bg session {}: {}",
                            bg_id_for_log, e
                        );
                        return;
                    }
                };

                let mut writer = tokio::io::BufWriter::new(file);

                while let Some(data) = output_rx.recv().await {
                    if let Err(e) = writer.write_all(data.as_bytes()).await {
                        error!(
                            "Failed to write output for bg session {}: {}",
                            bg_id_for_log, e
                        );
                        break;
                    }
                    let _ = writer.flush().await;
                }

                // Channel closed means session was destroyed - delete the log file
                drop(writer);
                if let Err(e) = tokio::fs::remove_file(&file_path).await {
                    debug!(
                        "Could not remove output file for bg session {} (may already be gone): {}",
                        bg_id_for_log, e
                    );
                } else {
                    debug!("Removed output file for bg session {}", bg_id_for_log);
                }
            });
        }

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        let output_file_str = output_file_path.as_deref().map(|p| p.display().to_string());

        let output_file_note = output_file_str
            .as_deref()
            .map(|s| format!("\nOutput is being written to: {}", s))
            .unwrap_or_default();

        let result_data = json!({
            "success": true,
            "command": command_str,
            "output": format!("Command started in background terminal session.{}", output_file_note),
            "exit_code": null,
            "interrupted": false,
            "working_directory": initial_cwd,
            "execution_time_ms": execution_time_ms,
            "terminal_session_id": bg_session_id,
            "output_file": output_file_str,
        });

        let result_for_assistant = format!(
            "Command started in background terminal session (id: {}).{}",
            bg_session_id, output_file_note
        );

        Ok(vec![ToolResult::Result {
            data: result_data,
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_output_preserving_tail_keeps_end_of_output() {
        let input = "BEGIN-".to_string() + &"x".repeat(120) + "-IMPORTANT-END";

        let truncated = truncate_output_preserving_tail(&input, 80);

        assert!(truncated.contains("tail preserved"));
        assert!(truncated.ends_with("IMPORTANT-END"));
        assert!(!truncated.contains("BEGIN-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
        assert!(truncated.chars().count() <= 80);
    }

    #[test]
    fn render_result_marks_truncated_output_and_keeps_tail() {
        let tool = BashTool::new();
        let long_output =
            "prefix\n".to_string() + &"y".repeat(MAX_OUTPUT_LENGTH + 100) + "\nfinal-error";

        let rendered = tool.render_result("session-1", &long_output, false, false, 1, None);

        assert!(rendered.contains("<output truncated=\"true\">"));
        assert!(rendered.contains("tail preserved"));
        assert!(rendered.contains("final-error"));
        assert!(rendered.contains("<exit_code>1</exit_code>"));
    }

    #[test]
    fn command_failure_hint_suggests_py_for_windows_python_alias() {
        let hint = BashTool::command_failure_hint(
            "python -c \"print(1)\"",
            "Python was not found; run without arguments to install from the Microsoft Store",
            9009,
        )
        .expect("expected python launcher hint");

        assert!(hint.contains("`py`"));
        assert!(hint.contains("Python Manager"));
    }

    #[test]
    fn command_failure_hint_detects_invalid_python_compound_one_liner() {
        let hint = BashTool::command_failure_hint(
            "py -c \"x=0; for i in range(3): x += i; print(x)\"",
            "SyntaxError: invalid syntax",
            1,
        )
        .expect("expected multi-line Python hint");

        assert!(hint.contains("one shell command"));
        assert!(hint.contains("compound statement"));
    }

    #[test]
    fn command_failure_hint_detects_powershell_parser_output_even_with_zero_exit() {
        let hint = BashTool::command_failure_hint(
            "@'\nfor page in reader.pages:\n    print(page)\n'@ | py -",
            "所在位置 行:3 字符: 3\n+ if len(text) > 4000:\n+   ~\nif 语句中的“if”后面缺少“(”。\nParserError",
            0,
        )
        .expect("expected shell parser hint");

        assert!(hint.contains("shell parsed"));
    }

    #[tokio::test]
    async fn validate_input_rejects_multiline_commands() {
        use crate::agentic::WorkspaceBinding;
        use std::collections::HashMap;

        let tool = BashTool::new();
        let context = ToolUseContext {
            tool_call_id: Some("tool-1".to_string()),
            agent_type: None,
            session_id: Some("session-1".to_string()),
            dialog_turn_id: Some("turn-1".to_string()),
            workspace: Some(WorkspaceBinding::new(
                None,
                std::path::PathBuf::from("F:\\G\\demo"),
            )),
            custom_data: HashMap::new(),
            stream_sink: None,
            computer_use_host: None,
            cancellation_token: None,
            workspace_services: None,
        };

        let result = tool
            .validate_input(&json!({"command":"echo one\necho two"}), Some(&context))
            .await;

        assert!(!result.result);
        assert!(result
            .message
            .unwrap_or_default()
            .contains("single shell command"));
    }
}
