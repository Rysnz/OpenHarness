//! Resolve miniapp manifest permissions into the worker policy payload.

use crate::miniapp::types::{FsPermissions, MiniAppPermissions, PathScope};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub fn resolve_policy(
    perms: &MiniAppPermissions,
    app_id: &str,
    app_data_dir: &Path,
    workspace_dir: Option<&Path>,
    granted_paths: &[PathBuf],
) -> Value {
    let mut policy = Map::new();

    if let Some(fs) = perms.fs.as_ref() {
        if let Some(fs_policy) =
            resolve_fs_policy(fs, app_id, app_data_dir, workspace_dir, granted_paths)
        {
            policy.insert("fs".to_string(), fs_policy);
        }
    }

    insert_allow_list(
        &mut policy,
        "shell",
        perms.shell.as_ref().and_then(|shell| shell.allow.as_ref()),
    );
    insert_allow_list(
        &mut policy,
        "net",
        perms.net.as_ref().and_then(|net| net.allow.as_ref()),
    );

    Value::Object(policy)
}

fn resolve_fs_policy(
    fs: &FsPermissions,
    app_id: &str,
    app_data_dir: &Path,
    workspace_dir: Option<&Path>,
    granted_paths: &[PathBuf],
) -> Option<Value> {
    let mut read_paths = resolve_fs_scopes(
        fs.read.as_deref().unwrap_or(&[]),
        app_id,
        app_data_dir,
        workspace_dir,
    );
    let mut write_paths = resolve_fs_scopes(
        fs.write.as_deref().unwrap_or(&[]),
        app_id,
        app_data_dir,
        workspace_dir,
    );

    append_granted_paths(&mut read_paths, granted_paths);
    append_granted_paths(&mut write_paths, granted_paths);

    if read_paths.is_empty() && write_paths.is_empty() {
        return None;
    }

    Some(json!({
        "read": read_paths,
        "write": write_paths,
    }))
}

fn insert_allow_list(policy: &mut Map<String, Value>, key: &str, allow: Option<&Vec<String>>) {
    let allow = allow
        .map(|items| Value::Array(items.iter().cloned().map(Value::String).collect()))
        .unwrap_or_else(|| Value::Array(Vec::new()));
    policy.insert(key.to_string(), json!({ "allow": allow }));
}

fn append_granted_paths(target: &mut Vec<String>, granted_paths: &[PathBuf]) {
    target.extend(
        granted_paths
            .iter()
            .filter_map(|path| path.to_str().map(str::to_string)),
    );
}

fn resolve_fs_scopes(
    scopes: &[String],
    _app_id: &str,
    app_data_dir: &Path,
    workspace_dir: Option<&Path>,
) -> Vec<String> {
    scopes
        .iter()
        .flat_map(|scope| {
            scope_paths(
                PathScope::from_manifest_value(scope),
                app_data_dir,
                workspace_dir,
            )
        })
        .filter_map(|path| path.to_str().map(str::to_string))
        .collect()
}

fn scope_paths(
    scope: PathScope,
    app_data_dir: &Path,
    workspace_dir: Option<&Path>,
) -> Vec<PathBuf> {
    match scope {
        PathScope::AppData => vec![app_data_dir.to_path_buf()],
        PathScope::Workspace => workspace_dir.map(Path::to_path_buf).into_iter().collect(),
        PathScope::Home => dirs::home_dir().into_iter().collect(),
        PathScope::UserSelected => Vec::new(),
        PathScope::Custom(paths) => paths,
    }
}
