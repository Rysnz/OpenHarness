use super::types::*;
use crate::infrastructure::ai::AIClientFactory;
use chrono::{Local, Timelike};
/**
 * Work state analyzer
 *
 * Analyzes the user's current work state, including Git status and file changes
 */
use log::{debug, info};
use std::path::Path;
use std::sync::Arc;

const MAX_MODIFIED_FILES: usize = 10;

pub struct WorkStateAnalyzer;

struct ParsedGitStatus {
    unstaged_files: u32,
    staged_files: u32,
    modified_files: Vec<FileModification>,
}

fn should_collect_git_diff(git_state: &Option<GitWorkState>) -> bool {
    git_state
        .as_ref()
        .is_some_and(|g| g.unstaged_files > 0 || g.staged_files > 0)
}

fn visible_ai_actions(
    ai_analysis: AIGeneratedAnalysis,
    options: &WorkStateOptions,
) -> (
    String,
    Vec<WorkItem>,
    Vec<PredictedAction>,
    Vec<QuickAction>,
) {
    let predicted_actions = if options.predict_next_actions {
        ai_analysis.predicted_actions
    } else {
        Vec::new()
    };
    let quick_actions = if options.include_quick_actions {
        ai_analysis.quick_actions
    } else {
        Vec::new()
    };

    (
        ai_analysis.summary,
        ai_analysis.ongoing_work,
        predicted_actions,
        quick_actions,
    )
}

fn parse_git_status(status: &str) -> ParsedGitStatus {
    let mut parsed = ParsedGitStatus {
        unstaged_files: 0,
        staged_files: 0,
        modified_files: Vec::new(),
    };

    for line in status.lines().filter(|line| !line.is_empty()) {
        let Some((modification, is_staged)) = parse_git_status_line(line) else {
            continue;
        };

        if is_staged {
            parsed.staged_files += 1;
        } else {
            parsed.unstaged_files += 1;
        }

        if parsed.modified_files.len() < MAX_MODIFIED_FILES {
            parsed.modified_files.push(modification);
        }
    }

    parsed
}

fn parse_git_status_line(line: &str) -> Option<(FileModification, bool)> {
    let status_code = line.get(0..2)?;
    let file_path = line.get(3..)?.trim().to_string();
    if file_path.is_empty() {
        return None;
    }

    let (change_type, is_staged) = git_change_from_status(status_code);
    Some((
        FileModification {
            module: extract_module(&file_path),
            path: file_path,
            change_type,
        },
        is_staged,
    ))
}

fn git_change_from_status(status_code: &str) -> (FileChangeType, bool) {
    match status_code {
        "A " => (FileChangeType::Added, true),
        " M" => (FileChangeType::Modified, false),
        "M " => (FileChangeType::Modified, true),
        "MM" => (FileChangeType::Modified, true),
        " D" => (FileChangeType::Deleted, false),
        "D " => (FileChangeType::Deleted, true),
        "??" => (FileChangeType::Untracked, false),
        "R " => (FileChangeType::Renamed, true),
        _ => (FileChangeType::Modified, false),
    }
}

fn extract_module(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);

    path.components()
        .next()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
}

fn time_of_day_for_hour(hour: u32) -> TimeOfDay {
    match hour {
        5..=11 => TimeOfDay::Morning,
        12..=17 => TimeOfDay::Afternoon,
        18..=22 => TimeOfDay::Evening,
        _ => TimeOfDay::Night,
    }
}

fn minutes_since_commit_from_output(output: std::process::Output) -> Option<u64> {
    if !output.status.success() {
        return None;
    }

    let timestamp_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let timestamp = timestamp_str.parse::<i64>().ok()?;
    let now = Local::now().timestamp();
    Some(((now - timestamp) / 60) as u64)
}

impl WorkStateAnalyzer {
    pub async fn analyze_work_state(
        factory: Arc<AIClientFactory>,
        repo_path: &Path,
        options: WorkStateOptions,
    ) -> AgentResult<WorkStateAnalysis> {
        info!("Analyzing work state: repo_path={:?}", repo_path);

        let greeting = Self::generate_greeting(&options);

        let git_state = if options.analyze_git {
            Self::analyze_git_state(repo_path).await.ok()
        } else {
            None
        };

        let git_diff = if should_collect_git_diff(&git_state) {
            Self::get_git_diff(repo_path).await.unwrap_or_default()
        } else {
            String::new()
        };

        let time_info = Self::get_time_info(repo_path).await;

        let ai_analysis =
            Self::generate_complete_analysis_with_ai(factory, &git_state, &git_diff, &options)
                .await?;

        debug!("AI complete analysis generation succeeded");
        let (summary, ongoing_work, predicted_actions, quick_actions) =
            visible_ai_actions(ai_analysis, &options);

        let current_state = CurrentWorkState {
            summary,
            git_state,
            ongoing_work,
            time_info,
        };

        Ok(WorkStateAnalysis {
            greeting,
            current_state,
            predicted_actions,
            quick_actions,
            analyzed_at: Local::now().to_rfc3339(),
        })
    }

