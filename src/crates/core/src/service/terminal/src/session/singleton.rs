//! Global terminal session manager access.

use std::sync::Arc;

use tokio::sync::OnceCell;

use crate::config::TerminalConfig;

use super::SessionManager;

const ALREADY_INITIALIZED: &str = "SessionManager already initialized";
const NOT_INITIALIZED: &str = "SessionManager not initialized. Call init_session_manager first.";

static SESSION_MANAGER: OnceCell<Arc<SessionManager>> = OnceCell::const_new();

pub async fn init_session_manager(
    config: TerminalConfig,
) -> Result<Arc<SessionManager>, &'static str> {
    let manager = build_session_manager(config);
    store_session_manager(manager.clone())?;

    Ok(manager)
}

pub fn get_session_manager() -> Option<Arc<SessionManager>> {
    SESSION_MANAGER.get().cloned()
}

pub fn session_manager() -> Arc<SessionManager> {
    get_session_manager().unwrap_or_else(|| panic!("{NOT_INITIALIZED}"))
}

pub fn is_session_manager_initialized() -> bool {
    SESSION_MANAGER.get().is_some()
}

pub fn set_session_manager(manager: Arc<SessionManager>) -> Result<(), &'static str> {
    store_session_manager(manager)
}

fn build_session_manager(config: TerminalConfig) -> Arc<SessionManager> {
    Arc::new(SessionManager::new(config))
}

fn store_session_manager(manager: Arc<SessionManager>) -> Result<(), &'static str> {
    SESSION_MANAGER
        .set(manager)
        .map_err(|_| ALREADY_INITIALIZED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_manager_not_initialized() {
        if !is_session_manager_initialized() {
            assert!(get_session_manager().is_none());
        }
    }
}
