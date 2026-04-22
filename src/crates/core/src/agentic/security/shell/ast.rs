//! Shell AST utilities
//!
//! Simple parsing utilities for shell command analysis.

/// Parsed shell command structure
#[derive(Debug, Clone)]
pub struct ShellCommand {
    /// The command name (first token)
    pub command: String,
    /// Arguments to the command
    pub args: Vec<String>,
    /// Raw input string
    pub raw: String,
}

impl ShellCommand {
    /// Parse a shell command string
    pub fn parse(input: &str) -> Self {
        let raw = input.to_string();
        let parts = Self::tokenize(input);

        let (command, args) = if parts.is_empty() {
            (String::new(), Vec::new())
        } else {
            (parts[0].clone(), parts[1..].to_vec())
        };

        Self { command, args, raw }
    }

    /// Tokenize a shell command string
    fn tokenize(input: &str) -> Vec<String> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        let mut in_single_quote = false;
        let mut in_double_quote = false;
        let mut escape_next = false;
        let chars: Vec<char> = input.chars().collect();

        for (i, &c) in chars.iter().enumerate() {
            if escape_next {
                current.push(c);
                escape_next = false;
                continue;
            }

            match c {
                '\\' => {
                    // Handle escape sequences
                    if i + 1 < chars.len() {
                        let next = chars[i + 1];
                        if next == '\n' {
                            // Line continuation, skip both
                        } else if next == ' '
                            || next == '\t'
                            || next == '"'
                            || next == '\''
                            || next == '\\'
                            || next == '$'
                        {
                            escape_next = true;
                        } else {
                            current.push(c);
                        }
                    } else {
                        current.push(c);
                    }
                }
                '\'' => {
                    if in_double_quote {
                        current.push(c);
                    } else {
                        in_single_quote = !in_single_quote;
                    }
                }
                '"' => {
                    if in_single_quote {
                        current.push(c);
                    } else {
                        in_double_quote = !in_double_quote;
                    }
                }
                ' ' | '\t' | '\n' if !in_single_quote && !in_double_quote => {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                }
                _ => {
                    current.push(c);
                }
            }
        }

        if !current.is_empty() {
            tokens.push(current);
        }

        tokens
    }

    /// Check if the command starts with a specific command name
    pub fn starts_with(&self, name: &str) -> bool {
        self.command.eq_ignore_ascii_case(name)
    }

    /// Check if any argument contains a pattern
    pub fn arg_contains(&self, pattern: &str) -> bool {
        self.args.iter().any(|arg| arg.contains(pattern))
    }

    /// Check if any argument matches a pattern (case insensitive)
    pub fn arg_matches(&self, pattern: &str) -> bool {
        let pattern_lower = pattern.to_ascii_lowercase();
        self.args
            .iter()
            .any(|arg| arg.to_ascii_lowercase() == pattern_lower)
    }

    /// Get the raw command as lowercase
    pub fn command_lower(&self) -> String {
        self.command.to_ascii_lowercase()
    }

    /// Check if the command has a specific flag
    pub fn has_flag(&self, flag: &str) -> bool {
        let normalized_flag = flag.trim_start_matches('-');

        self.args.iter().any(|arg| {
            if arg == &format!("-{}", normalized_flag) {
                return true;
            }

            if !arg.starts_with('-') || arg.starts_with("--") {
                return false;
            }

            let cluster = arg.trim_start_matches('-');
            cluster == normalized_flag
                || (normalized_flag.len() == 1
                    && cluster.len() > 1
                    && cluster.chars().all(|c| c.is_ascii_lowercase())
                    && cluster.contains(normalized_flag))
        })
    }

    /// Check if the command has a long flag
    pub fn has_long_flag(&self, flag: &str) -> bool {
        let flag_with_dashes = if flag.starts_with("--") {
            flag.to_string()
        } else {
            format!("--{}", flag)
        };

        self.args.iter().any(|arg| arg == &flag_with_dashes)
    }

    /// Get argument at index
    pub fn arg_at(&self, index: usize) -> Option<&str> {
        self.args.get(index).map(|s| s.as_str())
    }

    /// Check if any argument starts with a prefix
    pub fn arg_starts_with(&self, prefix: &str) -> bool {
        self.args.iter().any(|arg| arg.starts_with(prefix))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_command() {
        let cmd = ShellCommand::parse("ls -la /tmp");
        assert_eq!(cmd.command, "ls");
        assert_eq!(cmd.args, vec!["-la", "/tmp"]);
    }

    #[test]
    fn handles_quoted_arguments() {
        let cmd = ShellCommand::parse("echo 'hello world'");
        assert_eq!(cmd.command, "echo");
        assert_eq!(cmd.args, vec!["hello world"]);
    }

    #[test]
    fn handles_double_quotes() {
        let cmd = ShellCommand::parse("echo \"hello world\"");
        assert_eq!(cmd.command, "echo");
        assert_eq!(cmd.args, vec!["hello world"]);
    }

    #[test]
    fn detects_flags() {
        let cmd = ShellCommand::parse("rm -rf /tmp");
        assert!(cmd.has_flag("r"));
        assert!(cmd.has_flag("f"));
        assert!(cmd.has_flag("rf"));
    }

    #[test]
    fn handles_powershell_command() {
        let cmd = ShellCommand::parse("Remove-Item -Recurse -Force C:\\test");
        assert_eq!(cmd.command, "Remove-Item");
        assert!(cmd.arg_contains("-Recurse"));
    }
}
