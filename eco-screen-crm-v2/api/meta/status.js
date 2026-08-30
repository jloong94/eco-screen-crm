import { hasSession, metaConfig, sendJson, supabase } from "../_lib/meta.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 200, { configured: false, connected: false, missing: config.missing });
  if (!hasSession(req, config)) return sendJson(res, 200, { configured: true, connected: false });
  try {
    const rows = await supabase(config, `meta_page_connections?page_id=eq.${encodeURIComponent(config.pageId)}&status=eq.connected&select=page_name,webhook_subscribed&limit=1`);
    const page = rows?.[0];
    return sendJson(res, 200, { configured: true, connected: Boolean(page), pageName: page?.page_name || "", webhookSubscribed: Boolean(page?.webhook_subscribed) });
  } catch {
    return sendJson(res, 503, { configured: true, connected: false, code: "META_STORAGE_UNAVAILABLE" });
  }
}
