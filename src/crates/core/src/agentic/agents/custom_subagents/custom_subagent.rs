use crate::agentic::agents::Agent;
use crate::agentic::agents::{
    AgentDefinition, AgentHookConfig, AgentMemoryConfig, AgentMode, PermissionMode, PromptBuilder,
    PromptBuilderContext,
};
use crate::agentic::runtime::workspace_binding::WorkspaceIsolation;
use crate::service::agent_memory::build_scoped_agent_memory_prompt;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use crate::util::FrontMatterMarkdown;
use async_trait::async_trait;
use serde_yaml::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

/// Subagent type: project-level or user-level
#[derive(Debug, Clone, Copy)]
pub enum CustomSubagentKind {
    /// Project subagent
    Project,
    /// User subagent
    User,
}

pub struct CustomSubagent {
    pub name: String,
    pub description: String,
    pub tools: Vec<String>,
    pub prompt: String,
    pub readonly: bool,
    pub path: String,
    pub kind: CustomSubagentKind,
    /// Whether this subagent is enabled, default true
    pub enabled: bool,
    /// Model ID to use, default "primary"
    pub model: String,
    pub mode: AgentMode,
    pub temperature: Option<f32>,
    pub max_turns: Option<u32>,
    pub permission_mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub mcp_servers: Vec<String>,
    /// Inline MCP server configs (server_id → raw JSON). Transient: connected at agent start.
    pub inline_mcp_servers: HashMap<String, serde_json::Value>,
    pub skills: Vec<String>,
    pub initial_prompt: Option<String>,
    pub background: bool,
    pub memory: AgentMemoryConfig,
    pub hooks: AgentHookConfig,
    pub isolation: WorkspaceIsolation,
    pub cwd: Option<PathBuf>,
}

#[async_trait]
impl Agent for CustomSubagent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        &self.name
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        ""
    }

    async fn build_prompt(&self, context: &PromptBuilderContext) -> OpenHarnessResult<String> {
        let prompt_builder = PromptBuilder::new(context.clone());

        let mut prompt = prompt_builder
            .build_prompt_from_template(&self.prompt)
            .await?;

        if self.memory.enabled && context.remote_execution.is_none() {
            let memory_scope = self.memory.profile.as_deref().unwrap_or("local");
            let workspace_root = PathBuf::from(&context.workspace_path);
            let agent_memory =
                build_scoped_agent_memory_prompt(&workspace_root, &self.name, memory_scope).await?;
            if !agent_memory.trim().is_empty() {
                prompt.push_str("\n\n");
                prompt.push_str(&agent_memory);
            }
        }

        Ok(prompt)
    }

    fn default_tools(&self) -> Vec<String> {
        self.effective_tools()
    }

    fn is_readonly(&self) -> bool {
        self.readonly
    }
}

impl CustomSubagent {
    pub fn new(
        name: String,
        description: String,
        tools: Vec<String>,
        prompt: String,
        readonly: bool,
        path: String,
        kind: CustomSubagentKind,
    ) -> Self {
        Self {
            name,
            description,
            allowed_tools: tools.clone(),
            disallowed_tools: Vec::new(),
            tools,
            prompt,
            readonly,
            path,
            kind,
            enabled: true,
            model: "primary".to_string(),
            mode: AgentMode::default(),
            temperature: None,
            max_turns: None,
            permission_mode: PermissionMode::default(),
            mcp_servers: Vec::new(),
            inline_mcp_servers: HashMap::new(),
            skills: Vec::new(),
            initial_prompt: None,
            background: false,
            memory: AgentMemoryConfig::default(),
            hooks: AgentHookConfig::default(),
            isolation: WorkspaceIsolation::None,
            cwd: None,
        }
    }

    fn parse_string_list(value: Option<&Value>) -> Option<Vec<String>> {
        value.and_then(Self::parse_string_list_value)
    }

