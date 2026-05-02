//! Diff API - Tauri commands for diff comparison

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeDiffRequest {
    #[serde(rename = "oldContent")]
    pub old_content: String,
    #[serde(rename = "newContent")]
    pub new_content: String,
    pub options: Option<DiffOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffOptions {
    pub ignore_whitespace: Option<bool>,
    pub context_lines: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
    pub changes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_type: String, // "context" | "add" | "delete"
    pub content: String,
    pub old_line_number: Option<usize>,
    pub new_line_number: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyPatchRequest {
    pub content: String,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveMergedContentRequest {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
}

#[derive(Default)]
struct HunkBuilder {
    old_start: usize,
    new_start: usize,
    old_lines: usize,
    new_lines: usize,
    lines: Vec<DiffLine>,
}

impl HunkBuilder {
    fn mark_old_start(&mut self, old_index: usize) {
        if self.old_start == 0 {
            self.old_start = old_index + 1;
        }
    }

    fn mark_new_start(&mut self, new_index: usize) {
        if self.new_start == 0 {
            self.new_start = new_index + 1;
        }
    }

    fn push_context(&mut self, old_lines: &[&str], old_index: usize, new_index: usize, len: usize) {
        self.mark_old_start(old_index);
        self.mark_new_start(new_index);

        for offset in 0..len {
            self.lines.push(diff_line(
                "context",
                old_lines.get(old_index + offset).unwrap_or(&""),
                Some(old_index + offset + 1),
                Some(new_index + offset + 1),
            ));
            self.old_lines += 1;
            self.new_lines += 1;
        }
    }

    fn push_deleted(&mut self, old_lines: &[&str], old_index: usize, len: usize) -> usize {
        self.mark_old_start(old_index);

        for offset in 0..len {
            self.lines.push(diff_line(
                "delete",
                old_lines.get(old_index + offset).unwrap_or(&""),
                Some(old_index + offset + 1),
                None,
            ));
            self.old_lines += 1;
        }

        len
    }

    fn push_inserted(&mut self, new_lines: &[&str], new_index: usize, len: usize) -> usize {
        self.mark_new_start(new_index);

        for offset in 0..len {
            self.lines.push(diff_line(
                "add",
                new_lines.get(new_index + offset).unwrap_or(&""),
                None,
                Some(new_index + offset + 1),
            ));
            self.new_lines += 1;
        }

        len
    }

    fn finish(self) -> Option<DiffHunk> {
        (!self.lines.is_empty()).then_some(DiffHunk {
            old_start: self.old_start,
            old_lines: self.old_lines,
            new_start: self.new_start,
            new_lines: self.new_lines,
            lines: self.lines,
        })
    }
}

fn diff_line(
    line_type: &str,
    content: &str,
    old_line_number: Option<usize>,
    new_line_number: Option<usize>,
) -> DiffLine {
    DiffLine {
        line_type: line_type.to_string(),
        content: content.to_string(),
        old_line_number,
        new_line_number,
    }
}

#[tauri::command]
pub async fn compute_diff(request: ComputeDiffRequest) -> Result<DiffResult, String> {
    let old_lines: Vec<&str> = request.old_content.lines().collect();
    let new_lines: Vec<&str> = request.new_content.lines().collect();
    let diff = similar::TextDiff::from_lines(&request.old_content, &request.new_content);

    let mut hunks = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;

    for group in diff.grouped_ops(
        request
            .options
            .as_ref()
            .and_then(|o| o.context_lines)
            .unwrap_or(3),
    ) {
        let mut hunk = HunkBuilder::default();

        for op in &group {
            match op {
                similar::DiffOp::Equal {
                    old_index,
                    new_index,
                    len,
                } => {
                    hunk.push_context(&old_lines, *old_index, *new_index, *len);
                }
                similar::DiffOp::Delete {
                    old_index, old_len, ..
                } => {
                    deletions += hunk.push_deleted(&old_lines, *old_index, *old_len);
                }
                similar::DiffOp::Insert {
                    new_index, new_len, ..
                } => {
                    additions += hunk.push_inserted(&new_lines, *new_index, *new_len);
                }
                similar::DiffOp::Replace {
                    old_index,
                    old_len,
                    new_index,
                    new_len,
                } => {
                    deletions += hunk.push_deleted(&old_lines, *old_index, *old_len);
                    additions += hunk.push_inserted(&new_lines, *new_index, *new_len);
                }
            }
        }

        if let Some(hunk) = hunk.finish() {
            hunks.push(hunk);
        }
    }

    Ok(DiffResult {
        hunks,
        additions,
        deletions,
        changes: additions + deletions,
    })
}

#[tauri::command]
pub async fn apply_patch(request: ApplyPatchRequest) -> Result<String, String> {
    Ok(request.content)
}

#[tauri::command]
pub async fn save_merged_diff_content(request: SaveMergedContentRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.file_path);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    tokio::fs::write(&path, &request.content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}
