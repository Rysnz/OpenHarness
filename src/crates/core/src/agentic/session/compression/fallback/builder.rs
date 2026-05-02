use super::sanitize::{
    sanitize_assistant_text, sanitize_todo_snapshot, sanitize_tool_arguments, sanitize_user_text,
};
use super::types::CompressionFallbackOptions;
use crate::agentic::core::{
    strip_prompt_markup, CompressedMessage, CompressedMessageRole, CompressedTodoSnapshot,
    CompressedToolCall, CompressionEntry, Message, MessageContent, MessageRole,
    MessageSemanticKind,
};

pub(super) fn build_entries_from_turns(
    turns: Vec<Vec<Message>>,
    options: &CompressionFallbackOptions,
) -> Vec<CompressionEntry> {
    let mut entries = Vec::new();

    for turn in turns {
        build_entries_from_messages(turn, options, &mut entries);
    }

    entries
}

fn build_entries_from_messages(
    messages: Vec<Message>,
    options: &CompressionFallbackOptions,
    output: &mut Vec<CompressionEntry>,
) {
    let turn_id = messages
        .first()
        .and_then(|message| message.metadata.turn_id.clone());
    let mut turn_messages = Vec::new();
    let mut latest_todo = None;

    for message in messages {
        if let Some(entries) = extract_nested_compression_entries(&message) {
            flush_turn_entry(
                output,
                turn_id.clone(),
                &mut turn_messages,
                &mut latest_todo,
            );
            output.extend(entries);
            continue;
        }

        match message.content {
            MessageContent::Text(text) => {
                if let Some(compressed) = compress_text_message(message.role, &text, options) {
                    turn_messages.push(compressed);
                }
            }
            MessageContent::Multimodal { text, images } => {
                if let Some(compressed) =
                    compress_multimodal_message(message.role, &text, images.len(), options)
                {
                    turn_messages.push(compressed);
                }
            }
            MessageContent::Mixed {
                text, tool_calls, ..
            } => {
                if message.role == MessageRole::Assistant {
                    if let Some(compressed) = compress_mixed_assistant_message(
                        &text,
                        tool_calls,
                        options,
                        &mut latest_todo,
                    ) {
                        turn_messages.push(compressed);
                    }
                }
            }
            MessageContent::ToolResult { .. } => {}
        }
    }

    flush_turn_entry(output, turn_id, &mut turn_messages, &mut latest_todo);
}

fn compress_text_message(
    role: MessageRole,
    text: &str,
    options: &CompressionFallbackOptions,
) -> Option<CompressedMessage> {
    let (role, text) = match role {
        MessageRole::User => (
            CompressedMessageRole::User,
            sanitize_user_text(text, options),
        ),
        MessageRole::Assistant => (
            CompressedMessageRole::Assistant,
            sanitize_assistant_text(text, options),
        ),
        MessageRole::System | MessageRole::Tool => return None,
    };

    text.map(|text| compressed_text(role, text))
}

fn compress_multimodal_message(
    role: MessageRole,
    text: &str,
    image_count: usize,
    options: &CompressionFallbackOptions,
) -> Option<CompressedMessage> {
    if role != MessageRole::User {
        return None;
    }

    let mut rendered = sanitize_user_text(text, options).unwrap_or_default();
    if image_count > 0 {
        if !rendered.is_empty() {
            rendered.push('\n');
        }
        rendered.push_str(&format!("[{} image(s) omitted]", image_count));
    }

    (!rendered.trim().is_empty()).then(|| compressed_text(CompressedMessageRole::User, rendered))
}

fn compress_mixed_assistant_message(
    text: &str,
    tool_calls: Vec<crate::agentic::core::ToolCall>,
    options: &CompressionFallbackOptions,
    latest_todo: &mut Option<CompressedTodoSnapshot>,
) -> Option<CompressedMessage> {
    let compressed_tool_calls = compress_tool_calls(tool_calls, options, latest_todo);
    let sanitized_text = sanitize_assistant_text(text, options);

    (sanitized_text.is_some() || !compressed_tool_calls.is_empty()).then(|| CompressedMessage {
        role: CompressedMessageRole::Assistant,
        text: sanitized_text,
        tool_calls: compressed_tool_calls,
    })
}

fn compress_tool_calls(
    tool_calls: Vec<crate::agentic::core::ToolCall>,
    options: &CompressionFallbackOptions,
    latest_todo: &mut Option<CompressedTodoSnapshot>,
) -> Vec<CompressedToolCall> {
    let mut compressed_tool_calls = Vec::new();

    for tool_call in tool_calls {
        if tool_call.tool_name == "TodoWrite" {
            *latest_todo = sanitize_todo_snapshot(&tool_call.arguments);
            continue;
        }

        compressed_tool_calls.push(CompressedToolCall {
            tool_name: tool_call.tool_name.clone(),
            arguments: sanitize_tool_arguments(&tool_call.tool_name, &tool_call.arguments, options),
            is_error: tool_call.is_error,
        });
    }

    compressed_tool_calls
}

fn compressed_text(role: CompressedMessageRole, text: String) -> CompressedMessage {
    CompressedMessage {
        role,
        text: Some(text),
        tool_calls: Vec::new(),
    }
}

fn flush_turn_entry(
    output: &mut Vec<CompressionEntry>,
    turn_id: Option<String>,
    turn_messages: &mut Vec<CompressedMessage>,
    latest_todo: &mut Option<CompressedTodoSnapshot>,
) {
    if turn_messages.is_empty() && latest_todo.is_none() {
        return;
    }

    output.push(CompressionEntry::Turn {
        turn_id,
        messages: std::mem::take(turn_messages),
        todo: latest_todo.take(),
    });
}

fn extract_nested_compression_entries(message: &Message) -> Option<Vec<CompressionEntry>> {
    match message.metadata.semantic_kind {
        Some(MessageSemanticKind::CompressionBoundaryMarker) => return Some(Vec::new()),
        Some(MessageSemanticKind::CompressionSummary)
        | Some(MessageSemanticKind::InternalReminder) => {}
        _ => return None,
    }

    if let Some(payload) = message.metadata.compression_payload.clone() {
        if !payload.is_empty() {
            return Some(payload.entries);
        }
    }

    if message.metadata.semantic_kind == Some(MessageSemanticKind::CompressionSummary) {
        return None;
    }

    let raw_text = match &message.content {
        MessageContent::Text(text) => text.clone(),
        MessageContent::Multimodal { text, .. } => text.clone(),
        _ => String::new(),
    };
    let stripped = strip_prompt_markup(&raw_text);
    if stripped.is_empty() {
        return None;
    }

    Some(vec![CompressionEntry::ModelSummary { text: stripped }])
}
