use std::sync::Arc;

use axum::{
    Json,
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use serde_json::json;

use crate::{
    AppState,
    db::{ValidationContext, ValidationFailure},
};

pub async fn admin_key_middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let admin_key = read_admin_key(request.headers()).unwrap_or_default();
    if admin_key != state.config.admin_key {
        return json_error(
            StatusCode::FORBIDDEN.as_u16(),
            json!({ "error": "Admin key required via x-admin-key or Authorization header." }),
        );
    }
    next.run(request).await
}

pub fn authorize_api_key(
    headers: &HeaderMap,
    state: &Arc<AppState>,
    enforce_search_cooldown: bool,
) -> Result<(), Response> {
    let api_key = read_api_key(headers).unwrap_or_default();
    state
        .keys
        .validate_key(
            &api_key,
            ValidationContext {
                enforce_search_cooldown,
            },
        )
        .map_err(validation_failure_response)
}

pub fn read_api_key(headers: &HeaderMap) -> Option<String> {
    first_header_value(headers, "x-api-key").or_else(|| read_bearer_token(headers))
}

fn read_admin_key(headers: &HeaderMap) -> Option<String> {
    first_header_value(headers, "x-admin-key").or_else(|| read_bearer_token(headers))
}

fn first_header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_bearer_token(headers: &HeaderMap) -> Option<String> {
    let authorization = headers.get("authorization")?.to_str().ok()?.trim();
    let prefix = authorization.get(..7)?;
    if !prefix.eq_ignore_ascii_case("bearer ") {
        return None;
    }
    let token = authorization[7..].trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

pub fn json_error(status: u16, body: serde_json::Value) -> Response {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(Json(body).0.to_string()))
        .unwrap()
}

pub fn validation_failure_response(failure: ValidationFailure) -> Response {
    let mut body = json!({
        "error": failure.error,
        "code": failure.code,
        "retryAfter": failure.retry_after,
    });
    if let Some(cooldown_seconds) = failure.cooldown_seconds {
        body["cooldownSeconds"] = json!(cooldown_seconds);
    }
    json_error(failure.status, body)
}
