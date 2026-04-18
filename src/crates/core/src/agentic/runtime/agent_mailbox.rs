use super::agent_task::AgentTaskId;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{Notify, RwLock};
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentMailboxMessage {
    pub message_id: String,
    pub mailbox_id: String,
    pub from_task_id: Option<AgentTaskId>,
    pub to_task_id: Option<AgentTaskId>,
    pub team_id: Option<String>,
    pub content: String,
    pub created_at_ms: u64,
}

impl AgentMailboxMessage {
    pub fn new(
        content: String,
        from_task_id: Option<AgentTaskId>,
        to_task_id: Option<AgentTaskId>,
        team_id: Option<String>,
    ) -> Self {
        let created_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            message_id: format!("agmsg-{}", uuid::Uuid::new_v4()),
            mailbox_id: String::new(),
            from_task_id,
            to_task_id,
            team_id,
            content,
            created_at_ms,
        }
    }
}

#[derive(Default)]
pub struct AgentMailboxStore {
    messages: RwLock<HashMap<String, VecDeque<AgentMailboxMessage>>>,
    notifiers: RwLock<HashMap<String, Arc<Notify>>>,
}

impl AgentMailboxStore {
    async fn notifier(&self, mailbox_id: &str) -> Arc<Notify> {
        let mut notifiers = self.notifiers.write().await;
        notifiers
            .entry(mailbox_id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    pub async fn send(
        &self,
        mailbox_id: &str,
        mut message: AgentMailboxMessage,
    ) -> AgentMailboxMessage {
        message.mailbox_id = mailbox_id.to_string();
        let notify = self.notifier(mailbox_id).await;

        {
            let mut messages = self.messages.write().await;
            messages
                .entry(mailbox_id.to_string())
                .or_insert_with(VecDeque::new)
                .push_back(message.clone());
        }

        notify.notify_waiters();
        message
    }

    pub async fn recv_all(&self, mailbox_id: &str) -> Vec<AgentMailboxMessage> {
        let mut messages = self.messages.write().await;
        messages
            .remove(mailbox_id)
            .map(|queue| queue.into_iter().collect())
            .unwrap_or_default()
    }

    pub async fn pending_count(&self, mailbox_id: &str) -> usize {
        self.messages
            .read()
            .await
            .get(mailbox_id)
            .map(|queue| queue.len())
            .unwrap_or(0)
    }

    pub async fn wait_and_recv_all(
        &self,
        mailbox_id: &str,
        timeout_ms: Option<u64>,
    ) -> Vec<AgentMailboxMessage> {
        let existing = self.recv_all(mailbox_id).await;
        if !existing.is_empty() {
            return existing;
        }

        let notify = self.notifier(mailbox_id).await;

        if let Some(timeout_ms) = timeout_ms {
            if timeout_ms == 0 {
                return Vec::new();
            }

            if timeout(Duration::from_millis(timeout_ms), notify.notified())
                .await
                .is_err()
            {
                return Vec::new();
            }
        } else {
            notify.notified().await;
        }

        self.recv_all(mailbox_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sends_and_waits_for_messages() {
        let store = AgentMailboxStore::default();
        let mailbox_id = "mailbox-test-1";

        let sent = store
            .send(
                mailbox_id,
                AgentMailboxMessage::new(
                    "hello".to_string(),
                    Some(AgentTaskId::from("agtask-from")),
                    Some(AgentTaskId::from("agtask-to")),
                    None,
                ),
            )
            .await;

        let received = store.wait_and_recv_all(mailbox_id, Some(50)).await;
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].message_id, sent.message_id);
        assert_eq!(received[0].content, "hello");
        assert_eq!(store.pending_count(mailbox_id).await, 0);
    }

    #[tokio::test]
    async fn wait_returns_empty_after_timeout() {
        let store = AgentMailboxStore::default();
        let received = store.wait_and_recv_all("mailbox-timeout", Some(1)).await;
        assert!(received.is_empty());
    }
}
