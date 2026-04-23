use crate::computer_use;
use openharness_core::agentic::tools::computer_use_capability::set_computer_use_desktop_available;
use openharness_core::agentic::tools::computer_use_host::ComputerUseHostRef;
use openharness_core::infrastructure::ai::AIClientFactory;
use openharness_core::infrastructure::try_get_path_manager_arc;
use std::sync::Arc;

#[derive(Clone)]
pub struct CoordinatorState {
    pub coordinator: Arc<openharness_core::agentic::coordination::ConversationCoordinator>,
}

#[derive(Clone)]
pub struct SchedulerState {
    pub scheduler: Arc<openharness_core::agentic::coordination::DialogScheduler>,
}

pub struct AgenticRuntime {
    pub coordinator: Arc<openharness_core::agentic::coordination::ConversationCoordinator>,
    pub scheduler: Arc<openharness_core::agentic::coordination::DialogScheduler>,
    pub event_queue: Arc<openharness_core::agentic::events::EventQueue>,
    pub event_router: Arc<openharness_core::agentic::events::EventRouter>,
    pub ai_client_factory: Arc<AIClientFactory>,
    pub token_usage_service: Arc<openharness_core::service::token_usage::TokenUsageService>,
}

pub async fn bootstrap_agentic_runtime() -> anyhow::Result<AgenticRuntime> {
    use openharness_core::agentic::*;

    let ai_client_factory = AIClientFactory::get_global().await?;

    let event_queue = Arc::new(events::EventQueue::new(Default::default()));
    let event_router = Arc::new(events::EventRouter::new());

    let path_manager = try_get_path_manager_arc()?;
    let persistence_manager = Arc::new(persistence::PersistenceManager::new(path_manager.clone())?);

    let context_store = Arc::new(session::SessionContextStore::new());
    let context_compressor = Arc::new(session::ContextCompressor::new(Default::default()));

    let session_manager = Arc::new(session::SessionManager::new(
        context_store,
        persistence_manager,
        Default::default(),
    ));

    let tool_registry = tools::registry::get_global_tool_registry();
    let tool_state_manager = Arc::new(tools::pipeline::ToolStateManager::new(event_queue.clone()));

    let computer_use_host: ComputerUseHostRef =
        Arc::new(computer_use::DesktopComputerUseHost::new());
    set_computer_use_desktop_available(true);

    let tool_pipeline = Arc::new(tools::pipeline::ToolPipeline::new(
        tool_registry,
        tool_state_manager,
        Some(computer_use_host),
    ));

    let stream_processor = Arc::new(execution::StreamProcessor::new(event_queue.clone()));
    let round_executor = Arc::new(execution::RoundExecutor::new(
        stream_processor,
        event_queue.clone(),
        tool_pipeline.clone(),
    ));
    let execution_engine = Arc::new(execution::ExecutionEngine::new(
        round_executor,
        event_queue.clone(),
        session_manager.clone(),
        context_compressor,
        Default::default(),
    ));

    let coordinator = Arc::new(coordination::ConversationCoordinator::new(
        session_manager.clone(),
        execution_engine,
        tool_pipeline,
        event_queue.clone(),
        event_router.clone(),
    ));

    restore_permission_rules(coordinator.clone()).await;
    coordination::ConversationCoordinator::set_global(coordinator.clone());

    let token_usage_service = Arc::new(
        openharness_core::service::token_usage::TokenUsageService::new(path_manager.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize token usage service: {}", e))?,
    );
    let token_usage_subscriber = Arc::new(
        openharness_core::service::token_usage::TokenUsageSubscriber::new(
            token_usage_service.clone(),
        ),
    );
    event_router.subscribe_internal("token_usage".to_string(), token_usage_subscriber);

    let scheduler =
        coordination::DialogScheduler::new(coordinator.clone(), session_manager.clone());
    coordinator.set_scheduler_notifier(scheduler.outcome_sender());
    coordinator.set_round_preempt_source(scheduler.preempt_monitor());
    coordination::set_global_scheduler(scheduler.clone());

    let cron_service =
        openharness_core::service::cron::CronService::new(path_manager.clone(), scheduler.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize cron service: {}", e))?;
    openharness_core::service::cron::set_global_cron_service(cron_service.clone());
    let cron_subscriber = Arc::new(openharness_core::service::cron::CronEventSubscriber::new(
        cron_service.clone(),
    ));
    event_router.subscribe_internal("cron_jobs".to_string(), cron_subscriber);
    cron_service.start();

    log::info!("Agentic runtime initialized");

    Ok(AgenticRuntime {
        coordinator,
        scheduler,
        event_queue,
        event_router,
        ai_client_factory,
        token_usage_service,
    })
}

async fn restore_permission_rules(
    coordinator: Arc<openharness_core::agentic::coordination::ConversationCoordinator>,
) {
    use openharness_core::agentic::PermissionRule;

    match openharness_core::service::config::get_global_config_service().await {
        Ok(config_service) => {
            match config_service
                .get_config::<Option<Vec<PermissionRule>>>(Some("agentic_permission_rules"))
                .await
            {
                Ok(Some(rules)) if !rules.is_empty() => {
                    if let Err(error) = coordinator.agent_permission_rule_replace_all(rules).await {
                        log::warn!("Failed to restore persisted permission rules: {}", error);
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    log::debug!("No persisted agentic permission rules loaded: {}", error);
                }
            }
        }
        Err(error) => {
            log::warn!(
                "Config service unavailable while loading permission rules: {}",
                error
            );
        }
    }
}

pub async fn init_function_agents(ai_client_factory: Arc<AIClientFactory>) -> anyhow::Result<()> {
    let _ = openharness_core::function_agents::git_func_agent::GitFunctionAgent::new(
        ai_client_factory.clone(),
    );

    let _ = openharness_core::function_agents::startchat_func_agent::StartchatFunctionAgent::new(
        ai_client_factory.clone(),
    );

    Ok(())
}
