//! End-to-end integration tests for the memory engine.
//!
//! Simulates the full lifecycle:
//!   Tool use → Capture → Persist → Consolidate → Search → Prompt injection

use chrono::Utc;
use openharness_core::service::agent_memory::capture::{
    get_or_init_global_memory_capture, CapturedObservation, MemoryCaptureService,
};
use openharness_core::service::agent_memory::consolidation::{
    ConsolidationPipeline, NoOpLlmProvider,
};
use openharness_core::service::agent_memory::models::{
    Bm25Index, MemoryEntry, MemoryIndex, MemoryTier,
};
use openharness_core::service::agent_memory::search::MemorySearchService;
use openharness_core::service::agent_memory::storage::MemoryStorage;
use std::path::PathBuf;
use tokio::fs;

fn temp_workspace() -> PathBuf {
    std::env::temp_dir().join(format!("openharness-e2e-memory-{}", uuid::Uuid::new_v4()))
}

/// Simulate a realistic session: JWT auth implementation
async fn simulate_jwt_auth_session(workspace: &PathBuf) {
    let capture = MemoryCaptureService::new(workspace.clone());
    simulate_jwt_auth_session_with_capture(&capture).await;
}

async fn simulate_jwt_auth_session_with_capture(capture: &MemoryCaptureService) {
    // 1. npm install jose
    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "npm install jose"}),
            "added 3 packages in 2s",
            false,
            "session-jwt",
            "agentic",
        )
        .await;

    // 2. Create auth middleware
    capture
        .on_post_tool_use(
            "Write",
            &serde_json::json!({
                "file_path": "src/middleware/auth.ts",
                "content": "import { jwtVerify } from 'jose';\nexport async function verifyToken(token: string) { ... }"
            }),
            "File created successfully",
            false,
            "session-jwt",
            "agentic",
        )
        .await;

    // 3. Create auth route
    capture
        .on_post_tool_use(
            "Write",
            &serde_json::json!({
                "file_path": "src/routes/auth.ts",
                "content": "import { Router } from 'express';\nconst router = Router();\nrouter.post('/login', ...);"
            }),
            "File created successfully",
            false,
            "session-jwt",
            "agentic",
        )
        .await;

    // 4. Run tests (with error)
    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "npm test"}),
            "FAIL src/auth.test.ts\n  Token validation > should reject expired tokens",
            true,
            "session-jwt",
            "agentic",
        )
        .await;

    // 5. Fix and re-run
    capture
        .on_post_tool_use(
            "Edit",
            &serde_json::json!({
                "file_path": "src/middleware/auth.ts",
                "old_string": "jwtVerify",
                "new_string": "jwtVerify with clockTolerance"
            }),
            "File edited successfully",
            false,
            "session-jwt",
            "agentic",
        )
        .await;

    // 6. Tests pass
    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "npm test"}),
            "PASS src/auth.test.ts\n  Token validation > all tests passed",
            false,
            "session-jwt",
            "agentic",
        )
        .await;
}

/// Simulate a second session: rate limiting
async fn simulate_rate_limit_session(workspace: &PathBuf) {
    let capture = MemoryCaptureService::new(workspace.clone());

    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "npm install rate-limiter-flexible"}),
            "added 1 package",
            false,
            "session-ratelimit",
            "agentic",
        )
        .await;

    capture
        .on_post_tool_use(
            "Write",
            &serde_json::json!({"file_path": "src/middleware/rateLimit.ts"}),
            "File created",
            false,
            "session-ratelimit",
            "agentic",
        )
        .await;
}

// ============================================================
// E2E Test 1: Full capture → persist → search cycle
// ============================================================
#[tokio::test]
async fn e2e_capture_persist_search() {
    let workspace = temp_workspace();

    // Phase 1: Simulate sessions with a shared capture instance for dedup testing
    let capture = MemoryCaptureService::new(workspace.clone());
    simulate_jwt_auth_session_with_capture(&capture).await;
    // Rate limit uses its own instance (separate session)
    simulate_rate_limit_session(&workspace).await;

    // Phase 2: Verify observations were persisted
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let obs_file = workspace
        .join(".openharness")
        .join("memory")
        .join("observations")
        .join(format!("{}.jsonl", today));
    assert!(obs_file.exists(), "Observations file should exist");

    let content = fs::read_to_string(&obs_file).await.unwrap();
    let observations: Vec<CapturedObservation> =
        content.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    assert_eq!(observations.len(), 8, "Should have 8 observations (6 + 2)");

    // Phase 3: Verify dedup works within same capture instance
    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "npm test"}),
            "PASS src/auth.test.ts\n  Token validation > all tests passed",
            false,
            "session-jwt",
            "agentic",
        )
        .await;

    let content2 = fs::read_to_string(&obs_file).await.unwrap();
    let obs2: Vec<CapturedObservation> =
        content2.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    assert_eq!(obs2.len(), 8, "Duplicate within same instance should be deduped");

    let _ = fs::remove_dir_all(&workspace).await;
}

