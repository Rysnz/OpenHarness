use chrono::{DateTime, Utc};
use dashmap::DashMap;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::fs;

const OBSERVATIONS_DIR: &str = "observations";
const DEDUP_WINDOW_SECS: u64 = 300; // 5 minutes
const OBSERVATION_FILE_MAX_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedObservation {
    pub id: String,
    pub tool_name: String,
    pub tool_input_summary: String,
    pub tool_output_summary: String,
    pub file_paths: Vec<String>,
    pub timestamp: DateTime<Utc>,
    pub session_id: String,
    pub agent_name: String,
    pub is_error: bool,
}

struct PrivacyFilter;

impl PrivacyFilter {
    fn filter(text: &str) -> String {
        let mut result = text.to_string();

        // API keys and tokens
        let patterns = [
            r"(?i)(sk-[a-zA-Z0-9]{20,})",
            r"(?i)(ghp_[a-zA-Z0-9]{36})",
            r"(?i)(gho_[a-zA-Z0-9]{36})",
            r"(?i)(github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})",
            r"(?i)(Bearer\s+[a-zA-Z0-9._\-]{20,})",
            r"(?i)(-----BEGIN[A-Z\s]*KEY-----)",
            r#"(?i)("(?:api[_-]?key|api[_-]?secret|password|passwd|token|secret[_-]?key|access[_-]?key|private[_-]?key)"\s*[:=]\s*"[^"]{8,}")"#,
            r#"(?i)('(?:api[_-]?key|api[_-]?secret|password|passwd|token|secret[_-]?key|access[_-]?key|private[_-]?key)'\s*[:=]\s*'[^']{8,}')"#,
        ];

        for pattern in &patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                result = re
                    .replace_all(&result, "[REDACTED]")
                    .into_owned();
            }
        }

        // Environment variable patterns
        let env_patterns = [
            r"\$\{(?:SECRET|API_KEY|API_SECRET|PASSWORD|TOKEN|PRIVATE_KEY|ACCESS_KEY)\}",
            r"\$\{(?:secret|api_key|api_secret|password|token|private_key|access_key)\}",
        ];

        for pattern in &env_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                result = re
                    .replace_all(&result, "[REDACTED_ENV]")
                    .into_owned();
            }
        }

        // <private> tags
        if let Ok(re) = regex::Regex::new(r"(?s)<private>.*?</private>") {
            result = re
                .replace_all(&result, "[REDACTED_PRIVATE]")
                .into_owned();
        }

        result
    }
}

/// MemoryCaptureService: automatically captures tool use observations via hooks
pub struct MemoryCaptureService {
    workspace_root: PathBuf,
    dedup_cache: Arc<DashMap<String, Instant>>,
}

