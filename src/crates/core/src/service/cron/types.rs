//! Scheduled job data types.

use serde::{Deserialize, Serialize};

pub const CRON_JOBS_VERSION: u32 = 1;
pub const DEFAULT_RETRY_DELAY_MS: i64 = 5_000;

fn empty_jobs() -> Vec<CronJob> {
    Vec::new()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobsFile {
    pub version: u32,
    pub jobs: Vec<CronJob>,
}

impl Default for CronJobsFile {
    fn default() -> Self {
        Self {
            version: CRON_JOBS_VERSION,
            jobs: empty_jobs(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub schedule: CronSchedule,
    pub payload: CronJobPayload,
    pub enabled: bool,
    pub session_id: String,
    pub workspace_path: String,
    pub created_at_ms: i64,
    pub config_updated_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub state: CronJobState,
}

impl CronJob {
    pub fn is_one_shot(&self) -> bool {
        self.schedule.is_one_shot()
    }

    pub fn is_runnable(&self) -> bool {
        self.enabled && self.state.active_turn_id.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CronSchedule {
    At {
        at: String,
    },
    Every {
        #[serde(rename = "everyMs")]
        every_ms: u64,
        #[serde(rename = "anchorMs", skip_serializing_if = "Option::is_none")]
        anchor_ms: Option<i64>,
    },
    Cron {
        expr: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tz: Option<String>,
    },
}

impl CronSchedule {
    pub fn is_one_shot(&self) -> bool {
        matches!(self, Self::At { .. })
    }

    pub fn timezone(&self) -> Option<&str> {
        match self {
            Self::Cron { tz, .. } => tz.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobPayload {
    pub text: String,
}

impl CronJobPayload {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CronJobRunStatus {
    Queued,
    Running,
    Ok,
    Error,
    Cancelled,
}

impl CronJobRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Ok | Self::Error | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_trigger_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_trigger_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_enqueued_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_started_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_finished_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_status: Option<CronJobRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(default)]
    pub consecutive_failures: u32,
    #[serde(default)]
    pub coalesced_run_count: u32,
}

impl CronJobState {
    pub fn clear_pending_trigger(&mut self) {
        self.pending_trigger_at_ms = None;
    }

    pub fn mark_enqueued(&mut self, queued_at_ms: i64, active_turn_id: String) {
        self.last_enqueued_at_ms = Some(queued_at_ms);
        self.pending_trigger_at_ms = None;
        self.active_turn_id = Some(active_turn_id);
        self.last_run_status = Some(CronJobRunStatus::Queued);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCronJobRequest {
    pub name: String,
    pub schedule: CronSchedule,
    pub payload: CronJobPayload,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub session_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCronJobRequest {
    pub name: Option<String>,
    pub schedule: Option<CronSchedule>,
    pub payload: Option<CronJobPayload>,
    pub enabled: Option<bool>,
    pub session_id: Option<String>,
    pub workspace_path: Option<String>,
}

const fn default_enabled() -> bool {
    true
}