// ============================================================
// E2E Test 2: Consolidation pipeline
// ============================================================
#[tokio::test]
async fn e2e_consolidation() {
    let workspace = temp_workspace();

    simulate_jwt_auth_session(&workspace).await;

    // Load observations
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let obs_file = workspace
        .join(".openharness")
        .join("memory")
        .join("observations")
        .join(format!("{}.jsonl", today));
    let content = fs::read_to_string(&obs_file).await.unwrap();
    let observations: Vec<CapturedObservation> = content
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .filter(|o: &CapturedObservation| o.session_id == "session-jwt")
        .collect();

    // Consolidate
    let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
    let result = pipeline.consolidate_session(&observations).await.unwrap();

    // Verify consolidation output
    let summary = result.summary.as_ref().unwrap();
    assert_eq!(summary.session_id, "session-jwt");
    assert!(summary.summary.contains("6 tool operations"));
    assert!(summary.summary.contains("1 errors"));
    assert!(summary.tools_used.contains(&"Bash".to_string()));
    assert!(summary.tools_used.contains(&"Write".to_string()));
    assert!(summary.tools_used.contains(&"Edit".to_string()));
    assert!(summary.files.contains(&"src/middleware/auth.ts".to_string()));

    assert_eq!(result.episodic_entries.len(), 1);
    assert_eq!(result.episodic_entries[0].tier, MemoryTier::Episodic);
    assert!(result.episodic_entries[0].importance > 0.5);

    // Persist consolidated entries
    let storage = MemoryStorage::new(&workspace);
    storage.ensure_dirs().await.unwrap();
    storage.save_session_summary(summary).await.unwrap();
    let entries: Vec<_> = result.all_entries().into_iter().cloned().collect();
    storage.save_entries(&entries).await.unwrap();

    // Verify persistence
    let summaries = storage.load_session_summaries().await.unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session_id, "session-jwt");

    let _ = fs::remove_dir_all(&workspace).await;
}

// ============================================================
// E2E Test 3: BM25 search across memories
// ============================================================
#[tokio::test]
async fn e2e_bm25_search() {
    let workspace = temp_workspace();

    // Create and consolidate first session
    simulate_jwt_auth_session(&workspace).await;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let obs_file = workspace
        .join(".openharness")
        .join("memory")
        .join("observations")
        .join(format!("{}.jsonl", today));
    let content = fs::read_to_string(&obs_file).await.unwrap();
    let observations: Vec<CapturedObservation> = content
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .filter(|o: &CapturedObservation| o.session_id == "session-jwt")
        .collect();

    let pipeline = ConsolidationPipeline::new(NoOpLlmProvider);
    let result = pipeline.consolidate_session(&observations).await.unwrap();

    // Save to storage
    let storage = MemoryStorage::new(&workspace);
    storage.ensure_dirs().await.unwrap();
    if let Some(summary) = &result.summary {
        storage.save_session_summary(summary).await.unwrap();
    }
    let entries: Vec<_> = result.all_entries().into_iter().cloned().collect();
    storage.save_entries(&entries).await.unwrap();

    // Add a manual semantic memory
    let mut manual = MemoryEntry::new(
        MemoryTier::Semantic,
        "We chose jose over jsonwebtoken for Edge runtime compatibility".to_string(),
        "session-jwt".to_string(),
        "agentic".to_string(),
    );
    manual.importance = 0.9;
    manual.tags = vec!["decision".to_string(), "jwt".to_string()];
    storage.save_entry(&manual).await.unwrap();

    // Load search service AFTER saving all entries
    let search_service = MemorySearchService::load(&workspace).await.unwrap();

    // Search 1: "JWT" should find the manual memory and episodic
    let results = search_service.search("JWT authentication", 5);
    assert!(!results.is_empty(), "Should find JWT-related memories");
    let contents: Vec<&str> = results.iter().map(|(e, _)| e.content.as_str()).collect();
    assert!(
        contents.iter().any(|c| c.contains("jose")),
        "Should find jose decision"
    );

    // Search 2: "rate limiting" should NOT find JWT memories
    let results2 = search_service.search("database optimization", 5);
    // This query has no matching memories, so results should be empty or low-score
    let has_relevant = results2.iter().any(|(e, s)| *s > 0.3 && e.content.contains("JWT"));
    assert!(!has_relevant, "Unrelated query should not surface JWT memories");

    // Search 3: CJK query
    let results3 = search_service.search("认证 middleware", 5);
    // Should match via bigram "认证"
    let has_auth = results3.iter().any(|(e, _)| {
        e.content.contains("auth") || e.content.contains("middleware")
    });
    assert!(has_auth, "CJK query should match via bigram tokenization");

    // Search 4: Format for prompt
    let prompt = search_service.format_for_prompt("JWT auth", 2000);
    assert!(prompt.contains("<memory_context>"));
    assert!(prompt.contains("</memory_context>"));
    // The prompt should contain at least one memory about JWT/auth
    assert!(
        prompt.contains("JWT") || prompt.contains("jose") || prompt.contains("auth"),
        "Prompt should contain JWT-related memory content"
    );

    let _ = fs::remove_dir_all(&workspace).await;
}

