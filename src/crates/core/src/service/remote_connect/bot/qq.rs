//! QQ Bot integration via official QQ Bot API (WebSocket + HTTP).

use crate::service::remote_connect::bot::command_router::{
    self, BotChatState, BotInteractionHandler, BotInteractiveRequest, BotMessageSender,
    ForwardedTurnResult,
};
use crate::service::remote_connect::bot::{load_bot_persistence, save_bot_persistence, BotConfig, SavedBotConnection};
use anyhow::{anyhow, Result};
use log::{info, warn};
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{watch, Mutex};

const QQ_API_BASE: &str = "https://api.sgroup.qq.com";

#[derive(Debug, Clone, Deserialize)]
struct TokenResponse { access_token: String, expires_in: u64 }

#[derive(Debug, Clone, Deserialize)]
struct GatewayResponse { url: String }

#[derive(Debug, Clone, Deserialize)]
struct WsPayload { op: u32, #[serde(default)] s: Option<u32>, #[serde(default)] t: Option<String> }

#[derive(Debug, Clone, Deserialize)]
struct WsEvent { id: String, content: String, author: WsAuthor, #[serde(default)] channel_id: Option<String>, #[serde(default)] group_openid: Option<String> }

#[derive(Debug, Clone, Deserialize)]
struct WsAuthor { id: String, #[serde(default)] user_openid: Option<String> }

#[derive(Debug, Clone)]
pub struct QqBotConfig { pub app_id: String, pub app_secret: String, pub sandbox: bool }

#[derive(Clone)]
pub struct QqBot {
    config: QqBotConfig,
    client: Arc<Client>,
    token: Arc<Mutex<(String, Instant)>>,
    state: Arc<Mutex<BotChatState>>,
    stop_rx: watch::Receiver<bool>,
}

impl QqBot {
    pub fn new(config: QqBotConfig, state: BotChatState, stop_rx: watch::Receiver<bool>) -> Self {
        Self {
            config,
            client: Arc::new(Client::new()),
            token: Arc::new(Mutex::new((String::new(), Instant::now()))),
            state: Arc::new(Mutex::new(state)),
            stop_rx,
        }
    }

    async fn get_token(&self) -> Result<String> {
        let mut g = self.token.lock().await;
        if g.1.elapsed() < Duration::from_secs(3500) && !g.0.is_empty() { return Ok(g.0.clone()); }
        let r: TokenResponse = self.client.post(format!("{QQ_API_BASE}/oauth2/token")).json(&serde_json::json!({"client_id":self.config.app_id,"client_secret":self.config.app_secret,"grant_type":"client_credentials"})).send().await.map_err(|e|anyhow!("QQ token: {e}"))?.json().await.map_err(|e|anyhow!("QQ token parse: {e}"))?;
        g.0 = r.access_token.clone(); g.1 = Instant::now(); Ok(r.access_token)
    }

    async fn send(&self, url: &str, text: &str) -> Result<()> {
        let t = self.get_token().await?;
        let resp = self.client.post(url).header("Authorization", format!("QQBot {t}")).json(&serde_json::json!({"content":text,"msg_type":0})).send().await.map_err(|e|anyhow!("QQ send: {e}"))?;
        if !resp.status().is_success() { let b = resp.text().await.unwrap_or_default(); return Err(anyhow!("QQ send err: {b}")); }
        Ok(())
    }

    /// Send a message to a specific QQ chat URL (used for bot-initiated messages
    /// during forwarded turn execution and interaction delivery).
    pub async fn send_message(&self, reply_url: &str, text: &str) -> Result<()> {
        self.send(reply_url, text).await
    }

    /// Persist the current chat state to disk so workspace/partner/session
    /// selections survive restarts.
    async fn persist_chat_state(&self) {
        let state = self.state.lock().await;
        let mut data = load_bot_persistence();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        data.upsert(SavedBotConnection {
            bot_type: "qq".to_string(),
            chat_id: state.chat_id.clone(),
            chat_state: state.clone(),
            config: BotConfig::Qq {
                app_id: self.config.app_id.clone(),
                app_secret: self.config.app_secret.clone(),
                sandbox: self.config.sandbox,
            },
            connected_at: now_ms,
        });
        save_bot_persistence(&data);
    }

    pub fn pairing_code() -> u32 { use rand::Rng; rand::thread_rng().gen_range(100000..1000000) }

    pub async fn run(self: Arc<Self>) -> Result<()> {
        match self.run_inner().await {
            Err(e) => {
                warn!("QQ WS: {e}, reconnecting in 5s...");
                tokio::time::sleep(Duration::from_secs(5)).await;
                Box::pin(self.run()).await
            }
            Ok(()) => Ok(()),
        }
    }

