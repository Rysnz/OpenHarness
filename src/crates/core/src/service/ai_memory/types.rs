//! AI memory data model.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const DEFAULT_MEMORY_SOURCE: &str = "User manually added";
const MAX_IMPORTANCE: u8 = 5;
const METADATA_COUNT: &str = "count";
const METADATA_UPDATED_AT: &str = "updated_at";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    TechPreference,
    ProjectContext,
    UserHabit,
    CodePattern,
    Decision,
    #[default]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIMemory {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memory_type: MemoryType,
    pub tags: Vec<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub importance: u8,
    pub enabled: bool,
}

impl AIMemory {
    pub fn new(title: String, content: String, memory_type: MemoryType, importance: u8) -> Self {
        let now = utc_timestamp();
        Self {
            id: new_memory_id(),
            title,
            content,
            memory_type,
            tags: vec![],
            source: DEFAULT_MEMORY_SOURCE.to_string(),
            created_at: now.clone(),
            updated_at: now,
            importance: clamp_importance(importance),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryStorage {
    pub memories: Vec<AIMemory>,
    pub metadata: HashMap<String, String>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_memory(&mut self, memory: AIMemory) {
        self.memories.push(memory);
        self.update_metadata();
    }

    pub fn remove_memory(&mut self, id: &str) -> bool {
        let len_before = self.memories.len();
        self.memories.retain(|m| m.id != id);
        let removed = self.memories.len() != len_before;
        if removed {
            self.update_metadata();
        }
        removed
    }

    pub fn update_memory(&mut self, memory: AIMemory) -> bool {
        let Some(existing) = self.memories.iter_mut().find(|item| item.id == memory.id) else {
            return false;
        };

        *existing = with_fresh_update_time(memory);
        self.update_metadata();
        true
    }

    pub fn get_enabled_memories(&self) -> Vec<&AIMemory> {
        self.memories
            .iter()
            .filter(|memory| memory.enabled)
            .collect()
    }

    fn update_metadata(&mut self) {
        for (key, value) in self.metadata_entries() {
            self.metadata.insert(key, value);
        }
    }

    fn metadata_entries(&self) -> [(String, String); 2] {
        [
            (METADATA_UPDATED_AT.to_string(), utc_timestamp()),
            (METADATA_COUNT.to_string(), self.memories.len().to_string()),
        ]
    }
}

fn with_fresh_update_time(mut memory: AIMemory) -> AIMemory {
    memory.updated_at = utc_timestamp();
    memory
}

fn clamp_importance(importance: u8) -> u8 {
    importance.min(MAX_IMPORTANCE)
}

fn new_memory_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn utc_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}
