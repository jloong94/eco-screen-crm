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
  const provider = providers.get(normalizeSocialPlatform(platform));
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

export function validateFacebookSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|web\.|m\.)/, "");
    if (host === "fb.watch") return url.pathname !== "/" ? cleanUrl(url) : "";
    if (host !== "facebook.com") return "";
    if (!/(?:\/share\/(?:p|v)\/|\/reel\/|\/videos\/|\/posts\/|\/watch\/|\/permalink\.php)/i.test(`${url.pathname}${url.search}`)) return "";
    return cleanUrl(url);
  } catch {
    return "";
  }
}

export function validateRedNoteSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "xhslink.com") return url.pathname !== "/" ? cleanUrl(url) : "";
    if (host !== "xiaohongshu.com") return "";
    if (!/(?:\/discovery\/item\/|\/explore\/)[a-z0-9]+/i.test(url.pathname)) return "";
    return cleanUrl(url);
  } catch {
    return "";
  }
}

const tiktokProvider = {
  platform: "tiktok",
  label: "TikTok",
  validateSourceUrl: validateTikTokVideoUrl,
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
    return scanApprovedEndpoint(endpoint, { ...request, sourceUrl, platform: "tiktok", providerLabel: "TikTok" });
  }
};

const facebookProvider = createEndpointProvider({
  platform: "facebook",
  label: "Facebook",
  endpointKey: "VITE_FACEBOOK_SCAN_ENDPOINT",
  validateSourceUrl: validateFacebookSourceUrl,
  invalidMessage: "Enter a valid public Facebook post, video or reel URL.",
  configurationMessage: "Facebook comment access is not configured. An approved Meta Page connector and authorization are required; no scraping or mock comments will be used."
});

const redNoteProvider = createEndpointProvider({
  platform: "rednote",
  label: "小红书 / RedNote",
  endpointKey: "VITE_REDNOTE_SCAN_ENDPOINT",
  validateSourceUrl: validateRedNoteSourceUrl,
  invalidMessage: "Enter a valid public Xiaohongshu / RedNote post URL.",
  configurationMessage: "Xiaohongshu / RedNote comment access is not configured. An approved provider is required; no login bypass, scraping or mock comments will be used."
});

registerSocialProvider(tiktokProvider);
registerSocialProvider(facebookProvider);
registerSocialProvider(redNoteProvider);

function createEndpointProvider({ platform, label, endpointKey, validateSourceUrl, invalidMessage, configurationMessage }) {
  return {
    platform,
    label,
    validateSourceUrl,
    capabilities: Object.freeze({ comments: true, pagination: true, stop: true }),
    async scan(request = {}) {
      const sourceUrl = validateSourceUrl(request.sourceUrl);
      if (!sourceUrl) throw new SocialProviderError("INVALID_SOURCE_URL", invalidMessage);
      const endpoint = String(runtimeEnv[endpointKey] || "").trim();
      if (!endpoint) throw new SocialProviderError("PROVIDER_NOT_CONFIGURED", configurationMessage);
      return scanApprovedEndpoint(endpoint, { ...request, sourceUrl, platform, providerLabel: label });
    }
  };
}

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
      throw new SocialProviderError(payload.code || "PROVIDER_REQUEST_FAILED", payload.message || `${request.providerLabel || "Social"} provider failed (${response.status}).`, { status: response.status });
    }
    if (!Array.isArray(payload.comments)) {
      throw new SocialProviderError("INVALID_PROVIDER_RESPONSE", `${request.providerLabel || "Social"} provider returned an invalid comments response.`);
    }
    return {
      comments: payload.comments.slice(0, clampMaximum(request.maximum)),
      exhausted: payload.exhausted !== false,
      cursor: payload.cursor || ""
    };
  } catch (error) {
    if (error instanceof SocialProviderError) throw error;
    if (controller.signal.aborted) {
      throw new SocialProviderError(externalSignal?.aborted ? "SCAN_STOPPED" : "PROVIDER_TIMEOUT", externalSignal?.aborted ? "Scan stopped." : `${request.providerLabel || "Social"} provider timed out.`);
    }
    throw new SocialProviderError("PROVIDER_NETWORK_ERROR", `${request.providerLabel || "Social"} provider could not be reached.`);
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

export function normalizeSocialPlatform(value) {
  const platform = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["xiaohongshu", "小红书", "xhs", "rednote"].includes(platform)) return "rednote";
  if (["fb", "meta", "facebook"].includes(platform)) return "facebook";
  return platform;
}

function normalizePlatform(value) { return normalizeSocialPlatform(value); }
function cleanUrl(url) { url.hash = ""; return url.href; }
