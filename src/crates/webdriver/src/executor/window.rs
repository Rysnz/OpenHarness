use std::time::Duration;

use tauri::{PhysicalPosition, PhysicalSize, Position, Size};

use crate::executor::BridgeExecutor;
use crate::platform::WindowRect;
use crate::server::response::WebDriverErrorResponse;

const WINDOW_SETTLE_MS: u64 = 100;
const WINDOW_MODE_SETTLE_MS: u64 = 50;

impl BridgeExecutor {
    pub async fn get_window_rect(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        let window = self.webview_window()?;
        let position = window.outer_position().map_err(|error| {
            WebDriverErrorResponse::unknown_error(format!(
                "Failed to read window position: {error}"
            ))
        })?;
        let size = window.outer_size().map_err(|error| {
            WebDriverErrorResponse::unknown_error(format!("Failed to read window size: {error}"))
        })?;

        Ok(WindowRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    }

    pub async fn set_window_rect(
        &self,
        rect: WindowRect,
    ) -> Result<WindowRect, WebDriverErrorResponse> {
        let window = self.webview_window()?;

        if window.is_fullscreen().unwrap_or(false) {
            let _ = window.set_fullscreen(false);
            sleep_for_window_mode_change().await;
        }

        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
            sleep_for_window_mode_change().await;
        }

        window
            .set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)))
            .map_err(|error| {
                WebDriverErrorResponse::unknown_error(format!(
                    "Failed to set window position: {error}"
                ))
            })?;

        let (chrome_width, chrome_height) = window_chrome_size(&window);

        let inner_width = rect.width.saturating_sub(chrome_width);
        let inner_height = rect.height.saturating_sub(chrome_height);
        window
            .set_size(Size::Physical(PhysicalSize::new(inner_width, inner_height)))
            .map_err(|error| {
                WebDriverErrorResponse::unknown_error(format!("Failed to set window size: {error}"))
            })?;

        self.get_window_rect().await
    }

    pub async fn maximize_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        self.webview_window()?.maximize().map_err(|error| {
            WebDriverErrorResponse::unknown_error(format!("Failed to maximize window: {error}"))
        })?;
        sleep_for_window_change().await;
        self.get_window_rect().await
    }

    pub async fn minimize_window(&self) -> Result<(), WebDriverErrorResponse> {
        self.webview_window()?.minimize().map_err(|error| {
            WebDriverErrorResponse::unknown_error(format!("Failed to minimize window: {error}"))
        })?;
        Ok(())
    }

    pub async fn fullscreen_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        self.webview_window()?
            .set_fullscreen(true)
            .map_err(|error| {
                WebDriverErrorResponse::unknown_error(format!(
                    "Failed to fullscreen window: {error}"
                ))
            })?;
        sleep_for_window_change().await;
        self.get_window_rect().await
    }
}

fn window_chrome_size<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> (u32, u32) {
    let Ok(outer) = window.outer_size() else {
        return (0, 0);
    };
    let Ok(inner) = window.inner_size() else {
        return (0, 0);
    };

    (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    )
}

async fn sleep_for_window_mode_change() {
    tokio::time::sleep(Duration::from_millis(WINDOW_MODE_SETTLE_MS)).await;
}

async fn sleep_for_window_change() {
    tokio::time::sleep(Duration::from_millis(WINDOW_SETTLE_MS)).await;
}