    fn metadata_value<'a>(metadata: &'a Value, keys: &[&str]) -> Option<&'a Value> {
        keys.iter().find_map(|key| metadata.get(*key))
    }

    fn parse_string_list_value(value: &Value) -> Option<Vec<String>> {
        if let Some(raw) = value.as_str() {
            let list = raw
                .split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>();
            if !list.is_empty() {
                return Some(list);
            }
        }

        if let Some(raw) = value.as_sequence() {
            let list = raw
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>();
            if !list.is_empty() {
                return Some(list);
            }
        }

        None
    }

    fn parse_mcp_server_refs(value: Option<&Value>) -> Option<Vec<String>> {
        let value = value?;

        if value.as_str().is_some() {
            return Self::parse_string_list_value(value);
        }

        let mut refs = Vec::new();
        let collect_mapping_keys = |mapping: &serde_yaml::Mapping, refs: &mut Vec<String>| {
            for key in mapping.keys() {
                let Some(key) = key.as_str().map(str::trim).filter(|key| !key.is_empty()) else {
                    continue;
                };
                refs.push(key.to_string());
            }
        };

        if let Some(mapping) = value.as_mapping() {
            collect_mapping_keys(mapping, &mut refs);
        } else if let Some(items) = value.as_sequence() {
            for item in items {
                if let Some(name) = item.as_str().map(str::trim).filter(|name| !name.is_empty()) {
                    refs.push(name.to_string());
                } else if let Some(mapping) = item.as_mapping() {
                    collect_mapping_keys(mapping, &mut refs);
                }
            }
        }

        if refs.is_empty() {
            None
        } else {
            Some(refs)
        }
    }

    /// Parse inline MCP server configs from agent frontmatter.
    /// Returns a map of server_id → raw JSON config for entries that have inline config
    /// (i.e., mapping entries where the value is not just a string reference).
    fn parse_inline_mcp_server_configs(
        value: Option<&Value>,
    ) -> Option<std::collections::HashMap<String, serde_json::Value>> {
        let value = value?;
        let mut configs = std::collections::HashMap::new();

        let collect_mapping_configs =
            |mapping: &serde_yaml::Mapping,
             configs: &mut std::collections::HashMap<String, serde_json::Value>| {
                for (key, val) in mapping {
                    let Some(key) = key.as_str().map(str::trim).filter(|key| !key.is_empty()) else {
                        continue;
                    };
                    // Only collect if the value is a mapping (inline config), not a plain string
                    if val.is_mapping() || val.is_sequence() {
                        if let Ok(json_val) = serde_json::to_value(val) {
                            configs.insert(key.to_string(), json_val);
                        }
                    }
                }
            };

        if let Some(mapping) = value.as_mapping() {
            collect_mapping_configs(mapping, &mut configs);
        } else if let Some(items) = value.as_sequence() {
            for item in items {
                if item.as_str().is_some() {
                    // Plain string reference, skip
                    continue;
                } else if let Some(mapping) = item.as_mapping() {
                    collect_mapping_configs(mapping, &mut configs);
                }
            }
        }

        if configs.is_empty() {
            None
        } else {
            Some(configs)
        }
    }

    fn parse_memory_config(value: Option<&Value>) -> AgentMemoryConfig {
        let Some(value) = value else {
            return AgentMemoryConfig::default();
        };

        if let Some(enabled) = value.as_bool() {
            return AgentMemoryConfig {
                enabled,
                profile: None,
            };
        }

        if let Some(profile) = value.as_str() {
            return AgentMemoryConfig {
                enabled: true,
                profile: Some(profile.to_string()),
            };
        }

        if let Some(mapping) = value.as_mapping() {
            let enabled = mapping
                .get(Value::String("enabled".to_string()))
                .and_then(|item| item.as_bool())
                .unwrap_or(false);
            let profile = mapping
                .get(Value::String("profile".to_string()))
                .and_then(|item| item.as_str())
                .map(|item| item.to_string());

            return AgentMemoryConfig { enabled, profile };
        }

        AgentMemoryConfig::default()
    }

    fn parse_hook_config(value: Option<&Value>) -> AgentHookConfig {
        let Some(mapping) = value.and_then(|item| item.as_mapping()) else {
            return AgentHookConfig::default();
        };

        let parse_legacy = |key: &str| {
            mapping
                .get(Value::String(key.to_string()))
                .and_then(Self::parse_string_list_value)
                .unwrap_or_default()
        };

        let parse_claude_code_event = |event_names: &[&str]| {
            let mut hooks = Vec::new();
            for event_name in event_names {
                let Some(Value::Sequence(matchers)) =
                    mapping.get(Value::String((*event_name).into()))
                else {
                    continue;
                };

                for matcher_item in matchers {
                    let Some(matcher_mapping) = matcher_item.as_mapping() else {
                        continue;
                    };
                    let matcher = matcher_mapping
                        .get(Value::String("matcher".into()))
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .trim();
                    let Some(Value::Sequence(commands)) =
                        matcher_mapping.get(Value::String("hooks".into()))
                    else {
                        continue;
                    };

                    for command_item in commands {
                        let Some(command_mapping) = command_item.as_mapping() else {
                            continue;
                        };
                        let hook_type = command_mapping
                            .get(Value::String("type".into()))
                            .and_then(|value| value.as_str())
                            .unwrap_or("command");
                        let body = match hook_type {
                            "command" => command_mapping
                                .get(Value::String("command".into()))
                                .and_then(|value| value.as_str())
                                .map(|command| format!("shell:{}", command)),
                            "prompt" => command_mapping
                                .get(Value::String("prompt".into()))
                                .and_then(|value| value.as_str())
                                .map(|prompt| format!("prompt:{}", prompt)),
                            "http" => command_mapping
                                .get(Value::String("url".into()))
                                .and_then(|value| value.as_str())
                                .map(|url| format!("http:{}", url)),
                            "agent" => command_mapping
                                .get(Value::String("prompt".into()))
                                .and_then(|value| value.as_str())
                                .map(|prompt| format!("agent:{}", prompt)),
                            _ => None,
                        };

                        let Some(body) = body else {
                            continue;
                        };

                        if matcher.is_empty() {
                            hooks.push(body);
                        } else {
                            hooks.push(format!("matcher:{}\n{}", matcher, body));
                        }
                    }
                }
            }
            hooks
        };

        let mut before_agent_start = parse_legacy("before_agent_start");
        before_agent_start.extend(parse_claude_code_event(&["SessionStart", "SubagentStart"]));

        let mut before_model_request = parse_legacy("before_model_request");
        before_model_request.extend(parse_claude_code_event(&["UserPromptSubmit"]));

        let mut before_tool_call = parse_legacy("before_tool_call");
        before_tool_call.extend(parse_claude_code_event(&["PreToolUse"]));

        let mut after_tool_result = parse_legacy("after_tool_result");
        after_tool_result.extend(parse_claude_code_event(&[
            "PostToolUse",
            "PostToolUseFailure",
        ]));

        let mut before_agent_finish = parse_legacy("before_agent_finish");
        before_agent_finish.extend(parse_claude_code_event(&[
            "Stop",
            "StopFailure",
            "SubagentStop",
        ]));

        AgentHookConfig {
            before_agent_start,
            before_model_request,
            before_tool_call,
            after_tool_result,
            before_agent_finish,
        }
    }

    fn parse_isolation(value: Option<&Value>) -> WorkspaceIsolation {
        let Some(raw) = value.and_then(|item| item.as_str()) else {
            return WorkspaceIsolation::None;
        };

        match raw.trim().to_lowercase().as_str() {
            "none" => WorkspaceIsolation::None,
            "worktree" | "git_worktree" | "git-worktree" => WorkspaceIsolation::GitWorktree,
            "scratch" => WorkspaceIsolation::Scratch,
            _ => WorkspaceIsolation::None,
        }
    }

    fn parse_cwd(value: Option<&Value>) -> Option<PathBuf> {
        value
            .and_then(|item| item.as_str())
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .map(PathBuf::from)
    }

    fn with_deny_priority(allow: Vec<String>, deny: &[String]) -> Vec<String> {
        if allow.is_empty() {
            return Vec::new();
        }

        let deny_set: HashSet<&str> = deny.iter().map(String::as_str).collect();
        let mut dedupe = HashSet::new();

        allow
            .into_iter()
            .filter(|tool| !deny_set.contains(tool.as_str()))
            .filter(|tool| dedupe.insert(tool.clone()))
            .collect()
    }

    pub fn from_file(path: &str, kind: CustomSubagentKind) -> OpenHarnessResult<Self> {
        let (metadata, content) = FrontMatterMarkdown::load(path)?;
        let name = metadata
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| OpenHarnessError::Agent("Missing name field".to_string()))?
            .to_string();
        let description = metadata
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| OpenHarnessError::Agent("Missing description field".to_string()))?
            .to_string();

        let mut tools = Self::parse_string_list(Self::metadata_value(&metadata, &["tools"]))
            .unwrap_or_else(|| Self::DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect());
        let mut allowed_tools = Self::parse_string_list(Self::metadata_value(
            &metadata,
            &["allowed_tools", "allowedTools"],
        ))
        .unwrap_or_else(|| tools.clone());
        let disallowed_tools = Self::parse_string_list(Self::metadata_value(
            &metadata,
            &["disallowed_tools", "disallowedTools"],
        ))
        .unwrap_or_default();

        tools = Self::with_deny_priority(tools, &disallowed_tools);
        allowed_tools = Self::with_deny_priority(allowed_tools, &disallowed_tools);

        if tools.is_empty() && !allowed_tools.is_empty() {
            tools = allowed_tools.clone();
        }
        if allowed_tools.is_empty() {
            allowed_tools = tools.clone();
        }

        let readonly = metadata
            .get("readonly")
            .and_then(|v| v.as_bool())
            .unwrap_or(Self::DEFAULT_READONLY);

        let enabled = metadata
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(Self::DEFAULT_ENABLED);

        let model = metadata
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or(Self::DEFAULT_MODEL)
            .to_string();

        let mode = metadata
            .get("mode")
            .and_then(|v| v.as_str())
            .map(AgentMode::from_str)
            .unwrap_or_default();
        let temperature = metadata
            .get("temperature")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);
        let max_turns = metadata
            .get("max_turns")
            .or_else(|| metadata.get("maxTurns"))
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        let permission_mode = metadata
            .get("permission_mode")
            .or_else(|| metadata.get("permissionMode"))
            .and_then(|v| v.as_str())
            .map(PermissionMode::from_str)
            .unwrap_or_default();

        let mcp_servers = Self::parse_mcp_server_refs(Self::metadata_value(
            &metadata,
            &["mcp_servers", "mcpServers"],
        ))
        .unwrap_or_default();
        let inline_mcp_servers =
            Self::parse_inline_mcp_server_configs(Self::metadata_value(
                &metadata,
                &["mcp_servers", "mcpServers"],
            ))
            .unwrap_or_default();
        let skills = Self::parse_string_list(Self::metadata_value(&metadata, &["skills"]))
            .unwrap_or_default();
        let initial_prompt = Self::metadata_value(&metadata, &["initial_prompt", "initialPrompt"])
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let background = metadata
            .get("background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let memory = Self::parse_memory_config(Self::metadata_value(&metadata, &["memory"]));
        let hooks = Self::parse_hook_config(metadata.get("hooks"));
        let isolation = Self::parse_isolation(metadata.get("isolation"));
        let cwd = Self::parse_cwd(metadata.get("cwd"));

        Ok(Self {
            name,
            description,
            tools,
            prompt: content,
            readonly,
            path: path.to_string(),
            kind,
            enabled,
            model,
            mode,
            temperature,
            max_turns,
            permission_mode,
            allowed_tools,
            disallowed_tools,
            mcp_servers,
            inline_mcp_servers,
            skills,
            initial_prompt,
            background,
            memory,
            hooks,
            isolation,
            cwd,
        })
    }

    const DEFAULT_TOOLS: &'static [&'static str] = &["LS", "Read", "Glob", "Grep"];
    const DEFAULT_READONLY: bool = true;
    const DEFAULT_ENABLED: bool = true;
    const DEFAULT_MODEL: &'static str = "primary";

    /// Check if tools match default values
    fn is_default_tools(tools: &[String]) -> bool {
        if tools.len() != Self::DEFAULT_TOOLS.len() {
            return false;
        }
        tools
            .iter()
            .zip(Self::DEFAULT_TOOLS.iter())
            .all(|(a, b)| a == *b)
    }

    pub fn effective_tools(&self) -> Vec<String> {
        let mut tools = if self.allowed_tools.is_empty() {
            self.tools.clone()
        } else {
            self.allowed_tools.clone()
        };

        if tools.is_empty() {
            tools = self.tools.clone();
        }

        Self::with_deny_priority(tools, &self.disallowed_tools)
    }

    pub fn to_definition(&self) -> AgentDefinition {
        AgentDefinition {
            name: self.name.clone(),
            description: self.description.clone(),
            prompt: self.prompt.clone(),
            mode: self.mode.clone(),
            model: Some(self.model.clone()),
            temperature: self.temperature,
            max_turns: self.max_turns,
            permission_mode: self.permission_mode.clone(),
            allowed_tools: self.allowed_tools.clone(),
            disallowed_tools: self.disallowed_tools.clone(),
            mcp_servers: self.mcp_servers.clone(),
            inline_mcp_servers: self.inline_mcp_servers.clone(),
            skills: self.skills.clone(),
            initial_prompt: self.initial_prompt.clone(),
            background: self.background,
            memory: self.memory.clone(),
            hooks: self.hooks.clone(),
            isolation: self.isolation,
            cwd: self.cwd.clone(),
        }
    }

    fn put_list(metadata: &mut serde_yaml::Mapping, key: &str, values: &[String]) {
        if values.is_empty() {
            return;
        }

        metadata.insert(
            Value::String(key.to_string()),
            Value::Sequence(values.iter().cloned().map(Value::String).collect()),
        );
    }

    /// Save current subagent as markdown file with YAML front matter
    ///
    /// # Parameters
    /// - `enabled`: Override enabled value, None uses self.enabled
    /// - `model`: Override model value, None uses self.model
    ///
    /// Fields equal to default values are not saved
    pub fn save_to_file(
        &self,
        enabled: Option<bool>,
        model: Option<&str>,
    ) -> OpenHarnessResult<()> {
        let enabled = enabled.unwrap_or(self.enabled);
        let model = model.unwrap_or(&self.model);

        let mut metadata = serde_yaml::Mapping::new();
        metadata.insert(
            Value::String("name".into()),
            Value::String(self.name.clone()),
        );
        metadata.insert(
            Value::String("description".into()),
            Value::String(self.description.clone()),
        );

        if !Self::is_default_tools(&self.tools) {
            metadata.insert(
                Value::String("tools".into()),
                Value::String(self.tools.join(", ")),
            );
        }

        if !self.allowed_tools.is_empty() && self.allowed_tools != self.tools {
            Self::put_list(&mut metadata, "allowed_tools", &self.allowed_tools);
        }
        if !self.disallowed_tools.is_empty() {
            Self::put_list(&mut metadata, "disallowed_tools", &self.disallowed_tools);
        }
        if !self.mcp_servers.is_empty() {
            Self::put_list(&mut metadata, "mcp_servers", &self.mcp_servers);
        }
        if !self.skills.is_empty() {
            Self::put_list(&mut metadata, "skills", &self.skills);
        }
        if let Some(initial_prompt) = self
            .initial_prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            metadata.insert(
                Value::String("initial_prompt".into()),
                Value::String(initial_prompt.to_string()),
            );
        }
        if self.background {
            metadata.insert(Value::String("background".into()), Value::Bool(true));
        }

        if self.readonly != Self::DEFAULT_READONLY {
            metadata.insert(Value::String("readonly".into()), Value::Bool(self.readonly));
        }
        if enabled != Self::DEFAULT_ENABLED {
            metadata.insert(Value::String("enabled".into()), Value::Bool(enabled));
        }
        if model != Self::DEFAULT_MODEL {
            metadata.insert(
                Value::String("model".into()),
                Value::String(model.to_string()),
            );
        }

        if self.mode != AgentMode::default() {
            metadata.insert(
                Value::String("mode".into()),
                Value::String(self.mode.as_string()),
            );
        }

        if let Some(temperature) = self.temperature {
            metadata.insert(
                Value::String("temperature".into()),
                serde_yaml::to_value(temperature).unwrap_or(Value::Null),
            );
        }

        if let Some(max_turns) = self.max_turns {
            metadata.insert(
                Value::String("max_turns".into()),
                serde_yaml::to_value(max_turns).unwrap_or(Value::Null),
            );
        }

        if self.permission_mode != PermissionMode::default() {
            metadata.insert(
                Value::String("permission_mode".into()),
                Value::String(self.permission_mode.as_string()),
            );
        }

        if self.memory.enabled || self.memory.profile.is_some() {
            metadata.insert(
                Value::String("memory".into()),
                serde_yaml::to_value(&self.memory).unwrap_or(Value::Null),
            );
        }

        if !self.hooks.before_agent_start.is_empty()
            || !self.hooks.before_model_request.is_empty()
            || !self.hooks.before_tool_call.is_empty()
            || !self.hooks.after_tool_result.is_empty()
            || !self.hooks.before_agent_finish.is_empty()
        {
            metadata.insert(
                Value::String("hooks".into()),
                serde_yaml::to_value(&self.hooks).unwrap_or(Value::Null),
            );
        }

        if self.isolation != WorkspaceIsolation::None {
            let isolation = match self.isolation {
                WorkspaceIsolation::None => "none",
                WorkspaceIsolation::GitWorktree => "worktree",
                WorkspaceIsolation::Scratch => "scratch",
            };
            metadata.insert(
                Value::String("isolation".into()),
                Value::String(isolation.to_string()),
            );
        }

        if let Some(cwd) = &self.cwd {
            metadata.insert(
                Value::String("cwd".into()),
                Value::String(cwd.to_string_lossy().to_string()),
            );
        }

        let metadata = Value::Mapping(metadata);
        FrontMatterMarkdown::save(&self.path, &metadata, &self.prompt)
            .map_err(OpenHarnessError::Agent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_code_frontmatter_aliases() {
        let path = std::env::temp_dir().join(format!(
            "openharness-custom-agent-{}.md",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(
            &path,
            r#"---
name: reviewer
description: Reviews changes
tools: "*"
disallowedTools:
  - Bash
permissionMode: acceptEdits
maxTurns: 7
mcpServers:
  - github
  - localDocs:
      type: stdio
      command: docs-server
memory: project
initialPrompt: Read this before the task.
background: true
skills:
  - docs
hooks:
  PreToolUse:
    - matcher: Write|Edit
      hooks:
        - type: command
          command: echo pre-tool
---
Review carefully.
"#,
        )
        .unwrap();

        let agent = CustomSubagent::from_file(&path.to_string_lossy(), CustomSubagentKind::Project)
            .unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(agent.tools, vec!["*"]);
        assert_eq!(agent.allowed_tools, vec!["*"]);
        assert_eq!(agent.disallowed_tools, vec!["Bash"]);
        assert_eq!(agent.permission_mode, PermissionMode::Allow);
        assert_eq!(agent.max_turns, Some(7));
        assert_eq!(agent.mcp_servers, vec!["github", "localDocs"]);
        assert_eq!(agent.memory.enabled, true);
        assert_eq!(agent.memory.profile, Some("project".to_string()));
        assert_eq!(
            agent.initial_prompt,
            Some("Read this before the task.".to_string())
        );
        assert!(agent.background);
        assert_eq!(agent.skills, vec!["docs"]);
        assert_eq!(
            agent.hooks.before_tool_call,
            vec!["matcher:Write|Edit\nshell:echo pre-tool"]
        );
        assert_eq!(agent.prompt.trim(), "Review carefully.");
    }
}
