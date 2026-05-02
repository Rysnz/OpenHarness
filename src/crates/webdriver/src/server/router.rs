use std::sync::Arc;

use axum::{
    routing::{delete, get, post},
    Router,
};

use super::handlers;
use super::AppState;

type StatefulRouter = Router<Arc<AppState>>;

pub fn create_router(state: Arc<AppState>) -> Router {
    webdriver_routes().with_state(state)
}

fn webdriver_routes() -> StatefulRouter {
    Router::new()
        .route("/status", get(handlers::status))
        .merge(session_routes())
        .merge(timeout_routes())
        .merge(navigation_routes())
        .merge(window_routes())
        .merge(frame_routes())
        .merge(alert_routes())
        .merge(element_lookup_routes())
        .merge(element_property_routes())
        .merge(element_action_routes())
        .merge(script_routes())
        .merge(input_routes())
        .merge(screenshot_routes())
        .merge(shadow_routes())
        .merge(cookie_routes())
        .merge(log_routes())
}

fn session_routes() -> StatefulRouter {
    Router::new()
        .route("/session", post(handlers::session::create))
        .route("/session/:session_id", delete(handlers::session::delete))
}

fn timeout_routes() -> StatefulRouter {
    Router::new().route(
        "/session/:session_id/timeouts",
        get(handlers::timeouts::get).post(handlers::timeouts::set),
    )
}

fn navigation_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/url",
            get(handlers::navigation::get_url).post(handlers::navigation::navigate),
        )
        .route(
            "/session/:session_id/back",
            post(handlers::navigation::back),
        )
        .route(
            "/session/:session_id/forward",
            post(handlers::navigation::forward),
        )
        .route(
            "/session/:session_id/refresh",
            post(handlers::navigation::refresh),
        )
        .route(
            "/session/:session_id/title",
            get(handlers::navigation::get_title),
        )
        .route(
            "/session/:session_id/source",
            get(handlers::navigation::get_source),
        )
}

fn window_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/window",
            get(handlers::window::get_window_handle)
                .post(handlers::window::switch_to_window)
                .delete(handlers::window::close_window),
        )
        .route(
            "/session/:session_id/window/new",
            post(handlers::window::new_window),
        )
        .route(
            "/session/:session_id/window/handles",
            get(handlers::window::get_window_handles),
        )
        .route(
            "/session/:session_id/window/rect",
            get(handlers::window::get_window_rect).post(handlers::window::set_window_rect),
        )
        .route(
            "/session/:session_id/window/maximize",
            post(handlers::window::maximize),
        )
        .route(
            "/session/:session_id/window/minimize",
            post(handlers::window::minimize),
        )
        .route(
            "/session/:session_id/window/fullscreen",
            post(handlers::window::fullscreen),
        )
}

fn frame_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/frame",
            post(handlers::frame::switch_to_frame),
        )
        .route(
            "/session/:session_id/frame/parent",
            post(handlers::frame::switch_to_parent_frame),
        )
}

fn alert_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/alert/dismiss",
            post(handlers::alert::dismiss),
        )
        .route(
            "/session/:session_id/alert/accept",
            post(handlers::alert::accept),
        )
        .route(
            "/session/:session_id/alert/text",
            get(handlers::alert::get_text).post(handlers::alert::send_text),
        )
}

fn element_lookup_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/element",
            post(handlers::element::find),
        )
        .route(
            "/session/:session_id/elements",
            post(handlers::element::find_all),
        )
        .route(
            "/session/:session_id/element/active",
            get(handlers::element::get_active),
        )
        .route(
            "/session/:session_id/element/:element_id/element",
            post(handlers::element::find_from_element),
        )
        .route(
            "/session/:session_id/element/:element_id/elements",
            post(handlers::element::find_all_from_element),
        )
}

fn element_property_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/element/:element_id/selected",
            get(handlers::element::is_selected),
        )
        .route(
            "/session/:session_id/element/:element_id/displayed",
            get(handlers::element::is_displayed),
        )
        .route(
            "/session/:session_id/element/:element_id/attribute/:name",
            get(handlers::element::get_attribute),
        )
        .route(
            "/session/:session_id/element/:element_id/property/:name",
            get(handlers::element::get_property),
        )
        .route(
            "/session/:session_id/element/:element_id/css/:property_name",
            get(handlers::element::get_css_value),
        )
        .route(
            "/session/:session_id/element/:element_id/text",
            get(handlers::element::get_text),
        )
        .route(
            "/session/:session_id/element/:element_id/name",
            get(handlers::element::get_name),
        )
        .route(
            "/session/:session_id/element/:element_id/rect",
            get(handlers::element::get_rect),
        )
        .route(
            "/session/:session_id/element/:element_id/enabled",
            get(handlers::element::is_enabled),
        )
        .route(
            "/session/:session_id/element/:element_id/computedrole",
            get(handlers::element::get_computed_role),
        )
        .route(
            "/session/:session_id/element/:element_id/computedlabel",
            get(handlers::element::get_computed_label),
        )
}

fn element_action_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/element/:element_id/click",
            post(handlers::element::click),
        )
        .route(
            "/session/:session_id/element/:element_id/clear",
            post(handlers::element::clear),
        )
        .route(
            "/session/:session_id/element/:element_id/value",
            post(handlers::element::send_keys),
        )
}

fn script_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/execute/sync",
            post(handlers::script::execute_sync),
        )
        .route(
            "/session/:session_id/execute/async",
            post(handlers::script::execute_async),
        )
        .route("/session/:session_id/print", post(handlers::print::print))
}

fn input_routes() -> StatefulRouter {
    Router::new().route(
        "/session/:session_id/actions",
        post(handlers::actions::perform).delete(handlers::actions::release),
    )
}

fn screenshot_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/screenshot",
            get(handlers::screenshot::take),
        )
        .route(
            "/session/:session_id/element/:element_id/screenshot",
            get(handlers::screenshot::take_element),
        )
}

fn shadow_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/element/:element_id/shadow",
            get(handlers::shadow::get_shadow_root),
        )
        .route(
            "/session/:session_id/shadow/:shadow_id/element",
            post(handlers::shadow::find_element_in_shadow),
        )
        .route(
            "/session/:session_id/shadow/:shadow_id/elements",
            post(handlers::shadow::find_elements_in_shadow),
        )
}

fn cookie_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/cookie",
            get(handlers::cookie::get_all)
                .post(handlers::cookie::add)
                .delete(handlers::cookie::delete_all),
        )
        .route(
            "/session/:session_id/cookie/:name",
            get(handlers::cookie::get).delete(handlers::cookie::delete),
        )
}

fn log_routes() -> StatefulRouter {
    Router::new()
        .route(
            "/session/:session_id/se/log/types",
            get(handlers::logs::get_types),
        )
        .route("/session/:session_id/se/log", post(handlers::logs::get))
}
