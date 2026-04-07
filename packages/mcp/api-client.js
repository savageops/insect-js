const DEFAULT_API_BASE = "http://localhost:3000";

export function readMcpConfig(env = process.env) {
  const apiBase = (
    env.INSECT_API_URL
    || DEFAULT_API_BASE
  ).trim();
  const apiKey = (env.INSECT_API_KEY || "").trim();
  return { apiBase, apiKey };
}

export const MCP_CONFIG_EXAMPLE = {
  mcpServers: {
    insect: {
      command: "node",
      args: ["./packages/mcp/index.js"],
      env: {
        INSECT_API_KEY: "sk_your_key_here",
        INSECT_API_URL: "http://localhost:3000",
      },
    },
  },
};

export function createApiClient({
  apiBase,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 60_000,
} = {}) {
  if (!apiBase) {
    throw new Error("apiBase is required");
  }
  if (!apiKey) {
    throw new Error("apiKey is required");
  }

  async function postJson(endpoint, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    let responseText = "";

    try {
      response = await fetchImpl(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      return {
        ok: false,
        errorMessage: isAbort
          ? `API request timed out after ${Math.floor(timeoutMs / 1000)}s`
          : `API request failed: ${err.message}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    let payload;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { raw: responseText };
      }
    } else {
      payload = {};
    }

    if (!response.ok) {
      const message = typeof payload.error === "string"
        ? payload.error
        : (payload.raw || JSON.stringify(payload));
      return {
        ok: false,
        errorMessage: `API Error ${response.status}: ${message}`,
      };
    }

    return { ok: true, payload };
  }

  return { postJson };
}

export function toMcpError(errorMessage) {
  return {
    content: [{ type: "text", text: errorMessage }],
    isError: true,
  };
}