impl MemoryCaptureService {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            dedup_cache: Arc::new(DashMap::new()),
        }
    }

    fn observations_dir(&self) -> PathBuf {
        self.workspace_root
            .join(".openharness")
            .join("memory")
            .join(OBSERVATIONS_DIR)
    }

    fn compute_dedup_hash(tool_name: &str, input_summary: &str, output_summary: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(tool_name.as_bytes());
        hasher.update(b"|");
        hasher.update(input_summary.as_bytes());
        hasher.update(b"|");
        hasher.update(output_summary.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn is_duplicate(&self, hash: &str) -> bool {
        self.evict_expired();

        if let Some(entry) = self.dedup_cache.get(hash) {
            entry.elapsed().as_secs() < DEDUP_WINDOW_SECS
        } else {
            false
        }
    }

    fn record_hash(&self, hash: String) {
        self.dedup_cache.insert(hash, Instant::now());
    }

    fn evict_expired(&self) {
        self.dedup_cache
            .retain(|_, instant| instant.elapsed().as_secs() < DEDUP_WINDOW_SECS);
    }

    fn truncate_summary(text: &str, max_chars: usize) -> String {
        if text.chars().count() <= max_chars {
            text.to_string()
        } else {
            let truncated: String = text.chars().take(max_chars).collect();
            format!("{}...", truncated)
        }
    }

    fn extract_file_paths(input_json: &serde_json::Value) -> Vec<String> {
        let mut paths = Vec::new();
        let path_keys = [
            "file_path",
            "path",
            "relative_path",
            "working_directory",
            "target_path",
            "source_path",
        ];

        for key in &path_keys {
            if let Some(value) = input_json.get(*key) {
                if let Some(s) = value.as_str() {
                    if !s.is_empty() {
                        paths.push(s.to_string());
                    }
                }
            }
        }

        // Also check args array for file-like paths
        if let Some(args) = input_json.get("args").and_then(|v| v.as_array()) {
            for arg in args {
                if let Some(s) = arg.as_str() {
                    if s.contains('/') || s.contains('\\') || s.contains('.') {
                        if !s.starts_with('-') && s.len() < 500 {
                            paths.push(s.to_string());
                        }
                    }
                }
            }
        }

        paths
    }

    /// Called when a tool use completes (success or failure)
    pub async fn on_post_tool_use(
        &self,
        tool_name: &str,
        tool_input: &serde_json::Value,
        tool_output: &str,
        is_error: bool,
        session_id: &str,
        agent_name: &str,
    ) {
        let filtered_output = PrivacyFilter::filter(tool_output);
        let input_summary = Self::truncate_summary(
            &Self::summarize_input(tool_input),
            500,
        );
        let output_summary = Self::truncate_summary(&filtered_output, 1000);

        let hash = Self::compute_dedup_hash(tool_name, &input_summary, &output_summary);
        if self.is_duplicate(&hash) {
            debug!(
                "Skipping duplicate observation: tool={}, hash={}",
                tool_name, &hash[..16]
            );
            return;
        }

        let file_paths = Self::extract_file_paths(tool_input);

        let observation = CapturedObservation {
            id: format!("obs-{}", uuid::Uuid::new_v4()),
            tool_name: tool_name.to_string(),
            tool_input_summary: input_summary,
            tool_output_summary: output_summary,
            file_paths,
            timestamp: Utc::now(),
            session_id: session_id.to_string(),
            agent_name: agent_name.to_string(),
            is_error,
        };

        self.record_hash(hash);

        if let Err(e) = self.persist_observation(&observation).await {
            warn!("Failed to persist memory observation: {}", e);
        } else {
            debug!(
                "Captured observation: tool={}, session={}, id={}",
                tool_name, session_id, observation.id
            );
        }
    }

    fn summarize_input(input: &serde_json::Value) -> String {
        if input.is_null() {
            return "(null)".to_string();
        }

        if let Some(obj) = input.as_object() {
            // Prioritize meaningful fields
            let mut parts = Vec::new();

            for key in &["command", "content", "query", "message", "text", "pattern"] {
                if let Some(value) = obj.get(*key) {
                    if let Some(s) = value.as_str() {
                        if !s.is_empty() {
                            parts.push(format!("{}: {}", key, Self::truncate_summary(s, 200)));
                        }
                    }
                }
            }

            for key in &["file_path", "path"] {
                if let Some(value) = obj.get(*key) {
                    if let Some(s) = value.as_str() {
                        if !s.is_empty() {
                            parts.push(format!("{}: {}", key, s));
                        }
                    }
                }
            }

            if parts.is_empty() {
                let field_names: Vec<&str> = obj.keys().take(5).map(|s| s.as_str()).collect();
                format!("fields: {}", field_names.join(", "))
            } else {
                parts.join("; ")
            }
        } else if let Some(s) = input.as_str() {
            Self::truncate_summary(s, 200)
        } else {
            format!("{:?} type", if input.is_array() { "array" } else { "other" })
        }
    }

    async fn persist_observation(&self, observation: &CapturedObservation) -> Result<(), String> {
        let dir = self.observations_dir();
        fs::create_dir_all(&dir).await.map_err(|e| {
            format!("Failed to create observations directory: {}", e)
        })?;

        // Check file size limit
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let file_path = dir.join(format!("{}.jsonl", today));

        if file_path.exists() {
            let metadata = fs::metadata(&file_path).await.map_err(|e| {
                format!("Failed to check observation file metadata: {}", e)
            })?;
            if metadata.len() > OBSERVATION_FILE_MAX_SIZE_BYTES {
                warn!(
                    "Observation file exceeds size limit, skipping: path={}, size={}",
                    file_path.display(),
                    metadata.len()
                );
                return Ok(());
            }
        }

        let json_line = serde_json::to_string(observation)
            .map_err(|e| format!("Failed to serialize observation: {}", e))?;

        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .map_err(|e| format!("Failed to open observation file: {}", e))?;

        file.write_all(json_line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write observation: {}", e))?;
        file.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to write newline: {}", e))?;

        Ok(())
    }

    /// Clear the dedup cache (for testing)
    #[cfg(test)]
    pub fn clear_dedup_cache(&self) {
        self.dedup_cache.clear();
    }
}

static GLOBAL_MEMORY_CAPTURE: std::sync::OnceLock<Arc<MemoryCaptureService>> =
    std::sync::OnceLock::new();

/// Initialize the global MemoryCaptureService with a workspace root path.
/// Returns true if this call initialized it, false if it was already set.
#[allow(dead_code)]
pub fn init_global_memory_capture(workspace_root: PathBuf) -> bool {
    GLOBAL_MEMORY_CAPTURE
        .set(Arc::new(MemoryCaptureService::new(workspace_root)))
        .is_ok()
}

/// Get the global MemoryCaptureService, initializing with the given workspace if needed.
pub fn get_or_init_global_memory_capture(workspace_root: PathBuf) -> Arc<MemoryCaptureService> {
    GLOBAL_MEMORY_CAPTURE
        .get_or_init(|| Arc::new(MemoryCaptureService::new(workspace_root)))
        .clone()
}

/// Get the global MemoryCaptureService if already initialized.
#[allow(dead_code)]
pub fn get_global_memory_capture() -> Option<Arc<MemoryCaptureService>> {
    GLOBAL_MEMORY_CAPTURE.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace() -> PathBuf {
        std::env::temp_dir().join(format!("openharness-memory-capture-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn privacy_filter_redacts_api_keys() {
        let input = "Using key sk-abc1234567890123456789012345 to authenticate";
        let filtered = PrivacyFilter::filter(input);
        assert!(filtered.contains("[REDACTED]"));
        assert!(!filtered.contains("sk-abc123"));
    }

    #[test]
    fn privacy_filter_redacts_github_tokens() {
        let input = "token: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
        let filtered = PrivacyFilter::filter(input);
        assert!(filtered.contains("[REDACTED]"));
        assert!(!filtered.contains("ghp_"));
    }

    #[test]
    fn privacy_filter_redacts_bearer_tokens() {
        let input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let filtered = PrivacyFilter::filter(input);
        assert!(filtered.contains("[REDACTED]"));
        assert!(!filtered.contains("eyJhbG"));
    }

    #[test]
    fn privacy_filter_redacts_env_vars() {
        let input = "Connecting with ${API_KEY} and ${SECRET}";
        let filtered = PrivacyFilter::filter(input);
        assert!(filtered.contains("[REDACTED_ENV]"));
        assert!(!filtered.contains("${API_KEY}"));
    }

    #[test]
    fn privacy_filter_redacts_private_tags() {
        let input = "Before <private>secret content here</private> after";
        let filtered = PrivacyFilter::filter(input);
        assert!(filtered.contains("[REDACTED_PRIVATE]"));
        assert!(!filtered.contains("secret content"));
    }

    #[test]
    fn dedup_hash_is_deterministic() {
        let hash1 =
            MemoryCaptureService::compute_dedup_hash("Bash", "echo hi", "hi");
        let hash2 =
            MemoryCaptureService::compute_dedup_hash("Bash", "echo hi", "hi");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn dedup_hash_differs_for_different_inputs() {
        let hash1 =
            MemoryCaptureService::compute_dedup_hash("Bash", "echo hi", "hi");
        let hash2 =
            MemoryCaptureService::compute_dedup_hash("Bash", "echo bye", "bye");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn truncate_summary_preserves_short_text() {
        assert_eq!(
            MemoryCaptureService::truncate_summary("hello", 10),
            "hello"
        );
    }

    #[test]
    fn truncate_summary_cuts_long_text() {
        let result = MemoryCaptureService::truncate_summary("hello world", 5);
        assert_eq!(result, "hello...");
    }

    #[test]
    fn summarize_input_extracts_command() {
        let input = serde_json::json!({"command": "echo hello"});
        let summary = MemoryCaptureService::summarize_input(&input);
        assert!(summary.contains("command: echo hello"));
    }

    #[test]
    fn summarize_input_extracts_file_path() {
        let input = serde_json::json!({"file_path": "/src/main.rs"});
        let summary = MemoryCaptureService::summarize_input(&input);
        assert!(summary.contains("file_path: /src/main.rs"));
    }

    #[test]
    fn extract_file_paths_finds_multiple_keys() {
        let input = serde_json::json!({
            "file_path": "/src/main.rs",
            "working_directory": "/workspace"
        });
        let paths = MemoryCaptureService::extract_file_paths(&input);
        assert!(paths.contains(&"/src/main.rs".to_string()));
        assert!(paths.contains(&"/workspace".to_string()));
    }

    #[test]
    fn extract_file_paths_ignores_flags_in_args() {
        let input = serde_json::json!({
            "args": ["-la", "/src/main.rs", "--verbose"]
        });
        let paths = MemoryCaptureService::extract_file_paths(&input);
        assert!(paths.contains(&"/src/main.rs".to_string()));
        assert!(!paths.iter().any(|p| p.starts_with('-')));
    }

    #[tokio::test]
    async fn dedup_cache_prevents_duplicate_within_window() {
        let workspace = temp_workspace();
        let service = MemoryCaptureService::new(workspace.clone());

        let hash = MemoryCaptureService::compute_dedup_hash("Bash", "echo hi", "hi");
        assert!(!service.is_duplicate(&hash));

        service.record_hash(hash.clone());
        assert!(service.is_duplicate(&hash));

        service.clear_dedup_cache();
        assert!(!service.is_duplicate(&hash));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn on_post_tool_use_persists_observation() {
        let workspace = temp_workspace();
        let service = MemoryCaptureService::new(workspace.clone());

        service
            .on_post_tool_use(
                "Bash",
                &serde_json::json!({"command": "echo hello"}),
                "hello",
                false,
                "session-1",
                "agentic",
            )
            .await;

        let obs_dir = workspace.join(".openharness").join("memory").join("observations");
        assert!(obs_dir.exists());

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let obs_file = obs_dir.join(format!("{}.jsonl", today));
        assert!(obs_file.exists());

        let content = fs::read_to_string(&obs_file).await.unwrap();
        let observation: CapturedObservation =
            serde_json::from_str(content.lines().next().unwrap()).unwrap();

        assert_eq!(observation.tool_name, "Bash");
        assert_eq!(observation.session_id, "session-1");
        assert_eq!(observation.agent_name, "agentic");
        assert!(!observation.is_error);
        assert!(observation.tool_output_summary.contains("hello"));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn on_post_tool_use_deduplicates_within_window() {
        let workspace = temp_workspace();
        let service = MemoryCaptureService::new(workspace.clone());

        service
            .on_post_tool_use(
                "Bash",
                &serde_json::json!({"command": "echo hello"}),
                "hello",
                false,
                "session-1",
                "agentic",
            )
            .await;

        // Same call again - should be deduplicated
        service
            .on_post_tool_use(
                "Bash",
                &serde_json::json!({"command": "echo hello"}),
                "hello",
                false,
                "session-1",
                "agentic",
            )
            .await;

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let obs_file = workspace
            .join(".openharness")
            .join("memory")
            .join("observations")
            .join(format!("{}.jsonl", today));

        let content = fs::read_to_string(&obs_file).await.unwrap();
        assert_eq!(
            content.lines().count(),
            1,
            "Second identical observation should be deduplicated"
        );

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn on_post_tool_use_records_errors() {
        let workspace = temp_workspace();
        let service = MemoryCaptureService::new(workspace.clone());

        service
            .on_post_tool_use(
                "Bash",
                &serde_json::json!({"command": "false"}),
                "command failed with exit code 1",
                true,
                "session-1",
                "agentic",
            )
            .await;

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let obs_file = workspace
            .join(".openharness")
            .join("memory")
            .join("observations")
            .join(format!("{}.jsonl", today));

        let content = fs::read_to_string(&obs_file).await.unwrap();
        let observation: CapturedObservation =
            serde_json::from_str(content.lines().next().unwrap()).unwrap();

        assert!(observation.is_error);
        assert!(observation.tool_output_summary.contains("failed"));

        let _ = fs::remove_dir_all(&workspace).await;
    }

    #[tokio::test]
    async fn on_post_tool_use_filters_sensitive_output() {
        let workspace = temp_workspace();
        let service = MemoryCaptureService::new(workspace.clone());

        service
            .on_post_tool_use(
                "Bash",
                &serde_json::json!({"command": "cat .env"}),
                "API_KEY=sk-abc1234567890123456789012345\nDB_PASSWORD=mysecretpassword",
                false,
                "session-1",
                "agentic",
            )
            .await;

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let obs_file = workspace
            .join(".openharness")
            .join("memory")
            .join("observations")
            .join(format!("{}.jsonl", today));

        let content = fs::read_to_string(&obs_file).await.unwrap();
        let observation: CapturedObservation =
            serde_json::from_str(content.lines().next().unwrap()).unwrap();

        assert!(
            !observation.tool_output_summary.contains("sk-abc123"),
            "API key should be redacted from observation"
        );
        assert!(observation.tool_output_summary.contains("[REDACTED]"));

        let _ = fs::remove_dir_all(&workspace).await;
    }
}
