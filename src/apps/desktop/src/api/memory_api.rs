use openharness_core::service::agent_memory::models::{MemoryEntry, MemoryTier};
use openharness_core::service::agent_memory::search::MemorySearchService;
use openharness_core::service::agent_memory::storage::MemoryStorage;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySearchRequest {
    pub workspace_path: String,
    pub query: String,
    pub top_k: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySearchResult {
    pub id: String,
    pub tier: String,
    pub content: String,
    pub importance: f32,
    pub score: f32,
    pub session_id: String,
    pub agent_name: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySearchResponse {
    pub results: Vec<MemorySearchResult>,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySaveRequest {
    pub workspace_path: String,
    pub content: String,
    pub importance: Option<f32>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySaveResponse {
    pub success: bool,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySessionSummary {
    pub session_id: String,
    pub agent_name: String,
    pub summary: String,
    pub total_tools: usize,
    pub files: Vec<String>,
    pub tools_used: Vec<String>,
    pub started_at: String,
    pub ended_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryStatsResponse {
    pub working_count: usize,
    pub episodic_count: usize,
    pub semantic_count: usize,
    pub procedural_count: usize,
    pub session_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryDeleteRequest {
    pub workspace_path: String,
    pub entry_id: String,
    pub tier: String,
}

#[tauri::command]
pub async fn memory_search(
    request: MemorySearchRequest,
) -> Result<MemorySearchResponse, String> {
    let workspace = PathBuf::from(&request.workspace_path);
    let search_service = MemorySearchService::load(&workspace)
        .await
        .map_err(|e| format!("Failed to load memory: {}", e))?;

    let top_k = request.top_k.unwrap_or(10);
    let results = search_service.search(&request.query, top_k);

    let search_results: Vec<MemorySearchResult> = results
        .iter()
        .map(|(entry, score)| MemorySearchResult {
            id: entry.id.clone(),
            tier: entry.tier.as_str().to_string(),
            content: entry.content.clone(),
            importance: entry.importance,
            score: *score,
            session_id: entry.session_id.clone(),
            agent_name: entry.agent_name.clone(),
            created_at: entry.created_at.to_rfc3339(),
            tags: entry.tags.clone(),
        })
        .collect();

    let count = search_results.len();
    Ok(MemorySearchResponse {
        results: search_results,
        count,
    })
}

#[tauri::command]
pub async fn memory_save(
    request: MemorySaveRequest,
) -> Result<MemorySaveResponse, String> {
    let workspace = PathBuf::from(&request.workspace_path);
    let storage = MemoryStorage::new(&workspace);

    let mut entry = MemoryEntry::new(
        MemoryTier::Semantic,
        request.content,
        "manual".to_string(),
        "user".to_string(),
    );
    entry.importance = request.importance.unwrap_or(0.7);
    entry.tags = request.tags.unwrap_or_default();

    storage
        .save_entry(&entry)
        .await
        .map_err(|e| format!("Failed to save memory: {}", e))?;

    Ok(MemorySaveResponse {
        success: true,
        id: entry.id,
    })
}

#[tauri::command]
pub async fn memory_sessions(
    workspace_path: String,
) -> Result<Vec<MemorySessionSummary>, String> {
    let workspace = PathBuf::from(&workspace_path);
    let storage = MemoryStorage::new(&workspace);

    let summaries = storage
        .load_session_summaries()
        .await
        .map_err(|e| format!("Failed to load sessions: {}", e))?;

    Ok(summaries
        .iter()
        .map(|s| MemorySessionSummary {
            session_id: s.session_id.clone(),
            agent_name: s.agent_name.clone(),
            summary: s.summary.clone(),
            total_tools: s.total_tools,
            files: s.files.clone(),
            tools_used: s.tools_used.clone(),
            started_at: s.started_at.to_rfc3339(),
            ended_at: s.ended_at.to_rfc3339(),
        })
        .collect())
}

#[tauri::command]
pub async fn memory_stats(
    workspace_path: String,
) -> Result<MemoryStatsResponse, String> {
    let workspace = PathBuf::from(&workspace_path);
    let storage = MemoryStorage::new(&workspace);

    let stats = storage
        .stats()
        .await
        .map_err(|e| format!("Failed to get stats: {}", e))?;

    Ok(MemoryStatsResponse {
        working_count: stats.working_count,
        episodic_count: stats.episodic_count,
        semantic_count: stats.semantic_count,
        procedural_count: stats.procedural_count,
        session_count: stats.session_count,
    })
}

#[tauri::command]
pub async fn memory_delete(
    request: MemoryDeleteRequest,
) -> Result<bool, String> {
    let workspace = PathBuf::from(&request.workspace_path);
    let storage = MemoryStorage::new(&workspace);

    let tier = match request.tier.as_str() {
        "working" => MemoryTier::Working,
        "episodic" => MemoryTier::Episodic,
        "semantic" => MemoryTier::Semantic,
        "procedural" => MemoryTier::Procedural,
        _ => return Err(format!("Unknown tier: {}", request.tier)),
    };

    storage
        .delete_entry(&request.entry_id, tier)
        .await
        .map_err(|e| format!("Failed to delete memory: {}", e))?;

    Ok(true)
}
