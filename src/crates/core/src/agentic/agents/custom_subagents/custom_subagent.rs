use crate::agentic::agents::Agent;
use crate::agentic::agents::{
    AgentDefinition, AgentHookConfig, AgentMemoryConfig, AgentMode, PermissionMode, PromptBuilder,
    PromptBuilderContext,
};
use crate::agentic::runtime::workspace_binding::WorkspaceIsolation;
use crate::util::errors::{OpenHarnessError, OpenHarnessResult};
use crate::util::FrontMatterMarkdown;
use async_trait::async_trait;
use serde_yaml::Value;
use std::collections::HashSet;
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
    pub skills: Vec<String>,
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

        let prompt = prompt_builder
            .build_prompt_from_template(&self.prompt)
            .await?;

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
            skills: Vec::new(),
            memory: AgentMemoryConfig::default(),
            hooks: AgentHookConfig::default(),
            isolation: WorkspaceIsolation::None,
            cwd: None,
        }
    }

    fn parse_string_list(value: Option<&Value>) -> Option<Vec<String>> {
        value.and_then(Self::parse_string_list_value)
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

        let parse = |key: &str| {
            mapping
                .get(Value::String(key.to_string()))
                .and_then(Self::parse_string_list_value)
                .unwrap_or_default()
        };

        AgentHookConfig {
            before_agent_start: parse("before_agent_start"),
            before_model_request: parse("before_model_request"),
            before_tool_call: parse("before_tool_call"),
            after_tool_result: parse("after_tool_result"),
            before_agent_finish: parse("before_agent_finish"),
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

        let mut tools = Self::parse_string_list(metadata.get("tools"))
            .unwrap_or_else(|| Self::DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect());
        let mut allowed_tools =
            Self::parse_string_list(metadata.get("allowed_tools")).unwrap_or_else(|| tools.clone());
        let disallowed_tools =
            Self::parse_string_list(metadata.get("disallowed_tools")).unwrap_or_default();

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
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        let permission_mode = metadata
            .get("permission_mode")
            .and_then(|v| v.as_str())
            .map(PermissionMode::from_str)
            .unwrap_or_default();

        let mcp_servers = Self::parse_string_list(metadata.get("mcp_servers")).unwrap_or_default();
        let skills = Self::parse_string_list(metadata.get("skills")).unwrap_or_default();
        let memory = Self::parse_memory_config(metadata.get("memory"));
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
            skills,
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
            skills: self.skills.clone(),
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
