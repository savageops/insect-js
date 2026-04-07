import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  generateFingerprint,
  NOISE_SELECTORS,
  randomInt,
} from "./fingerprint.js";
import { formatOutput, formatGoogleResults } from "./formatters.js";
import { normalizeEngineRequest } from "./request.js";
import {
  buildSearchUrl,
  decodeSearchResultUrl,
  isSearchBlocked,
  searchEngineLabel,
} from "./search.js";

puppeteer.use(StealthPlugin());

async function buildBrowser(opts, fp) {
  const args = [
    `--window-size=${fp.viewport.width},${fp.viewport.height}`,
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--lang=" + fp.locale,
  ];

  if (opts.proxy) args.push(`--proxy-server=${opts.proxy}`);

  return puppeteer.launch({
    headless: opts.headless,
    args,
    defaultViewport: fp.viewport,
    ignoreHTTPSErrors: true,
    protocolTimeout: (opts.timeout || 30) * 1000 + 15000,
  });
}

async function injectFingerprint(page, fp) {
  await page.evaluateOnNewDocument((f) => {
    Object.defineProperty(navigator, "platform", { get: () => f.platform });
    Object.defineProperty(navigator, "language", { get: () => f.locale });
    Object.defineProperty(navigator, "languages", { get: () => [f.locale, "en"] });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => f.hardwareConcurrency });
    Object.defineProperty(navigator, "deviceMemory", { get: () => f.deviceMemory });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => f.touchSupport.maxTouchPoints });

    Object.defineProperty(screen, "width", { get: () => f.screen.width });
    Object.defineProperty(screen, "height", { get: () => f.screen.height });
    Object.defineProperty(screen, "availWidth", { get: () => f.screen.availWidth });
    Object.defineProperty(screen, "availHeight", { get: () => f.screen.availHeight });
    Object.defineProperty(screen, "colorDepth", { get: () => f.screen.colorDepth });
    Object.defineProperty(screen, "pixelDepth", { get: () => f.screen.pixelDepth });

    const tzOffsets = {
      "America/New_York": 300, "America/Chicago": 360,
      "America/Denver": 420, "America/Los_Angeles": 480,
      "America/Toronto": 300, "America/Vancouver": 480,
      "Europe/London": 0, "Europe/Dublin": 0,
      "Australia/Sydney": -660, "Pacific/Auckland": -780,
    };
    Object.defineProperty(Date.prototype, "getTimezoneOffset", {
      get: () => () => tzOffsets[f.timezone] ?? 0,
    });

    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return f.webgl.vendor;
      if (param === 37446) return f.webgl.renderer;
      return origGetParam.call(this, param);
    };
    const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return f.webgl.vendor;
      if (param === 37446) return f.webgl.renderer;
      return origGetParam2.call(this, param);
    };
  }, fp);
}

async function setPageContext(page, opts, fp) {
  await page.setUserAgent(fp.userAgent);
  await page.setViewport(fp.viewport);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
  });

  if (opts.headers) {
    await page.setExtraHTTPHeaders(opts.headers);
  }
  if (opts.cookies && opts.cookies.length > 0) {
    await page.setCookie(...opts.cookies);
  }
}

async function scrollPage(page, scrollCount, scrollDelay) {
  await page.evaluate(async (count, delay) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < count; i++) {
      window.scrollBy(0, window.innerHeight + Math.floor(Math.random() * 400 + 100));
      await wait(delay + Math.floor(Math.random() * 300));
    }
    window.scrollTo(0, 0);
  }, scrollCount, scrollDelay);
}

async function extractContent(page, verbose) {
  return page.evaluate((isVerbose, noiseSels) => {
    const clone = document.cloneNode(true);

    if (!isVerbose) {
      for (const sel of noiseSels) {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      }
    }

    const title = document.title;
    const url = window.location.href;
    const html = clone.documentElement.outerHTML;

    const body = clone.body || clone.documentElement;
    const text = (body.innerText || body.textContent || "")
      .replace(/\n{3,}/g, "\n\n").trim();

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        text: (a.textContent || "").trim().substring(0, 200),
        href: a.href,
      }))
      .filter((l) => l.href && l.href.startsWith("http"));

    const meta = {};
    document.querySelectorAll("meta[property], meta[name]").forEach((m) => {
      const key = m.getAttribute("property") || m.getAttribute("name");
      const val = m.getAttribute("content");
      if (key && val) meta[key] = val;
    });

    return { title, url, text, html, links, meta };
  }, verbose, NOISE_SELECTORS);
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchResults(engine, rawResults, count) {
  const seen = new Set();
  const normalized = [];

  for (const raw of rawResults || []) {
    if (normalized.length >= count) break;

    const rawUrl = cleanText(raw?.url);
    if (!rawUrl.startsWith("http")) continue;

    const url = decodeSearchResultUrl(engine, rawUrl);
    if (!url.startsWith("http")) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const title = cleanText(raw?.title) || url;
    const snippet = cleanText(raw?.snippet);
    normalized.push({ title, url, snippet });
  }

  return normalized;
}

