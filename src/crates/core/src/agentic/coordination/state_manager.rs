//! Centralized session state coordination.

use crate::agentic::core::{ProcessingPhase, SessionState};
use crate::agentic::events::{AgenticEvent, EventPriority, EventQueue};
use dashmap::DashMap;
use log::debug;
use std::sync::Arc;

pub struct SessionStateManager {
    states: Arc<DashMap<String, SessionState>>,
    event_queue: Arc<EventQueue>,
}

impl SessionStateManager {
    pub fn new(event_queue: Arc<EventQueue>) -> Self {
        Self {
            states: Arc::new(DashMap::new()),
            event_queue,
        }
    }

    pub async fn initialize(&self, session_id: &str) {
        self.replace_state(session_id, SessionState::Idle);
    }

    pub fn get_state(&self, session_id: &str) -> Option<SessionState> {
        self.states.get(session_id).map(|state| state.clone())
    }

    pub async fn update_state(&self, session_id: &str, new_state: SessionState) {
        if self.replace_existing_state(session_id, new_state.clone()) {
            self.emit_state_change_event(session_id, &new_state).await;
        }
    }

    pub async fn set_processing_phase(
        &self,
        session_id: &str,
        current_turn_id: String,
        phase: ProcessingPhase,
    ) {
        self.update_state(
            session_id,
            SessionState::Processing {
                current_turn_id,
                phase,
            },
        )
        .await;
    }

    pub async fn set_idle(&self, session_id: &str) {
        self.update_state(session_id, SessionState::Idle).await;
    }

    pub async fn set_error(&self, session_id: &str, error: String, recoverable: bool) {
        self.update_state(session_id, SessionState::Error { error, recoverable })
            .await;
    }

    pub fn can_start_new_turn(&self, session_id: &str) -> bool {
        self.get_state(session_id)
            .is_some_and(|state| Self::allows_new_turn(&state))
    }

    pub fn is_processing(&self, session_id: &str) -> bool {
        self.get_state(session_id)
            .is_some_and(|state| matches!(state, SessionState::Processing { .. }))
    }

    pub fn remove(&self, session_id: &str) {
        self.states.remove(session_id);
        debug!("Removed session state: session_id={}", session_id);
    }

    async fn emit_state_change_event(&self, session_id: &str, state: &SessionState) {
        let event = AgenticEvent::SessionStateChanged {
            session_id: session_id.to_string(),
            new_state: crate::agentic::events::types::session_state_to_string(state),
        };

        let _ = self
            .event_queue
            .enqueue(event, Some(EventPriority::High))
            .await;
    }

    pub fn get_all_states(&self) -> Vec<(String, SessionState)> {
        self.states
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect()
    }

    fn replace_state(&self, session_id: &str, state: SessionState) {
        self.states.insert(session_id.to_string(), state);
    }

    fn replace_existing_state(&self, session_id: &str, state: SessionState) -> bool {
        self.states
            .get_mut(session_id)
            .map(|mut current| {
                *current = state;
            })
            .is_some()
    }

    fn allows_new_turn(state: &SessionState) -> bool {
        matches!(
            state,
            SessionState::Idle
                | SessionState::Error {
                    recoverable: true,
                    ..
                }
        )
    }
}
