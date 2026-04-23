use openharness_transport::{TauriTransportAdapter, TransportAdapter};
use std::sync::Arc;

pub fn start_event_loop_with_transport(
    event_queue: Arc<openharness_core::agentic::events::EventQueue>,
    event_router: Arc<openharness_core::agentic::events::EventRouter>,
    app_handle: tauri::AppHandle,
) {
    let transport = Arc::new(TauriTransportAdapter::new(app_handle));

    tokio::spawn(async move {
        loop {
            event_queue.wait_for_events().await;
            loop {
                let batch = event_queue.dequeue_configured_batch().await;
                if batch.is_empty() {
                    break;
                }

                for envelope in batch {
                    if let Err(error) = event_router.route(envelope.clone()).await {
                        log::warn!("Internal event routing failed: {:?}", error);
                    }

                    if let Err(error) = transport.emit_event("", envelope.event).await {
                        log::error!("Failed to emit event: {:?}", error);
                    }
                }
            }
        }
    });
}

pub fn create_event_emitter(
    app_handle: tauri::AppHandle,
) -> Arc<dyn openharness_core::infrastructure::events::EventEmitter> {
    use openharness_core::infrastructure::events::TransportEmitter;

    let transport = Arc::new(TauriTransportAdapter::new(app_handle));
    Arc::new(TransportEmitter::new(transport))
}
