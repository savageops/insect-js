import { Router } from "express";
import { getObservabilitySnapshot } from "../observability/metrics.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "insect",
    version: "1.0.0",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    observability: getObservabilitySnapshot(),
  });
});

export default router;
