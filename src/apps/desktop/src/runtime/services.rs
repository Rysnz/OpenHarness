use crate::{api, logging};
use openharness_core::service::workspace::get_global_workspace_service;
use tauri::Manager;

pub fn init_mcp_servers(app_handle: tauri::AppHandle) {
    tokio::spawn(async move {
        let _ = app_handle;
    });
}

pub fn setup_panic_hook() {
    std::panic::set_hook(Box::new(move |panic_info| {
        let location = panic_info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown location".to_string());

        let message = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("unknown panic message");

        log::error!("Application panic at {}: {}", location, message);

        if location.contains("wry") && location.contains("wkwebview") {
            log::warn!("Suppressed non-fatal wry/wkwebview panic, application continues");
            return;
        }

        if message.contains("WSAStartup") || message.contains("10093") || message.contains("hyper")
        {
            log::error!("Network-related crash detected, possible solutions:");
            log::error!("  1) Restart the application");
            log::error!("  2) Check Windows network service status");
            log::error!("  3) Run as administrator");
        }

        std::process::exit(1);
    }));
}

pub fn init_services(app_handle: tauri::AppHandle, default_log_level: log::LevelFilter) {
    use openharness_core::{infrastructure, service};

    spawn_ingest_server_with_config_listener();
    spawn_runtime_log_level_listener(default_log_level);

    tokio::spawn(async move {
        let emitter = super::event_bridge::create_event_emitter(app_handle.clone());
        let workspace_identity_watch_service = {
            let app_state: tauri::State<'_, api::app_state::AppState> = app_handle.state();
            app_state.workspace_identity_watch_service.clone()
        };

        service::snapshot::initialize_snapshot_event_emitter(emitter.clone());
        openharness_core::service::initialize_file_watch_service(emitter.clone());

        if let Err(error) = workspace_identity_watch_service
            .set_event_emitter(emitter.clone())
            .await
        {
            log::error!(
                "Failed to initialize workspace identity watch service: {}",
                error
            );
        }

        if let Err(error) = service::lsp::initialize_global_lsp_manager().await {
            log::error!("Failed to initialize LSP manager: {}", error);
        }

        let event_system = infrastructure::events::get_global_event_system();
        event_system.set_emitter(emitter).await;
    });
}

pub async fn resolve_runtime_log_level(default_level: log::LevelFilter) -> log::LevelFilter {
    use openharness_core::service::config::get_global_config_service;

    if let Ok(config_service) = get_global_config_service().await {
        if let Ok(config_level) = config_service
            .get_config::<String>(Some("app.logging.level"))
            .await
        {
            if let Some(level) = logging::parse_log_level(&config_level) {
                return level;
            }
            log::warn!(
                "Invalid app.logging.level '{}', falling back to default={}",
                config_level,
                logging::level_to_str(default_level)
            );
        }
    }

    default_level
}

pub fn spawn_runtime_log_level_listener(default_level: log::LevelFilter) {
    use openharness_core::service::config::{subscribe_config_updates, ConfigUpdateEvent};

    tokio::spawn(async move {
        if let Some(mut receiver) = subscribe_config_updates() {
            loop {
                match receiver.recv().await {
                    Ok(ConfigUpdateEvent::LogLevelUpdated { new_level }) => {
                        if let Some(level) = logging::parse_log_level(&new_level) {
                            logging::apply_runtime_log_level(level, "config_update_event");
                        } else {
                            log::warn!(
                                "Received invalid log level from config update event: {}",
                                new_level
                            );
                        }
                    }
                    Ok(ConfigUpdateEvent::ConfigReloaded) => {
                        let level = resolve_runtime_log_level(default_level).await;
                        logging::apply_runtime_log_level(level, "config_reloaded");
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!("Log-level listener channel closed, stopping listener");
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Log-level listener lagged by {} messages", skipped);
                    }
                }
            }
        } else {
            log::warn!("Config update subscription unavailable for log-level listener");
        }
    });
}

pub fn spawn_ingest_server_with_config_listener() {
    use openharness_core::infrastructure::debug_log::IngestServerManager;
    use openharness_core::service::config::{
        get_global_config_service, subscribe_config_updates, ConfigUpdateEvent,
    };

    tokio::spawn(async move {
        let initial_config = if let Ok(config_service) = get_global_config_service().await {
            if let Ok(config) = config_service
                .get_config::<openharness_core::service::config::GlobalConfig>(None)
                .await
            {
                let debug_config = &config.ai.debug_mode_config;
                let workspace_path = get_global_workspace_service()
                    .and_then(|service| service.try_get_current_workspace_path())
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

                Some(
                    openharness_core::infrastructure::debug_log::IngestServerConfig::from_debug_mode_config(
                        debug_config.ingest_port,
                        workspace_path.join(&debug_config.log_path),
                    ),
                )
            } else {
                None
            }
        } else {
            None
        };

        let configured_port = if let Ok(config_service) = get_global_config_service().await {
            if let Ok(config) = config_service
                .get_config::<openharness_core::service::config::GlobalConfig>(None)
                .await
            {
                Some(config.ai.debug_mode_config.ingest_port)
            } else {
                None
            }
        } else {
            None
        };

        let manager = IngestServerManager::global();
        if let Err(error) = manager.start(initial_config).await {
            log::error!("Failed to start Debug Log Ingest Server: {}", error);
        }

        let actual_port = manager.get_actual_port().await;
        if let Some(configured_port) = configured_port {
            if actual_port != configured_port {
                if let Ok(config_service) = get_global_config_service().await {
                    if let Err(error) = config_service
                        .set_config("ai.debug_mode_config.ingest_port", actual_port)
                        .await
                    {
                        log::error!("Failed to sync actual port to config: {}", error);
                    } else {
                        log::info!(
                            "Ingest Server port synced: actual_port={}, config_port={}",
                            actual_port,
                            configured_port
                        );
                    }
                }
            }
        }

        if let Some(mut receiver) = subscribe_config_updates() {
            loop {
                match receiver.recv().await {
                    Ok(ConfigUpdateEvent::DebugModeConfigUpdated {
                        new_port,
                        new_log_path,
                    }) => {
                        let workspace_path = get_global_workspace_service()
                            .and_then(|service| service.try_get_current_workspace_path())
                            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                        let full_log_path = workspace_path.join(&new_log_path);

                        if let Err(error) = manager.update_port(new_port, full_log_path).await {
                            log::error!(
                                "Failed to update Ingest Server config: port={}, log_path={}, error={}",
                                new_port,
                                new_log_path,
                                error
                            );
                        }
                    }
                    Ok(ConfigUpdateEvent::ConfigReloaded) => {
                        if let Ok(config_service) = get_global_config_service().await {
                            if let Ok(config) = config_service
                                .get_config::<openharness_core::service::config::GlobalConfig>(None)
                                .await
                            {
                                let debug_config = &config.ai.debug_mode_config;
                                let workspace_path = get_global_workspace_service()
                                    .and_then(|service| service.try_get_current_workspace_path())
                                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                                let full_log_path = workspace_path.join(&debug_config.log_path);

                                if let Err(error) = manager
                                    .update_port(debug_config.ingest_port, full_log_path)
                                    .await
                                {
                                    log::error!(
                                        "Failed to update Ingest Server after config reload: port={}, error={}",
                                        debug_config.ingest_port,
                                        error
                                    );
                                }
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!("Config update channel closed, stopping listener");
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Config update listener lagged by {} messages", skipped);
                    }
                }
            }
        }
    });
}
