//! Message enhancement helpers for image-aware requests.

use super::types::ImageAnalysisResult;
use serde_json::Value;

const SECTION_SEPARATOR: &str = "------------------------------------------------------------";

pub struct MessageEnhancer;

impl MessageEnhancer {
    pub fn enhance_with_image_analysis(
        original_message: &str,
        image_analyses: &[ImageAnalysisResult],
        other_contexts: &[Value],
    ) -> String {
        let mut sections = Vec::new();

        if !image_analyses.is_empty() {
            sections.push(Self::image_analysis_section(image_analyses));
        }

        if !other_contexts.is_empty() {
            sections.push(Self::context_section(other_contexts));
        }

        sections.push(
            "The image analysis above has already been completed. Do not ask the user to view or re-analyze the image; answer the user's question directly from the available context."
                .to_string(),
        );
        sections.push(SECTION_SEPARATOR.to_string());
        sections.push(format!("User's question:\n{}", original_message));

        sections.join("\n\n")
    }

    fn image_analysis_section(image_analyses: &[ImageAnalysisResult]) -> String {
        let mut lines = vec![format!(
            "User uploaded {} image(s). The model's understanding is:",
            image_analyses.len()
        )];

        for (idx, analysis) in image_analyses.iter().enumerate() {
            lines.push(String::new());
            lines.push(format!("[Image {}]", idx + 1));
            lines.push(format!("- Summary: {}", analysis.summary));
            lines.push(format!(
                "- Detailed description: {}",
                analysis.detailed_description
            ));

            if !analysis.detected_elements.is_empty() {
                lines.push(format!(
                    "- Key elements: {}",
                    analysis.detected_elements.join(", ")
                ));
            }

            lines.push(format!(
                "- Analysis confidence: {:.1}%",
                analysis.confidence * 100.0
            ));
        }

        lines.join("\n")
    }

    fn context_section(other_contexts: &[Value]) -> String {
        let mut lines = vec![
            "User also provided this context:".to_string(),
            String::new(),
        ];

        lines.extend(other_contexts.iter().filter_map(Self::format_context));
        lines.join("\n")
    }

    fn format_context(ctx: &Value) -> Option<String> {
        let ctx_type = ctx.get("type")?.as_str()?;

        let formatted = match ctx_type {
            "file" => format!("- File: {}", ctx.get("path")?.as_str()?),
            "directory" => format!("- Directory: {}", ctx.get("path")?.as_str()?),
            "code-snippet" => {
                let file_name = ctx.get("fileName")?.as_str()?;
                let start_line = ctx.get("startLine")?.as_u64()?;
                let end_line = ctx.get("endLine")?.as_u64()?;
                format!("- Code snippet: {file_name} (lines {start_line}-{end_line})")
            }
            "mermaid-diagram" => {
                let title = ctx
                    .get("diagramTitle")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled");
                format!("- Mermaid diagram: {title}")
            }
            _ => format!("- {ctx_type}"),
        };

        Some(formatted)
    }
}
