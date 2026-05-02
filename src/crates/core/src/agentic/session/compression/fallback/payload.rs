use super::render::render_payload_for_model;
use super::types::{CompressionFallbackOptions, CompressionUnit};
use crate::agentic::core::{
    render_system_reminder, CompressedMessage, CompressedTodoSnapshot, CompressionEntry,
    CompressionPayload, Message,
};

pub(super) fn trim_payload_to_budget(
    entries: Vec<CompressionEntry>,
    options: &CompressionFallbackOptions,
) -> CompressionPayload {
    if entries.is_empty() {
        return CompressionPayload::default();
    }

    let units = flatten_entries_to_units(entries);
    let mut selected_units = Vec::new();

    for unit in units.into_iter().rev() {
        let mut candidate_units = vec![unit.clone()];
        candidate_units.extend(selected_units.clone());

        let candidate_payload = rebuild_payload_from_units(candidate_units);
        if estimate_payload_tokens(&candidate_payload) <= options.max_tokens {
            selected_units.insert(0, unit);
        }
    }

    rebuild_payload_from_units(selected_units)
}

#[derive(Default)]
struct RebuildTurnState {
    entry_id: Option<usize>,
    turn_id: Option<String>,
    messages: Vec<CompressedMessage>,
    todo: Option<CompressedTodoSnapshot>,
}

impl RebuildTurnState {
    fn start_turn(&mut self, entry_id: usize, turn_id: Option<String>) {
        self.entry_id = Some(entry_id);
        self.turn_id = turn_id;
    }

    fn has_entry(&self, entry_id: usize) -> bool {
        self.entry_id == Some(entry_id)
    }

    fn clear(&mut self) {
        self.entry_id = None;
        self.turn_id = None;
    }

    fn flush_into(&mut self, entries: &mut Vec<CompressionEntry>) {
        if self.entry_id.is_none() {
            return;
        }

        if self.messages.is_empty() && self.todo.is_none() {
            self.clear();
            return;
        }

        entries.push(CompressionEntry::Turn {
            turn_id: self.turn_id.clone(),
            messages: std::mem::take(&mut self.messages),
            todo: self.todo.take(),
        });
        self.clear();
    }
}

fn flatten_entries_to_units(entries: Vec<CompressionEntry>) -> Vec<CompressionUnit> {
    let mut units = Vec::new();

    for (entry_id, entry) in entries.into_iter().enumerate() {
        match entry {
            CompressionEntry::ModelSummary { text } => {
                units.push(CompressionUnit::ModelSummary { text });
            }
            CompressionEntry::Turn {
                turn_id,
                messages,
                todo,
            } => {
                for message in messages {
                    units.push(CompressionUnit::TurnMessage {
                        entry_id,
                        turn_id: turn_id.clone(),
                        message,
                    });
                }
                if let Some(todo) = todo {
                    units.push(CompressionUnit::TurnTodo {
                        entry_id,
                        turn_id,
                        todo,
                    });
                }
            }
        }
    }

    units
}

fn rebuild_payload_from_units(units: Vec<CompressionUnit>) -> CompressionPayload {
    let mut entries = Vec::new();
    let mut current_turn = RebuildTurnState::default();

    for unit in units {
        match unit {
            CompressionUnit::ModelSummary { text } => {
                current_turn.flush_into(&mut entries);
                entries.push(CompressionEntry::ModelSummary { text });
            }
            CompressionUnit::TurnMessage {
                entry_id,
                turn_id,
                message,
            } => {
                if !current_turn.has_entry(entry_id) {
                    current_turn.flush_into(&mut entries);
                    current_turn.start_turn(entry_id, turn_id);
                }
                current_turn.messages.push(message);
            }
            CompressionUnit::TurnTodo {
                entry_id,
                turn_id,
                todo,
            } => {
                if !current_turn.has_entry(entry_id) {
                    current_turn.flush_into(&mut entries);
                    current_turn.start_turn(entry_id, turn_id);
                }
                current_turn.todo = Some(todo);
            }
        }
    }

    current_turn.flush_into(&mut entries);

    CompressionPayload { entries }
}

fn estimate_payload_tokens(payload: &CompressionPayload) -> usize {
    let rendered = render_payload_for_model(payload);
    let mut synthetic_message = Message::user(render_system_reminder(&rendered));
    synthetic_message.get_tokens()
}
