//! Unified path management module
//!
//! Provides unified management for all app storage paths, supporting user, project, and temporary levels

use crate::util::errors::*;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Storage level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StorageLevel {
    /// User: global configuration and data
    User,
    /// Project: configuration for a specific project
    Project,
    /// Session: temporary data for the current session
    Session,
    /// Temporary: cache that can be cleaned
    Temporary,
}

/// Cache type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CacheType {
    /// AI model cache
    Models,
    /// Vector embedding cache
    Embeddings,
    /// Git repository metadata cache
    Git,
    /// Code index cache
    Index,
}

/// Path manager
///
/// Manages all app storage paths consistently across platforms
#[derive(Debug, Clone)]
pub struct PathManager {
    /// User config root directory
    user_root: PathBuf,
}

impl PathManager {
    /// Create a new path manager
    pub fn new() -> OpenHarnessResult<Self> {
        let user_root = Self::get_user_config_root()?;

        Ok(Self { user_root })
    }

    /// Get user config root directory
    ///
    /// - Windows: %APPDATA%\OpenHarness\
    /// - macOS: ~/Library/Application Support/OpenHarness/
    /// - Linux: ~/.config/openharness/
    fn get_user_config_root() -> OpenHarnessResult<PathBuf> {
        let config_dir = dirs::config_dir().ok_or_else(|| {
            OpenHarnessError::config("Failed to get config directory".to_string())
        })?;

        Ok(config_dir.join("openharness"))
    }

    /// Get user config root directory
    pub fn user_root(&self) -> &Path {
        &self.user_root
    }

