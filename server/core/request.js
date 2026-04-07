import { FORMATS, METHODS } from "./fingerprint.js";
import { normalizeSearchEngines } from "./search.js";

const LIMITS = {
  timeout: { min: 1, max: 180, defaultValue: 30 },
  scrollCount: { min: 1, max: 500, defaultValue: 20 },
  scrollDelay: { min: 50, max: 10_000, defaultValue: 800 },
  delay: { min: 0, max: 30_000, defaultValue: 1000 },
  googleCount: { min: 1, max: 50, defaultValue: 10 },
};

const SUPPORTED_SCRAPE_METHODS = Object.freeze(Object.keys(METHODS));
const SUPPORTED_FORMATS = Object.freeze([...FORMATS]);

export class RequestValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "RequestValidationError";
    this.code = "VALIDATION_ERROR";
    this.field = field;
  }
}

function toOptionalString(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function toInteger(value, field, { min, max, defaultValue }) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new RequestValidationError(`'${field}' must be an integer`, field);
  }
  if (numeric < min || numeric > max) {
    throw new RequestValidationError(
      `'${field}' must be between ${min} and ${max}`,
      field,
    );
  }
  return numeric;
}

function parseObjectLike(value, field) {
  if (value === undefined || value === null) return undefined;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new RequestValidationError(
        `'${field}' must be valid JSON when provided as a string`,
        field,
      );
    }
  }

  if (typeof value === "object") return value;

  throw new RequestValidationError(`'${field}' must be an object or JSON string`, field);
}

function parseHeaders(value) {
  const parsed = parseObjectLike(value, "headers");
  if (parsed === undefined) return undefined;
  if (Array.isArray(parsed) || parsed === null) {
    throw new RequestValidationError("'headers' must be a plain object", "headers");
  }
  return parsed;
}

function parseCookies(value) {
  const parsed = parseObjectLike(value, "cookies");
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) {
    throw new RequestValidationError("'cookies' must be an array", "cookies");
  }
  return parsed;
}

function assertUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new RequestValidationError(
        "'url' must use http:// or https://",
        "url",
      );
    }
  } catch {
    throw new RequestValidationError("'url' must be a valid absolute URL", "url");
  }
}

function normalizeMethod(value) {
  const method = toOptionalString(value) || "direct";
  if (!SUPPORTED_SCRAPE_METHODS.includes(method)) {
    throw new RequestValidationError(
      `Unknown method. Valid: ${SUPPORTED_SCRAPE_METHODS.join(", ")}`,
      "method",
    );
  }
  return method;
}

function normalizeFormat(value) {
  const format = toOptionalString(value) || "text";
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new RequestValidationError(
      `Unknown format. Valid: ${SUPPORTED_FORMATS.join(", ")}`,
      "format",
    );
  }
  return format;
}

function ensureFileOutputAllowed(pathValue, field, allowFileOutput) {
  if (!pathValue) return undefined;
  if (!allowFileOutput) {
    throw new RequestValidationError(
      `'${field}' is only supported for local CLI usage`,
      field,
    );
  }
  return pathValue;
}

export function normalizeEngineRequest(
  input = {},
  { allowFileOutput = false, allowHeadful = false } = {},
) {
  const url = toOptionalString(input.url);
  const google = toOptionalString(input.google);
  const query = toOptionalString(input.query);

  if (google && query && google !== query) {
    throw new RequestValidationError(
      "When both 'google' and 'query' are provided, they must match",
      "query",
    );
  }
  const searchQuery = query || google;

  if (!url && !searchQuery) {
    throw new RequestValidationError(
      "Either --url or --google/--query is required.",
      "url",
    );
  }
  if (url) assertUrl(url);

  const method = normalizeMethod(input.method);
  const selector = toOptionalString(input.selector);
  if (!searchQuery && method === "wait" && !selector) {
    throw new RequestValidationError(
      "method='wait' requires a non-empty 'selector'",
      "selector",
    );
  }

  let searchEngines;
  try {
    searchEngines = normalizeSearchEngines(
      input.searchEngines ?? input.search_engines ?? input.engines,
    );
  } catch (err) {
    throw new RequestValidationError(err.message, "searchEngines");
  }

  const normalized = {
    url,
    query: searchQuery,
    google: searchQuery,
    method,
    format: normalizeFormat(input.format),
    verbose: toBoolean(input.verbose, false),
    selector,
    timeout: toInteger(input.timeout, "timeout", LIMITS.timeout),
    scrollCount: toInteger(
      input.scrollCount ?? input.scroll_count,
      "scrollCount",
      LIMITS.scrollCount,
    ),
    scrollDelay: toInteger(
      input.scrollDelay ?? input.scroll_delay,
      "scrollDelay",
      LIMITS.scrollDelay,
    ),
    delay: toInteger(input.delay, "delay", LIMITS.delay),
    googleCount: toInteger(
      input.googleCount ?? input.google_count,
      "googleCount",
      LIMITS.googleCount,
    ),
    searchEngines,
    proxy: toOptionalString(input.proxy),
    cookies: parseCookies(input.cookies),
    headers: parseHeaders(input.headers),
    listLinks: toBoolean(input.listLinks ?? input["list-links"], false),
    screenshotPath: ensureFileOutputAllowed(
      toOptionalString(input.screenshot ?? input.screenshotPath),
      "screenshot",
      allowFileOutput,
    ),
    pdfPath: ensureFileOutputAllowed(
      toOptionalString(input.pdf ?? input.pdfPath),
      "pdf",
      allowFileOutput,
    ),
  };

  const requestedHeadless = input["no-headless"] ? false : toBoolean(input.headless, true);
  normalized.headless = allowHeadful ? requestedHeadless : true;

  return normalized;
}


export function requestValidationToHttp(err) {
  if (!(err instanceof RequestValidationError)) return null;
  return {
    status: 400,
    body: {
      error: err.message,
      code: err.code,
      field: err.field,
    },
  };
}
