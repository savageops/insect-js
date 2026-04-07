import { Router } from "express";
import { runInsectEngine } from "../core/engine.js";
import { requestValidationToHttp, normalizeEngineRequest } from "../core/request.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const params = normalizeEngineRequest(req.body, {
      allowFileOutput: false,
      allowHeadful: false,
    });
    const result = await runInsectEngine(params);

    if (!result.success) {
      const statusByErrorCode = {
        BROWSER_LAUNCH: 503,
        UPSTREAM_REQUEST: 502,
      };
      return res.status(statusByErrorCode[result.errorCode] || 500).json({
        error: result.error,
        code: result.errorCode || "ENGINE_ERROR",
      });
    }

    return res.json(result);
  } catch (err) {
    const validationResponse = requestValidationToHttp(err);
    if (validationResponse) {
      return res.status(validationResponse.status).json(validationResponse.body);
    }
    return res.status(500).json({ error: err.message });
  }
});

export default router;
