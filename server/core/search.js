// Future engine candidates (backlog, not implemented yet):
// - yahoo
// - yandex
// - startpage
// - ecosia
// - qwant
// - mojeek
// - kagi
// Keep `google` as the final fallback attempt when new engines are added.
const SEARCH_ENGINE_SPECS = Object.freeze({
  duckduckgo: {
    label: "DuckDuckGo",
    buildUrl(query) {
      return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    },
  },
  bing: {
    label: "Bing",
    buildUrl(query, count) {
      return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}&setlang=en-US`;
    },
  },
  brave: {
    label: "Brave Search",
    buildUrl(query) {
      return `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    },
  },
  google: {
    label: "Google",
    buildUrl(query, count) {
      return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}&hl=en`;
    },
  },
});

export const SUPPORTED_SEARCH_ENGINES = Object.freeze(
  Object.keys(SEARCH_ENGINE_SPECS),
);

export const DEFAULT_SEARCH_ENGINES = Object.freeze([
  "duckduckgo",
  "bing",
  "brave",
  "google",
]);

const BLOCK_PATTERNS = [
  /\bcaptcha\b/i,
  /\bunusual traffic\b/i,
  /\bnot a robot\b/i,
  /\bautomated queries\b/i,
  /\bverify you are human\b/i,
  /\baccess denied\b/i,
  /\btemporarily blocked\b/i,
  /\bsecurity check\b/i,
];

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function enforceGoogleLast(engines) {
  const uniqueEngines = unique(engines);
  const withoutGoogle = uniqueEngines.filter((engine) => engine !== "google");
  return [...withoutGoogle, "google"];
}

export function normalizeSearchEngines(value) {
  if (value === undefined || value === null || value === "") {
    return [...DEFAULT_SEARCH_ENGINES];
  }

  let list;
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string") {
    list = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  } else {
    throw new Error("'searchEngines' must be a comma-delimited string or array");
  }

  if (list.length === 0) {
    throw new Error("'searchEngines' cannot be empty");
  }

  const normalized = list.map((engine) => String(engine).trim().toLowerCase());
  for (const engine of normalized) {
    if (!SUPPORTED_SEARCH_ENGINES.includes(engine)) {
      throw new Error(
        `'searchEngines' contains unsupported engine '${engine}'. Valid: ${SUPPORTED_SEARCH_ENGINES.join(", ")}`,
      );
    }
  }
  return enforceGoogleLast(normalized);
}

export function buildSearchUrl(engine, query, count) {
  const spec = SEARCH_ENGINE_SPECS[engine];
  if (!spec) {
    throw new Error(`Unknown search engine '${engine}'`);
  }
  return spec.buildUrl(query, count);
}

export function searchEngineLabel(engine) {
  return SEARCH_ENGINE_SPECS[engine]?.label || engine;
}

export function decodeSearchResultUrl(engine, rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (
      engine === "duckduckgo"
      && parsed.hostname.endsWith("duckduckgo.com")
      && parsed.pathname === "/l/"
    ) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }

    if (engine === "google" && parsed.pathname === "/url") {
      const q = parsed.searchParams.get("q");
      if (q) return q;
    }
  } catch {
    return rawUrl;
  }

  return rawUrl;
}

export function isSearchBlocked({ engine, url, title, text }) {
  const source = `${url || ""}\n${title || ""}\n${text || ""}`;
  if (engine === "google" && /\/sorry\//i.test(url || "")) return true;
  return BLOCK_PATTERNS.some((pattern) => pattern.test(source));
}