    async fn run_inner(self: &Arc<Self>) -> Result<()> {
        let gw: GatewayResponse = self.client.get(format!("{QQ_API_BASE}/gateway/bot")).header("Authorization", format!("QQBot {}", self.get_token().await?)).send().await.map_err(|e|anyhow!("QQ gw: {e}"))?.json().await.map_err(|e|anyhow!("QQ gw parse: {e}"))?;
        info!("QQ Bot WS: {}", gw.url);
        let (ws, _) = tokio_tungstenite::connect_async(&gw.url).await.map_err(|e|anyhow!("QQ ws: {e}"))?;
        let (mut tx, mut rx) = ws.split();
        let id = serde_json::json!({"op":2,"d":{"token":format!("QQBot {}", self.get_token().await?),"intents":(1u32<<25)|(1u32<<12),"shard":[0,1]}}).to_string();
        tx.send(tokio_tungstenite::tungstenite::Message::Text(id.into())).await.map_err(|e|anyhow!("QQ identify: {e}"))?;
        let tx = Arc::new(Mutex::new(tx));
        let mut stop = self.stop_rx.clone();
        let code = Arc::new(Mutex::new(Some(Self::pairing_code())));
        use futures::SinkExt;
use futures::StreamExt;
        loop {
            tokio::select! {
                m = rx.next() => match m {
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) => {
                        let p: WsPayload = match serde_json::from_str(&t) { Ok(p) => p, _ => continue };
                        if p.op == 0 {
                            if let Some(ref event_type) = p.t {
                                if let Some(end) = t.find("\"d\":") {
                                    let rest = &t[end+4..];
                                    let depth_end = rest.find(|c| c == '}').unwrap_or(rest.len()-1);
                                    if let Ok(ev) = serde_json::from_str::<WsEvent>(&rest[..=depth_end]) {
                                        let content = ev.content.trim().to_string();
                                        if content.is_empty() { continue; }
                                        let reply_to = match event_type.as_str() {
                                            "GROUP_AT_MESSAGE_CREATE" => (format!("{QQ_API_BASE}/v2/groups/{}/messages", ev.group_openid.unwrap_or_default()), "group"),
                                            "C2C_MESSAGE_CREATE" => (format!("{QQ_API_BASE}/v2/users/{}/messages", ev.author.user_openid.as_deref().unwrap_or(&ev.author.id)), "c2c"),
                                            "AT_MESSAGE_CREATE" => (format!("{QQ_API_BASE}/v2/channels/{}/messages", ev.channel_id.unwrap_or_default()), "channel"),
                                            _ => continue,
                                        };
                                        // Pairing check
                                        let pairing_done = {
                                            let mut cg = code.lock().await;
                                            if let Some(expected) = *cg {
                                                if let Ok(input) = content.parse::<u32>() {
                                                    if input == expected {
                                                        *cg = None;
                                                        true
                                                    } else {
                                                        let _ = self.send(&reply_to.0, "❌ 配对码错误").await;
                                                        continue;
                                                    }
                                                } else {
                                                    false
                                                }
                                            } else {
                                                false
                                            }
                                        };

                                        if pairing_done {
                                            // Complete pairing: bootstrap the chat state
                                            let pairing_result = {
                                                let mut state = self.state.lock().await;
                                                let result = command_router::complete_im_bot_pairing(&mut state).await;
                                                drop(state); // Release lock before persist
                                                result
                                            };
                                            self.persist_chat_state().await;
                                            let _ = self.send(&reply_to.0, &pairing_result.reply).await;
                                            continue;
                                        }
                                        // Command dispatch
                                        let cmd = command_router::parse_command(&content);
                                        let (reply, forward_req) = {
                                            let mut state = self.state.lock().await;
                                            let r = command_router::dispatch_im_bot_command(&mut state, cmd, vec![]).await;
                                            (r.reply, r.forward_to_session)
                                        };
                                        if !reply.is_empty() { let _ = self.send(&reply_to.0, &reply).await; }

                                        // Persist state so partner/session selections survive restarts
                                        self.persist_chat_state().await;

                                        // If the command handler requested an AI turn, spawn it
                                        if let Some(forward) = forward_req {
                                            let bot = self.clone();
                                            let reply_url = reply_to.0.clone();
                                            tokio::spawn(async move {
                                                let interaction_bot = bot.clone();
                                                let interaction_reply_url = reply_url.clone();
                                                let handler: BotInteractionHandler = std::sync::Arc::new(
                                                    move |interaction: BotInteractiveRequest| {
                                                        let interaction_bot = interaction_bot.clone();
                                                        let interaction_reply_url = interaction_reply_url.clone();
                                                        Box::pin(async move {
                                                            // Update state then persist
                                                            {
                                                                let mut s = interaction_bot.state.lock().await;
                                                                s.pending_action = Some(interaction.pending_action.clone());
                                                                s.last_menu_commands = interaction.actions.iter().map(|a| a.command.clone()).collect();
                                                                drop(s); // Release lock before persist
                                                            }
                                                            interaction_bot.persist_chat_state().await;
                                                            if let Err(err) = interaction_bot.send_message(&interaction_reply_url, &interaction.reply).await {
                                                                warn!("Failed to send QQ interaction message: {err}");
                                                            }
                                                        })
                                                    },
                                                );
                                                let msg_bot = bot.clone();
                                                let msg_reply_url = reply_url.clone();
                                                let sender: BotMessageSender = std::sync::Arc::new(
                                                    move |text: String| {
                                                        let msg_bot = msg_bot.clone();
                                                        let msg_reply_url = msg_reply_url.clone();
                                                        Box::pin(async move {
                                                            if let Err(err) = msg_bot.send_message(&msg_reply_url, &text).await {
                                                                warn!("Failed to send QQ intermediate message: {err}");
                                                            }
                                                        })
                                                    },
                                                );
                                                let verbose_mode = load_bot_persistence().verbose_mode;
                                                let result: ForwardedTurnResult = command_router::execute_forwarded_turn(
                                                    forward,
                                                    Some(handler),
                                                    Some(sender),
                                                    verbose_mode,
                                                )
                                                .await;
                                                if !result.display_text.is_empty() {
                                                    if let Err(err) = bot.send_message(&reply_url, &result.display_text).await {
                                                        warn!("Failed to send QQ final message: {err}");
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => return Err(anyhow!("QQ WS closed")),
                    Some(Err(e)) => return Err(anyhow!("QQ WS error: {e}")),
                    _ => {}
                },
                _ = stop.changed() => { info!("QQ Bot stopped"); return Ok(()); }
            }
        }
    }
}
