use super::types::CompressionFallbackOptions;
use crate::agentic::core::{CompressedTodoItem, CompressedTodoSnapshot, strip_prompt_markup};
use serde_json::{Map, Value};

const GREP_ARGUMENT_FIELDS: &[&str] = &[
    "pattern",
    "path",
    "glob",
    "type",
    "head_limit",
    "multiline",
    "-A",
    "-B",
    "-C",
    "-i",
    "-n",
    "output_mode",
];

const HEAVY_STRING_KEYS: &[&str] = &[
    "content",
    "contents",
    "old_string",
    "new_string",
    "text",
    "output",
    "stdout",
    "stderr",
    "diff",
    "file_diff",
    "original_content",
    "new_content",
    "data_url",
    "data_base64",
];

pub(super) fn sanitize_user_text(
    text: &str,
    options: &CompressionFallbackOptions,
) -> Option<String> {
    let normalized = strip_prompt_markup(text);
    sanitize_text(&normalized, options.user_chars)
}

pub(super) fn sanitize_assistant_text(
    text: &str,
    options: &CompressionFallbackOptions,
) -> Option<String> {
    sanitize_text(text, options.assistant_chars)
}

pub(super) fn sanitize_todo_snapshot(arguments: &Value) -> Option<CompressedTodoSnapshot> {
    let todos = arguments.get("todos")?.as_array()?;
    let mut compressed_todos = Vec::new();

    for todo in todos {
        let Some(todo_object) = todo.as_object() else {
            continue;
        };
        let Some(content) = todo_object
            .get("content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|content| !content.is_empty())
        else {
            continue;
        };
        let status = todo_object
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending");
        let id = todo_object
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string);

        compressed_todos.push(CompressedTodoItem {
            id,
            content: content.to_string(),
            status: status.to_string(),
        });
    }

    if compressed_todos.is_empty() {
        return None;
    }

    Some(CompressedTodoSnapshot {
        todos: compressed_todos,
        summary: None,
    })
}

pub(super) fn sanitize_tool_arguments(
    tool_name: &str,
    arguments: &Value,
    options: &CompressionFallbackOptions,
) -> Option<Value> {
    let Some(object) = arguments.as_object() else {
        return sanitize_generic_value(arguments, options);
    };

    let sanitized = match tool_name {
        "Read" => SanitizedArguments::from(object)
            .copy_many(&["file_path", "start_line", "limit"])
            .finish(),
        "Write" => SanitizedArguments::from(object)
            .copy("file_path")
            .clear("content")
            .finish(),
        "Edit" => SanitizedArguments::from(object)
            .copy_many(&["file_path", "replace_all"])
            .clear_many(&["old_string", "new_string"])
            .finish(),
        "Grep" => SanitizedArguments::from(object)
            .copy_many(GREP_ARGUMENT_FIELDS)
            .finish(),
        "Glob" => SanitizedArguments::from(object)
            .copy_many(&["pattern", "path", "limit"])
            .finish(),
        "LS" => SanitizedArguments::from(object)
            .copy_many(&["path", "ignore", "limit"])
            .finish(),
        "GetFileDiff" => SanitizedArguments::from(object).copy("file_path").finish(),
        "DeleteFile" => SanitizedArguments::from(object)
            .copy_many(&["path", "recursive"])
            .finish(),
        "Git" => {
            let mut result =
                SanitizedArguments::from(object).copy_many(&["operation", "working_directory"]);
            if let Some(args) = object.get("args") {
                if let Some(value) = sanitize_generic_value(args, options) {
                    result.insert_value("args", value);
                }
            }
            result.finish()
        }
        "Bash" => SanitizedArguments::from(object)
            .sanitize_text("command", options.tool_command_chars)
            .finish(),
        "TerminalControl" => SanitizedArguments::from(object)
            .copy_many(&["action", "terminal_session_id"])
            .finish(),
        "Skill" => SanitizedArguments::from(object).copy("command").finish(),
        "CreatePlan" => SanitizedArguments::from(object)
            .copy_many(&["name", "overview"])
            .clear_many(&["plan", "todos"])
            .finish(),
        "WebSearch" => SanitizedArguments::from(object).copy("query").finish(),
        "WebFetch" => SanitizedArguments::from(object).copy("url").finish(),
        _ => sanitize_generic_object(object, options),
    };

    if sanitized.is_empty() {
        None
    } else {
        Some(Value::Object(sanitized))
    }
}

pub(super) fn sanitize_generic_object(
    object: &Map<String, Value>,
    options: &CompressionFallbackOptions,
) -> Map<String, Value> {
    let mut sanitized = Map::new();

    for (key, value) in object {
        if HEAVY_STRING_KEYS.contains(&key.as_str()) {
            if let Some(text) = value.as_str() {
                sanitized.insert(
                    format!("{key}_chars"),
                    Value::Number(serde_json::Number::from(text.chars().count() as u64)),
                );
            }
            continue;
        }

        if let Some(value) = sanitize_generic_value(value, options) {
            sanitized.insert(key.clone(), value);
        }
    }

    sanitized
}

pub(super) fn sanitize_generic_value(
    value: &Value,
    options: &CompressionFallbackOptions,
) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Bool(_) | Value::Number(_) => Some(value.clone()),
        Value::String(text) => sanitize_text(text, options.tool_arg_chars).map(Value::String),
        Value::Array(values) => {
            let sanitized_values: Vec<Value> = values
                .iter()
                .take(5)
                .filter_map(|value| sanitize_generic_value(value, options))
                .collect();
            if sanitized_values.is_empty() {
                None
            } else {
                Some(Value::Array(sanitized_values))
            }
        }
        Value::Object(object) => {
            let sanitized_object = sanitize_generic_object(object, options);
            if sanitized_object.is_empty() {
                None
            } else {
                Some(Value::Object(sanitized_object))
            }
        }
    }
}

fn sanitize_text(text: &str, limit: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let text_len = trimmed.chars().count();
    if text_len <= limit {
        return Some(trimmed.to_string());
    }

    let mut truncated: String = trimmed.chars().take(limit).collect();
    truncated.push_str(" ... [truncated]");
    Some(truncated)
}

struct SanitizedArguments<'a> {
    source: &'a Map<String, Value>,
    target: Map<String, Value>,
}

impl<'a> SanitizedArguments<'a> {
    fn from(source: &'a Map<String, Value>) -> Self {
        Self {
            source,
            target: Map::new(),
        }
    }

    fn copy(mut self, key: &str) -> Self {
        if let Some(value) = self.source.get(key) {
            self.target.insert(key.to_string(), value.clone());
        }
        self
    }

    fn copy_many(mut self, keys: &[&str]) -> Self {
        for key in keys {
            self = self.copy(key);
        }
        self
    }

    fn clear(mut self, key: &str) -> Self {
        if self.source.get(key).is_some() {
            self.target
                .insert(key.to_string(), Value::String("[cleared]".to_string()));
        }
        self
    }

    fn clear_many(mut self, keys: &[&str]) -> Self {
        for key in keys {
            self = self.clear(key);
        }
        self
    }

    fn sanitize_text(mut self, key: &str, limit: usize) -> Self {
        if let Some(text) = self
            .source
            .get(key)
            .and_then(Value::as_str)
            .and_then(|text| sanitize_text(text, limit))
        {
            self.target.insert(key.to_string(), Value::String(text));
        }
        self
    }

    fn insert_value(&mut self, key: &str, value: Value) {
        self.target.insert(key.to_string(), value);
    }

    fn finish(self) -> Map<String, Value> {
        self.target
    }
}
