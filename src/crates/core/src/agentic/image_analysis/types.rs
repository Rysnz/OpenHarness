//! Image analysis related type definitions

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MIB: usize = 1024 * 1024;
const NO_APP_IMAGE_CAP: usize = usize::MAX;

#[derive(Debug, Clone, Copy)]
struct ProviderLimitSpec {
    max_size_mib: usize,
    max_width: u32,
    max_height: u32,
}

impl ProviderLimitSpec {
    const fn new(max_size_mib: usize, max_width: u32, max_height: u32) -> Self {
        Self {
            max_size_mib,
            max_width,
            max_height,
        }
    }

    fn into_limits(self) -> ImageLimits {
        ImageLimits {
            max_size: self.max_size_mib * MIB,
            max_width: self.max_width,
            max_height: self.max_height,
            max_images_per_request: NO_APP_IMAGE_CAP,
        }
    }
}

const DEFAULT_PROVIDER_LIMITS: ProviderLimitSpec = ProviderLimitSpec::new(20, 2048, 2048);
const ANTHROPIC_PROVIDER_LIMITS: ProviderLimitSpec = ProviderLimitSpec::new(5, 1568, 2390);
const GOOGLE_PROVIDER_LIMITS: ProviderLimitSpec = ProviderLimitSpec::new(10, 4096, 4096);

fn normalized_provider_key(provider: &str) -> String {
    provider.trim().to_ascii_lowercase()
}

/// Image context data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageContextData {
    /// Image ID
    pub id: String,
    /// Image file path (local file)
    pub image_path: Option<String>,
    /// Base64 encoded image data (clipboard/temporary file)
    pub data_url: Option<String>,
    /// MIME type
    pub mime_type: String,
    /// Metadata
    pub metadata: Option<serde_json::Value>,
}

/// Image analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAnalysisResult {
    /// Image ID
    pub image_id: String,
    /// Brief summary (1-2 sentences)
    pub summary: String,
    /// Detailed description
    pub detailed_description: String,
    /// Detected key elements
    pub detected_elements: Vec<String>,
    /// Confidence (0-1)
    pub confidence: f32,
    /// Analysis time (milliseconds)
    pub analysis_time_ms: u64,
}

/// Image analysis request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeImagesRequest {
    /// List of images
    pub images: Vec<ImageContextData>,
    /// User message (optional, helps understand user intent)
    pub user_message: Option<String>,
    /// Session ID
    pub session_id: String,
    /// Workspace path for the owning session.
    #[serde(default, alias = "workspacePath")]
    pub workspace_path: Option<String>,
}

/// Send enhanced message request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEnhancedMessageRequest {
    /// Original user message
    pub original_message: String,
    /// Image analysis results
    pub image_analyses: Vec<ImageAnalysisResult>,
    /// Other contexts (files, code snippets, etc.)
    pub other_contexts: Vec<serde_json::Value>,
    /// Session ID
    pub session_id: String,
    /// Dialog turn ID
    pub dialog_turn_id: String,
    pub agent_type: String,
}

/// Image source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImageSource {
    /// Local file path
    Path(PathBuf),
    /// Base64 encoded data
    Base64 { data: String, mime_type: String },
    /// URL (future extension)
    Url(String),
}

/// Image content (for message construction)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageContent {
    pub source: ImageSource,
    pub mime_type: String,
    pub metadata: Option<ImageMetadata>,
}

/// Image metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<u64>,
}

/// Image model limits configuration
#[derive(Debug, Clone)]
pub struct ImageLimits {
    /// Maximum file size (bytes)
    pub max_size: usize,
    /// Maximum width (pixels)
    pub max_width: u32,
    /// Maximum height (pixels)
    pub max_height: u32,
    /// Maximum number of images per request (no app-side cap; provider APIs may still reject).
    pub max_images_per_request: usize,
}

impl Default for ImageLimits {
    fn default() -> Self {
        DEFAULT_PROVIDER_LIMITS.into_limits()
    }
}

impl ImageLimits {
    /// Get limits based on model provider
    pub fn for_provider(provider: &str) -> Self {
        match normalized_provider_key(provider).as_str() {
            "anthropic" => ANTHROPIC_PROVIDER_LIMITS.into_limits(),
            "google" | "gemini" => GOOGLE_PROVIDER_LIMITS.into_limits(),
            "openai" | "response" | "responses" | "nvidia" | "openrouter" => {
                DEFAULT_PROVIDER_LIMITS.into_limits()
            }
            _ => Self::default(),
        }
    }
}
