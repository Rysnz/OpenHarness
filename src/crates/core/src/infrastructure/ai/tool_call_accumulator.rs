use log::{error, warn};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallBoundary {
    NewTool,
    FinishReason,
    StreamEnd,
    GracefulShutdown,
    EndOfAggregation,
}

impl ToolCallBoundary {
    fn as_str(self) -> &'static str {
        match self {
            Self::NewTool => "new_tool",
            Self::FinishReason => "finish_reason",
            Self::StreamEnd => "stream_end",
            Self::GracefulShutdown => "graceful_shutdown",
            Self::EndOfAggregation => "end_of_aggregation",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct PendingToolCall {
    tool_id: String,
    tool_name: String,
    raw_arguments: String,
}

struct ParsedArguments {
    value: Value,
    error: Option<String>,
}

impl ParsedArguments {
    fn from_raw(raw_arguments: &str) -> Self {
        match parse_json_arguments(raw_arguments) {
            Ok(value) => Self { value, error: None },
            Err(error) => Self {
                value: json!({}),
                error: Some(error),
            },
        }
    }

    fn is_error(&self) -> bool {
        self.error.is_some()
    }
}

#[derive(Debug, Clone)]
pub struct FinalizedToolCall {
    pub tool_id: String,
    pub tool_name: String,
    pub raw_arguments: String,
    pub arguments: Value,
    pub is_error: bool,
}

impl FinalizedToolCall {
    pub fn arguments_as_object_map(&self) -> HashMap<String, Value> {
        match &self.arguments {
            Value::Object(map) => map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            _ => HashMap::new(),
        }
    }
}

fn boundary_label(boundary: ToolCallBoundary) -> &'static str {
    boundary.as_str()
}

fn remove_single_trailing_right_brace(raw_arguments: &str) -> Option<String> {
    let (index, ch) = raw_arguments
        .char_indices()
        .rev()
        .find(|(_, ch)| !ch.is_whitespace())?;

    if ch != '}' {
        return None;
    }

    let mut repaired = raw_arguments.to_string();
    repaired.remove(index);
    Some(repaired)
}

fn parse_json_arguments(raw_arguments: &str) -> Result<Value, String> {
    let primary_error = match serde_json::from_str::<Value>(raw_arguments) {
        Ok(arguments) => return Ok(arguments),
        Err(error) => error,
    };

    if let Some(repaired_arguments) = remove_single_trailing_right_brace(raw_arguments) {
        if let Ok(arguments) = serde_json::from_str::<Value>(&repaired_arguments) {
            warn!("Tool call arguments repaired by removing one trailing right brace");
            return Ok(arguments);
        }
    }

    Err(primary_error.to_string())
}

impl PendingToolCall {
    pub fn has_pending(&self) -> bool {
        !self.tool_id.is_empty()
    }

    pub fn tool_id(&self) -> &str {
        &self.tool_id
    }

    pub fn tool_name(&self) -> &str {
        &self.tool_name
    }

    pub fn start_new(&mut self, tool_id: String, tool_name: Option<String>) {
        self.tool_id = tool_id;
        self.tool_name = tool_name.unwrap_or_default();
        self.raw_arguments.clear();
    }

    pub fn update_tool_name_if_missing(&mut self, tool_name: Option<String>) {
        if self.tool_name.is_empty() {
            self.tool_name = tool_name.unwrap_or_default();
        }
    }

    pub fn append_arguments(&mut self, arguments_chunk: &str) {
        self.raw_arguments.push_str(arguments_chunk);
    }

    pub fn finalize(&mut self, boundary: ToolCallBoundary) -> Option<FinalizedToolCall> {
        if !self.has_pending() {
            return None;
        }

        let tool_id = std::mem::take(&mut self.tool_id);
        let tool_name = std::mem::take(&mut self.tool_name);
        let raw_arguments = std::mem::take(&mut self.raw_arguments);
        let parsed_arguments = ParsedArguments::from_raw(&raw_arguments);

        if let Some(error) = &parsed_arguments.error {
            error!(
                "Tool call arguments parsing failed at boundary={}: tool_id={}, tool_name={}, error={}, raw_arguments={}",
                boundary_label(boundary),
                tool_id,
                tool_name,
                error,
                raw_arguments
            );
        }

        Some(FinalizedToolCall {
            tool_id,
            tool_name,
            raw_arguments,
            is_error: parsed_arguments.is_error(),
            arguments: parsed_arguments.value,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{PendingToolCall, ToolCallBoundary};
    use serde_json::json;

    #[test]
    fn finalizes_complete_json_only_at_boundary() {
        let mut pending = PendingToolCall::default();
        pending.start_new("call_1".to_string(), Some("tool_a".to_string()));
        pending.append_arguments("{\"a\":1}");

        let finalized = pending
            .finalize(ToolCallBoundary::FinishReason)
            .expect("finalized tool");

        assert_eq!(finalized.tool_id, "call_1");
        assert_eq!(finalized.tool_name, "tool_a");
        assert_eq!(finalized.arguments, json!({"a": 1}));
        assert!(!finalized.is_error);
        assert!(!pending.has_pending());
    }

    #[test]
    fn invalid_json_becomes_error_with_empty_object() {
        let mut pending = PendingToolCall::default();
        pending.start_new("call_1".to_string(), Some("tool_a".to_string()));
        pending.append_arguments("{\"a\":");

        let finalized = pending
            .finalize(ToolCallBoundary::StreamEnd)
            .expect("finalized tool");

        assert_eq!(finalized.arguments, json!({}));
        assert!(finalized.is_error);
    }

    #[test]
    fn repairs_json_with_one_extra_trailing_right_brace() {
        let mut pending = PendingToolCall::default();
        pending.start_new("call_1".to_string(), Some("tool_a".to_string()));
        pending.append_arguments("{\"a\":1}}");

        let finalized = pending
            .finalize(ToolCallBoundary::FinishReason)
            .expect("finalized tool");

        assert_eq!(finalized.raw_arguments, "{\"a\":1}}");
        assert_eq!(finalized.arguments, json!({"a": 1}));
        assert!(!finalized.is_error);
    }

    #[test]
    fn arguments_as_object_map_returns_hash_map_for_objects() {
        let mut pending = PendingToolCall::default();
        pending.start_new("call_1".to_string(), Some("tool_a".to_string()));
        pending.append_arguments("{\"a\":1,\"b\":\"x\"}");

        let finalized = pending
            .finalize(ToolCallBoundary::EndOfAggregation)
            .expect("finalized tool");
        let map = finalized.arguments_as_object_map();

        assert_eq!(map.get("a"), Some(&json!(1)));
        assert_eq!(map.get("b"), Some(&json!("x")));
    }
}