    /// Get partner home root directory: ~/.openharness/
    pub fn openharness_home_dir(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| self.user_root.clone())
            .join(".openharness")
    }

    /// Get the legacy partner workspace base directory: ~/.openharness/
    ///
    /// `override_root` is reserved for future user customization.
    pub fn legacy_partner_workspace_base_dir(&self, override_root: Option<&Path>) -> PathBuf {
        override_root
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.openharness_home_dir())
    }

    /// Get partner workspace base directory: ~/.openharness/partners/
    ///
    /// `override_root` is reserved for future user customization.
    pub fn partner_workspace_base_dir(&self, override_root: Option<&Path>) -> PathBuf {
        self.legacy_partner_workspace_base_dir(override_root)
            .join("partners")
    }

    /// Get the legacy default partner workspace directory: ~/.openharness/workspace
    pub fn legacy_default_partner_workspace_dir(&self, override_root: Option<&Path>) -> PathBuf {
        self.legacy_partner_workspace_base_dir(override_root)
            .join("workspace")
    }

    /// Get the default partner workspace directory: ~/.openharness/partners/workspace
    pub fn default_partner_workspace_dir(&self, override_root: Option<&Path>) -> PathBuf {
        self.partner_workspace_base_dir(override_root)
            .join("workspace")
    }

    /// Get a legacy named partner workspace directory: ~/.openharness/workspace-<id>
    pub fn legacy_partner_workspace_dir(
        &self,
        partner_id: &str,
        override_root: Option<&Path>,
    ) -> PathBuf {
        self.legacy_partner_workspace_base_dir(override_root)
            .join(format!("workspace-{}", partner_id))
    }

    /// Get a named partner workspace directory: ~/.openharness/partners/workspace-<id>
    pub fn partner_workspace_dir(&self, partner_id: &str, override_root: Option<&Path>) -> PathBuf {
        self.partner_workspace_base_dir(override_root)
            .join(format!("workspace-{}", partner_id))
    }

    /// Resolve partner workspace directory for default or named partner.
    pub fn resolve_partner_workspace_dir(
        &self,
        partner_id: Option<&str>,
        override_root: Option<&Path>,
    ) -> PathBuf {
        match partner_id {
            Some(id) if !id.trim().is_empty() => self.partner_workspace_dir(id, override_root),
            _ => self.default_partner_workspace_dir(override_root),
        }
    }

    /// True if `path` is this machine's OpenHarness **partner** workspace directory.
    ///
    /// Used so remote-workspace registry (especially roots like `/`) does not
    /// mis-classify client paths such as `/Users/.../.openharness/partners/workspace-*`
    /// as SSH remote paths.
    pub fn is_local_partner_workspace_path(&self, path: &str) -> bool {
        let p = Path::new(path);
        if !p.is_absolute() {
            return false;
        }
        if p.starts_with(self.partner_workspace_base_dir(None)) {
            return true;
        }
        if p.starts_with(self.default_partner_workspace_dir(None)) {
            return true;
        }
        if p.starts_with(self.legacy_default_partner_workspace_dir(None)) {
            return true;
        }
        let legacy_base = self.legacy_partner_workspace_base_dir(None);
        if let Ok(rest) = p.strip_prefix(&legacy_base) {
            if let Some(std::path::Component::Normal(first)) = rest.components().next() {
                let name = first.to_string_lossy();
                if name == "workspace" || name.starts_with("workspace-") {
                    return true;
                }
            }
        }
        false
    }

    /// Get user config directory: ~/.config/openharness/config/
    pub fn user_config_dir(&self) -> PathBuf {
        self.user_root.join("config")
    }

    /// Get app config file path: ~/.config/openharness/config/app.json
    pub fn app_config_file(&self) -> PathBuf {
        self.user_config_dir().join("app.json")
    }

    /// Get user agent directory: ~/.config/openharness/agents/
    pub fn user_agents_dir(&self) -> PathBuf {
        self.user_root.join("agents")
    }

    /// Get agent templates directory: ~/.config/openharness/agents/templates/
    pub fn agent_templates_dir(&self) -> PathBuf {
        self.user_agents_dir().join("templates")
    }

    /// Get user skills directory:
    /// - Windows: C:\Users\xxx\AppData\Roaming\OpenHarness\skills\
    /// - macOS: ~/Library/Application Support/OpenHarness/skills/
    /// - Linux: ~/.local/share/OpenHarness/skills/
    pub fn user_skills_dir(&self) -> PathBuf {
        if cfg!(target_os = "windows") {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
                .join("OpenHarness")
                .join("skills")
        } else if cfg!(target_os = "macos") {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join("Library")
                .join("Application Support")
                .join("OpenHarness")
                .join("skills")
        } else {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join("OpenHarness")
                .join("skills")
        }
    }

    /// Get workspaces directory: ~/.config/openharness/workspaces/
    pub fn workspaces_dir(&self) -> PathBuf {
        self.user_root.join("workspaces")
    }

    /// Get cache root directory: ~/.config/openharness/cache/
    pub fn cache_root(&self) -> PathBuf {
        self.user_root.join("cache")
    }

    /// Get managed runtimes root directory: ~/.config/openharness/runtimes/
    ///
    /// OpenHarness-managed runtime components (e.g. node/python/office) are stored here.
    pub fn managed_runtimes_dir(&self) -> PathBuf {
        self.user_root.join("runtimes")
    }

    /// Get cache directory for a specific type
    pub fn cache_dir(&self, cache_type: CacheType) -> PathBuf {
        let subdir = match cache_type {
            CacheType::Models => "models",
            CacheType::Embeddings => "embeddings",
            CacheType::Git => "git",
            CacheType::Index => "index",
        };
        self.cache_root().join(subdir)
    }

    /// Get user data directory: ~/.config/openharness/data/
    pub fn user_data_dir(&self) -> PathBuf {
        self.user_root.join("data")
    }

    /// Root directory for **local** persistence of SSH remote workspace sessions (chat history,
    /// session metadata, etc.). This is always on the client machine — never the remote POSIX path.
    ///
    /// **Canonical (all platforms):** [`Self::user_data_dir`]`/remote-workspaces/` — same tree as
    /// other OpenHarness app data (`PathManager::user_root` / `config_dir`/`openharness` on each OS).
    ///
    /// **Legacy:** Older builds used `{data_local_dir}/OpenHarness/remote-workspaces/`. If that folder
    /// exists and the canonical path does not, this returns the legacy path so existing installs
    /// keep working. On Windows this avoided splitting data between `AppData\Local\OpenHarness` and
    /// `AppData\Roaming\openharness`; new installs use the canonical Roaming `openharness\data` tree only.
    ///
    /// New remote session data should use [`Self::remote_ssh_mirror_root`] instead.
    pub fn remote_ssh_sessions_root() -> PathBuf {
        let legacy = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("OpenHarness")
            .join("remote-workspaces");

        let canonical = match Self::new() {
            Ok(pm) => pm.user_data_dir().join("remote-workspaces"),
            Err(_) => legacy.clone(),
        };

        let canonical_exists = canonical.exists();
        let legacy_exists = legacy.exists();

        if canonical_exists {
            canonical.clone()
        } else if legacy_exists {
            legacy.clone()
        } else {
            canonical.clone()
        }
    }

    /// Root for per-host, per-remote-path workspace mirrors: `~/.openharness/remote_ssh/`.
    ///
    /// Session/chat persistence for SSH workspaces lives under
    /// `{this}/{sanitized_host}/{remote_path_segments}/sessions/`.
    pub fn remote_ssh_mirror_root() -> PathBuf {
        Self::new()
            .map(|pm| pm.openharness_home_dir().join("remote_ssh"))
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".openharness")
                    .join("remote_ssh")
            })
    }

    /// Get scheduled jobs directory: ~/.config/openharness/data/cron/
    pub fn user_cron_dir(&self) -> PathBuf {
        self.user_data_dir().join("cron")
    }

    /// Get scheduled jobs persistence file: ~/.config/openharness/data/cron/jobs.json
    pub fn cron_jobs_file(&self) -> PathBuf {
        self.user_cron_dir().join("jobs.json")
    }

    /// Get miniapps root directory: ~/.config/openharness/data/miniapps/
    pub fn miniapps_dir(&self) -> PathBuf {
        self.user_data_dir().join("miniapps")
    }

    /// Get directory for a specific miniapp: ~/.config/openharness/data/miniapps/{app_id}/
    pub fn miniapp_dir(&self, app_id: &str) -> PathBuf {
        self.miniapps_dir().join(app_id)
    }

    /// Get user-level rules directory: ~/.config/openharness/data/rules/
    pub fn user_rules_dir(&self) -> PathBuf {
        self.user_data_dir().join("rules")
    }

    /// Get history directory: ~/.config/openharness/data/history/
    pub fn history_dir(&self) -> PathBuf {
        self.user_data_dir().join("history")
    }

    /// Get snippets directory: ~/.config/openharness/data/snippets/
    pub fn snippets_dir(&self) -> PathBuf {
        self.user_data_dir().join("snippets")
    }

    /// Get templates directory: ~/.config/openharness/data/templates/
    pub fn templates_dir(&self) -> PathBuf {
        self.user_data_dir().join("templates")
    }

    /// Get logs directory: ~/.config/openharness/logs/
    pub fn logs_dir(&self) -> PathBuf {
        self.user_root.join("logs")
    }

    /// Get backups directory: ~/.config/openharness/backups/
    pub fn backups_dir(&self) -> PathBuf {
        self.user_root.join("backups")
    }

    /// Get temp directory: ~/.config/openharness/temp/
    pub fn temp_dir(&self) -> PathBuf {
        self.user_root.join("temp")
    }

    /// Get project config root directory: {project}/.openharness/
    pub fn project_root(&self, workspace_path: &Path) -> PathBuf {
        workspace_path.join(".openharness")
    }

    /// Get project config file: {project}/.openharness/config.json
    pub fn project_config_file(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("config.json")
    }

    /// Get project internal config directory: {project}/.openharness/config/
    pub fn project_internal_config_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("config")
    }

    /// Get project mode skills file: {project}/.openharness/config/mode_skills.json
    pub fn project_mode_skills_file(&self, workspace_path: &Path) -> PathBuf {
        self.project_internal_config_dir(workspace_path)
            .join("mode_skills.json")
    }

    /// Get project .gitignore file: {project}/.openharness/.gitignore
    pub fn project_gitignore_file(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join(".gitignore")
    }

    /// Get project agent directory: {project}/.openharness/agents/
    pub fn project_agents_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("agents")
    }

    /// Get project-level rules directory: {project}/.openharness/rules/
    pub fn project_rules_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("rules")
    }

    /// Get project snapshots directory: {project}/.openharness/snapshots/
    pub fn project_snapshots_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("snapshots")
    }

    /// Get project sessions directory: {project}/.openharness/sessions/
    pub fn project_sessions_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("sessions")
    }

    /// Get project diffs cache directory: {project}/.openharness/diffs/
    pub fn project_diffs_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("diffs")
    }

    /// Get project checkpoints directory: {project}/.openharness/checkpoints/
    pub fn project_checkpoints_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("checkpoints")
    }

    /// Get project context directory: {project}/.openharness/context/
    pub fn project_context_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("context")
    }

    /// Get project local data directory: {project}/.openharness/local/
    pub fn project_local_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("local")
    }

    /// Get project local cache directory: {project}/.openharness/local/cache/
    pub fn project_cache_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_local_dir(workspace_path).join("cache")
    }

    /// Get project local logs directory: {project}/.openharness/local/logs/
    pub fn project_logs_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_local_dir(workspace_path).join("logs")
    }

    /// Get project local temp directory: {project}/.openharness/local/temp/
    pub fn project_temp_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_local_dir(workspace_path).join("temp")
    }

    /// Get project tasks directory: {project}/.openharness/tasks/
    pub fn project_tasks_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("tasks")
    }

    /// Get project plans directory: {project}/.openharness/plans/
    pub fn project_plans_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("plans")
    }

    /// Compute a hash of the workspace path (used for directory names)
    pub fn workspace_hash(workspace_path: &Path) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        workspace_path.to_string_lossy().hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// Ensure directory exists
    pub async fn ensure_dir(&self, path: &Path) -> OpenHarnessResult<()> {
        if !path.exists() {
            tokio::fs::create_dir_all(path).await.map_err(|e| {
                OpenHarnessError::service(format!("Failed to create directory {:?}: {}", path, e))
            })?;
        }
        Ok(())
    }

    /// Initialize user-level directory structure
    pub async fn initialize_user_directories(&self) -> OpenHarnessResult<()> {
        let dirs = vec![
            self.openharness_home_dir(),
            self.partner_workspace_base_dir(None),
            self.user_config_dir(),
            self.user_agents_dir(),
            self.agent_templates_dir(),
            self.workspaces_dir(),
            self.cache_root(),
            self.cache_dir(CacheType::Models),
            self.cache_dir(CacheType::Embeddings),
            self.cache_dir(CacheType::Git),
            self.cache_dir(CacheType::Index),
            self.user_data_dir(),
            self.user_cron_dir(),
            self.user_rules_dir(),
            self.history_dir(),
            self.snippets_dir(),
            self.templates_dir(),
            self.miniapps_dir(),
            self.logs_dir(),
            self.backups_dir(),
            self.temp_dir(),
        ];

        for dir in dirs {
            self.ensure_dir(&dir).await?;
        }

        debug!("User-level directories initialized");
        Ok(())
    }

    /// Initialize project-level directory structure
    pub async fn initialize_project_directories(
        &self,
        workspace_path: &Path,
    ) -> OpenHarnessResult<()> {
        let dirs = vec![
            self.project_root(workspace_path),
            self.project_internal_config_dir(workspace_path),
            self.project_agents_dir(workspace_path),
            self.project_rules_dir(workspace_path),
            self.project_snapshots_dir(workspace_path),
            self.project_sessions_dir(workspace_path),
            self.project_diffs_dir(workspace_path),
            self.project_checkpoints_dir(workspace_path),
            self.project_context_dir(workspace_path),
            self.project_local_dir(workspace_path),
            self.project_cache_dir(workspace_path),
            self.project_logs_dir(workspace_path),
            self.project_temp_dir(workspace_path),
            self.project_tasks_dir(workspace_path),
        ];

        for dir in dirs {
            self.ensure_dir(&dir).await?;
        }

        self.generate_project_gitignore(workspace_path).await?;

        debug!(
            "Project-level directories initialized for {:?}",
            workspace_path
        );
        Ok(())
    }

    /// Generate project-level .gitignore file
    async fn generate_project_gitignore(&self, workspace_path: &Path) -> OpenHarnessResult<()> {
        let gitignore_path = self.project_gitignore_file(workspace_path);

        if gitignore_path.exists() {
            return Ok(());
        }

        let content = r#"# OpenHarness local data (auto-generated)

# Snapshots and cache
snapshots/
diffs/
local/

# Personal sessions and checkpoints
sessions/
checkpoints/

# Logs and temporary files
*.log
temp/

# Note: The following files SHOULD be committed to version control
# config.json
# agents/
# context/
# tasks/
"#;

        tokio::fs::write(&gitignore_path, content)
            .await
            .map_err(|e| {
                OpenHarnessError::service(format!("Failed to create .gitignore: {}", e))
            })?;

        debug!("Generated .gitignore for project");
        Ok(())
    }
}

