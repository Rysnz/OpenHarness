//! MiniApp data contracts for ESM UI assets, Node workers, and runtime permissions.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsmDep {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NpmDep {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MiniAppSource {
    pub html: String,
    pub css: String,
    #[serde(rename = "ui_js")]
    pub ui_js: String,
    #[serde(default, rename = "esm_dependencies")]
    pub esm_dependencies: Vec<EsmDep>,
    #[serde(rename = "worker_js")]
    pub worker_js: String,
    #[serde(default, rename = "npm_dependencies")]
    pub npm_dependencies: Vec<NpmDep>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MiniAppPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<FsPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<ShellPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net: Option<NetPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<NodePermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiPermissions>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FsPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShellPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodePermissions {
    #[serde(default = "default_node_enabled")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

fn default_node_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiPermissions {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_models: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens_per_request: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_per_minute: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MiniAppAiContext {
    pub original_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub iteration_history: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MiniAppRuntimeState {
    pub source_revision: String,
    pub deps_revision: String,
    pub deps_dirty: bool,
    pub worker_restart_required: bool,
    pub ui_recompile_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub source: MiniAppSource,
    pub compiled_html: String,
    #[serde(default)]
    pub permissions: MiniAppPermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<MiniAppAiContext>,
    #[serde(default)]
    pub runtime: MiniAppRuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniAppMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub permissions: MiniAppPermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<MiniAppAiContext>,
    #[serde(default)]
    pub runtime: MiniAppRuntimeState,
}

impl MiniApp {
    pub fn metadata(&self) -> MiniAppMeta {
        MiniAppMeta::from_app(self)
    }
}

impl MiniAppMeta {
    pub fn from_app(app: &MiniApp) -> Self {
        Self {
            id: app.id.clone(),
            name: app.name.clone(),
            description: app.description.clone(),
            icon: app.icon.clone(),
            category: app.category.clone(),
            tags: app.tags.clone(),
            version: app.version,
            created_at: app.created_at,
            updated_at: app.updated_at,
            permissions: app.permissions.clone(),
            ai_context: app.ai_context.clone(),
            runtime: app.runtime.clone(),
        }
    }
}

impl From<&MiniApp> for MiniAppMeta {
    fn from(app: &MiniApp) -> Self {
        app.metadata()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathScope {
    AppData,
    Workspace,
    UserSelected,
    Home,
    Custom(Vec<PathBuf>),
}

impl PathScope {
    pub fn from_manifest_value(value: &str) -> Self {
        match value {
            "{appdata}" => Self::AppData,
            "{workspace}" => Self::Workspace,
            "{user-selected}" => Self::UserSelected,
            "{home}" => Self::Home,
            _ => Self::custom(value),
        }
    }

    pub fn custom(path: impl Into<PathBuf>) -> Self {
        Self::Custom(vec![path.into()])
    }
}