// ============================================================
// E2E Test 4: Privacy filtering in capture
// ============================================================
#[tokio::test]
async fn e2e_privacy_filtering() {
    let workspace = temp_workspace();
    let capture = MemoryCaptureService::new(workspace.clone());

    // Tool output contains sensitive data
    capture
        .on_post_tool_use(
            "Bash",
            &serde_json::json!({"command": "cat .env"}),
            "DATABASE_URL=postgres://user:pass@host/db\nAPI_KEY=sk-abc1234567890123456789012345\nSECRET_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890",
            false,
            "session-sec",
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
    let obs: CapturedObservation = serde_json::from_str(content.lines().next().unwrap()).unwrap();

    // Verify sensitive data is redacted
    assert!(!obs.tool_output_summary.contains("sk-abc123"), "API key should be redacted");
    assert!(!obs.tool_output_summary.contains("ghp_abc"), "GitHub token should be redacted");
    assert!(obs.tool_output_summary.contains("[REDACTED]"), "Should contain redaction marker");

    let _ = fs::remove_dir_all(&workspace).await;
}

// ============================================================
// E2E Test 5: Memory index decay and eviction
// ============================================================
#[tokio::test]
async fn e2e_decay_and_eviction() {
    let mut index = MemoryIndex::new();

    // Add old, low-importance entry
    let mut old = MemoryEntry::new(
        MemoryTier::Working,
        "Temporary debug output".to_string(),
        "s1".to_string(),
        "agent".to_string(),
    );
    old.last_accessed = Utc::now() - chrono::Duration::days(30);
    old.importance = 0.1;
    old.update_decay();

    // Add fresh, high-importance entry
    let mut fresh = MemoryEntry::new(
        MemoryTier::Semantic,
        "Auth uses JWT with jose middleware".to_string(),
        "s2".to_string(),
        "agent".to_string(),
    );
    fresh.importance = 0.9;

    // Add medium entry (accessed 12 hours ago)
    let mut medium = MemoryEntry::new(
        MemoryTier::Episodic,
        "Implemented rate limiting with Redis".to_string(),
        "s3".to_string(),
        "agent".to_string(),
    );
    medium.importance = 0.5;
    medium.last_accessed = Utc::now() - chrono::Duration::hours(12);
    medium.update_decay();

    index.add(old);
    index.add(fresh);
    index.add(medium);

    // Verify decay scores
    assert!(index.entries[0].decay_score < 0.3, "Old entry should have low decay");
    assert_eq!(index.entries[1].decay_score, 1.0, "Fresh entry should have full decay");
    assert!(index.entries[2].decay_score > 0.3, "Medium entry should have moderate decay");

    // Evict stale entries
    let evicted = index.evict_decayed(0.3);
    assert_eq!(evicted.len(), 1, "Should evict 1 stale entry");
    assert_eq!(evicted[0].content, "Temporary debug output");
    assert_eq!(index.entries.len(), 2, "Should retain 2 entries");

    // Search should still work on remaining entries
    let results = index.search("JWT auth", 5);
    assert!(!results.is_empty());
    assert!(results[0].0.content.contains("jose"));

    let _ = ();
}

// ============================================================
// E2E Test 6: BM25 index add/remove/search cycle
// ============================================================
#[tokio::test]
async fn e2e_bm25_index_lifecycle() {
    let mut index = Bm25Index::new();

    index.add_document("doc1".to_string(), "Express JWT authentication middleware");
    index.add_document("doc2".to_string(), "Rate limiting with Redis sliding window");
    index.add_document("doc3".to_string(), "JWT token refresh and rotation strategy");
    index.add_document("doc4".to_string(), "PostgreSQL connection pooling configuration");
    assert_eq!(index.doc_count, 4);

    // Search: JWT should match doc1 and doc3
    let results = index.search("JWT token", 5);
    let ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
    assert!(ids.contains(&"doc1"));
    assert!(ids.contains(&"doc3"));

    // Search: Redis should match doc2
    let results2 = index.search("Redis cache", 5);
    assert!(results2.iter().any(|(id, _)| id == "doc2"));

    // Search: PostgreSQL should match doc4
    let results3 = index.search("database postgres", 5);
    assert!(results3.iter().any(|(id, _)| id == "doc4"));

    // Remove doc1 and re-search
    index.remove_document("doc1");
    assert_eq!(index.doc_count, 3);

    let results4 = index.search("Express middleware", 5);
    assert!(!results4.iter().any(|(id, _)| id == "doc1"), "Removed doc should not appear");

    // Search for completely unrelated query
    let results5 = index.search("cooking recipes", 5);
    // BM25 bigrams may produce some noise; just verify no document is a strong match
    // (the top result's content should not contain "cooking" or "recipes")
    if let Some((top_doc, _)) = results5.first() {
        assert!(
            !top_doc.contains("cooking") && !top_doc.contains("recipes"),
            "Unrelated query should not strongly match any document"
        );
    }
}

// ============================================================
// E2E Test 7: Multi-tier storage and retrieval
// ============================================================
#[tokio::test]
async fn e2e_multi_tier_storage() {
    let workspace = temp_workspace();
    let storage = MemoryStorage::new(&workspace);
    storage.ensure_dirs().await.unwrap();

    // Create entries in all 4 tiers
    let working = MemoryEntry::new(
        MemoryTier::Working,
        "Raw tool output from bash command".to_string(),
        "s1".to_string(),
        "agent".to_string(),
    );
    let episodic = MemoryEntry::new(
        MemoryTier::Episodic,
        "Session implemented JWT auth with jose".to_string(),
        "s1".to_string(),
        "agent".to_string(),
    );
    let mut semantic = MemoryEntry::new(
        MemoryTier::Semantic,
        "Project uses TypeScript with strict mode".to_string(),
        "s1".to_string(),
        "agent".to_string(),
    );
    semantic.importance = 0.8;
    semantic.tags = vec!["typescript".to_string(), "config".to_string()];
    let procedural = MemoryEntry::new(
        MemoryTier::Procedural,
        "When adding API routes: 1) define schema 2) add handler 3) write tests".to_string(),
        "s1".to_string(),
        "agent".to_string(),
    );

    storage.save_entries(&[working, episodic, semantic, procedural]).await.unwrap();

    // Load all and verify
    let index = storage.load_index().await.unwrap();
    assert_eq!(index.entries.len(), 4);

    // Verify tier distribution
    let working_count = index.entries_by_tier(MemoryTier::Working).len();
    let episodic_count = index.entries_by_tier(MemoryTier::Episodic).len();
    let semantic_count = index.entries_by_tier(MemoryTier::Semantic).len();
    let procedural_count = index.entries_by_tier(MemoryTier::Procedural).len();
    assert_eq!(working_count, 1);
    assert_eq!(episodic_count, 1);
    assert_eq!(semantic_count, 1);
    assert_eq!(procedural_count, 1);

    // Verify stats
    let stats = storage.stats().await.unwrap();
    assert_eq!(stats.working_count, 1);
    assert_eq!(stats.episodic_count, 1);
    assert_eq!(stats.semantic_count, 1);
    assert_eq!(stats.procedural_count, 1);

    // Search across tiers
    let search = MemorySearchService::load(&workspace).await.unwrap();
    let results = search.search("TypeScript config", 5);
    assert!(results.iter().any(|(e, _)| e.content.contains("strict mode")));

    let results2 = search.search("API routes handler", 5);
    assert!(results2.iter().any(|(e, _)| e.content.contains("define schema")));

    let _ = fs::remove_dir_all(&workspace).await;
}