impl Default for PathManager {
    fn default() -> Self {
        match Self::new() {
            Ok(manager) => manager,
            Err(e) => {
                error!(
                    "Failed to create PathManager from system config directory, using temp fallback: {}",
                    e
                );
                Self {
                    user_root: std::env::temp_dir().join("openharness"),
                }
            }
        }
    }
}

use std::sync::OnceLock;

/// Global PathManager instance
static GLOBAL_PATH_MANAGER: OnceLock<Arc<PathManager>> = OnceLock::new();

fn init_global_path_manager() -> OpenHarnessResult<Arc<PathManager>> {
    PathManager::new().map(Arc::new)
}

/// Get the global PathManager instance (Arc)
///
/// Return a shared Arc to the global PathManager instance
pub fn get_path_manager_arc() -> Arc<PathManager> {
    GLOBAL_PATH_MANAGER
        .get_or_init(|| match init_global_path_manager() {
            Ok(manager) => manager,
            Err(e) => {
                error!(
                    "Failed to create global PathManager from config directory, using fallback: {}",
                    e
                );
                Arc::new(PathManager::default())
            }
        })
        .clone()
}

/// Try to get the global PathManager instance (Arc)
pub fn try_get_path_manager_arc() -> OpenHarnessResult<Arc<PathManager>> {
    if let Some(manager) = GLOBAL_PATH_MANAGER.get() {
        return Ok(Arc::clone(manager));
    }

    let manager = init_global_path_manager()?;
    match GLOBAL_PATH_MANAGER.set(Arc::clone(&manager)) {
        Ok(()) => Ok(manager),
        Err(_) => Ok(Arc::clone(GLOBAL_PATH_MANAGER.get().expect(
            "GLOBAL_PATH_MANAGER should be initialized after set failure",
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::PathManager;

    #[test]
    fn partner_workspace_paths_use_partners_subdir() {
        let path_manager = PathManager::default();
        let base_dir = path_manager.partner_workspace_base_dir(None);

        assert_eq!(
            base_dir,
            path_manager.openharness_home_dir().join("partners")
        );
        assert_eq!(
            path_manager.default_partner_workspace_dir(None),
            base_dir.join("workspace")
        );
        assert_eq!(
            path_manager.partner_workspace_dir("demo", None),
            base_dir.join("workspace-demo")
        );
        assert_eq!(
            path_manager.resolve_partner_workspace_dir(None, None),
            base_dir.join("workspace")
        );
        assert_eq!(
            path_manager.resolve_partner_workspace_dir(Some("demo"), None),
            base_dir.join("workspace-demo")
        );
    }

    #[test]
    fn legacy_partner_workspace_paths_remain_at_openharness_root() {
        let path_manager = PathManager::default();
        let legacy_base_dir = path_manager.legacy_partner_workspace_base_dir(None);

        assert_eq!(legacy_base_dir, path_manager.openharness_home_dir());
        assert_eq!(
            path_manager.legacy_default_partner_workspace_dir(None),
            legacy_base_dir.join("workspace")
        );
        assert_eq!(
            path_manager.legacy_partner_workspace_dir("demo", None),
            legacy_base_dir.join("workspace-demo")
        );
    }

    #[test]
    fn is_local_partner_workspace_path_detects_partners_and_legacy() {
        let pm = PathManager::default();
        let base = pm.partner_workspace_base_dir(None);
        let named = pm.partner_workspace_dir("abc", None);
        assert!(pm.is_local_partner_workspace_path(&named.to_string_lossy()));
        assert!(pm.is_local_partner_workspace_path(&base.join("workspace").to_string_lossy()));
        let legacy = pm.legacy_partner_workspace_dir("xyz", None);
        assert!(pm.is_local_partner_workspace_path(&legacy.to_string_lossy()));
        assert!(!pm.is_local_partner_workspace_path("/tmp/not-openharness"));
    }
}
