use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::util::errors::OpenHarnessResult;
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct MemorySearchTool;

#[async_trait]
impl Tool for MemorySearchTool {
    fn name(&self) -> &str {
        "MemorySearch"
    }

    async fn description(&self) -> OpenHarnessResult<String> {
        Ok("Search the agent's long-term memory for relevant facts, past sessions, and learned preferences. Use this before starting work to recall relevant context from previous conversations.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query — keywords or natural language describing what to recall"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        })
    }

    async fn call_impl(
        &self,
        args: &Value,
        context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let top_k = args.get("top_k").and_then(|v| v.as_u64()).unwrap_or(5) as usize;

        let Some(workspace) = context.workspace.as_ref() else {
            return Ok(vec![ToolResult::Result {
                data: json!({"error": "No workspace available for memory search"}),
                result_for_assistant: Some("Memory search requires a workspace.".to_string()),
                image_attachments: None,
            }]);
        };

        let search_service =
            match crate::service::agent_memory::search::MemorySearchService::load(
                workspace.root_path(),
            )
            .await
            {
                Ok(service) => service,
                Err(e) => {
                    return Ok(vec![ToolResult::Result {
                        data: json!({"error": format!("Failed to load memory: {}", e)}),
                        result_for_assistant: Some(format!("Memory not available: {}", e)),
                        image_attachments: None,
                    }]);
                }
            };

        let results = search_service.search(query, top_k);

        if results.is_empty() {
            return Ok(vec![ToolResult::Result {
                data: json!({"results": [], "message": "No relevant memories found"}),
                result_for_assistant: Some(
                    "No relevant memories found for this query.".to_string(),
                ),
                image_attachments: None,
            }]);
        }

        let result_items: Vec<Value> = results
            .iter()
            .map(|(entry, score)| {
                json!({
                    "id": entry.id,
                    "tier": entry.tier.as_str(),
                    "content": entry.content,
                    "importance": entry.importance,
                    "score": score,
                    "session_id": entry.session_id,
                    "created_at": entry.created_at.to_rfc3339(),
                    "tags": entry.tags,
                })
            })
            .collect();

        let summary = results
            .iter()
            .map(|(entry, _)| format!("[{}] {}", entry.tier.as_str(), entry.content))
            .collect::<Vec<_>>()
            .join("\n");

        Ok(vec![ToolResult::Result {
            data: json!({
                "results": result_items,
                "count": result_items.len(),
            }),
            result_for_assistant: Some(format!(
                "Found {} relevant memories:\n{}",
                result_items.len(),
                summary
            )),
            image_attachments: None,
        }])
    }

    fn needs_permissions(&self, _args: Option<&Value>) -> bool {
        false
    }
}

pub struct MemorySaveTool;

#[async_trait]
impl Tool for MemorySaveTool {
    fn name(&self) -> &str {
        "MemorySave"
    }

    async fn description(&self) -> OpenHarnessResult<String> {
        Ok("Save an important fact, preference, or decision to the agent's long-term memory. Use this when the user teaches you something that should persist across sessions.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The fact or knowledge to remember"
                },
                "importance": {
                    "type": "number",
                    "description": "Importance score from 0.0 (trivial) to 1.0 (critical), default 0.7",
                    "default": 0.7
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional tags for categorization"
                }
            },
            "required": ["content"]
        })
    }

    async fn call_impl(
        &self,
        args: &Value,
        context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let importance = args
            .get("importance")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7) as f32;
        let tags: Vec<String> = args
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        if content.is_empty() {
            return Ok(vec![ToolResult::Result {
                data: json!({"error": "Content cannot be empty"}),
                result_for_assistant: Some("Cannot save empty memory.".to_string()),
                image_attachments: None,
            }]);
        }

        let Some(workspace) = context.workspace.as_ref() else {
            return Ok(vec![ToolResult::Result {
                data: json!({"error": "No workspace available"}),
                result_for_assistant: Some("Memory save requires a workspace.".to_string()),
                image_attachments: None,
            }]);
        };

        let session_id = context.session_id.clone().unwrap_or_default();
        let agent_name = context
            .agent_type
            .clone()
            .unwrap_or_else(|| "agent".to_string());

        let mut entry = crate::service::agent_memory::models::MemoryEntry::new(
            crate::service::agent_memory::models::MemoryTier::Semantic,
            content.clone(),
            session_id,
            agent_name,
        );
        entry.importance = importance;
        entry.tags = tags;

        let storage =
            crate::service::agent_memory::storage::MemoryStorage::new(workspace.root_path());
        match storage.save_entry(&entry).await {
            Ok(_) => Ok(vec![ToolResult::Result {
                data: json!({
                    "success": true,
                    "id": entry.id,
                    "content": content,
                }),
                result_for_assistant: Some(format!("Saved to memory: {}", content)),
                image_attachments: None,
            }]),
            Err(e) => Ok(vec![ToolResult::Result {
                data: json!({"error": format!("Failed to save: {}", e)}),
                result_for_assistant: Some(format!("Failed to save memory: {}", e)),
                image_attachments: None,
            }]),
        }
    }

    fn needs_permissions(&self, _args: Option<&Value>) -> bool {
        false
    }
}