async function inspectSearchPage(page) {
  return page.evaluate(() => ({
    title: document.title || "",
    url: window.location.href || "",
    text: (document.body?.innerText || "").substring(0, 6000),
  }));
}

async function extractGoogleResults(page, count) {
  return page.evaluate((maxResults) => {
    const results = [];
    const blocks = document.querySelectorAll(
      '[data-sokoban-container], .g, [class*="kp-blk"]',
    );

    for (const block of blocks) {
      if (results.length >= maxResults) break;
      const titleEl = block.querySelector("h3");
      const linkEl = block.querySelector("a[href]");
      const snippetEl = block.querySelector(
        '[data-sncf], [style*="-webkit-line-clamp"], .VwiC3b, span[style]',
      );
      if (!titleEl || !linkEl?.href) continue;

      results.push({
        title: titleEl.textContent || "",
        url: linkEl.href,
        snippet: snippetEl ? snippetEl.textContent || "" : "",
      });
    }
    return results;
  }, count);
}

async function extractDuckDuckGoResults(page, count) {
  return page.evaluate((maxResults) => {
    const results = [];
    const blocks = document.querySelectorAll(".result, .result__body");

    for (const block of blocks) {
      if (results.length >= maxResults) break;
      const linkEl = block.querySelector("a.result__a, .result__title a[href], a[href]");
      if (!linkEl?.href) continue;
      const snippetEl = block.querySelector(".result__snippet, .result__extras");

      results.push({
        title: linkEl.textContent || "",
        url: linkEl.href,
        snippet: snippetEl ? snippetEl.textContent || "" : "",
      });
    }
    return results;
  }, count);
}

async function extractBingResults(page, count) {
  return page.evaluate((maxResults) => {
    const results = [];
    const blocks = document.querySelectorAll("li.b_algo, .b_algo");

    for (const block of blocks) {
      if (results.length >= maxResults) break;
      const linkEl = block.querySelector("h2 a[href], a[href]");
      if (!linkEl?.href) continue;
      const snippetEl = block.querySelector(".b_caption p, .b_snippet, p");

      results.push({
        title: linkEl.textContent || "",
        url: linkEl.href,
        snippet: snippetEl ? snippetEl.textContent || "" : "",
      });
    }
    return results;
  }, count);
}

async function extractBraveResults(page, count) {
  return page.evaluate((maxResults) => {
    const results = [];
    const blocks = document.querySelectorAll(".snippet, .result, .fdb, article");

    for (const block of blocks) {
      if (results.length >= maxResults) break;
      const linkEl = block.querySelector(
        "h2 a[href], h3 a[href], a[data-testid='result-title-a'], a[href]",
      );
      if (!linkEl?.href) continue;
      const snippetEl = block.querySelector("p, .snippet-description, .snippet-content");

      results.push({
        title: linkEl.textContent || "",
        url: linkEl.href,
        snippet: snippetEl ? snippetEl.textContent || "" : "",
      });
    }
    return results;
  }, count);
}

async function extractGenericSearchResults(page, count) {
  return page.evaluate((maxResults) => {
    const results = [];
    const anchors = document.querySelectorAll("main a[href], #search a[href], [role='main'] a[href]");

    for (const anchor of anchors) {
      if (results.length >= maxResults) break;
      const href = anchor.href;
      if (!href || !href.startsWith("http")) continue;
      const text = (anchor.textContent || "").trim();
      if (text.length < 8) continue;

      const container = anchor.closest("article, li, div, section") || anchor.parentElement;
      const snippetEl = container?.querySelector("p");
      const snippet = snippetEl ? snippetEl.textContent || "" : "";

      results.push({
        title: text,
        url: href,
        snippet,
      });
    }
    return results;
  }, count);
}

async function extractSearchResultsForEngine(page, engine, count) {
  switch (engine) {
    case "duckduckgo":
      return extractDuckDuckGoResults(page, count);
    case "bing":
      return extractBingResults(page, count);
    case "brave":
      return extractBraveResults(page, count);
    case "google":
      return extractGoogleResults(page, count);
    default:
      return extractGenericSearchResults(page, count);
  }
}

async function applyLoadMethod(page, options) {
  const {
    method,
    selector,
    timeout,
    scrollCount,
    scrollDelay,
  } = options;

  switch (method) {
    case "direct":
      await page.waitForNetworkIdle({ timeout: timeout * 1000 }).catch(() => {});
      break;
    case "wait":
      if (selector) {
        await page.waitForSelector(selector, { timeout: timeout * 1000 });
      } else {
        await page.waitForNetworkIdle({ timeout: timeout * 1000 }).catch(() => {});
      }
      break;
    case "scroll":
      await scrollPage(page, scrollCount, scrollDelay);
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      break;
    case "timed":
      await new Promise((r) => setTimeout(r, timeout * 1000));
      break;
    case "spa":
      await page.waitForNetworkIdle({ timeout: timeout * 1000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000 + randomInt(0, 1000)));
      break;
  }
}

