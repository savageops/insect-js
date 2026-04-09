import express from "express";
import { apiKeyAuth } from "./middleware/auth.js";
import engineRouter from "./routes/engine.js";
import youtubeTranscriptRouter from "./routes/youtube-transcript.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";
import {
  ENGINE_API_PATH,
  YOUTUBE_TRANSCRIPT_API_PATH,
} from "./core/contracts.js";
import { logError, logEvent } from "./observability/logging.js";
import { recordHttpResponse } from "./observability/metrics.js";
import { firstHeaderValue, readBearerToken } from "./core/http-headers.js";

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY
  || (process.env.NODE_ENV === "production" ? null : "admin_change_me");

function readAdminKey(req) {
  const headerKey = firstHeaderValue(req.headers["x-admin-key"]);
  if (headerKey) return headerKey;

  const bearerToken = readBearerToken(req.headers.authorization);
  if (bearerToken) return bearerToken;
  return null;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const rawPath = req.originalUrl || req.url || "/";
  const sanitizedPath = rawPath.split("?")[0];
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordHttpResponse({ statusCode: res.statusCode, durationMs });
    logEvent("http.request", {
      method: req.method,
      path: sanitizedPath,
      status: res.statusCode,
      duration_ms: durationMs,
    });
  });
  next();
});

app.use("/health", healthRouter);

app.use(ENGINE_API_PATH, apiKeyAuth, engineRouter);
app.use(YOUTUBE_TRANSCRIPT_API_PATH, apiKeyAuth, youtubeTranscriptRouter);

app.use("/api/keys", (req, res, next) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({
      error: "Server misconfigured: ADMIN_KEY must be set in production.",
    });
  }
  const key = readAdminKey(req);
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Admin key required via x-admin-key or Authorization header." });
  }
  next();
}, authRouter);

app.use((err, _req, res, _next) => {
  const parseFailed = err?.type === "entity.parse.failed"
    || (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, "body"));
  if (parseFailed) {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  logError("http.unhandled_error", err);
  res.status(500).json({ error: "Internal server error" });
});

export function startServer(port) {
  const server = app.listen(port || PORT, () => {
    logEvent("server.started", {
      service: "insect",
      port: Number(port || PORT),
      engine_path: ENGINE_API_PATH,
      youtube_transcript_path: YOUTUBE_TRANSCRIPT_API_PATH,
    });
  });
  return server;
}

export { app };
