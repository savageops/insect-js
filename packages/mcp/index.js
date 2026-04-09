#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  MCP_CONFIG_EXAMPLE,
  createApiClient,
  readMcpConfig,
  toMcpError,
} from "./api-client.js";
import {
  ENGINE_API_PATH,
  MIN_SEARCH_COOLDOWN_SECONDS,
  YOUTUBE_TRANSCRIPT_API_PATH,
} from "../../server/core/contracts.js";

const { apiBase, apiKey } = readMcpConfig();
const SEARCH_ENGINES = ["duckduckgo", "bing", "brave", "google"];
const TRANSCRIPT_ADAPTERS = ["insect_native", "insect_signal", "invidious", "piped", "yt_dlp"];

if (!apiKey) {
  console.error("ERROR: INSECT_API_KEY env var is required.");
  console.error("Set it in your MCP client config:");
  console.error(JSON.stringify(MCP_CONFIG_EXAMPLE, null, 2));
  process.exit(1);
}

const apiClient = createApiClient({
  apiBase,
  apiKey,
});

const server = new McpServer(
  { name: "insect", version: "1.0.0" },
  {
    instructions: [
      "Insect crawler backed by a hosted API with rotating browser fingerprints.",
      "Use these tools to run engine jobs, execute multi-engine web search fallback, discover links, inspect metadata, and fetch YouTube transcripts.",
      "For dynamic sites, prefer method='spa' or method='wait' with a selector.",
      "For infinite feeds, use method='scroll' and tune scroll_count/scroll_delay.",
      `Search endpoints enforce a minimum ${MIN_SEARCH_COOLDOWN_SECONDS} second cooldown per API key between query requests.`,
      "Search fallback order is configurable, and Google is always attempted last.",
    ].join("\n"),
  },
);

async function callEngineApi(body) {
  const result = await apiClient.postJson(ENGINE_API_PATH, body);
  if (!result.ok) {
    return toMcpError(result.errorMessage);
  }
  return result.payload;
}

function buildMetaSummary(meta) {
  if (!meta) return "";
  if (meta.type === "search" || meta.type === "google") {
    return `\n\n---\nQuery: "${meta.query}" | Engine: ${meta.engine || "none"} | Results: ${meta.resultCount} | ${meta.elapsed}s`;
  }
  if (meta.type === "youtube_transcript") {
    return `\n\n---\nVideo: ${meta.videoId} | Method: ${meta.method || "none"} | Segments: ${meta.segmentCount || 0} | ${meta.elapsed}s`;
  }
  if (meta.type === "page") {
    return `\n\n---\nMeta: ${meta.textLength || 0} chars | ${meta.linksFound || 0} links | ${meta.elapsed}s`;
  }
  return "";
}

function asText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

server.tool(
  "run-engine",
  [
    "Run a page extraction job through the Insect engine API.",
    "Supports five loading methods: direct, wait, scroll, timed, and spa.",
    "Supports output formats: text, html, markdown, json, and links.",
  ].join("\n"),
  {
    url: z.string().url().describe("Absolute page URL including protocol."),
    format: z.enum(["text", "html", "markdown", "json", "links"]).default("text"),
    method: z.enum(["direct", "wait", "scroll", "timed", "spa"]).default("direct"),
    verbose: z.boolean().default(false).describe("Include noisy page regions when true."),
    selector: z.string().optional().describe("Required when method='wait'."),
    timeout: z.number().int().min(1).max(180).default(30),
    scroll_count: z.number().int().min(1).max(500).default(20),
    scroll_delay: z.number().int().min(50).max(10000).default(800),
    delay: z.number().int().min(0).max(30000).default(1000),
  },
  async (params) => {
    const payload = await callEngineApi({
      url: params.url,
      format: params.format,
      method: params.method,
      verbose: params.verbose,
      selector: params.selector,
      timeout: params.timeout,
      scrollCount: params.scroll_count,
      scrollDelay: params.scroll_delay,
      delay: params.delay,
    });

    if (payload.isError) return payload;

    return {
      content: [{ type: "text", text: asText(payload.output) + buildMetaSummary(payload.meta) }],
    };
  },
);

server.tool(
  "engine-search",
  [
    "Run a multi-engine web search with fallback and return ranked results.",
    "Default order: duckduckgo,bing,brave,google (Google is always forced to the final attempt).",
    `Search requests are rate-limited with a minimum ${MIN_SEARCH_COOLDOWN_SECONDS} second cooldown per API key.`,
    "Output can be text, json, links, or markdown.",
  ].join("\n"),
  {
    query: z.string().min(1).describe("Search query text."),
    count: z.number().int().min(1).max(50).default(10),
    format: z.enum(["text", "json", "links", "markdown"]).default("text"),
    engines: z.array(z.enum(SEARCH_ENGINES)).optional(),
  },
  async (params) => {
    const payload = await callEngineApi({
      google: params.query,
      googleCount: params.count,
      format: params.format,
      searchEngines: params.engines,
    });

    if (payload.isError) return payload;

    return {
      content: [{ type: "text", text: asText(payload.output) + buildMetaSummary(payload.meta) }],
    };
  },
);

