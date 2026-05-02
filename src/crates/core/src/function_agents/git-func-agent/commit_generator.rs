use super::ai_service::AIAnalysisService;
use super::context_analyzer::ContextAnalyzer;
use super::types::*;
use crate::infrastructure::ai::AIClientFactory;
use crate::service::git::{GitDiffParams, GitService};
/**
 * Git Function Agent - commit message generator
 *
 * Uses AI to deeply analyze code changes and generate compliant commit messages
 */
use log::{debug, info};
use std::path::Path;
use std::sync::Arc;

const ESTIMATED_FILE_ADDITIONS: u32 = 10;
const ESTIMATED_FILE_DELETIONS: u32 = 5;
const MAX_AFFECTED_MODULES: usize = 3;

pub struct CommitGenerator;

impl CommitGenerator {
    pub async fn generate_commit_message(
        repo_path: &Path,
        options: CommitMessageOptions,
        factory: Arc<AIClientFactory>,
    ) -> AgentResult<CommitMessage> {
        info!(
            "Generating commit message (AI-driven): repo_path={:?}",
            repo_path
        );

        let status = GitService::get_status(repo_path)
            .await
            .map_err(|e| AgentError::git_error(format!("Failed to get Git status: {}", e)))?;

        let changed_files = Self::staged_file_paths(&status)?;

        debug!(
            "Staged files: count={}, files={:?}",
            changed_files.len(),
            changed_files
        );

        let diff_content = Self::get_full_diff(repo_path).await?;
        Self::ensure_diff_has_content(&diff_content)?;

        let project_context = ContextAnalyzer::analyze_project_context(repo_path)
            .await
            .unwrap_or_default(); // Fallback to default on failure

        debug!(
            "Project context: type={}, tech_stack={:?}",
            project_context.project_type, project_context.tech_stack
        );

        let ai_service =
            AIAnalysisService::new_with_agent_config(factory, "git-func-agent").await?;

        let ai_analysis = ai_service
            .generate_commit_message_ai(&diff_content, &project_context, &options)
            .await?;

        debug!(
            "AI analysis completed: commit_type={:?}, confidence={}",
            ai_analysis.commit_type, ai_analysis.confidence
        );

        let changes_summary = Self::build_changes_summary(&status, &changed_files);

        let full_message = Self::assemble_full_message(
            &ai_analysis.title,
            &ai_analysis.body,
            &ai_analysis.breaking_changes,
        );

        Ok(CommitMessage {
            title: ai_analysis.title,
            body: ai_analysis.body,
            footer: ai_analysis.breaking_changes,
            full_message,
            commit_type: ai_analysis.commit_type,
            scope: ai_analysis.scope,
            confidence: ai_analysis.confidence,
            changes_summary,
        })
    }

    async fn get_full_diff(repo_path: &Path) -> AgentResult<String> {
        let diff_params = GitDiffParams {
            staged: Some(true),
            stat: Some(false),
            files: None,
            ..Default::default()
        };

        let diff = GitService::get_diff(repo_path, &diff_params)
            .await
            .map_err(|e| AgentError::git_error(format!("Failed to get diff: {}", e)))?;

        debug!("Got staged diff: length={} chars", diff.len());
        Ok(diff)
    }

    fn staged_file_paths(status: &crate::service::git::GitStatus) -> AgentResult<Vec<String>> {
        let files = status
            .staged
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();

        if files.is_empty() {
            return Err(AgentError::invalid_input(
                "Staging area is empty, please stage files first",
            ));
        }

        Ok(files)
    }

    fn ensure_diff_has_content(diff_content: &str) -> AgentResult<()> {
        if diff_content.trim().is_empty() {
            return Err(AgentError::invalid_input("Diff content is empty"));
        }

        Ok(())
    }

    fn build_changes_summary(
        status: &crate::service::git::GitStatus,
        changed_files: &[String],
    ) -> ChangesSummary {
        let total_files = status.staged.len() + status.unstaged.len();
        let total_additions = total_files as u32 * ESTIMATED_FILE_ADDITIONS;
        let total_deletions = total_files as u32 * ESTIMATED_FILE_DELETIONS;
        let file_changes = Self::build_file_changes(changed_files);
        let affected_modules = Self::collect_affected_modules(changed_files);
        let change_patterns = super::utils::detect_change_patterns(&file_changes);

        ChangesSummary {
            total_additions,
            total_deletions,
            files_changed: changed_files.len() as u32,
            file_changes,
            affected_modules,
            change_patterns,
        }
    }

    fn build_file_changes(changed_files: &[String]) -> Vec<FileChange> {
        changed_files
            .iter()
            .map(|path| FileChange {
                path: path.clone(),
                change_type: FileChangeType::Modified,
                additions: ESTIMATED_FILE_ADDITIONS,
                deletions: ESTIMATED_FILE_DELETIONS,
                file_type: super::utils::infer_file_type(path),
            })
            .collect()
    }

    fn collect_affected_modules(changed_files: &[String]) -> Vec<String> {
        changed_files
            .iter()
            .filter_map(|path| super::utils::extract_module_name(path))
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .take(MAX_AFFECTED_MODULES)
            .collect()
    }

    fn assemble_full_message(
        title: &str,
        body: &Option<String>,
        footer: &Option<String>,
    ) -> String {
        let mut parts = vec![title.to_string()];

        Self::append_message_section(&mut parts, body);
        Self::append_message_section(&mut parts, footer);

        parts.join("\n")
    }

    fn append_message_section(parts: &mut Vec<String>, section: &Option<String>) {
        let Some(text) = section else {
            return;
        };

        if text.is_empty() {
            return;
        }

        parts.push(String::new());
        parts.push(text.clone());
    }
}
