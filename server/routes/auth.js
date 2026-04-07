import { Router } from "express";
import { createKey, revokeKey, listKeys, getKeyInfo } from "../db/keys.js";
import { MIN_SEARCH_COOLDOWN_SECONDS } from "../core/contracts.js";

const router = Router();

router.post("/create", (req, res) => {
  const {
    label = "unnamed",
    rateLimit = 100,
    expiresIn = null,
    searchCooldownSeconds = MIN_SEARCH_COOLDOWN_SECONDS,
  } = req.body;
  const result = createKey(label, rateLimit, expiresIn, searchCooldownSeconds);
  res.status(201).json(result);
});

router.delete("/:key", (req, res) => {
  const revoked = revokeKey(req.params.key);
  if (!revoked) return res.status(404).json({ error: "Key not found" });
  res.json({ revoked: true });
});

router.get("/", (_req, res) => {
  res.json({ keys: listKeys() });
});

router.get("/:key", (req, res) => {
  const info = getKeyInfo(req.params.key);
  if (!info) return res.status(404).json({ error: "Key not found" });
  res.json(info);
});

export default router;