pub struct MemoryRecapTool;

#[async_trait]
impl Tool for MemoryRecapTool {
    fn name(&self) -> &str {
        "MemoryRecap"
    }

    async fn description(&self) -> OpenHarnessResult<String> {
        Ok("Generate a summary of what happened in the current session, including tools used and files touched.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn call_impl(
        &self,
        _args: &Value,
        context: &ToolUseContext,
    ) -> OpenHarnessResult<Vec<ToolResult>> {
        let Some(workspace) = context.workspace.as_ref() else {
            return Ok(vec![ToolResult::Result {
                data: json!({"error": "No workspace available"}),
                result_for_assistant: Some("Memory recap requires a workspace.".to_string()),
                image_attachments: None,
            }]);
        };

        let session_id = context.session_id.clone().unwrap_or_default();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let obs_file = workspace
            .root_path()
            .join(".openharness")
            .join("memory")
            .join("observations")
            .join(format!("{}.jsonl", today));

        if !obs_file.exists() {
            return Ok(vec![ToolResult::Result {
                data: json!({"observations": 0, "message": "No observations recorded yet"}),
                result_for_assistant: Some(
                    "No observations recorded for this session yet.".to_string(),
                ),
                image_attachments: None,
            }]);
        }

        let content = tokio::fs::read_to_string(&obs_file)
            .await
            .unwrap_or_default();
        let observations: Vec<crate::service::agent_memory::capture::CapturedObservation> =
            content
                .lines()
                .filter_map(|line| serde_json::from_str(line).ok())
                .filter(|obs: &crate::service::agent_memory::capture::CapturedObservation| {
                    obs.session_id == session_id
                })
                .collect();

        let tools_used: Vec<String> = observations
            .iter()
            .map(|o| o.tool_name.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let files: Vec<String> = observations
            .iter()
            .flat_map(|o| o.file_paths.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let error_count = observations.iter().filter(|o| o.is_error).count();

        Ok(vec![ToolResult::Result {
            data: json!({
                "session_id": session_id,
                "total_observations": observations.len(),
                "tools_used": tools_used,
                "files": files,
                "errors": error_count,
            }),
            result_for_assistant: Some(format!(
                "Session recap: {} tool operations ({} errors). Tools: {}. Files: {}.",
                observations.len(),
                error_count,
                tools_used.join(", "),
                if files.is_empty() {
                    "none".to_string()
                } else {
                    files.join(", ")
                }
            )),
            image_attachments: None,
        }])
    }

    fn needs_permissions(&self, _args: Option<&Value>) -> bool {
        false
    }
}

pub async fn register_memory_tools() {
    use crate::agentic::tools::registry::get_global_tool_registry;
    let registry = get_global_tool_registry();
    let mut reg = registry.write().await;
    reg.register_tool(std::sync::Arc::new(MemorySearchTool));
    reg.register_tool(std::sync::Arc::new(MemorySaveTool));
    reg.register_tool(std::sync::Arc::new(MemoryRecapTool));
    log::info!("Registered memory tools: MemorySearch, MemorySave, MemoryRecap");
}
