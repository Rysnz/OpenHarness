//! AI Memory Points API

use openharness_core::infrastructure::PathManager;
use openharness_core::service::ai_memory::{AIMemory, AIMemoryManager, MemoryType};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMemoryRequest {
    pub title: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memory_type: MemoryType,
    pub importance: u8,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMemoryRequest {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memory_type: MemoryType,
    pub importance: u8,
    pub tags: Vec<String>,
    pub enabled: bool,
}

/// Create an AIMemoryManager scoped to user-level or project-level.
async fn create_memory_manager(
    path_manager: &PathManager,
    workspace_path: Option<&str>,
) -> Result<AIMemoryManager, String> {
    match workspace_path {
        Some(path) => AIMemoryManager::new_project(Arc::new(path_manager.clone()), path)
            .await
            .map_err(|e| e.to_string()),
        None => AIMemoryManager::new(Arc::new(path_manager.clone()))
            .await
            .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn get_all_memories(
    path_manager: State<'_, Arc<PathManager>>,
    workspace_path: Option<String>,
) -> Result<Vec<AIMemory>, String> {
    let manager = create_memory_manager(path_manager.inner(), workspace_path.as_deref()).await?;
    manager.get_all_memories().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_memory(
    path_manager: State<'_, Arc<PathManager>>,
    request: CreateMemoryRequest,
    workspace_path: Option<String>,
) -> Result<AIMemory, String> {
    let manager = create_memory_manager(path_manager.inner(), workspace_path.as_deref()).await?;

    let mut memory = AIMemory::new(
        request.title,
        request.content,
        request.memory_type,
        request.importance,
    );

    if let Some(tags) = request.tags {
        memory.tags = tags;
    }

    manager.add_memory(memory).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_memory(
    path_manager: State<'_, Arc<PathManager>>,
    request: UpdateMemoryRequest,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    let manager = create_memory_manager(path_manager.inner(), workspace_path.as_deref()).await?;

    let now = chrono::Utc::now().to_rfc3339();
    let memory = AIMemory {
        id: request.id.clone(),
        title: request.title,
        content: request.content,
        memory_type: request.memory_type,
        tags: request.tags,
        source: "User manual edit".to_string(),
        created_at: now.clone(),
        updated_at: now,
        importance: request.importance.min(5),
        enabled: request.enabled,
    };

    manager
        .update_memory(memory)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_memory(
    path_manager: State<'_, Arc<PathManager>>,
    id: String,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    let manager = create_memory_manager(path_manager.inner(), workspace_path.as_deref()).await?;
    manager.delete_memory(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_memory(
    path_manager: State<'_, Arc<PathManager>>,
    id: String,
    workspace_path: Option<String>,
) -> Result<bool, String> {
    let manager = create_memory_manager(path_manager.inner(), workspace_path.as_deref()).await?;
    manager.toggle_memory(&id).await.map_err(|e| e.to_string())
}
