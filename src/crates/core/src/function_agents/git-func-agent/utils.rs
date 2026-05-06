use super::types::*;
use std::path::Path;

const CONFIG_PATTERNS: &[&str] = &[
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".ini",
    ".conf",
    "config",
    "package.json",
    "cargo.toml",
    "tsconfig",
];
const DEPENDENCY_MANIFESTS: &[&str] = &["package.json", "cargo.toml", "requirements.txt"];
const DOC_PATTERNS: &[&str] = &[".md", ".txt", ".rst", "readme", "changelog", "license"];
const TEST_PATTERNS: &[&str] = &["test", "spec", "__tests__", ".test.", ".spec."];
const REFACTOR_LINE_THRESHOLD: u32 = 200;
const REFACTOR_FILE_THRESHOLD: usize = 5;

pub fn infer_file_type(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn extract_module_name(path: &str) -> Option<String> {
    let path = Path::new(path);

    if let Some(module_name) = path.parent().and_then(Path::file_name) {
        return Some(module_name.to_string_lossy().to_string());
    }

    path.file_stem()
        .map(|name| name.to_string_lossy().to_string())
}

pub fn is_config_file(path: &str) -> bool {
    matches_any_pattern(path, CONFIG_PATTERNS)
}

pub fn is_doc_file(path: &str) -> bool {
    matches_any_pattern(path, DOC_PATTERNS)
}

pub fn is_test_file(path: &str) -> bool {
    matches_any_pattern(path, TEST_PATTERNS)
}

pub fn detect_change_patterns(file_changes: &[FileChange]) -> Vec<ChangePattern> {
    let mut patterns = Vec::new();
    let summary = summarize_changes(file_changes);

    if summary.has_new_files && summary.has_code_changes {
        patterns.push(ChangePattern::FeatureAddition);
    }

    if summary.has_code_changes && !summary.has_new_files {
        patterns.push(ChangePattern::BugFix);
    }

    if summary.has_test_changes {
        patterns.push(ChangePattern::TestUpdate);
    }

    if summary.has_doc_changes {
        patterns.push(ChangePattern::DocumentationUpdate);
    }

    if summary.has_config_changes {
        if has_dependency_manifest(file_changes) {
            patterns.push(ChangePattern::DependencyUpdate);
        } else {
            patterns.push(ChangePattern::ConfigChange);
        }
    }

    if summary.has_code_changes && is_compact_large_change(file_changes) {
        patterns.push(ChangePattern::Refactoring);
    }

    patterns
}

#[derive(Default)]
struct ChangeSummary {
    has_code_changes: bool,
    has_test_changes: bool,
    has_doc_changes: bool,
    has_config_changes: bool,
    has_new_files: bool,
}

fn summarize_changes(file_changes: &[FileChange]) -> ChangeSummary {
    let mut summary = ChangeSummary::default();

    for change in file_changes {
        summary.has_new_files |= change.change_type == FileChangeType::Added;
        match classify_change_path(&change.path) {
            ChangeBucket::Test => summary.has_test_changes = true,
            ChangeBucket::Doc => summary.has_doc_changes = true,
            ChangeBucket::Config => summary.has_config_changes = true,
            ChangeBucket::Code => summary.has_code_changes = true,
        }
    }

    summary
}

enum ChangeBucket {
    Code,
    Config,
    Doc,
    Test,
}

fn classify_change_path(path: &str) -> ChangeBucket {
    if is_test_file(path) {
        ChangeBucket::Test
    } else if is_doc_file(path) {
        ChangeBucket::Doc
    } else if is_config_file(path) {
        ChangeBucket::Config
    } else {
        ChangeBucket::Code
    }
}

fn matches_any_pattern(path: &str, patterns: &[&str]) -> bool {
    let path_lower = path.to_lowercase();
    patterns.iter().any(|pattern| path_lower.contains(pattern))
}

fn has_dependency_manifest(file_changes: &[FileChange]) -> bool {
    file_changes
        .iter()
        .any(|change| matches_any_pattern(&change.path, DEPENDENCY_MANIFESTS))
}

fn is_compact_large_change(file_changes: &[FileChange]) -> bool {
    total_changed_lines(file_changes) > REFACTOR_LINE_THRESHOLD
        && file_changes.len() < REFACTOR_FILE_THRESHOLD
}

fn total_changed_lines(file_changes: &[FileChange]) -> u32 {
    file_changes
        .iter()
        .map(|change| change.additions + change.deletions)
        .sum()
}
