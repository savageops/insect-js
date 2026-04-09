import { Router } from "express";
import {
  fetchYouTubeTranscript,
  YouTubeTranscriptValidationError,
} from "../core/youtube-transcript.js";
import { recordEngineOutcome } from "../observability/metrics.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const result = await fetchYouTubeTranscript(req.body || {});

    if (!result.success) {
      const statusByCode = {
        TRANSCRIPT_UNAVAILABLE: 502,
      };
      return res.status(statusByCode[result.errorCode] || 500).json({
        error: result.error,
        code: result.errorCode || "TRANSCRIPT_ERROR",
        meta: result.meta,
      });
    }

    recordEngineOutcome(result);
    return res.json(result);
  } catch (err) {
    if (err instanceof YouTubeTranscriptValidationError) {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        field: err.field,
      });
    }
    return next(err);
  }
});

export default router;
