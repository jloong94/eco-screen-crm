import { cookie, cookies, encryptToken, exchangeCode, graph, metaConfig, sendJson, sessionCookie, supabase, verifyState } from "../../_lib/meta.js";

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
    const accounts = await graph(config, "me/accounts?fields=id,name,access_token,tasks", userToken);
    const page = (accounts.data || []).find((item) => String(item.id) === config.pageId);
    if (!page?.access_token) return sendJson(res, 403, { code: "PAGE_NOT_AUTHORIZED", message: "该 Meta 账号没有管理指定 Facebook 专页的权限。" });
    const encrypted = encryptToken(config, page.access_token);
    const subscribed = await graph(config, `${config.pageId}/subscribed_apps?subscribed_fields=feed`, page.access_token, { method: "POST" });
    await supabase(config, "meta_page_connections?on_conflict=page_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ page_id: config.pageId, page_name: page.name || "Facebook Page", ...encrypted, granted_scopes: page.tasks || [], status: "connected", webhook_subscribed: Boolean(subscribed.success) })
    });
    res.setHeader("Set-Cookie", [cookie("meta_admin_session", sessionCookie(config, config.pageId), 30 * 86400), cookie("meta_oauth_state", "", 0)]);
    res.statusCode = 302;
    res.setHeader("Location", `${config.appUrl}/?meta=connected`);
    res.end();
  } catch (error) {
    return sendJson(res, 502, { code: "META_AUTH_FAILED", message: error.message || "Facebook 授权失败。" });
  }
}
