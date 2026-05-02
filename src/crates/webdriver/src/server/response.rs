use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct WebDriverResponse {
    pub value: Value,
}

impl WebDriverResponse {
    pub fn success<T: Serialize>(value: T) -> Self {
        Self {
            value: serde_json::to_value(value).unwrap_or(Value::Null),
        }
    }

    pub fn null() -> Self {
        Self { value: Value::Null }
    }
}

impl IntoResponse for WebDriverResponse {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [("Content-Type", "application/json; charset=utf-8")],
            Json(self),
        )
            .into_response()
    }
}

#[derive(Debug)]
pub struct WebDriverErrorResponse {
    pub status: StatusCode,
    pub error: String,
    pub message: String,
    pub stacktrace: Option<String>,
}

impl WebDriverErrorResponse {
    pub fn new(
        status: StatusCode,
        error: impl Into<String>,
        message: impl Into<String>,
        stacktrace: Option<String>,
    ) -> Self {
        Self {
            status,
            error: error.into(),
            message: message.into(),
            stacktrace,
        }
    }

    pub fn invalid_session_id(session_id: &str) -> Self {
        Self::not_found(
            "invalid session id",
            format!("Unknown session: {session_id}"),
        )
    }

    pub fn no_such_window(message: impl Into<String>) -> Self {
        Self::not_found("no such window", message)
    }

    pub fn no_such_element(message: impl Into<String>) -> Self {
        Self::not_found("no such element", message)
    }

    pub fn stale_element_reference(message: impl Into<String>) -> Self {
        Self::not_found("stale element reference", message)
    }

    pub fn no_such_frame(message: impl Into<String>) -> Self {
        Self::not_found("no such frame", message)
    }

    pub fn session_not_created(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "session not created",
            message,
            None,
        )
    }

    pub fn javascript_error(message: impl Into<String>, stacktrace: Option<String>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "javascript error",
            message,
            stacktrace,
        )
    }

    pub fn unknown_error(message: impl Into<String>) -> Self {
        Self::server_error("unknown error", message)
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::bad_request("invalid argument", message)
    }

    pub fn invalid_selector(message: impl Into<String>) -> Self {
        Self::bad_request("invalid selector", message)
    }

    pub fn no_such_cookie(message: impl Into<String>) -> Self {
        Self::not_found("no such cookie", message)
    }

    pub fn no_such_alert(message: impl Into<String>) -> Self {
        Self::not_found("no such alert", message)
    }

    pub fn no_such_shadow_root(message: impl Into<String>) -> Self {
        Self::not_found("no such shadow root", message)
    }

    pub fn unsupported_operation(message: impl Into<String>) -> Self {
        Self::server_error("unsupported operation", message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(StatusCode::REQUEST_TIMEOUT, "timeout", message, None)
    }

    fn not_found(error: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, error, message, None)
    }

    fn bad_request(error: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, error, message, None)
    }

    fn server_error(error: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, error, message, None)
    }
}

impl IntoResponse for WebDriverErrorResponse {
    fn into_response(self) -> Response {
        (
            self.status,
            [("Content-Type", "application/json; charset=utf-8")],
            Json(json!({
                "value": {
                    "error": self.error,
                    "message": self.message,
                    "stacktrace": self.stacktrace.unwrap_or_default()
                }
            })),
        )
            .into_response()
    }
}

pub type WebDriverResult = Result<WebDriverResponse, WebDriverErrorResponse>;
