use super::types::*;
use log::debug;
use std::fs;
use std::path::Path;

const README_CANDIDATES: &[&str] = &["README.md", "README", "README.txt", "readme.md"];
const JAVASCRIPT_FRAMEWORKS: &[(&str, &str)] = &[
    ("\"react\"", "react-app"),
    ("\"vue\"", "vue-app"),
    ("\"next\"", "nextjs-app"),
    ("\"express\"", "nodejs-backend"),
];
const RUST_STACK_MARKERS: &[(&str, &str)] = &[
    ("tokio", "Tokio"),
    ("axum", "Axum"),
    ("actix-web", "Actix-Web"),
    ("tauri", "Tauri"),
];
const JS_STACK_MARKERS: &[(&str, &str)] = &[
    ("\"react\"", "React"),
    ("\"vue\"", "Vue"),
    ("\"next\"", "Next.js"),
    ("\"vite\"", "Vite"),
];
const DIRECTORY_STACK_MARKERS: &[(&str, &str)] = &[
    ("postgres", "PostgreSQL"),
    ("pg", "PostgreSQL"),
    ("mysql", "MySQL"),
    ("mongo", "MongoDB"),
    ("redis", "Redis"),
];

pub struct ContextAnalyzer;

impl ContextAnalyzer {
    pub async fn analyze_project_context(repo_path: &Path) -> AgentResult<ProjectContext> {
        debug!("Analyzing project context: repo_path={:?}", repo_path);

        Ok(ProjectContext {
            project_type: Self::detect_project_type(repo_path)?,
            tech_stack: Self::detect_tech_stack(repo_path)?,
            project_docs: Self::read_project_docs(repo_path),
            code_standards: Self::detect_code_standards(repo_path),
        })
    }

    fn detect_project_type(repo_path: &Path) -> AgentResult<String> {
        if has_file(repo_path, "Cargo.toml") {
            return Ok(detect_rust_project_type(repo_path));
        }

        if has_file(repo_path, "package.json") {
            return Ok(detect_javascript_project_type(repo_path));
        }

        let known_project_files = [
            ("go.mod", "go-application"),
            ("requirements.txt", "python-application"),
            ("pyproject.toml", "python-application"),
            ("pom.xml", "java-maven-app"),
            ("build.gradle", "java-gradle-app"),
        ];

        Ok(known_project_files
            .iter()
            .find_map(|(file, project_type)| has_file(repo_path, file).then_some(*project_type))
            .unwrap_or("unknown")
            .to_string())
    }

    fn detect_tech_stack(repo_path: &Path) -> AgentResult<Vec<String>> {
        let mut stack = Vec::new();

        append_rust_stack(repo_path, &mut stack);
        append_javascript_stack(repo_path, &mut stack);
        append_language_stack(repo_path, &mut stack);
        append_directory_stack(repo_path, &mut stack);

        if stack.is_empty() {
            stack.push("Unknown".to_string());
        }

        Ok(stack)
    }

    fn read_project_docs(repo_path: &Path) -> Option<String> {
        README_CANDIDATES
            .iter()
            .map(|name| repo_path.join(name))
            .find_map(|path| fs::read_to_string(path).ok())
            .map(|content| content.chars().take(1000).collect())
    }

    fn detect_code_standards(repo_path: &Path) -> Option<String> {
        let standards = [
            (has_file(repo_path, "rustfmt.toml") || has_file(repo_path, ".rustfmt.toml"), "rustfmt"),
            (has_file(repo_path, "clippy.toml"), "clippy"),
            (
                has_file(repo_path, ".eslintrc.js")
                    || has_file(repo_path, ".eslintrc.json")
                    || has_file(repo_path, "eslint.config.js"),
                "ESLint",
            ),
            (
                has_file(repo_path, ".prettierrc") || has_file(repo_path, "prettier.config.js"),
                "Prettier",
            ),
            (has_file(repo_path, ".flake8"), "flake8"),
            (has_file(repo_path, ".pylintrc"), "pylint"),
            (has_file(repo_path, ".editorconfig"), "EditorConfig"),
        ]
        .into_iter()
        .filter_map(|(enabled, label)| enabled.then_some(label))
        .collect::<Vec<_>>();

        (!standards.is_empty()).then(|| standards.join(", "))
    }
}

fn has_file(repo_path: &Path, relative_path: &str) -> bool {
    repo_path.join(relative_path).exists()
}

fn read_file(repo_path: &Path, relative_path: &str) -> Option<String> {
    fs::read_to_string(repo_path.join(relative_path)).ok()
}

fn detect_rust_project_type(repo_path: &Path) -> String {
    if has_file(repo_path, "src-tauri") {
        return "tauri-app".to_string();
    }

    read_file(repo_path, "Cargo.toml")
        .filter(|content| content.contains("[lib]"))
        .map(|_| "rust-library")
        .unwrap_or("rust-application")
        .to_string()
}

fn detect_javascript_project_type(repo_path: &Path) -> String {
    let Some(package_json) = read_file(repo_path, "package.json") else {
        return "nodejs-app".to_string();
    };

    JAVASCRIPT_FRAMEWORKS
        .iter()
        .find_map(|(marker, project_type)| package_json.contains(marker).then_some(*project_type))
        .unwrap_or("nodejs-app")
        .to_string()
}

fn append_rust_stack(repo_path: &Path, stack: &mut Vec<String>) {
    if !has_file(repo_path, "Cargo.toml") {
        return;
    }

    stack.push("Rust".to_string());
    if let Some(cargo_toml) = read_file(repo_path, "Cargo.toml") {
        append_marker_matches(&cargo_toml, RUST_STACK_MARKERS, stack);
    }
}

fn append_javascript_stack(repo_path: &Path, stack: &mut Vec<String>) {
    let Some(package_json) = read_file(repo_path, "package.json") else {
        return;
    };

    if package_json.contains("\"typescript\"") {
        stack.push("TypeScript".to_string());
    } else {
        stack.push("JavaScript".to_string());
    }

    append_marker_matches(&package_json, JS_STACK_MARKERS, stack);
}

fn append_language_stack(repo_path: &Path, stack: &mut Vec<String>) {
    if has_file(repo_path, "go.mod") {
        stack.push("Go".to_string());
    }
    if has_file(repo_path, "requirements.txt") || has_file(repo_path, "pyproject.toml") {
        stack.push("Python".to_string());
    }
    if has_file(repo_path, "pom.xml") || has_file(repo_path, "build.gradle") {
        stack.push("Java".to_string());
    }
}

fn append_directory_stack(repo_path: &Path, stack: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(repo_path) else {
        return;
    };

    for entry in entries.flatten() {
        let Some(name) = entry.path().file_name().and_then(|name| name.to_str()).map(str::to_owned) else {
            continue;
        };
        append_marker_matches(&name, DIRECTORY_STACK_MARKERS, stack);
    }
}

fn append_marker_matches(content: &str, markers: &[(&str, &str)], stack: &mut Vec<String>) {
    stack.extend(
        markers
            .iter()
            .filter_map(|(marker, label)| content.contains(marker).then_some((*label).to_string())),
    );
}
