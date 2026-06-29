//! Command security assessment
//!
//! Provides command allow-list and risk assessment to prevent
//! arbitrary or dangerous command execution from the frontend.

use std::collections::HashSet;
use std::sync::LazyLock;

/// Risk level returned by [`assess_command_risk`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandRisk {
    /// Command is in the safe list — execute without confirmation.
    Safe,
    /// Command is not in the safe list — require explicit user confirmation.
    NeedsConfirmation,
    /// Command is explicitly blocked — refuse execution.
    Blocked,
}

// ── Safe commands (allow-list) ─────────────────────────────────────────────

static SAFE_COMMANDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        // version control
        "git",
        // runtimes & build tools
        "node", "npm", "pnpm", "npx", "yarn",
        "cargo", "rustc", "rustup",
        "python", "python3", "pip", "pip3",
        "go", "gofmt", "java", "javac", "mvn", "gradle",
        // editors / viewers
        "code", "cursor", "nvim", "vim", "nano",
        // file inspection
        "ls", "dir", "cat", "head", "tail", "find",
        "du", "df", "wc", "file", "stat",
        // search
        "grep", "rg", "sed", "awk",
        // helpers
        "echo", "date", "whoami", "uname", "hostname", "pwd",
        "which", "where", "type", "env",
        // network tools
        "curl", "wget",
        "ssh", "scp",
        // package managers
        "brew", "apt", "apt-get", "dnf", "yum", "pacman",
        "choco", "winget", "scoop",
        // compression
        "tar", "gzip", "gunzip", "zip", "unzip",
        // process inspection
        "ps", "top", "htop", "lsof",
    ])
});

// ── Blocked commands (deny-list) ──────────────────────────────────────────

static BLOCKED_COMMANDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        // destructive
        "rm",
        // privilege escalation
        "sudo", "su", "runas",
        // ownership / permission changes
        "chown", "chmod", "chgrp",
        // filesystem manipulation
        "mkfs", "dd", "fdisk", "parted", "diskutil",
        "mount", "umount",
        // shutdown / reboot
        "shutdown", "reboot", "halt", "poweroff", "init",
        // firewall
        "iptables", "ufw", "firewall-cmd", "netsh",
        // mass kill
        "killall", "pkill", "taskkill",
        // system service control
        "systemctl", "service", "launchctl", "sc",
        // arbitrary code execution wrappers
        "sh", "bash", "zsh", "cmd", "powershell", "pwsh",
        // kernel modules
        "modprobe", "insmod", "rmmod",
    ])
});

// ── Blocked argument patterns ──────────────────────────────────────────────

/// Returns `true` when any argument contains a dangerous pattern.
fn has_dangerous_args(_command: &str, args: &[String]) -> bool {
    for arg in args {
        let lower = arg.to_lowercase();

        // recursive force
        if lower == "-rf" || lower == "-r" || lower == "-f" || lower == "--force" {
            return true;
        }

        // sensitive filesystem paths
        if lower.contains("/etc/passwd")
            || lower.contains("/etc/shadow")
            || lower.contains("/etc/sudoers")
            || lower.contains("c:\\windows\\system32")
        {
            return true;
        }

        // path traversal attempts
        if lower.contains("..") && (lower.contains("/../") || lower.starts_with("../") || lower.ends_with("/.."))
        {
            return true;
        }
    }
    false
}

/// Extract the command name from a potentially-qualified path, stripping platform extensions.
///
/// e.g. `/usr/bin/python3` → `python3`, `C:\\Windows\\System32\\cmd.exe` → `cmd`
fn basename(command: &str) -> &str {
    let name = command
        .rsplit(|c: char| c == '/' || c == '\\')
        .next()
        .unwrap_or(command);

    // strip common executable extensions on Windows
    name.strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".cmd"))
        .or_else(|| name.strip_suffix(".bat"))
        .unwrap_or(name)
}

// ── Public API ─────────────────────────────────────────────────────────────

/// Assess the execution risk of a command and its arguments.
///
/// # Returns
/// - [`CommandRisk::Safe`] — the command is in the allow-list and its args are safe.
/// - [`CommandRisk::Blocked`] — the command or its arguments are banned.
/// - [`CommandRisk::NeedsConfirmation`] — the command is not in the allow-list
///   but not explicitly blocked; user confirmation is required.
pub fn assess_command_risk(command: &str, args: &[String]) -> CommandRisk {
    let name = basename(command);

    // 1. deny-list — always blocked
    if BLOCKED_COMMANDS.contains(name) {
        log::warn!("Blocked command attempted: {command}");
        return CommandRisk::Blocked;
    }

    // 2. allow-list — safe unless arguments are dangerous
    if SAFE_COMMANDS.contains(name) {
        if has_dangerous_args(name, args) {
            log::warn!("Safe command '{command}' used with dangerous arguments: {args:?}");
            return CommandRisk::NeedsConfirmation;
        }
        return CommandRisk::Safe;
    }

    // 3. unknown — require confirmation
    CommandRisk::NeedsConfirmation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_commands_pass() {
        assert_eq!(assess_command_risk("git", &[]), CommandRisk::Safe);
        assert_eq!(assess_command_risk("node", &[]), CommandRisk::Safe);
        assert_eq!(assess_command_risk("cargo", &[]), CommandRisk::Safe);
    }

    #[test]
    fn blocked_commands_rejected() {
        assert_eq!(assess_command_risk("rm", &[]), CommandRisk::Blocked);
        assert_eq!(assess_command_risk("sudo", &[]), CommandRisk::Blocked);
        assert_eq!(assess_command_risk("sh", &[]), CommandRisk::Blocked);
        assert_eq!(assess_command_risk("bash", &[]), CommandRisk::Blocked);
        assert_eq!(assess_command_risk("cmd", &[]), CommandRisk::Blocked);
    }

    #[test]
    fn qualified_paths_work() {
        assert_eq!(assess_command_risk("/usr/bin/git", &[]), CommandRisk::Safe);
        assert_eq!(assess_command_risk("/usr/bin/bash", &[]), CommandRisk::Blocked);
        assert_eq!(assess_command_risk("C:\\Windows\\System32\\cmd.exe", &[]), CommandRisk::Blocked);
    }
    fn unknown_commands_need_confirmation() {
        assert_eq!(assess_command_risk("foobar", &[]), CommandRisk::NeedsConfirmation);
    }

    #[test]
    fn dangerous_args_trigger_confirmation() {
        assert_eq!(assess_command_risk("git", &[String::from("-rf")]), CommandRisk::NeedsConfirmation);
        assert_eq!(assess_command_risk("git", &[String::from("--force")]), CommandRisk::NeedsConfirmation);
    }

    #[test]
    fn sensitive_paths_trigger_confirmation() {
        assert_eq!(
            assess_command_risk("cat", &[String::from("/etc/passwd")]),
            CommandRisk::NeedsConfirmation
        );
    }
}
