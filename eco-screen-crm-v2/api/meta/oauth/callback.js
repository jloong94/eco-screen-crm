import { cookie, cookies, exchangeCode, graph, metaConfig, sealPageConnection, sendJson, sessionCookie, verifyState } from "../../_lib/meta.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 503, { code: "META_NOT_CONFIGURED", missing: config.missing });
  const url = new URL(req.url, config.appUrl);
  if (!verifyState(config, url.searchParams.get("state"), cookies(req).meta_oauth_state)) return sendJson(res, 400, { code: "INVALID_OAUTH_STATE", message: "Facebook 授权已过期，请重新连接。" });
  const code = url.searchParams.get("code");
  if (!code) return sendJson(res, 400, { code: "META_AUTH_CANCELLED", message: "Facebook 授权未完成。" });
  try {
    const userToken = await exchangeCode(config, code);
    const longLived = await exchangeLongLivedToken(config, userToken).catch(() => userToken);
    const accounts = await graph(config, "me/accounts?fields=id,name,access_token,tasks", longLived);
    const pages = accounts.data || [];
    const page = config.pageId ? pages.find((item) => String(item.id) === config.pageId) : pages.length === 1 ? pages[0] : null;
    if (!page?.access_token) return sendJson(res, 403, { code: "PAGE_SELECTION_REQUIRED", message: pages.length ? "该账号管理多个专页，请先配置 META_PAGE_ID。" : "该 Meta 账号没有可授权的 Facebook 专页。", pages: pages.map(({ id, name }) => ({ id, name })) });
    const connection = sealPageConnection(config, { pageId: String(page.id), pageName: page.name || "Facebook Page", accessToken: page.access_token, connectedAt: new Date().toISOString() });
    res.setHeader("Set-Cookie", [cookie("meta_admin_session", sessionCookie(config, String(page.id)), 30 * 86400), cookie("meta_page_connection", connection, 30 * 86400), cookie("meta_oauth_state", "", 0)]);
    res.statusCode = 302;
    res.setHeader("Location", `${config.appUrl}/?meta=connected`);
    res.end();
  } catch (error) {
    return sendJson(res, 502, { code: "META_AUTH_FAILED", message: error.message || "Facebook 授权失败。" });
  }
}

async function exchangeLongLivedToken(config, token) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("fb_exchange_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("Long-lived Meta token exchange failed.");
  return payload.access_token;
}
