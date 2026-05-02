//! Shell profiles - Shell configuration profiles

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ShellType;
use crate::config::ShellConfig;

/// A shell profile with configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellProfile {
    /// Profile ID
    pub id: String,

    /// Display name
    pub name: String,

    /// Shell type
    pub shell_type: ShellType,

    /// Shell configuration
    pub config: ShellConfig,

    /// Whether this is the default profile
    pub is_default: bool,

    /// Icon identifier (optional)
    pub icon: Option<String>,

    /// Color (optional)
    pub color: Option<String>,

    /// Whether this profile is hidden
    pub hidden: bool,
}

impl ShellProfile {
    /// Create a new shell profile
    pub fn new(id: String, name: String, shell_type: ShellType, config: ShellConfig) -> Self {
        Self::with_defaults(id, name, shell_type, config)
    }

    fn with_defaults(id: String, name: String, shell_type: ShellType, config: ShellConfig) -> Self {
        Self {
            id,
            name,
            shell_type,
            config,
            is_default: false,
            icon: None,
            color: None,
            hidden: false,
        }
    }

    /// Create a default profile from a detected shell
    pub fn from_detected(shell: &super::detection::DetectedShell) -> Self {
        Self::with_defaults(
            uuid::Uuid::new_v4().to_string(),
            shell.display_name.clone(),
            shell.shell_type.clone(),
            shell.to_config(),
        )
    }
}

/// Shell profile manager
#[allow(dead_code)]
pub struct ShellProfileManager {
    /// All profiles
    profiles: HashMap<String, ShellProfile>,

    /// Default profile ID
    default_profile_id: Option<String>,
}

#[allow(dead_code)]
impl ShellProfileManager {
    /// Create a new profile manager
    pub fn new() -> Self {
        Self {
            profiles: HashMap::new(),
            default_profile_id: None,
        }
    }

    /// Initialize with detected shells
    pub fn init_from_detected(&mut self) {
        let shells = super::ShellDetector::detect_available_shells();

        for (i, shell) in shells.into_iter().enumerate() {
            let mut profile = ShellProfile::from_detected(&shell);

            if i == 0 {
                self.mark_as_default(&mut profile);
            }

            self.profiles.insert(profile.id.clone(), profile);
        }
    }

    /// Add a profile
    pub fn add_profile(&mut self, profile: ShellProfile) {
        if profile.is_default {
            self.default_profile_id = Some(profile.id.clone());
        }
        self.profiles.insert(profile.id.clone(), profile);
    }

    /// Remove a profile
    pub fn remove_profile(&mut self, id: &str) -> Option<ShellProfile> {
        let profile = self.profiles.remove(id)?;

        self.clear_default_if(id);

        Some(profile)
    }

    /// Get a profile by ID
    pub fn get_profile(&self, id: &str) -> Option<&ShellProfile> {
        self.profiles.get(id)
    }

    /// Get the default profile
    pub fn get_default_profile(&self) -> Option<&ShellProfile> {
        self.default_profile_id
            .as_ref()
            .and_then(|id| self.profiles.get(id))
    }

    /// Set the default profile
    pub fn set_default_profile(&mut self, id: &str) -> bool {
        if !self.profiles.contains_key(id) {
            return false;
        }

        self.unset_current_default();

        if let Some(profile) = self.profiles.get_mut(id) {
            profile.is_default = true;
        }
        self.default_profile_id = Some(id.to_string());
        true
    }

    /// List all profiles
    pub fn list_profiles(&self) -> Vec<&ShellProfile> {
        self.profiles.values().collect()
    }

    /// List visible profiles (not hidden)
    pub fn list_visible_profiles(&self) -> Vec<&ShellProfile> {
        self.profiles.values().filter(|p| !p.hidden).collect()
    }

    fn mark_as_default(&mut self, profile: &mut ShellProfile) {
        profile.is_default = true;
        self.default_profile_id = Some(profile.id.clone());
    }

    fn clear_default_if(&mut self, id: &str) {
        if self.default_profile_id.as_deref() == Some(id) {
            self.default_profile_id = None;
        }
    }

    fn unset_current_default(&mut self) {
        if let Some(old_id) = &self.default_profile_id {
            if let Some(old_profile) = self.profiles.get_mut(old_id) {
                old_profile.is_default = false;
            }
        }
    }
}

impl Default for ShellProfileManager {
    fn default() -> Self {
        let mut manager = Self::new();
        manager.init_from_detected();
        manager
    }
}