async function runSearchWithFallback(page, options) {
  const {
    query,
    count,
    engines,
    method,
    selector,
    timeout,
    scrollCount,
    scrollDelay,
  } = options;

  const attempts = [];
  let selectedEngine = null;
  let results = [];

  for (const engine of engines) {
    const searchUrl = buildSearchUrl(engine, query, count);

    try {
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeout * 1000,
      });

      await applyLoadMethod(page, {
        method,
        selector,
        timeout,
        scrollCount,
        scrollDelay,
      });

      const pageSnapshot = await inspectSearchPage(page);
      const blocked = isSearchBlocked({ engine, ...pageSnapshot });
      if (blocked) {
        attempts.push({
          engine,
          engineLabel: searchEngineLabel(engine),
          url: searchUrl,
          blocked: true,
          resultCount: 0,
          reason: "blocked",
        });
        continue;
      }

      const rawResults = await extractSearchResultsForEngine(page, engine, count);
      const normalizedResults = normalizeSearchResults(engine, rawResults, count);
      attempts.push({
        engine,
        engineLabel: searchEngineLabel(engine),
        url: searchUrl,
        blocked: false,
        resultCount: normalizedResults.length,
        reason: normalizedResults.length > 0 ? "ok" : "no_results",
      });

      if (normalizedResults.length > 0) {
        selectedEngine = engine;
        results = normalizedResults;
        break;
      }
    } catch (err) {
      attempts.push({
        engine,
        engineLabel: searchEngineLabel(engine),
        url: searchUrl,
        blocked: false,
        resultCount: 0,
        reason: "error",
        error: err.message,
      });
    }
  }

  return {
    selectedEngine,
    results,
    attempts,
  };
}

export async function runInsectEngine(params) {
  const normalized = normalizeEngineRequest(params, {
    allowFileOutput: true,
    allowHeadful: true,
  });
  const {
    url,
    query,
    method,
    format,
    verbose,
    selector,
    timeout,
    scrollCount,
    scrollDelay,
    proxy,
    cookies,
    headers,
    delay,
    googleCount,
    searchEngines,
    listLinks,
    screenshotPath,
    pdfPath,
    headless,
  } = normalized;

  const fp = generateFingerprint();
  const startTime = Date.now();
  const isSearchRequest = Boolean(query);

  let browser;
  try {
    browser = await buildBrowser({ proxy, timeout, headless }, fp);
  } catch (launchErr) {
    return {
      success: false,
      output: null,
      errorCode: "BROWSER_LAUNCH",
      error: `Browser launch failed: ${launchErr.message}. Ensure Chromium is installed (npm run install-browser).`,
    };
  }

  try {
    const page = await browser.newPage();
    await injectFingerprint(page, fp);
    await setPageContext(page, { cookies, headers }, fp);

    page.setDefaultNavigationTimeout(timeout * 1000);
    page.setDefaultTimeout(timeout * 1000);

    const preDelay = delay + randomInt(0, 500);
    await new Promise((r) => setTimeout(r, preDelay));
    let searchState = null;
    let pageState = null;

    if (isSearchRequest) {
      searchState = await runSearchWithFallback(page, {
        query,
        count: googleCount,
        engines: searchEngines,
        method,
        selector,
        timeout,
        scrollCount,
        scrollDelay,
      });
    } else {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeout * 1000,
      });

      await applyLoadMethod(page, {
        method,
        selector,
        timeout,
        scrollCount,
        scrollDelay,
      });

      pageState = await extractContent(page, verbose);
    }

    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    if (pdfPath) {
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (isSearchRequest) {
      const output = formatGoogleResults(searchState.results, format);
      return {
        success: true,
        output,
        meta: {
          type: "search",
          query,
          engine: searchState.selectedEngine,
          engineLabel: searchState.selectedEngine
            ? searchEngineLabel(searchState.selectedEngine)
            : null,
          engineOrder: searchEngines,
          attempts: searchState.attempts,
          resultCount: searchState.results.length,
          elapsed,
          artifacts: {
            screenshotPath: screenshotPath || null,
            pdfPath: pdfPath || null,
          },
          fingerprint: {
            userAgent: fp.userAgent,
            viewport: fp.viewport,
            locale: fp.locale,
            timezone: fp.timezone,
          },
        },
      };
    }

    const output = formatOutput(pageState, format);

    return {
      success: true,
      output,
      meta: {
        type: "page",
        title: pageState.title,
        url: pageState.url,
        textLength: pageState.text.length,
        linksFound: pageState.links.length,
        links: listLinks ? pageState.links : undefined,
        elapsed,
        artifacts: {
          screenshotPath: screenshotPath || null,
          pdfPath: pdfPath || null,
        },
        fingerprint: {
          userAgent: fp.userAgent,
          viewport: fp.viewport,
          locale: fp.locale,
          timezone: fp.timezone,
        },
      },
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      errorCode: "UPSTREAM_REQUEST",
      error: err.message,
    };
  } finally {
    await browser.close();
  }
}
