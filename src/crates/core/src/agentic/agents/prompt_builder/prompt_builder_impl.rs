//! System prompts module providing main dialogue and agent dialogue prompts
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::agent_memory::build_workspace_agent_memory_prompt;
use crate::service::ai_memory::AIMemoryManager;
use crate::service::ai_rules::get_global_ai_rules_service;
use crate::service::bootstrap::build_workspace_persona_prompt;
use crate::service::config::get_app_language_code;
use crate::service::config::global::GlobalConfigManager;
use crate::service::filesystem::get_formatted_directory_listing;
use crate::service::project_context::ProjectContextService;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use log::{debug, warn};
use regex::Regex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Placeholder constants
const PLACEHOLDER_PERSONA: &str = "{PERSONA}";
const PLACEHOLDER_ENV_INFO: &str = "{ENV_INFO}";
const PLACEHOLDER_PROJECT_LAYOUT: &str = "{PROJECT_LAYOUT}";
// PROJECT_CONTEXT_FILES needs configuration parsing
// const PLACEHOLDER_PROJECT_CONTEXT_FILES: &str = "{PROJECT_CONTEXT_FILES}";
const PLACEHOLDER_RULES: &str = "{RULES}";
const PLACEHOLDER_MEMORIES: &str = "{MEMORIES}";
const PLACEHOLDER_LANGUAGE_PREFERENCE: &str = "{LANGUAGE_PREFERENCE}";
const PLACEHOLDER_AGENT_MEMORY: &str = "{AGENT_MEMORY}";
const PLACEHOLDER_PARTNER_WORKSPACE: &str = "{PARTNER_WORKSPACE}";
const PLACEHOLDER_VISUAL_MODE: &str = "{VISUAL_MODE}";
const MAX_CLAUDE_MEMORY_FILE_BYTES: u64 = 128 * 1024;
const MAX_CLAUDE_MEMORY_IMPORT_DEPTH: usize = 5;

/// SSH remote host facts for system prompt (workspace tools run here, not on the local client).
#[derive(Debug, Clone)]
pub struct RemoteExecutionHints {
    pub connection_display_name: String,
    pub kernel_name: String,
    pub hostname: String,
}

#[derive(Debug, Clone)]
pub struct PromptBuilderContext {
    pub workspace_path: String,
    pub session_id: Option<String>,
    pub model_name: Option<String>,
    /// When set, file/shell tools target this remote environment; OS and path instructions follow it.
    pub remote_execution: Option<RemoteExecutionHints>,
    /// Pre-built tree text for `{PROJECT_LAYOUT}` when the workspace is not on the local disk.
    pub remote_project_layout: Option<String>,
    /// When `Some(false)`, system prompt append Computer use text-only guidance (no screenshot tool output).
    pub supports_image_understanding: Option<bool>,
}

impl PromptBuilderContext {
    pub fn new(
        workspace_path: impl Into<String>,
        session_id: Option<String>,
        model_name: Option<String>,
    ) -> Self {
        Self {
            workspace_path: workspace_path.into().replace("\\", "/"),
            session_id,
            model_name,
            remote_execution: None,
            remote_project_layout: None,
            supports_image_understanding: None,
        }
    }

    pub fn with_supports_image_understanding(mut self, supports: bool) -> Self {
        self.supports_image_understanding = Some(supports);
        self
    }

    pub fn with_remote_prompt_overlay(
        mut self,
        execution: RemoteExecutionHints,
        project_layout: Option<String>,
    ) -> Self {
        self.remote_execution = Some(execution);
        self.remote_project_layout = project_layout;
        self
    }
}

pub struct PromptBuilder {
    pub context: PromptBuilderContext,
    pub file_tree_max_entries: usize,
}

#[derive(Debug, Clone)]
struct ClaudeMemoryDocument {
    source: String,
    path: PathBuf,
    content: String,
}

impl PromptBuilder {
    pub fn new(context: PromptBuilderContext) -> Self {
        Self {
            context,
            file_tree_max_entries: 200,
        }
    }

