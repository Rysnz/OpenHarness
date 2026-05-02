//! Anthropic message format converter
//!
//! Converts the unified message format to Anthropic Claude API format

use crate::util::types::{Message, ToolDefinition};
use log::warn;
use serde_json::{json, Value};

pub struct AnthropicMessageConverter;

enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
    Unknown(String),
}

impl MessageRole {
    fn parse(role: &str) -> Self {
        match role {
            "system" => Self::System,
            "user" => Self::User,
            "assistant" => Self::Assistant,
            "tool" => Self::Tool,
            other => Self::Unknown(other.to_string()),
        }
    }
}

impl AnthropicMessageConverter {
    /// Convert unified message format to Anthropic format
    ///
    /// Note: Anthropic requires system messages to be handled separately, not in the messages array
    pub fn convert_messages(messages: Vec<Message>) -> (Option<String>, Vec<Value>) {
        let mut system_message = None;
        let mut anthropic_messages = Vec::new();

        for msg in messages {
            match MessageRole::parse(msg.role.as_str()) {
                MessageRole::System => {
                    if let Some(content) = msg.content {
                        system_message = Some(content);
                    }
                }
                MessageRole::User => {
                    anthropic_messages.push(Self::convert_user_message(msg));
                }
                MessageRole::Assistant => {
                    if let Some(converted) = Self::convert_assistant_message(msg) {
                        anthropic_messages.push(converted);
                    }
                }
                MessageRole::Tool => {
                    anthropic_messages.push(Self::convert_tool_result_message(msg));
                }
                MessageRole::Unknown(role) => {
                    warn!("Unknown message role: {}", role);
                }
            }
        }

        // Anthropic requires user/assistant messages to alternate
        let merged_messages = Self::merge_consecutive_messages(anthropic_messages);

        (system_message, merged_messages)
    }

    /// Merge consecutive same-role messages to keep user/assistant alternating
    fn merge_consecutive_messages(messages: Vec<Value>) -> Vec<Value> {
        let mut merged: Vec<Value> = Vec::new();

        for msg in messages {
            if Self::try_merge_user_message(merged.last_mut(), &msg) {
                continue;
            }

            merged.push(msg);
        }

        merged
    }

    fn try_merge_user_message(last: Option<&mut Value>, current: &Value) -> bool {
        let Some(last) = last else {
            return false;
        };

        if Self::message_role(last) != Some("user") || Self::message_role(current) != Some("user") {
            return false;
        }

        let Some(current_content) = current.get("content") else {
            return false;
        };
        let Some(last_content) = last.get_mut("content") else {
            return false;
        };

        match (last_content, current_content) {
            (Value::Array(last_arr), Value::Array(curr_arr)) => {
                last_arr.extend(curr_arr.clone());
            }
            (Value::Array(last_arr), Value::String(curr_str)) => {
                last_arr.push(Self::text_block(curr_str));
            }
            (Value::String(last_str), Value::Array(curr_arr)) => {
                let mut new_content = vec![Self::text_block(last_str)];
                new_content.extend(curr_arr.clone());
                *last = Self::role_message("user", Value::Array(new_content));
            }
            (Value::String(last_str), Value::String(curr_str)) => {
                *last_str = Self::join_text_blocks(last_str, curr_str);
            }
            _ => return false,
        }

        true
    }

    fn message_role(message: &Value) -> Option<&str> {
        message.get("role").and_then(|role| role.as_str())
    }

    fn role_message(role: &str, content: Value) -> Value {
        json!({
            "role": role,
            "content": content
        })
    }

    fn text_block(text: &str) -> Value {
        json!({
            "type": "text",
            "text": text
        })
    }

    fn join_text_blocks(existing: &str, next: &str) -> String {
        if existing.is_empty() {
            next.to_string()
        } else {
            format!("{}\n\n{}", existing, next)
        }
    }

    fn convert_user_message(msg: Message) -> Value {
        let content = msg.content.unwrap_or_default();

        if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
            if parsed.is_array() {
                return Self::role_message("user", parsed);
            }
        }

        Self::role_message("user", json!(content))
    }

    /// Convert assistant messages; return None when empty.
    fn convert_assistant_message(msg: Message) -> Option<Value> {
        let mut content = Vec::new();

        if let Some(thinking) = msg.reasoning_content.as_ref() {
            if !thinking.is_empty() {
                let mut thinking_block = json!({
                    "type": "thinking",
                    "thinking": thinking
                });

                thinking_block["signature"] =
                    json!(msg.thinking_signature.as_deref().unwrap_or(""));

                content.push(thinking_block);
            }
        }

        if let Some(text) = msg.content {
            if !text.is_empty() {
                content.push(Self::text_block(&text));
            }
        }

        if let Some(tool_calls) = msg.tool_calls {
            for tc in tool_calls {
                content.push(json!({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments
                }));
            }
        }

        if content.is_empty() {
            None
        } else {
            Some(Self::role_message("assistant", json!(content)))
        }
    }

    fn convert_tool_result_message(msg: Message) -> Value {
        let tool_call_id = msg.tool_call_id.unwrap_or_default();
        let text = msg.content.unwrap_or_default();

        let is_error = msg.is_error.unwrap_or(false);
        let tool_content: Value =
            if let Some(attachments) = msg.tool_image_attachments.filter(|a| !a.is_empty()) {
                let mut blocks: Vec<Value> = attachments
                    .into_iter()
                    .map(|att| {
                        json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": att.mime_type,
                                "data": att.data_base64,
                            }
                        })
                    })
                    .collect();
                blocks.push(json!({ "type": "text", "text": text }));
                json!(blocks)
            } else {
                json!(text)
            };

        let mut tool_result = json!({
            "type": "tool_result",
            "tool_use_id": tool_call_id,
            "content": tool_content,
        });
        if is_error {
            tool_result["is_error"] = json!(true);
        }

        Self::role_message("user", json!([tool_result]))
    }

    /// Convert tool definitions to Anthropic format
    pub fn convert_tools(tools: Option<Vec<ToolDefinition>>) -> Option<Vec<Value>> {
        tools.map(|tool_defs| {
            tool_defs
                .into_iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.parameters
                    })
                })
                .collect()
        })
    }
}
