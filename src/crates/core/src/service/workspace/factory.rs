use super::manager::{WorkspaceManager, WorkspaceManagerConfig};
use super::service::WorkspaceService;
use crate::util::errors::OpenHarnessResult;

/// Workspace factory - creates and configures workspace-related components
pub struct WorkspaceFactory;

impl WorkspaceFactory {
    /// Creates the default workspace service.
    pub async fn create_default_service() -> OpenHarnessResult<WorkspaceService> {
        WorkspaceService::new().await
    }

    /// Creates a workspace service with a custom config.
    pub async fn create_service_with_config(
        config: WorkspaceManagerConfig,
    ) -> OpenHarnessResult<WorkspaceService> {
        WorkspaceService::with_config(config).await
    }

    /// Creates a workspace manager.
    pub fn create_manager(config: WorkspaceManagerConfig) -> WorkspaceManager {
        WorkspaceManager::new(config)
    }
}
