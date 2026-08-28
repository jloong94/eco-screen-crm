import { runtimeEnv } from "./env.js";

const providers = new Map();

export class SocialProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SocialProviderError";
    this.code = code;
    this.details = details;
  }
}

export function registerSocialProvider(provider) {
  if (!provider?.platform || typeof provider.scan !== "function") {
    throw new TypeError("A social provider requires a platform and scan function.");
  }
  providers.set(normalizePlatform(provider.platform), Object.freeze({ ...provider }));
}

export function socialProvider(platform) {
  const provider = providers.get(normalizePlatform(platform));
  if (!provider) throw new SocialProviderError("UNSUPPORTED_PLATFORM", `Unsupported social platform: ${platform || "unknown"}.`);
  return provider;
}

export function socialProviderPlatforms() {
  return [...providers.keys()];
}

export function validateTikTokVideoUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!new Set(["tiktok.com", "m.tiktok.com", "vm.tiktok.com"]).has(host)) return "";
    if (host !== "vm.tiktok.com" && !/\/(?:@[^/]+\/video\/\d+|t\/[^/]+)/i.test(url.pathname)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

const tiktokProvider = {
  platform: "tiktok",
  label: "TikTok",
  capabilities: Object.freeze({ comments: true, pagination: true, stop: true }),
  async scan(request = {}) {
    const sourceUrl = validateTikTokVideoUrl(request.sourceUrl);
    if (!sourceUrl) throw new SocialProviderError("INVALID_SOURCE_URL", "Enter a valid public TikTok video URL.");
    const endpoint = String(runtimeEnv.VITE_TIKTOK_SCAN_ENDPOINT || "").trim();
    if (!endpoint) {
      throw new SocialProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "TikTok comment access is not configured. An approved server-side provider is required; no scraping or mock comments will be used."
      );
    }
    return scanApprovedEndpoint(endpoint, { ...request, sourceUrl, platform: "tiktok" });
  }
};

registerSocialProvider(tiktokProvider);

async function scanApprovedEndpoint(endpoint, request) {
  const controller = new AbortController();
  const externalSignal = request.signal;
  const timeout = setTimeout(() => controller.abort("timeout"), 30000);
  const abort = () => controller.abort("stopped");
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: request.platform,
        sourceUrl: request.sourceUrl,
        maximum: clampMaximum(request.maximum),
        triggerKeywords: String(request.triggerKeywords || ""),
        excludeKeywords: String(request.excludeKeywords || "")
      }),
      signal: controller.signal,
      credentials: "same-origin"
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new SocialProviderError(payload.code || "PROVIDER_REQUEST_FAILED", payload.message || `TikTok provider failed (${response.status}).`, { status: response.status });
    }
    if (!Array.isArray(payload.comments)) {
      throw new SocialProviderError("INVALID_PROVIDER_RESPONSE", "TikTok provider returned an invalid comments response.");
    }
    return {
      comments: payload.comments.slice(0, clampMaximum(request.maximum)),
      exhausted: payload.exhausted !== false,
      cursor: payload.cursor || ""
    };
  } catch (error) {
    if (error instanceof SocialProviderError) throw error;
    if (controller.signal.aborted) {
      throw new SocialProviderError(externalSignal?.aborted ? "SCAN_STOPPED" : "PROVIDER_TIMEOUT", externalSignal?.aborted ? "Scan stopped." : "TikTok provider timed out.");
    }
    throw new SocialProviderError("PROVIDER_NETWORK_ERROR", "TikTok provider could not be reached.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function clampMaximum(value) {
  return Math.min(200, Math.max(1, Number(value || 50)));
}

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase();
}
