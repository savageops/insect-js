import express from "express";
import { apiKeyAuth } from "./middleware/auth.js";
import engineRouter from "./routes/engine.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY
  || (process.env.NODE_ENV === "production" ? null : "admin_change_me");

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use("/health", healthRouter);

app.use("/api/engine", apiKeyAuth, engineRouter);

app.use("/api/keys", (req, res, next) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({
      error: "Server misconfigured: ADMIN_KEY must be set in production.",
    });
  }
  const key = req.headers["x-admin-key"]
    || req.headers.authorization?.replace("Bearer ", "")
    || req.query?.adminkey;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Admin key required via x-admin-key header." });
  }
  next();
}, authRouter);

app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export function startServer(port) {
  const server = app.listen(port || PORT, () => {
    console.log(`insect API listening on http://localhost:${port || PORT}`);
    console.log(`  POST /api/engine    - Engine endpoint (requires x-api-key)`);
    console.log(`  GET  /health        - Health check`);
    console.log(`  POST /api/keys      - Key management (requires x-admin-key)`);
  });
  return server;
}

export { app };
