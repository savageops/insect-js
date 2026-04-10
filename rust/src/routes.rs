use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    extract::{Path, Request, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    AppState, auth,
    contracts::{ENGINE_API_PATH, SERVICE_NAME, YOUTUBE_TRANSCRIPT_API_PATH},
    db::{CreateKeyInput, KeyRecord},
    engine::run_insect_engine,
    observability::{get_snapshot, record_engine_outcome, record_http_response, uptime_seconds},
    request::{
        EngineNormalizationOptions, EngineRequestInput, normalize_engine_request,
        request_validation_to_http,
    },
    transcript::{TranscriptInput, TranscriptValidationError, fetch_youtube_transcript},
};

pub fn build_router(state: Arc<AppState>) -> Router {
    let api_routes = Router::new()
        .route(ENGINE_API_PATH, post(engine))
        .route(YOUTUBE_TRANSCRIPT_API_PATH, post(youtube_transcript));

    let admin_routes = Router::new()
        .route("/api/keys/create", post(create_key))
        .route("/api/keys", get(list_keys))
        .route("/api/keys/{key}", get(inspect_key).delete(revoke_key))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::admin_key_middleware,
        ));

    Router::new()
        .route("/health", get(health))
        .merge(api_routes)
        .merge(admin_routes)
        .with_state(state)
        .layer(middleware::from_fn(track_request_metrics))
}

async fn track_request_metrics(request: Request, next: Next) -> Response {
    let started_at = Instant::now();
    let response = next.run(request).await;
    record_http_response(
        response.status().as_u16(),
        started_at.elapsed().as_secs_f64() * 1000.0,
    );
    response
}

async fn health() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": SERVICE_NAME,
        "version": env!("CARGO_PKG_VERSION"),
        "uptime": uptime_seconds(),
        "observability": get_snapshot(),
    }))
}

async fn engine(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    payload: Result<Json<EngineRequestInput>, JsonRejection>,
) -> impl IntoResponse {
    let payload = match payload {
        Ok(Json(payload)) => payload,
        Err(error) => return invalid_json_response(error),
    };

    let enforce_search_cooldown = payload
        .query
        .as_deref()
        .or(payload.google.as_deref())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if let Err(response) = auth::authorize_api_key(&headers, &state, enforce_search_cooldown) {
        return response;
    }

    let params = match normalize_engine_request(
        payload,
        EngineNormalizationOptions {
            allow_file_output: false,
            allow_headful: false,
        },
    ) {
        Ok(params) => params,
        Err(error) => {
            let (status, body) = request_validation_to_http(&error);
            return auth::json_error(status, body);
        }
    };

    let result = run_insect_engine(params).await;
    if !result.success {
        let status = match result.error_code.as_deref() {
            Some("BROWSER_LAUNCH") => StatusCode::SERVICE_UNAVAILABLE,
            Some("UPSTREAM_REQUEST") => StatusCode::BAD_GATEWAY,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        return (
            status,
            Json(json!({
                "error": result.error,
                "code": result.error_code.unwrap_or_else(|| "ENGINE_ERROR".to_string()),
            })),
        )
            .into_response();
    }

    record_engine_outcome(&result);
    Json(result).into_response()
}

async fn youtube_transcript(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    payload: Result<Json<TranscriptInput>, JsonRejection>,
) -> impl IntoResponse {
    let payload = match payload {
        Ok(Json(payload)) => payload,
        Err(error) => return invalid_json_response(error),
    };

    if let Err(response) = auth::authorize_api_key(&headers, &state, false) {
        return response;
    }

    match fetch_youtube_transcript(payload, state).await {
        Ok(result) => (StatusCode::OK, Json(json!(result))).into_response(),
        Err(TranscriptValidationError { message, field }) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": message,
                "code": "VALIDATION_ERROR",
                "field": field,
            })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct CreateKeyBody {
    label: Option<String>,
    #[serde(rename = "rateLimit")]
    rate_limit: Option<i64>,
    #[serde(rename = "searchCooldownSeconds")]
    search_cooldown_seconds: Option<i64>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<i64>,
}

#[derive(Debug, Serialize)]
struct KeyListResponse {
    keys: Vec<KeyRecord>,
}

async fn create_key(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateKeyBody>,
) -> impl IntoResponse {
    match state.keys.create_key(CreateKeyInput {
        label: body.label,
        rate_limit: body.rate_limit,
        search_cooldown_seconds: body.search_cooldown_seconds,
        expires_in_seconds: body.expires_in,
    }) {
        Ok(record) => (StatusCode::CREATED, Json(json!(record))).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn list_keys(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.keys.list_keys() {
        Ok(keys) => (StatusCode::OK, Json(json!(KeyListResponse { keys }))).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn inspect_key(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> impl IntoResponse {
    match state.keys.get_key(&key, true) {
        Ok(Some(record)) => (StatusCode::OK, Json(json!(record))).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "API key not found." })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn revoke_key(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> impl IntoResponse {
    match state.keys.revoke_key(&key) {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({
                "apiKey": key,
                "revokedAt": Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "API key not found." })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

fn invalid_json_response(error: JsonRejection) -> Response {
    let message = if matches!(error, JsonRejection::JsonSyntaxError(_)) {
        "Invalid JSON request body.".to_string()
    } else {
        error.body_text()
    };
    (
        StatusCode::BAD_REQUEST,
        Json(json!({
            "error": message,
        })),
    )
        .into_response()
}
