//! Shared relay types for embedded and standalone relay server.
//!
//! Provides:
//! - `WebAssetStore` trait — abstract asset storage
//! - `MemoryAssetStore` — in-memory DashMap-backed store (embedded relay)
//! - `RoomManager` — WebSocket room / connection management

pub mod room;

use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;

// ── WebAssetStore trait ───────────────────────────────────────────────

/// Abstract storage for per-room mobile-web static assets.
///
/// The standalone relay uses `DiskAssetStore` (filesystem-backed), while
/// the embedded relay uses `MemoryAssetStore` (in-memory DashMap-backed).
pub trait WebAssetStore: Send + Sync + 'static {
    fn has_content(&self, hash: &str) -> bool;
    fn store_content(&self, hash: &str, data: Vec<u8>) -> Result<(), String>;
    fn map_to_room(&self, room_id: &str, rel_path: &str, hash: &str) -> Result<(), String>;
    fn get_file(&self, room_id: &str, path: &str) -> Option<Vec<u8>>;
    fn has_room_files(&self, room_id: &str) -> bool;
    fn cleanup_room(&self, room_id: &str);
}

// ── MemoryAssetStore ──────────────────────────────────────────────────

/// In-memory asset store backed by DashMap. Used by the embedded relay.
pub struct MemoryAssetStore {
    content_store: DashMap<String, Arc<Vec<u8>>>,
    room_manifests: DashMap<String, HashMap<String, String>>,
}

impl MemoryAssetStore {
    pub fn new() -> Self {
        Self {
            content_store: DashMap::new(),
            room_manifests: DashMap::new(),
        }
    }
}

impl Default for MemoryAssetStore {
    fn default() -> Self {
        Self::new()
    }
}

impl WebAssetStore for MemoryAssetStore {
    fn has_content(&self, hash: &str) -> bool {
        self.content_store.contains_key(hash)
    }

    fn store_content(&self, hash: &str, data: Vec<u8>) -> Result<(), String> {
        self.content_store
            .entry(hash.to_string())
            .or_insert_with(|| Arc::new(data));
        Ok(())
    }

    fn map_to_room(&self, room_id: &str, rel_path: &str, hash: &str) -> Result<(), String> {
        self.room_manifests
            .entry(room_id.to_string())
            .or_default()
            .insert(rel_path.to_string(), hash.to_string());
        Ok(())
    }

    fn get_file(&self, room_id: &str, path: &str) -> Option<Vec<u8>> {
        let manifest = self.room_manifests.get(room_id)?;
        let hash = manifest.get(path).or_else(|| manifest.get("index.html"))?;
        let content = self.content_store.get(hash)?;
        Some(content.value().as_ref().clone())
    }

    fn has_room_files(&self, room_id: &str) -> bool {
        self.room_manifests.contains_key(room_id)
    }

    fn cleanup_room(&self, room_id: &str) {
        self.room_manifests.remove(room_id);
    }
}
