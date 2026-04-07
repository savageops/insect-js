#!/usr/bin/env node

import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FORMATS, METHODS } from "./server/core/fingerprint.js";
import {
  DEFAULT_SEARCH_ENGINES,
  SUPPORTED_SEARCH_ENGINES,
} from "./server/core/search.js";
import {
  RequestValidationError,
  normalizeEngineRequest,
} from "./server/core/request.js";
import { runInsectEngine } from "./server/core/engine.js";

function printHelp() {
  const methodHelp = Object.entries(METHODS)
    .map(([name, description]) => `  ${name.padEnd(10)} - ${description}`)
    .join("\n");
  const formatHelp = FORMATS.map((format) => `  ${format}`).join("\n");
  const searchHelp = SUPPORTED_SEARCH_ENGINES.map((engine) => `  ${engine}`).join("\n");

  console.log(`
insect v1.0.0

USAGE:
  node insect-engine.js --url <url> [options]

REQUIRED:
  --url <url>            Target URL to scrape
  --query <query>        Search query to run across fallback engines
  --google <query>       Legacy alias for --query

OPTIONS:
  --method <method>      Scraping method (default: direct)
  --format <format>      Output format (default: text)
  --verbose              Include all content (default: filtered)
  --selector <css>       CSS selector for method=wait
  --timeout <sec>        Request timeout in seconds (default: 30)
  --scroll-count <n>     Scroll iterations for method=scroll (default: 20)
  --scroll-delay <ms>    Delay between scrolls in milliseconds (default: 800)
  --delay <ms>           Pre-engine randomized delay floor in ms (default: 1000)
  --google-count <n>     Maximum search results to return (default: 10)
  --search-engines <csv> Search fallback order; Google is always forced last
                         (default: ${DEFAULT_SEARCH_ENGINES.join(",")})
  --proxy <url>          HTTP/HTTPS proxy URL
  --cookies <json>       Cookies JSON array
  --headers <json>       Extra headers JSON object
  --headless             Run browser headless (default)
  --no-headless          Run with visible browser for debugging
  --screenshot <path>    Save full-page screenshot to file
  --pdf <path>           Save page as PDF
  --list-links           Print discovered links to stderr
  --metadata             Print engine metadata to stderr
  --output <path>        Write output to file instead of stdout
  --help                 Show this help

METHODS:
${methodHelp}

FORMATS:
${formatHelp}

SEARCH ENGINES:
${searchHelp}
`);
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      query: { type: "string" },
      google: { type: "string" },
      method: { type: "string", default: "direct" },
      format: { type: "string", default: "text" },
      verbose: { type: "boolean", default: false },
      selector: { type: "string" },
      timeout: { type: "string", default: "30" },
      "scroll-count": { type: "string", default: "20" },
      "scroll-delay": { type: "string", default: "800" },
      delay: { type: "string", default: "1000" },
      "google-count": { type: "string", default: "10" },
      "search-engines": { type: "string" },
      proxy: { type: "string" },
      cookies: { type: "string" },
      headers: { type: "string" },
      headless: { type: "boolean", default: true },
      "no-headless": { type: "boolean", default: false },
      screenshot: { type: "string" },
      pdf: { type: "string" },
      "list-links": { type: "boolean", default: false },
      metadata: { type: "boolean", default: false },
      output: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  return values;
}

function writeOutput(pathValue, content) {
  const outputPath = resolve(pathValue);
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, content, "utf-8");
  return outputPath;
}

function printMetadata(result, params) {
  const { meta } = result;
  if (!meta) return;
  console.error("[meta] Method:", params.method);
  console.error("[meta] Format:", params.format);
  if (params.url) console.error("[meta] Target:", params.url);
  if (params.query) console.error("[meta] Search query:", params.query);
  console.error("[meta] Elapsed:", `${meta.elapsed}s`);
  if (meta.type === "page") {
    console.error("[meta] Title:", meta.title || "(unknown)");
    console.error("[meta] URL:", meta.url || "(unknown)");
    console.error("[meta] Text length:", meta.textLength ?? 0);
    console.error("[meta] Links found:", meta.linksFound ?? 0);
  }
  if (meta.type === "search") {
    console.error("[meta] Search engine:", meta.engine || "(none)");
    console.error("[meta] Search results:", meta.resultCount ?? 0);
    if (Array.isArray(meta.attempts)) {
      for (const attempt of meta.attempts) {
        const attemptStatus = attempt.reason || (attempt.resultCount > 0 ? "ok" : "no_results");
        console.error(
          `[meta] Attempt: ${attempt.engine} => ${attemptStatus} (${attempt.resultCount ?? 0})`,
        );
      }
    }
  }
  if (meta.fingerprint) {
    console.error("[meta] Fingerprint:", `${meta.fingerprint.userAgent?.substring(0, 60)}...`);
    console.error(
      "[meta] Viewport:",
      `${meta.fingerprint.viewport?.width}x${meta.fingerprint.viewport?.height}`,
    );
    console.error("[meta] Locale:", meta.fingerprint.locale);
    console.error("[meta] Timezone:", meta.fingerprint.timezone);
  }
  if (meta.artifacts?.screenshotPath) {
    console.error("[meta] Screenshot:", meta.artifacts.screenshotPath);
  }
  if (meta.artifacts?.pdfPath) {
    console.error("[meta] PDF:", meta.artifacts.pdfPath);
  }
}

function printLinks(result) {
  const links = result.meta?.links;
  if (!Array.isArray(links) || links.length === 0) {
    console.error("[links] No links found.");
    return;
  }
  console.error(`[links] Found ${links.length} links:`);
  for (const link of links) {
    const text = (link.text || "").trim();
    console.error(`  ${link.href}${text ? ` | ${text}` : ""}`);
  }
}

async function main() {
  const opts = parseCli();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let params;
  try {
    params = normalizeEngineRequest(
      {
        ...opts,
        scrollCount: opts["scroll-count"],
        scrollDelay: opts["scroll-delay"],
        googleCount: opts["google-count"],
        searchEngines: opts["search-engines"],
        listLinks: opts["list-links"],
        screenshotPath: opts.screenshot,
        pdfPath: opts.pdf,
      },
      { allowFileOutput: true, allowHeadful: true },
    );
  } catch (err) {
    if (err instanceof RequestValidationError) {
      console.error(`[error] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const result = await runInsectEngine(params);
  if (!result.success) {
    console.error(`[error] ${result.error}`);
    process.exit(1);
  }

  if (opts.metadata) {
    printMetadata(result, params);
  }
  if (params.listLinks && result.meta?.type === "page") {
    printLinks(result);
  }

  const output = typeof result.output === "string"
    ? result.output
    : JSON.stringify(result.output, null, 2);

  if (opts.output) {
    const savedPath = writeOutput(opts.output, output);
    if (opts.metadata) {
      console.error("[meta] Output saved:", savedPath);
    }
    return;
  }

  console.log(output);
}

main().catch((err) => {
  console.error("[error]", err.message);
  process.exit(1);
});
