use super::types::{
    AICommitAnalysis, AgentError, AgentResult, CommitFormat, CommitMessageOptions, CommitType,
    Language, ProjectContext,
};
use crate::infrastructure::ai::{AIClient, AIClientFactory};
use crate::util::types::Message;
/**
 * AI service layer
 *
 * Handles AI client interaction and provides intelligent analysis for commit message generation
 */
use log::{debug, error, warn};
use serde_json::Value;
use std::sync::Arc;

/// Prompt template constants (embedded at compile time)
const COMMIT_MESSAGE_PROMPT: &str = include_str!("prompts/commit_message.md");
const MAX_DIFF_CHARS: usize = 50_000;
const TRUNCATED_DIFF_SUFFIX: &str = "\n\n... [content truncated] ...";
const DEFAULT_REASONING: &str = "AI analysis";
const DEFAULT_CONFIDENCE: f32 = 0.8;

pub struct AIAnalysisService {
    ai_client: Arc<AIClient>,
}

impl AIAnalysisService {
    pub async fn new_with_agent_config(
        factory: Arc<AIClientFactory>,
        agent_name: &str,
    ) -> AgentResult<Self> {
        let ai_client = factory
            .get_client_by_func_agent(agent_name)
            .await
            .map_err(|e| {
                error!("Failed to get AI client: {}", e);
                AgentError::internal_error(format!("Failed to get AI client: {}", e))
            })?;

        Ok(Self { ai_client })
    }

    pub async fn generate_commit_message_ai(
        &self,
        diff_content: &str,
        project_context: &ProjectContext,
        options: &CommitMessageOptions,
    ) -> AgentResult<AICommitAnalysis> {
        if diff_content.is_empty() {
            return Err(AgentError::invalid_input("Code changes are empty"));
        }

        let processed_diff = self.truncate_diff_if_needed(diff_content, MAX_DIFF_CHARS);

        let prompt = self.build_commit_prompt(&processed_diff, project_context, options);

        let ai_response = self.call_ai(&prompt).await?;

        self.parse_commit_response(&ai_response)
    }

    async fn call_ai(&self, prompt: &str) -> AgentResult<String> {
        debug!("Sending request to AI: prompt_length={}", prompt.len());

        let messages = vec![Message::user(prompt.to_string())];
        let response = self
            .ai_client
            .send_message(messages, None)
            .await
            .map_err(|e| {
                error!("AI call failed: {}", e);
                AgentError::internal_error(format!("AI call failed: {}", e))
            })?;

        debug!(
            "AI response received: response_length={}",
            response.text.len()
        );

        if response.text.is_empty() {
            error!("AI response is empty");
            Err(AgentError::internal_error(
                "AI response is empty".to_string(),
            ))
        } else {
            Ok(response.text)
        }
    }

    fn build_commit_prompt(
        &self,
        diff_content: &str,
        project_context: &ProjectContext,
        options: &CommitMessageOptions,
    ) -> String {
        COMMIT_MESSAGE_PROMPT
            .replace("{project_type}", &project_context.project_type)
            .replace("{tech_stack}", &project_context.tech_stack.join(", "))
            .replace("{format_desc}", Self::format_description(&options.format))
            .replace("{language_desc}", Self::language_description(&options.language))
            .replace("{diff_content}", diff_content)
            .replace("{max_title_length}", &options.max_title_length.to_string())
    }

    fn parse_commit_response(&self, response: &str) -> AgentResult<AICommitAnalysis> {
        let json_str = crate::util::extract_json_from_ai_response(response)
            .ok_or_else(|| AgentError::analysis_error("Cannot extract JSON from response"))?;

        let value: Value = serde_json::from_str(&json_str).map_err(|e| {
            AgentError::analysis_error(format!("Failed to parse AI response: {}", e))
        })?;

        self.parse_analysis_value(value)
    }

    fn truncate_diff_if_needed(&self, diff: &str, max_chars: usize) -> String {
        if diff.len() <= max_chars {
            return diff.to_string();
        }

        warn!(
            "Diff too large ({} chars), truncating to {} chars",
            diff.len(),
            max_chars
        );

        let available_chars = max_chars.saturating_sub(100);
        let mut truncated = diff.chars().take(available_chars).collect::<String>();
        truncated.push_str(TRUNCATED_DIFF_SUFFIX);
        truncated
    }

    fn parse_analysis_value(&self, value: Value) -> AgentResult<AICommitAnalysis> {
        Ok(AICommitAnalysis {
            commit_type: self.parse_commit_type(value["type"].as_str().unwrap_or("chore"))?,
            scope: Self::optional_string(&value, "scope"),
            title: Self::required_string(&value, "title")?,
            body: Self::optional_string(&value, "body"),
            breaking_changes: Self::optional_string(&value, "breaking_changes"),
            reasoning: Self::optional_string(&value, "reasoning")
                .unwrap_or_else(|| DEFAULT_REASONING.to_string()),
            confidence: value["confidence"].as_f64().unwrap_or(DEFAULT_CONFIDENCE as f64) as f32,
        })
    }

    fn required_string(value: &Value, field: &str) -> AgentResult<String> {
        value[field]
            .as_str()
            .map(ToString::to_string)
            .ok_or_else(|| AgentError::analysis_error(format!("Missing {} field", field)))
    }

    fn optional_string(value: &Value, field: &str) -> Option<String> {
        value[field].as_str().map(ToString::to_string)
    }

    fn language_description(language: &Language) -> &'static str {
        match language {
            Language::Chinese => "Chinese",
            Language::English => "English",
        }
    }

    fn format_description(format: &CommitFormat) -> &'static str {
        match format {
            CommitFormat::Conventional => "Conventional Commits",
            CommitFormat::Angular => "Angular Style",
            CommitFormat::Simple => "Simple Format",
            CommitFormat::Custom => "Custom Format",
        }
    }

    fn parse_commit_type(&self, s: &str) -> AgentResult<CommitType> {
        match s.to_lowercase().as_str() {
            "feat" | "feature" => Ok(CommitType::Feat),
            "fix" => Ok(CommitType::Fix),
            "docs" | "doc" => Ok(CommitType::Docs),
            "style" => Ok(CommitType::Style),
            "refactor" => Ok(CommitType::Refactor),
            "perf" | "performance" => Ok(CommitType::Perf),
            "test" => Ok(CommitType::Test),
            "chore" => Ok(CommitType::Chore),
            "ci" => Ok(CommitType::CI),
            "revert" => Ok(CommitType::Revert),
            _ => Ok(CommitType::Chore),
        }
    }
}
