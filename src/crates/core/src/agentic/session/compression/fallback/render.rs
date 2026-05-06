use crate::agentic::core::{
    CompressedMessage, CompressedMessageRole, CompressedTodoSnapshot, CompressionEntry,
    CompressionPayload,
};
use serde_json::{json, Value};

const EMPTY_HISTORY_MESSAGE: &str =
    "No detailed historical entries fit within the remaining context budget.";

pub(super) fn render_payload_for_model(payload: &CompressionPayload) -> String {
    if payload.entries.is_empty() {
        return EMPTY_HISTORY_MESSAGE.to_string();
    }

    payload
        .entries
        .iter()
        .enumerate()
        .map(|(index, entry)| render_entry(index + 1, entry))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn render_entry(position: usize, entry: &CompressionEntry) -> String {
    match entry {
        CompressionEntry::ModelSummary { text } => {
            format!("Earlier summarized history {position}:\n{text}")
        }
        CompressionEntry::Turn { messages, todo, .. } => {
            let mut lines = vec![format!("Historical turn {position}:")];
            let mut previous_role = None;

            for message in messages {
                render_compressed_message(&mut lines, message, &mut previous_role);
            }

            if let Some(todo) = todo {
                append_todo_lines(&mut lines, todo);
            }

            lines.join("\n")
        }
    }
}

fn render_compressed_message(
    lines: &mut Vec<String>,
    message: &CompressedMessage,
    previous_role: &mut Option<CompressedMessageRole>,
) {
    let role_label = match message.role {
        CompressedMessageRole::User => "User",
        CompressedMessageRole::Assistant => "Assistant",
    };
    let is_new_role_segment = *previous_role != Some(message.role);

    if let Some(text) = message.text.as_ref() {
        if is_new_role_segment {
            lines.push(format!("{role_label}: {text}"));
        } else {
            lines.push(text.clone());
        }
    } else if is_new_role_segment {
        lines.push(format!("{role_label}:"));
    }

    for tool_call in &message.tool_calls {
        let mut rendered = tool_call.tool_name.clone();
        if let Some(arguments) = tool_call.arguments.as_ref() {
            rendered.push(' ');
            rendered.push_str(&render_tool_arguments(arguments));
        }
        if tool_call.is_error {
            rendered.push_str(" [error]");
        }
        lines.push(format!("Tool call: {}", rendered));
    }

    *previous_role = Some(message.role);
}

fn append_todo_lines(lines: &mut Vec<String>, todo: &CompressedTodoSnapshot) {
    lines.push("Latest task list for this turn:".to_string());

    if todo.todos.is_empty() {
        if let Some(summary) = todo.summary.as_ref() {
            lines.push(format!("- {summary}"));
        }
        return;
    }

    lines.extend(
        todo.todos
            .iter()
            .map(|item| format!("- [{}] {}", item.status, item.content)),
    );

    if let Some(summary) = todo.summary.as_ref() {
        lines.push(format!("Task list note: {summary}"));
    }
}

fn render_tool_arguments(arguments: &Value) -> String {
    if arguments.is_null() {
        return "{}".to_string();
    }
    serde_json::to_string(arguments).unwrap_or_else(|_| json!({}).to_string())
}