    fn command_environment_guidance(host_os: &str, is_remote: bool) -> &'static str {
        if is_remote {
            return "Command environment rules: workspace Bash commands run on the remote SSH host. Use POSIX shell syntax and forward-slash paths. Before relying on optional CLIs, check availability with `command -v <name>` or use a known project script. For Python, prefer `python3` on Unix-like hosts; if it is missing, check `python --version` once and adapt. Use non-interactive commands and explicit timeouts for long work.";
        }

        match host_os {
            "windows" => {
                "Command environment rules: workspace Bash commands run on the local Windows shell, usually PowerShell. Use PowerShell-compatible syntax and quote paths with spaces. Do not assume Unix tools (`grep`, `sed`, `awk`, `cat`, `head`, `tail`, `find`) exist unless already verified; prefer PowerShell cmdlets or dedicated file tools. The Bash command field accepts one shell command string: do not paste PowerShell here-strings or multi-line scripts into it. For Python on Windows, prefer `py` because Python Manager or App Execution Aliases may make `python` and `python3` unavailable. Do not put compound Python statements (`for`, `with`, `try`, functions/classes) after semicolons in `py -c`; use a shell-safe expression/comprehension, a dedicated file/PDF tool, or an approved temporary script flow. If a command is not found or a shell syntax error occurs, stop, report the exact failure, and retry with the OS-appropriate command instead of waiting or repeating the same command."
            }
            "macos" => {
                "Command environment rules: workspace Bash commands run on local macOS. Use POSIX shell syntax and forward-slash paths. For Python, prefer `python3`; check `command -v python3` before depending on it. Use non-interactive commands, avoid pager/editor prompts, and use `open -a \"AppName\"` for launching GUI apps when needed."
            }
            "linux" => {
                "Command environment rules: workspace Bash commands run on local Linux. Use POSIX shell syntax and forward-slash paths. For Python, prefer `python3`; check `command -v python3` before depending on it. Use non-interactive commands and avoid pager/editor prompts."
            }
            _ => {
                "Command environment rules: match commands to the reported operating system and shell. Verify optional CLIs before relying on them. Use non-interactive commands, explicit timeouts for long work, and stop/adapt if a command is not found or the shell reports a syntax error."
            }
        }
    }

    /// Provide complete environment information
    pub fn get_env_info(&self) -> String {
        let host_os = std::env::consts::OS;
        let host_family = std::env::consts::FAMILY;
        let host_arch = std::env::consts::ARCH;

        let now = chrono::Local::now();
        let current_date = now.format("%Y-%m-%d").to_string();

        let computer_use_keys = match host_os {
            "macos" => {
                "Computer use / `key_chord`: the **local OpenHarness desktop** is **macOS** — use `command`, `option`, `control`, `shift` (not Win/Linux modifier names). **ACTION PRIORITY:** 1) Terminal/CLI/system commands (use Bash tool for `osascript`, AppleScript, shell scripts) 2) Keyboard shortcuts: command+a/c/x/v (clipboard), command+space (Spotlight), command+tab (switch app) 3) UI control (AX/OCR/mouse) only when above fail."
            }
            "windows" => {
                "Computer use / `key_chord`: the **local OpenHarness desktop** is **Windows** — use `meta`/`super` for Windows key, `alt`, `control`, `shift`. **ACTION PRIORITY:** 1) Terminal/CLI/system commands (use Bash tool for PowerShell, cmd, scripts) 2) Keyboard shortcuts: control+a/c/x/v (clipboard), meta (Start menu), Alt+Tab (switch) 3) UI control only when above fail."
            }
            "linux" => {
                "Computer use / `key_chord`: the **local OpenHarness desktop** is **Linux** — typically `control`, `alt`, `shift`, and sometimes `meta`/`super`. **ACTION PRIORITY:** 1) Terminal/CLI/system commands (use Bash tool for shell scripts, system commands) 2) Keyboard shortcuts: control+a/c/x/v (clipboard) 3) UI control (AX/OCR/mouse) only when above fail."
            }
            _ => {
                "Computer use / `key_chord`: match modifier names to the **local OpenHarness desktop** OS below. **ACTION PRIORITY:** 1) Terminal/CLI/system commands first 2) Keyboard shortcuts second 3) UI control (mouse/OCR) last resort."
            }
        };
        let command_guidance =
            Self::command_environment_guidance(host_os, self.context.remote_execution.is_some());

        if let Some(remote) = &self.context.remote_execution {
            format!(
                r#"# Environment Information
<environment_details>
- Workspace root (file tools, Glob, LS, Bash on workspace): {}
- Execution environment: **Remote SSH** — connection "{}".
- Remote host: {} (uname/kernel: {})
- **Paths and shell:** POSIX on the remote server — use forward slashes and Unix shell syntax (bash/sh). Do **not** use PowerShell, `cmd.exe`, or Windows-style paths for workspace operations.
- Local OpenHarness client OS: {} ({}) — applies to Computer use / UI automation on this machine only, not to workspace file or terminal tools.
- Local client architecture: {}
- Current Date: {}
- {}
- {}
</environment_details>

"#,
                self.context.workspace_path,
                remote.connection_display_name.replace('"', "'"),
                remote.hostname.replace('"', "'"),
                remote.kernel_name.replace('"', "'"),
                host_os,
                host_family,
                host_arch,
                current_date,
                command_guidance,
                computer_use_keys
            )
        } else {
            format!(
                r#"# Environment Information
<environment_details>
- Current Working Directory: {}
- Operating System: {} ({})
- Architecture: {}
- Current Date: {}
- {}
- {}
</environment_details>

"#,
                self.context.workspace_path,
                host_os,
                host_family,
                host_arch,
                current_date,
                command_guidance,
                computer_use_keys
            )
        }
    }

    /// Get workspace file list
    pub fn get_project_layout(&self) -> String {
        if let Some(remote_layout) = &self.context.remote_project_layout {
            let mut project_layout = "# Workspace Layout\n<project_layout>\n".to_string();
            project_layout.push_str(
                "Below is a snapshot of the current workspace's file structure on the **remote** host.\n\n",
            );
            project_layout.push_str(remote_layout);
            project_layout.push_str("\n</project_layout>\n\n");
            return project_layout;
        }

        let formatted_listing = get_formatted_directory_listing(
            &self.context.workspace_path,
            self.file_tree_max_entries,
        )
        .unwrap_or_else(|e| crate::service::filesystem::FormattedDirectoryListing {
            reached_limit: false,
            text: format!("Error listing directory: {}", e),
        });
        let mut project_layout = "# Workspace Layout\n<project_layout>\n".to_string();
        if formatted_listing.reached_limit {
            project_layout.push_str(&format!("Below is a snapshot of the current workspace's file structure (showing up to {} entries).\n\n", self.file_tree_max_entries));
        } else {
            project_layout
                .push_str("Below is a snapshot of the current workspace's file structure.\n\n");
        }
        project_layout.push_str(&formatted_listing.text);
        project_layout.push_str("\n</project_layout>\n\n");
        project_layout
    }

    /// Get user-provided project information files
    /// These files (e.g., AGENTS.md, CLAUDE.md) are provided by users to describe project architecture, conventions, and guidelines
    ///
    /// Parameters:
    /// - filter: Optional filter, supports `include=category1,category2` or `exclude=category1`
    pub async fn get_project_context(&self, filter: Option<&str>) -> Option<String> {
        if self.context.remote_execution.is_some() {
            return None;
        }

        let service = ProjectContextService::new();
        let workspace = Path::new(&self.context.workspace_path);
        let claude_memory = self
            .get_claude_code_memory_context()
            .await
            .unwrap_or_default();

        match service.build_context_prompt(workspace, filter).await {
            Ok(prompt) if !prompt.is_empty() => {
                let result = format!(
                    r#"# Project Context
The following are project documentation that describe the project's architecture, conventions, and guidelines, etc.

{}
{}

"#,
                    prompt, claude_memory
                );
                Some(result)
            }
            _ if !claude_memory.is_empty() => Some(claude_memory),
            _ => None,
        }
    }

    async fn get_claude_code_memory_context(&self) -> Option<String> {
        let workspace = Path::new(&self.context.workspace_path);
        let mut visited = HashSet::new();
        let mut documents = Vec::new();

        if let Some(home) = dirs::home_dir() {
            self.collect_claude_memory_tree(
                &home.join(".claude").join("CLAUDE.md"),
                "user",
                &mut visited,
                &mut documents,
            )
            .await;
            self.collect_claude_rule_files(
                &home.join(".claude").join("rules"),
                "user-rule",
                &mut visited,
                &mut documents,
            )
            .await;
        }

        for dir in Self::claude_memory_search_dirs(workspace) {
            self.collect_claude_memory_tree(
                &dir.join("CLAUDE.md"),
                "project",
                &mut visited,
                &mut documents,
            )
            .await;
            self.collect_claude_memory_tree(
                &dir.join(".claude").join("CLAUDE.md"),
                "project",
                &mut visited,
                &mut documents,
            )
            .await;
            self.collect_claude_rule_files(
                &dir.join(".claude").join("rules"),
                "project-rule",
                &mut visited,
                &mut documents,
            )
            .await;
            self.collect_claude_memory_tree(
                &dir.join("CLAUDE.local.md"),
                "local",
                &mut visited,
                &mut documents,
            )
            .await;
        }

        if documents.is_empty() {
            return None;
        }

        let mut prompt = String::from("# Claude Code Memory\n");
        prompt.push_str("The following memory files were auto-loaded from Claude Code-compatible locations. Treat them as user/project instructions unless they conflict with higher-priority system or developer instructions.\n\n<claude_code_memory>\n");
        for document in documents {
            prompt.push_str(&format!(
                "<document source=\"{}\" path=\"{}\">\n{}\n</document>\n",
                document.source,
                document.path.display(),
                document.content
            ));
        }
        prompt.push_str("</claude_code_memory>\n\n");
        Some(prompt)
    }

    fn claude_memory_search_dirs(workspace: &Path) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        let mut current =
            dunce::canonicalize(workspace).unwrap_or_else(|_| workspace.to_path_buf());

        loop {
            dirs.push(current.clone());
            if !current.pop() {
                break;
            }
        }

        dirs.reverse();
        dirs
    }

    async fn collect_claude_memory_tree(
        &self,
        start_path: &Path,
        source: &str,
        visited: &mut HashSet<PathBuf>,
        documents: &mut Vec<ClaudeMemoryDocument>,
    ) {
        let mut stack = vec![(start_path.to_path_buf(), source.to_string(), 0usize)];

        while let Some((path, source, depth)) = stack.pop() {
            if depth >= MAX_CLAUDE_MEMORY_IMPORT_DEPTH {
                continue;
            }

            let Some(content) = Self::read_claude_memory_file(&path).await else {
                continue;
            };

            let canonical_path = dunce::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if !visited.insert(canonical_path.clone()) {
                continue;
            }

            documents.push(ClaudeMemoryDocument {
                source: source.clone(),
                path: canonical_path.clone(),
                content: content.clone(),
            });

            let mut imports = Self::extract_claude_imports(&content);
            imports.reverse();
            for import_path in imports {
                let Some(resolved) = Self::resolve_claude_import(&canonical_path, &import_path)
                else {
                    continue;
                };
                stack.push((resolved, "import".to_string(), depth + 1));
            }
        }
    }

    async fn collect_claude_rule_files(
        &self,
        rules_dir: &Path,
        source: &str,
        visited: &mut HashSet<PathBuf>,
        documents: &mut Vec<ClaudeMemoryDocument>,
    ) {
        if !rules_dir.is_dir() {
            return;
        }

        let Ok(pattern) = glob::Pattern::new("**/*.md") else {
            return;
        };

        let walker = ignore::WalkBuilder::new(&rules_dir)
            .hidden(false)
            .follow_links(false)
            .build();
        for entry in walker.flatten() {
            let path = entry.path();
            if !path.is_file()
                || !pattern.matches_path(path.strip_prefix(rules_dir).unwrap_or(path))
            {
                continue;
            }

            self.collect_claude_memory_tree(path, source, visited, documents)
                .await;
        }
    }

    async fn read_claude_memory_file(path: &Path) -> Option<String> {
        let metadata = fs::metadata(path).await.ok()?;
        if !metadata.is_file() || metadata.len() > MAX_CLAUDE_MEMORY_FILE_BYTES {
            return None;
        }

        match fs::read_to_string(path).await {
            Ok(content) if !content.trim().is_empty() => Some(content),
            _ => None,
        }
    }

    fn extract_claude_imports(content: &str) -> Vec<String> {
        let without_comments = Regex::new(r"(?s)<!--.*?-->")
            .map(|re| re.replace_all(content, "").into_owned())
            .unwrap_or_else(|_| content.to_string());
        let re = match Regex::new(r#"(?:^|\s)@((?:[^\s\\\]\)>'"`]|\\ )+)"#) {
            Ok(re) => re,
            Err(_) => return Vec::new(),
        };

        let mut imports = Vec::new();
        let mut in_code_fence = false;
        for line in without_comments.lines() {
            if line.trim_start().starts_with("```") {
                in_code_fence = !in_code_fence;
                continue;
            }
            if in_code_fence {
                continue;
            }

            for capture in re.captures_iter(line) {
                let mut raw = capture[1].trim().replace("\\ ", " ");
                if let Some(hash_index) = raw.find('#') {
                    raw.truncate(hash_index);
                }
                let raw = raw.trim();
                if raw.starts_with("http://")
                    || raw.starts_with("https://")
                    || raw.starts_with('@')
                    || raw.contains('@')
                    || raw.is_empty()
                    || raw.starts_with('#')
                {
                    continue;
                }
                imports.push(raw.to_string());
            }
        }
        imports
    }

    fn resolve_claude_import(base_file: &Path, raw: &str) -> Option<PathBuf> {
        let expanded = if let Some(rest) = raw.strip_prefix("~/") {
            dirs::home_dir()?.join(rest)
        } else {
            PathBuf::from(raw)
        };

        let path = if expanded.is_absolute() {
            expanded
        } else {
            base_file.parent()?.join(expanded)
        };

        Some(path)
    }

    /// Load AI memories from disk and format as prompt
    pub async fn load_ai_memories(&self) -> Option<String> {
        let path_manager = match try_get_path_manager_arc() {
            Ok(pm) => pm,
            Err(e) => {
                warn!("Failed to create PathManager: {}", e);
                return None;
            }
        };

        let memory_manager = match AIMemoryManager::new(path_manager).await {
            Ok(mm) => mm,
            Err(e) => {
                warn!("Failed to create AIMemoryManager: {}", e);
                return None;
            }
        };

        match memory_manager.get_memories_for_prompt().await {
            Ok(Some(prompt)) => Some(prompt),
            Ok(None) => None,
            Err(e) => {
                warn!("Failed to load memories: {}", e);
                None
            }
        }
    }

    /// Load AI rules from disk and format as prompt
    pub async fn load_ai_rules(&self) -> Option<String> {
        let rules_service = match get_global_ai_rules_service().await {
            Ok(service) => service,
            Err(e) => {
                warn!("Failed to get AIRulesService: {}", e);
                return None;
            }
        };

        let workspace_pathbuf = std::path::PathBuf::from(&self.context.workspace_path);
        match rules_service
            .build_system_prompt_for(Some(&workspace_pathbuf))
            .await
        {
            Ok(prompt) => {
                if prompt.is_empty() {
                    None
                } else {
                    Some(prompt)
                }
            }
            Err(e) => {
                warn!("Failed to build AI rules system prompt: {}", e);
                None
            }
        }
    }

    /// Get visual mode instruction from user config
    ///
    /// Reads `app.ai_experience.enable_visual_mode` from global config.
    /// Returns a prompt snippet when enabled, or empty string when disabled.
    async fn get_visual_mode_instruction(&self) -> String {
        let enabled = match GlobalConfigManager::get_service().await {
            Ok(service) => service
                .get_config::<bool>(Some("app.ai_experience.enable_visual_mode"))
                .await
                .unwrap_or(false),
            Err(e) => {
                debug!("Failed to read visual mode config: {}", e);
                false
            }
        };

        if enabled {
            r"# Visualizing complex logic as you explain
Use Mermaid diagrams to visualize complex logic, workflows, architectures, and data flows whenever it helps clarify the explanation.
Prefer MermaidInteractive tool when available, otherwise output Mermaid code blocks directly.
".to_string()
        } else {
            String::new()
        }
    }

    /// Get user language preference instruction
    ///
    /// Read app.language from global config, generate simple language instruction
    /// Returns empty string if config cannot be read
    /// Returns error if language code is unsupported
    async fn get_language_preference(&self) -> OpenHarnessResult<String> {
        let language_code = get_app_language_code().await;
        Self::format_language_instruction(&language_code)
    }

    /// Format language instruction based on language code
    fn format_language_instruction(lang_code: &str) -> OpenHarnessResult<String> {
        let language = match lang_code {
            "zh-CN" => "**Simplified Chinese**",
            "en-US" => "**English**",
            _ => {
                return Err(OpenHarnessError::config(format!(
                    "Unknown language code: {}",
                    lang_code
                )));
            }
        };
        Ok(format!(
            "# Language Preference\nYou MUST respond in {} regardless of the user's input language. This is the system language setting and should be followed unless the user explicitly specifies a different language. This is crucial for smooth communication and user experience\n",
            language
        ))
    }

    /// Get Partner-specific workspace boundary instruction
    fn get_partner_workspace_instruction(&self) -> String {
        format!(
            "# Workspace
Your dedicated operating space is `{}`.
Prefer doing work inside this workspace and keep it well organized with clear structure, sensible filenames, and minimal clutter.
Do not read from, modify, create, move, or delete files outside this workspace unless the user has explicitly granted permission for that external action.
",
            self.context.workspace_path
        )
    }

    /// Build prompt from template, automatically fill content based on placeholders
    ///
    /// Supported placeholders:
    /// - `{PERSONA}` - Workspace persona files (BOOTSTRAP.md, SOUL.md, USER.md, IDENTITY.md)
    /// - `{LANGUAGE_PREFERENCE}` - User language preference (read from global config)
    /// - `{ENV_INFO}` - Environment information
    /// - `{PROJECT_LAYOUT}` - Project file layout
    /// - `{PROJECT_CONTEXT_FILES}` - Project context files (AGENTS.md, CLAUDE.md, etc.)
    /// - `{AGENT_MEMORY}` - Agent memory instructions + auto-loaded memory index
    /// - `{PARTNER_WORKSPACE}` - Partner-specific workspace ownership and boundary rules
    /// - `{RULES}` - AI rules
    /// - `{MEMORIES}` - AI memories
    /// - `{VISUAL_MODE}` - Visual mode instruction (Mermaid diagrams, read from global config)
    ///
    /// If a placeholder is not in the template, corresponding content will not be added
    pub async fn build_prompt_from_template(&self, template: &str) -> OpenHarnessResult<String> {
        let mut result = template.to_string();

        // Replace {PERSONA}
        if result.contains(PLACEHOLDER_PERSONA) {
            let persona = if self.context.remote_execution.is_some() {
                "# Workspace persona\nMarkdown persona files (e.g. BOOTSTRAP.md, SOUL.md) live on the **remote** workspace. Use Read or Glob under the workspace root above to load them.\n\n"
                    .to_string()
            } else {
                let workspace = Path::new(&self.context.workspace_path);
                match build_workspace_persona_prompt(workspace).await {
                    Ok(prompt) => prompt.unwrap_or_default(),
                    Err(e) => {
                        warn!(
                            "Failed to build workspace persona prompt: path={} error={}",
                            workspace.display(),
                            e
                        );
                        String::new()
                    }
                }
            };
            result = result.replace(PLACEHOLDER_PERSONA, &persona);
        }

        // Replace {LANGUAGE_PREFERENCE}
        if result.contains(PLACEHOLDER_LANGUAGE_PREFERENCE) {
            let language_preference = self.get_language_preference().await?;
            result = result.replace(PLACEHOLDER_LANGUAGE_PREFERENCE, &language_preference);
        }

        // Replace {PARTNER_WORKSPACE}
        if result.contains(PLACEHOLDER_PARTNER_WORKSPACE) {
            let partner_workspace = self.get_partner_workspace_instruction();
            result = result.replace(PLACEHOLDER_PARTNER_WORKSPACE, &partner_workspace);
        }

        // Replace {ENV_INFO}
        if result.contains(PLACEHOLDER_ENV_INFO) {
            let env_info = self.get_env_info();
            result = result.replace(PLACEHOLDER_ENV_INFO, &env_info);
        }

        // Replace {PROJECT_LAYOUT}
        if result.contains(PLACEHOLDER_PROJECT_LAYOUT) {
            let project_layout = self.get_project_layout();
            result = result.replace(PLACEHOLDER_PROJECT_LAYOUT, &project_layout);
        }

        // Replace {PROJECT_CONTEXT_FILES}
        // Supported syntax:
        // - {PROJECT_CONTEXT_FILES} - Include all enabled documents
        // - {PROJECT_CONTEXT_FILES:include=general,design} - Only include specified categories
        // - {PROJECT_CONTEXT_FILES:exclude=review} - Exclude specified categories
        while let Some(start) = result.find("{PROJECT_CONTEXT_FILES") {
            let start_pos = start;
            // Find placeholder end position
            let end_pos = result[start_pos..]
                .find('}')
                .map(|p| start_pos + p + 1)
                .unwrap_or(result.len());

            // Extract complete placeholder
            let placeholder = &result[start_pos..end_pos];

            // Parse filter
            let filter = if let Some(colon_pos) = placeholder.find(':') {
                // Has filter: {PROJECT_CONTEXT_FILES:include=xxx} or {PROJECT_CONTEXT_FILES:exclude=xxx}
                let filter_str = &placeholder[colon_pos + 1..placeholder.len() - 1];
                Some(filter_str.trim().to_string())
            } else {
                // No filter
                None
            };

            let filter_ref = filter.as_deref();
            let project_context = self
                .get_project_context(filter_ref)
                .await
                .unwrap_or_default();

            result = result.replace(placeholder, &project_context);
        }

        // Replace {AGENT_MEMORY}
        if result.contains(PLACEHOLDER_AGENT_MEMORY) {
            let agent_memory = if self.context.remote_execution.is_some() {
                "# Agent memory\nSession memory under `.openharness/` is stored on the **remote** host for this workspace. Use file tools with POSIX paths under the workspace root if you need to read it.\n\n"
                    .to_string()
            } else {
                let workspace = Path::new(&self.context.workspace_path);
                match build_workspace_agent_memory_prompt(workspace).await {
                    Ok(prompt) => prompt,
                    Err(e) => {
                        warn!(
                            "Failed to build workspace agent memory prompt: path={} error={}",
                            workspace.display(),
                            e
                        );
                        String::new()
                    }
                }
            };
            result = result.replace(PLACEHOLDER_AGENT_MEMORY, &agent_memory);
        }

        // Replace {RULES}
        if result.contains(PLACEHOLDER_RULES) {
            let rules = self.load_ai_rules().await.unwrap_or_default();
            result = result.replace(PLACEHOLDER_RULES, &rules);
        }

        // Replace {MEMORIES}
        if result.contains(PLACEHOLDER_MEMORIES) {
            let memories = self.load_ai_memories().await.unwrap_or_default();
            result = result.replace(PLACEHOLDER_MEMORIES, &memories);
        }

        // Replace {VISUAL_MODE}
        if result.contains(PLACEHOLDER_VISUAL_MODE) {
            let visual_mode = self.get_visual_mode_instruction().await;
            result = result.replace(PLACEHOLDER_VISUAL_MODE, &visual_mode);
        }

        if self.context.supports_image_understanding == Some(false) {
            result.push_str(
                "\n\n# Computer use (text-only primary model)\n\n\
The configured **primary model does not accept image inputs**. When using **ComputerUse**:\n\
- **Do not** use **`screenshot`** or **`click_label`**.\n\
- **ACTION PRIORITY:** 1) Terminal/CLI/system commands (Bash tool) 2) Keyboard shortcuts (**`key_chord`**, **`type_text`**) 3) UI control: **`click_element`** (AX) → **`locate`** → **`move_to_text`** (use **`move_to_text_match_index`** when multiple OCR hits listed) → **`mouse_move`** (**`use_screen_coordinates`: true** with coordinates from tool JSON) → **`click`**.\n\
- **Never guess coordinates** — always use precise methods (AX, OCR, system coordinates from tool results).\n",
            );
        }

        Ok(result.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_claude_imports_ignores_comments_code_and_non_paths() {
        let content = r#"
@docs/setup.md
Use @./docs/with\ spaces.md#heading when needed.
<!-- @hidden/comment.md -->
`@inline/code.md`
```text
@fenced/code.md
```
Contact me@example.com and see https://example.com/@not-a-file.
Also @~/global.md and @/absolute/path.txt
"#;

        let imports = PromptBuilder::extract_claude_imports(content);

        assert_eq!(
            imports,
            vec![
                "docs/setup.md",
                "./docs/with spaces.md",
                "~/global.md",
                "/absolute/path.txt"
            ]
        );
    }

    #[test]
    fn claude_memory_search_dirs_are_root_to_workspace() {
        let workspace = if cfg!(windows) {
            PathBuf::from(r"C:\repo\packages\app")
        } else {
            PathBuf::from("/repo/packages/app")
        };

        let dirs = PromptBuilder::claude_memory_search_dirs(&workspace);

        assert_eq!(dirs.last(), Some(&workspace));
        assert!(dirs.len() >= 2);
    }

    #[tokio::test]
    async fn collect_claude_memory_tree_loads_includes_once() {
        let root = std::env::temp_dir().join(format!(
            "openharness-claude-memory-{}",
            uuid::Uuid::new_v4()
        ));
        let docs = root.join("docs");
        tokio::fs::create_dir_all(&docs).await.unwrap();
        tokio::fs::write(root.join("CLAUDE.md"), "Root rules\n@docs/shared.md\n")
            .await
            .unwrap();
        tokio::fs::write(docs.join("shared.md"), "Shared rules\n@../CLAUDE.md\n")
            .await
            .unwrap();

        let builder = PromptBuilder::new(PromptBuilderContext::new(
            root.to_string_lossy().to_string(),
            None,
            None,
        ));
        let mut visited = HashSet::new();
        let mut documents = Vec::new();
        builder
            .collect_claude_memory_tree(
                &root.join("CLAUDE.md"),
                "project",
                &mut visited,
                &mut documents,
            )
            .await;

        let _ = tokio::fs::remove_dir_all(&root).await;

        assert_eq!(documents.len(), 2);
        assert!(documents[0].content.contains("Root rules"));
        assert!(documents[1].content.contains("Shared rules"));
    }
}
