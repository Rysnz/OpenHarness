//! Shell dialect definitions
//!
//! Supports PowerShell, cmd, bash, and zsh.

use serde::{Deserialize, Serialize};

/// Supported shell dialects
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShellDialect {
    PowerShell,
    Cmd,
    Bash,
    Zsh,
    Sh,
    Unknown,
}

impl Default for ShellDialect {
    fn default() -> Self {
        Self::Unknown
    }
}

impl ShellDialect {
    /// Get the default shell for the current platform
    pub fn platform_default() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::PowerShell
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::Bash
        }
    }

    /// Check if this is a Windows shell
    pub fn is_windows(&self) -> bool {
        matches!(self, Self::PowerShell | Self::Cmd)
    }

    /// Check if this is a Unix shell
    pub fn is_unix(&self) -> bool {
        matches!(self, Self::Bash | Self::Zsh | Self::Sh)
    }

    /// Get common dangerous command patterns for this dialect
    pub fn dangerous_patterns(&self) -> &'static [&'static str] {
        match self {
            Self::PowerShell => &[
                "Remove-Item",
                "rm",
                "del",
                "rmdir",
                "Format-Volume",
                "Clear-Content",
                "Stop-Process",
                "Invoke-Expression",
                "iex",
                "&",
                "Start-Process",
            ],
            Self::Cmd => &["del", "rmdir", "format", "erase", "rd"],
            Self::Bash | Self::Zsh | Self::Sh => &[
                "rm", "dd", "mkfs", "shutdown", "reboot", "halt", "poweroff", "kill", "pkill",
                "killall",
            ],
            Self::Unknown => &[],
        }
    }
}

/// Detect shell dialect from command content
pub struct ShellDialectDetector;

impl ShellDialectDetector {
    /// Detect shell dialect from command string
    pub fn detect(command: &str) -> ShellDialect {
        let trimmed = command.trim();

        // PowerShell detection
        if Self::is_powershell(trimmed) {
            return ShellDialect::PowerShell;
        }

        // cmd detection
        if Self::is_cmd(trimmed) {
            return ShellDialect::Cmd;
        }

        // zsh detection (zsh-specific features)
        if Self::is_zsh(trimmed) {
            return ShellDialect::Zsh;
        }

        // bash detection
        if Self::is_bash(trimmed) {
            return ShellDialect::Bash;
        }

        // Default to platform default
        ShellDialect::platform_default()
    }

    fn is_powershell(cmd: &str) -> bool {
        // PowerShell-specific patterns
        let patterns = [
            // Cmdlets
            "Get-",
            "Set-",
            "Remove-",
            "New-",
            "Invoke-",
            "Write-",
            "Read-",
            "Select-",
            "Where-",
            "ForEach-",
            "Sort-",
            "Group-",
            "Measure-",
            "Format-",
            "Out-",
            "ConvertTo-",
            "ConvertFrom-",
            "Export-",
            "Import-",
            // Operators
            " -eq ",
            " -ne ",
            " -gt ",
            " -lt ",
            " -ge ",
            " -le ",
            " -and ",
            " -or ",
            " -not ",
            " -match ",
            " -like ",
            " -contains ",
            // Variables
            "$_",
            "$true",
            "$false",
            "$null",
            "$?",
            "$LASTEXITCODE",
            // Common aliases
            " iex ",
            " iex\n",
            " iex\t",
            " iex;",
            "?{",
            "%{",
            // Pipeline
            " | Select-Object",
            " | Where-Object",
            " | ForEach-Object",
        ];

        let lower = cmd.to_ascii_lowercase();
        patterns
            .iter()
            .any(|p| lower.contains(&p.to_ascii_lowercase()))
    }

    fn is_cmd(cmd: &str) -> bool {
        // cmd-specific patterns
        let patterns = [
            // cmd commands
            "cmd /c",
            "cmd.exe /c",
            "cmd /k",
            "cmd.exe /k",
            // Batch file patterns
            "call ",
            "goto ",
            "exit /b",
            // Variable syntax
            "%cd%",
            "%date%",
            "%time%",
            "%errorlevel%",
            // Redirection specific to cmd
            "2>nul",
            "1>nul",
            ">nul",
        ];

        let lower = cmd.to_ascii_lowercase();
        patterns
            .iter()
            .any(|p| lower.contains(&p.to_ascii_lowercase()))
    }

    fn is_zsh(cmd: &str) -> bool {
        // zsh-specific features
        let patterns = [
            // zsh-specific syntax
            " ${(s:/:)var}",
            " ${(j:,:)arr}",
            " ${~",
            " ${=#",
            " ${(%):-",
            // zsh arrays
            " ${arr[(r)",
            " ${arr[(i)",
            // zsh globbing
            "(#q",
            "(#a",
            "(#s",
            // zsh-specific expansion
            " ${~:-",
            " ${:-",
            // zsh modifiers
            ":h",
            ":t",
            ":r",
            ":e",
            ":s/",
        ];

        patterns.iter().any(|p| cmd.contains(p))
    }

    fn is_bash(cmd: &str) -> bool {
        // bash-specific features (that aren't zsh)
        let patterns = [
            // bash-specific syntax
            " <<<",
            " <<<",
            " ${var:-",
            " ${var:+",
            // bash arrays
            " ${arr[@]}",
            " ${arr[*]}",
            // bash parameter expansion
            " ${var%pattern}",
            " ${var#pattern}",
            // bash brace expansion
            "{start..end}",
            "{a..z}",
            // bash-specific builtins
            "declare ",
            "typeset ",
            "local ",
            "shopt ",
            "compgen ",
            "complete ",
            // Process substitution
            "<(",
            ">(",
        ];

        patterns.iter().any(|p| cmd.contains(p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_powershell_cmdlet() {
        assert_eq!(
            ShellDialectDetector::detect("Get-Process"),
            ShellDialect::PowerShell
        );
        assert_eq!(
            ShellDialectDetector::detect("Remove-Item -Recurse -Force"),
            ShellDialect::PowerShell
        );
    }

    #[test]
    fn detects_cmd_syntax() {
        assert_eq!(
            ShellDialectDetector::detect("cmd /c dir"),
            ShellDialect::Cmd
        );
        assert_eq!(
            ShellDialectDetector::detect("del file.txt 2>nul"),
            ShellDialect::Cmd
        );
    }

    #[test]
    fn detects_bash_here_string() {
        assert_eq!(
            ShellDialectDetector::detect("cat <<< 'hello'"),
            ShellDialect::Bash
        );
    }
}
