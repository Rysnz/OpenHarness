//! Runtime detection — Bun first, Node.js fallback for JS Worker.

use std::path::PathBuf;

use crate::util::process_manager;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeKind {
    Bun,
    Node,
}

#[derive(Debug, Clone)]
pub struct DetectedRuntime {
    pub kind: RuntimeKind,
    pub path: PathBuf,
    pub version: String,
}

/// Detect available JS runtime: Bun first, then Node.js. Returns None if neither is available.
pub fn detect_runtime() -> Option<DetectedRuntime> {
    if let Some(bun_path) = resolve_runtime_path("bun") {
        if let Ok(version) = get_version(&bun_path) {
            return Some(DetectedRuntime {
                kind: RuntimeKind::Bun,
                path: bun_path,
                version,
            });
        }
    }
    if let Some(node_path) = resolve_runtime_path("node") {
        if let Ok(version) = get_version(&node_path) {
            return Some(DetectedRuntime {
                kind: RuntimeKind::Node,
                path: node_path,
                version,
            });
        }
    }
    None
}

fn resolve_runtime_path(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        resolve_windows_runtime_path(name)
    }

    #[cfg(not(windows))]
    {
        which::which(name).ok()
    }
}

#[cfg(windows)]
fn resolve_windows_runtime_path(name: &str) -> Option<PathBuf> {
    let path = which::which(name).ok()?;

    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Some(path);
    }

    if name.eq_ignore_ascii_case("bun") {
        if let Some(parent) = path.parent() {
            let embedded_bun = parent.join("node_modules").join("bun").join("bin").join("bun.exe");
            if embedded_bun.exists() {
                return Some(embedded_bun);
            }
        }
    }

    let exe_candidate = path.with_extension("exe");
    if exe_candidate.exists() {
        return Some(exe_candidate);
    }

    None
}

fn get_version(executable: &std::path::Path) -> Result<String, std::io::Error> {
    let out = process_manager::create_command(executable)
        .arg("--version")
        .output()?;
    if out.status.success() {
        let v = String::from_utf8_lossy(&out.stdout);
        Ok(v.trim().to_string())
    } else {
        Err(std::io::Error::other("version check failed"))
    }
}