    fn generate_greeting(_options: &WorkStateOptions) -> GreetingMessage {
        // Frontend uses its own static greeting from i18n.
        GreetingMessage {
            title: String::new(),
            subtitle: String::new(),
            tagline: None,
        }
    }

    async fn get_git_diff(repo_path: &Path) -> AgentResult<String> {
        debug!("Getting Git diff");

        let unstaged_output = crate::util::process_manager::create_command("git")
            .arg("diff")
            .arg("HEAD")
            .current_dir(repo_path)
            .output()
            .map_err(|e| AgentError::git_error(format!("Failed to get git diff: {}", e)))?;

        let mut diff = String::from_utf8_lossy(&unstaged_output.stdout).to_string();

        let staged_output = crate::util::process_manager::create_command("git")
            .arg("diff")
            .arg("--cached")
            .current_dir(repo_path)
            .output()
            .map_err(|e| AgentError::git_error(format!("Failed to get staged diff: {}", e)))?;

        let staged_diff = String::from_utf8_lossy(&staged_output.stdout);

        if !staged_diff.is_empty() {
            diff.push_str("\n\n=== Staged Changes ===\n\n");
            diff.push_str(&staged_diff);
        }

        debug!("Git diff retrieved: length={} chars", diff.len());

        Ok(diff)
    }

    async fn generate_complete_analysis_with_ai(
        factory: Arc<AIClientFactory>,
        git_state: &Option<GitWorkState>,
        git_diff: &str,
        options: &WorkStateOptions,
    ) -> AgentResult<AIGeneratedAnalysis> {
        use super::ai_service::AIWorkStateService;

        debug!("Starting AI complete analysis generation");

        let ai_service =
            AIWorkStateService::new_with_agent_config(factory, "startchat-func-agent").await?;
        ai_service
            .generate_complete_analysis(git_state, git_diff, &options.language)
            .await
    }

    async fn analyze_git_state(repo_path: &Path) -> AgentResult<GitWorkState> {
        let current_branch = Self::get_current_branch(repo_path)?;

        let status_output = crate::util::process_manager::create_command("git")
            .arg("status")
            .arg("--porcelain")
            .current_dir(repo_path)
            .output()
            .map_err(|e| AgentError::git_error(format!("Failed to get git status: {}", e)))?;

        let status_str = String::from_utf8_lossy(&status_output.stdout);

        let parsed_status = parse_git_status(&status_str);

        let unpushed_commits = Self::get_unpushed_commits(repo_path)?;
        let ahead_behind = Self::get_ahead_behind(repo_path).ok();

        Ok(GitWorkState {
            current_branch,
            unstaged_files: parsed_status.unstaged_files,
            staged_files: parsed_status.staged_files,
            unpushed_commits,
            ahead_behind,
            modified_files: parsed_status.modified_files,
        })
    }

    fn get_current_branch(repo_path: &Path) -> AgentResult<String> {
        let output = crate::util::process_manager::create_command("git")
            .arg("branch")
            .arg("--show-current")
            .current_dir(repo_path)
            .output()
            .map_err(|e| AgentError::git_error(format!("Failed to get current branch: {}", e)))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn get_unpushed_commits(repo_path: &Path) -> AgentResult<u32> {
        let output = crate::util::process_manager::create_command("git")
            .arg("log")
            .arg("@{u}..")
            .arg("--oneline")
            .current_dir(repo_path)
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let count = String::from_utf8_lossy(&output.stdout).lines().count() as u32;
                return Ok(count);
            }
        }

        Ok(0)
    }

    fn get_ahead_behind(repo_path: &Path) -> AgentResult<AheadBehind> {
        let output = crate::util::process_manager::create_command("git")
            .arg("rev-list")
            .arg("--left-right")
            .arg("--count")
            .arg("HEAD...@{u}")
            .current_dir(repo_path)
            .output()
            .map_err(|e| AgentError::git_error(format!("Failed to get ahead/behind: {}", e)))?;

        if !output.status.success() {
            return Err(AgentError::git_error("No upstream branch configured"));
        }

        let result = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = result.split_whitespace().collect();

        if parts.len() >= 2 {
            let ahead = parts[0].parse().unwrap_or(0);
            let behind = parts[1].parse().unwrap_or(0);
            Ok(AheadBehind { ahead, behind })
        } else {
            Err(AgentError::git_error("Failed to parse ahead/behind info"))
        }
    }

    async fn get_time_info(repo_path: &Path) -> TimeInfo {
        let hour = Local::now().hour();
        let time_of_day = time_of_day_for_hour(hour);

        let output = crate::util::process_manager::create_command("git")
            .arg("log")
            .arg("-1")
            .arg("--format=%ct")
            .current_dir(repo_path)
            .output();

        let minutes_since_last_commit = output.ok().and_then(minutes_since_commit_from_output);
        let last_commit_time_desc = None;

        TimeInfo {
            minutes_since_last_commit,
            last_commit_time_desc,
            time_of_day,
        }
    }
}
