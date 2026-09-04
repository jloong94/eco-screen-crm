import crypto from "node:crypto";

const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content"];

export function metaConfig() {
  const values = {
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    pageId: process.env.META_PAGE_ID || "",
    graphVersion: process.env.META_GRAPH_API_VERSION || "",
    stateSecret: process.env.META_STATE_SECRET || "",
    encryptionKey: process.env.META_TOKEN_ENCRYPTION_KEY || "",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
    appUrl: (process.env.PUBLIC_APP_URL || "").replace(/\/$/, ""),
    supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
    supabaseKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
  const required = {
    META_APP_ID: values.appId,
    META_APP_SECRET: values.appSecret,
    META_GRAPH_API_VERSION: values.graphVersion,
    META_STATE_SECRET: values.stateSecret,
    META_TOKEN_ENCRYPTION_KEY: values.encryptionKey,
    PUBLIC_APP_URL: values.appUrl
  };
  return { ...values, missing: Object.entries(required).filter(([, value]) => !value).map(([name]) => name) };
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function oauthUrl(config, state) {
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", `${config.appUrl}/api/meta/oauth/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.href;
}

export function signState(config, nonce) {
  const body = Buffer.from(JSON.stringify({ nonce, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${body}.${hmac(config.stateSecret, body)}`;
}

export function verifyState(config, state, cookieNonce) {
  const [body, signature] = String(state || "").split(".");
  if (!body || !signature || !safeEqual(signature, hmac(config.stateSecret, body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.nonce === cookieNonce && Number(payload.exp) > Date.now();
  } catch { return false; }
}

export function sessionCookie(config, pageId) {
  const body = Buffer.from(JSON.stringify({ pageId, exp: Date.now() + 30 * 86400_000 })).toString("base64url");
  return `${body}.${hmac(config.stateSecret, body)}`;
}

export function hasSession(req, config) {
  const value = cookies(req).meta_admin_session || "";
  const [body, signature] = value.split(".");
  if (!body || !signature || !safeEqual(signature, hmac(config.stateSecret, body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.pageId === config.pageId && Number(payload.exp) > Date.now();
  } catch { return false; }
}

export function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

export function cookie(name, value, maxAge = 600) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function graph(config, path, token, init = {}) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path.replace(/^\//, "")}`);
  if (token) {
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", hmac(config.appSecret, token));
  }
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Graph API failed (${response.status}).`);
  return payload;
}

export async function exchangeCode(config, code) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", `${config.appUrl}/api/meta/oauth/callback`);
  url.searchParams.set("code", code);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error?.message || "Meta authorization code exchange failed.");
  return payload.access_token;
}

export function encryptToken(config, token) {
  const key = Buffer.from(config.encryptionKey, "base64");
  if (key.length !== 32) throw new Error("META_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { encrypted_token: encrypted.toString("base64"), token_iv: iv.toString("base64"), token_tag: cipher.getAuthTag().toString("base64") };
}

export function sealPageConnection(config, value) {
  const sealed = encryptToken(config, JSON.stringify(value));
  return Buffer.from(JSON.stringify(sealed)).toString("base64url");
}

export function openPageConnection(config, value) {
  try {
    const sealed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    const key = Buffer.from(config.encryptionKey, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.token_iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.token_tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed.encrypted_token, "base64")), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plain);
    return payload?.pageId && payload?.accessToken ? payload : null;
  } catch { return null; }
}

export async function supabase(config, path, init = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Secure Supabase request failed (${response.status}).`);
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function verifyWebhookSignature(config, rawBody, signatureHeader) {
  const expected = `sha256=${crypto.createHmac("sha256", config.appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, String(signatureHeader || ""));
}

function hmac(secret, value) { return crypto.createHmac("sha256", secret).update(value).digest("base64url"); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
