use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceIsolation {
    #[default]
    None,
    GitWorktree,
    Scratch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CleanupPolicy {
    #[default]
    Keep,
    DeleteOnSuccess,
    AlwaysDelete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceBinding {
    pub isolation: WorkspaceIsolation,
    pub root: PathBuf,
    pub working_dir: PathBuf,
    pub branch_name: Option<String>,
    pub worktree_path: Option<PathBuf>,
    pub cleanup_policy: CleanupPolicy,
}

impl WorkspaceBinding {
    pub fn shared(root: PathBuf) -> Self {
        Self {
            isolation: WorkspaceIsolation::None,
            root: root.clone(),
            working_dir: root,
            branch_name: None,
            worktree_path: None,
            cleanup_policy: CleanupPolicy::Keep,
        }
    }

    pub fn effective_working_dir(&self) -> &Path {
        self.worktree_path
            .as_deref()
            .unwrap_or(self.working_dir.as_path())
    }
}