server.tool(
  "search-web",
  [
    "Run a multi-engine web search with fallback and return ranked results.",
    "Default order: duckduckgo,bing,brave,google (Google is always forced to the final attempt).",
    `Search requests are rate-limited with a minimum ${MIN_SEARCH_COOLDOWN_SECONDS} second cooldown per API key.`,
    "Output can be text, json, links, or markdown.",
  ].join("\n"),
  {
    query: z.string().min(1).describe("Search query text."),
    count: z.number().int().min(1).max(50).default(10),
    format: z.enum(["text", "json", "links", "markdown"]).default("text"),
    engines: z.array(z.enum(SEARCH_ENGINES)).optional(),
  },
  async (params) => {
    const payload = await callEngineApi({
      query: params.query,
      googleCount: params.count,
      format: params.format,
      searchEngines: params.engines,
    });

    if (payload.isError) return payload;

    return {
      content: [{ type: "text", text: asText(payload.output) + buildMetaSummary(payload.meta) }],
    };
  },
);

server.tool(
  "transcribe-youtube",
  [
    "Fetch a YouTube transcript using a resilient adapter chain.",
    "Fallback order defaults to: insect_native -> insect_signal -> invidious -> piped -> yt_dlp.",
    "When one adapter fails, Insect automatically tries the next.",
    "Insect-native methods are direct integration paths without third-party API dependencies.",
    "Output supports text, json, and markdown.",
  ].join("\n"),
  {
    url: z.string().url().optional().describe("YouTube video URL."),
    video_id: z.string().optional().describe("YouTube video ID (11 chars)."),
    language: z.string().default("en").describe("Preferred transcript language tag."),
    format: z.enum(["text", "json", "markdown"]).default("text"),
    timeout: z.number().int().min(5).max(120).default(20),
    include_segments: z.boolean().default(false),
    include_auto_captions: z.boolean().default(true),
    methods: z.array(z.enum(TRANSCRIPT_ADAPTERS)).optional(),
  },
  async (params) => {
    if (!params.url && !params.video_id) {
      return toMcpError("Either 'url' or 'video_id' is required.");
    }

    const result = await apiClient.postJson(YOUTUBE_TRANSCRIPT_API_PATH, {
      url: params.url,
      videoId: params.video_id,
      language: params.language,
      format: params.format,
      timeout: params.timeout,
      includeSegments: params.include_segments,
      includeAutoCaptions: params.include_auto_captions,
      methods: params.methods,
    });

    if (!result.ok) {
      return toMcpError(result.errorMessage);
    }

    return {
      content: [{ type: "text", text: asText(result.payload.output) + buildMetaSummary(result.payload.meta) }],
    };
  },
);

server.tool(
  "extract-links",
  [
    "Extract all hyperlinks from a page.",
    "Useful for crawl seeding and site mapping.",
  ].join("\n"),
  {
    url: z.string().url(),
    verbose: z.boolean().default(false),
  },
  async (params) => {
    const payload = await callEngineApi({
      url: params.url,
      format: "links",
      verbose: params.verbose,
    });

    if (payload.isError) return payload;

    return {
      content: [{ type: "text", text: payload.output || "No links found." }],
    };
  },
);

server.tool(
  "engine-page-metadata",
  [
    "Fetch a quick metadata snapshot for a page.",
    "Returns title, URL, text length, links count, and meta tags.",
  ].join("\n"),
  {
    url: z.string().url(),
  },
  async (params) => {
    const payload = await callEngineApi({
      url: params.url,
      format: "json",
    });

    if (payload.isError) return payload;

    let parsed;
    try {
      parsed = typeof payload.output === "string"
        ? JSON.parse(payload.output)
        : payload.output;
    } catch (err) {
      return toMcpError(`Failed to parse metadata payload: ${err.message}`);
    }

    const summaryLines = [
      `Title: ${parsed.title || "(none)"}`,
      `URL: ${parsed.url || "(none)"}`,
      `Text length: ${parsed.text?.length || 0} chars`,
      `Links: ${parsed.links?.length || 0}`,
      "",
      "Meta tags:",
    ];
    for (const [key, value] of Object.entries(parsed.meta || {})) {
      summaryLines.push(`  ${key}: ${value}`);
    }

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("insect MCP server running on stdio");
