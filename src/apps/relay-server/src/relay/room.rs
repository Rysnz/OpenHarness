//! Room management for the relay server.
//!
//! Each room holds a single desktop participant connected via WebSocket.
//! Mobile clients interact through HTTP requests that the relay bridges
//! to the desktop via the WebSocket connection. The relay stores no
//! business data; it only routes messages.

use chrono::Utc;
use dashmap::DashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, info, warn};

pub type ConnId = u64;

#[derive(Debug, Clone)]
pub struct OutboundMessage {
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ResponsePayload {
    pub encrypted_data: String,
    pub nonce: String,
}

#[derive(Debug)]
pub struct DesktopConnection {
    pub conn_id: ConnId,
    #[allow(dead_code)]
    pub device_id: String,
    #[allow(dead_code)]
    pub public_key: String,
    pub tx: mpsc::UnboundedSender<OutboundMessage>,
    #[allow(dead_code)]
    pub joined_at: i64,
    pub last_heartbeat: i64,
}

#[derive(Debug)]
pub struct RelayRoom {
    pub room_id: String,
    #[allow(dead_code)]
    pub created_at: i64,
    pub last_activity: i64,
    pub desktop: Option<DesktopConnection>,
}

impl RelayRoom {
    pub fn new(room_id: String) -> Self {
        let now = current_timestamp();
        Self {
            room_id,
            created_at: now,
            last_activity: now,
            desktop: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.desktop.is_none()
    }

    pub fn touch(&mut self) {
        self.last_activity = current_timestamp();
    }

    pub fn attach_desktop(&mut self, desktop: DesktopConnection) {
        self.touch();
        self.desktop = Some(desktop);
    }

    pub fn detach_desktop(&mut self, conn_id: ConnId) -> bool {
        if self.desktop.as_ref().is_some_and(|desktop| desktop.conn_id == conn_id) {
            self.desktop = None;
            return true;
        }

        false
    }

    pub fn send_to_desktop(&self, message: &str) -> bool {
        let Some(desktop) = self.desktop.as_ref() else {
            return false;
        };

        let _ = desktop.tx.send(OutboundMessage {
            text: message.to_string(),
        });
        true
    }

    pub fn update_heartbeat(&mut self, conn_id: ConnId) -> bool {
        if !self.desktop.as_ref().is_some_and(|desktop| desktop.conn_id == conn_id) {
            return false;
        }

        let now = current_timestamp();
        self.last_activity = now;
        if let Some(desktop) = self.desktop.as_mut() {
            desktop.last_heartbeat = now;
        }
        true
    }
}

pub struct RoomManager {
    rooms: DashMap<String, RelayRoom>,
    conn_to_room: DashMap<ConnId, String>,
    next_conn_id: AtomicU64,
    pending_requests: DashMap<String, oneshot::Sender<ResponsePayload>>,
}

impl RoomManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            rooms: DashMap::new(),
            conn_to_room: DashMap::new(),
            next_conn_id: AtomicU64::new(1),
            pending_requests: DashMap::new(),
        })
    }

    pub fn next_conn_id(&self) -> ConnId {
        self.next_conn_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn create_room(
        &self,
        room_id: &str,
        conn_id: ConnId,
        device_id: &str,
        public_key: &str,
        tx: mpsc::UnboundedSender<OutboundMessage>,
    ) -> bool {
        self.detach_connection(conn_id);
        self.rooms.remove(room_id);

        let mut room = RelayRoom::new(room_id.to_string());
        room.attach_desktop(new_desktop_connection(conn_id, device_id, public_key, tx));

        self.rooms.insert(room_id.to_string(), room);
        self.conn_to_room.insert(conn_id, room_id.to_string());

        info!("Room {room_id} created by desktop {device_id}");
        true
    }

    pub fn send_to_desktop(&self, room_id: &str, message: &str) -> bool {
        let Some(mut room) = self.rooms.get_mut(room_id) else {
            return false;
        };

        room.touch();
        room.send_to_desktop(message)
    }

    #[allow(dead_code)]
    pub fn get_desktop_public_key(&self, room_id: &str) -> Option<String> {
        self.rooms
            .get(room_id)
            .and_then(|room| room.desktop.as_ref().map(|desktop| desktop.public_key.clone()))
    }

    pub fn register_pending(&self, correlation_id: String) -> oneshot::Receiver<ResponsePayload> {
        let (sender, receiver) = oneshot::channel();
        self.pending_requests.insert(correlation_id, sender);
        receiver
    }

    pub fn resolve_pending(&self, correlation_id: &str, payload: ResponsePayload) -> bool {
        let Some((_, sender)) = self.pending_requests.remove(correlation_id) else {
            warn!("No pending request for correlation_id={correlation_id}");
            return false;
        };

        sender.send(payload).is_ok()
    }

    pub fn cancel_pending(&self, correlation_id: &str) {
        self.pending_requests.remove(correlation_id);
    }

    pub fn on_disconnect(&self, conn_id: ConnId) {
        if let Some(room_id) = self.detach_connection(conn_id) {
            debug!("Connection {conn_id} detached from room {room_id}");
        }
    }

    pub fn heartbeat(&self, conn_id: ConnId) -> bool {
        let Some(room_id) = self.conn_to_room.get(&conn_id).map(|entry| entry.value().clone()) else {
            return false;
        };

        self.rooms
            .get_mut(&room_id)
            .is_some_and(|mut room| room.update_heartbeat(conn_id))
    }

    pub fn cleanup_stale_rooms(&self, ttl_secs: u64) -> Vec<String> {
        let now = current_timestamp();
        let stale_ids = self.find_stale_room_ids(now, ttl_secs);

        for room_id in &stale_ids {
            self.remove_room(room_id);
            info!("Stale room {room_id} cleaned up");
        }

        stale_ids
    }

    pub fn room_exists(&self, room_id: &str) -> bool {
        self.rooms.contains_key(room_id)
    }

    pub fn has_desktop(&self, room_id: &str) -> bool {
        self.rooms.get(room_id).is_some_and(|room| room.desktop.is_some())
    }

    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    pub fn connection_count(&self) -> usize {
        self.conn_to_room.len()
    }

    fn detach_connection(&self, conn_id: ConnId) -> Option<String> {
        let (_, room_id) = self.conn_to_room.remove(&conn_id)?;
        let should_remove = self
            .rooms
            .get_mut(&room_id)
            .is_some_and(|mut room| {
                if room.detach_desktop(conn_id) {
                    info!("Desktop disconnected from room {room_id}");
                }
                room.is_empty()
            });

        if should_remove {
            self.rooms.remove(&room_id);
            debug!("Empty room {room_id} removed");
        }

        Some(room_id)
    }

    fn find_stale_room_ids(&self, now: i64, ttl_secs: u64) -> Vec<String> {
        self.rooms
            .iter()
            .filter(|room| (now - room.last_activity) as u64 > ttl_secs)
            .map(|room| room.room_id.clone())
            .collect()
    }

    fn remove_room(&self, room_id: &str) {
        if let Some((_, room)) = self.rooms.remove(room_id) {
            if let Some(desktop) = room.desktop {
                self.conn_to_room.remove(&desktop.conn_id);
            }
        }
    }
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp()
}

fn new_desktop_connection(
    conn_id: ConnId,
    device_id: &str,
    public_key: &str,
    tx: mpsc::UnboundedSender<OutboundMessage>,
) -> DesktopConnection {
    let now = current_timestamp();
    DesktopConnection {
        conn_id,
        device_id: device_id.to_string(),
        public_key: public_key.to_string(),
        tx,
        joined_at: now,
        last_heartbeat: now,
    }
}
