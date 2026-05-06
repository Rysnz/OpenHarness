use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

const SUPPORTED_LOCALES: [LocaleId; 2] = [LocaleId::ZhCN, LocaleId::EnUS];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum LocaleId {
    #[serde(rename = "zh-CN")]
    #[default]
    ZhCN,
    #[serde(rename = "en-US")]
    EnUS,
}

impl LocaleId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ZhCN => "zh-CN",
            Self::EnUS => "en-US",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        SUPPORTED_LOCALES
            .iter()
            .copied()
            .find(|locale| locale.as_str() == value)
    }

    pub fn all() -> Vec<LocaleId> {
        SUPPORTED_LOCALES.to_vec()
    }
}

impl fmt::Display for LocaleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleMetadata {
    pub id: LocaleId,
    pub name: String,
    pub english_name: String,
    pub native_name: String,
    pub rtl: bool,
}

impl LocaleMetadata {
    pub fn all() -> Vec<LocaleMetadata> {
        [Self::zh_cn(), Self::en_us()].to_vec()
    }

    fn zh_cn() -> Self {
        Self {
            id: LocaleId::ZhCN,
            name: "简体中文".to_string(),
            english_name: "Simplified Chinese".to_string(),
            native_name: "简体中文".to_string(),
            rtl: false,
        }
    }

    fn en_us() -> Self {
        Self {
            id: LocaleId::EnUS,
            name: "English".to_string(),
            english_name: "English (US)".to_string(),
            native_name: "English".to_string(),
            rtl: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct I18nConfig {
    #[serde(rename = "currentLanguage")]
    pub current_language: LocaleId,
    #[serde(rename = "fallbackLanguage")]
    pub fallback_language: LocaleId,
    #[serde(rename = "autoDetect")]
    pub auto_detect: bool,
}

impl Default for I18nConfig {
    fn default() -> Self {
        Self {
            current_language: LocaleId::ZhCN,
            fallback_language: LocaleId::EnUS,
            auto_detect: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct TranslationArgs {
    args: HashMap<String, FluentValue>,
}

#[derive(Debug, Clone)]
pub enum FluentValue {
    String(String),
    Number(f64),
}

impl TranslationArgs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_string(mut self, key: &str, value: impl Into<String>) -> Self {
        self.args
            .insert(key.to_string(), FluentValue::String(value.into()));
        self
    }

    pub fn with_number(mut self, key: &str, value: f64) -> Self {
        self.args
            .insert(key.to_string(), FluentValue::Number(value));
        self
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &FluentValue)> {
        self.args.iter()
    }
}
