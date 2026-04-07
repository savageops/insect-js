import { startServer } from "./server/index.js";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });

startServer();
