import { metaConfig, readRawBody, sendJson, supabase, verifyWebhookSignature } from "../_lib/meta.js";

export default async function handler(req, res) {
  const config = metaConfig();
  if (req.method === "GET") {
    const url = new URL(req.url, config.appUrl || "https://localhost");
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === config.webhookVerifyToken) {
      res.statusCode = 200; return res.end(url.searchParams.get("hub.challenge") || "");
    }
    return sendJson(res, 403, { code: "WEBHOOK_VERIFICATION_FAILED" });
  }
  if (req.method !== "POST") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  if (config.missing.length) return sendJson(res, 503, { code: "META_NOT_CONFIGURED" });
  const raw = await readRawBody(req);
  if (!verifyWebhookSignature(config, raw, req.headers["x-hub-signature-256"])) return sendJson(res, 401, { code: "INVALID_WEBHOOK_SIGNATURE" });
  try {
    const payload = JSON.parse(raw.toString("utf8"));
    const rows = [];
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      if (String(entry.id) !== config.pageId || change.field !== "feed" || value.item !== "comment" || value.verb !== "add" || !value.comment_id || !value.message) continue;
      const postId = String(value.post_id || "");
      const [pageId, objectId] = postId.split("_");
      rows.push({
        page_id: String(entry.id || pageId || config.pageId), provider_comment_id: String(value.comment_id),
        commenter_id: String(value.from?.id || ""), commenter_name: String(value.from?.name || "Public Facebook user"),
        message: String(value.message), commented_at: value.created_time ? new Date(Number(value.created_time) * 1000).toISOString() : new Date().toISOString(),
        source_url: pageId && objectId ? `https://www.facebook.com/${pageId}/posts/${objectId}` : "", page_name: "Facebook Page"
      });
    }
    if (rows.length) await supabase(config, "meta_page_comment_events?on_conflict=provider_comment_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    res.statusCode = 200; res.end("EVENT_RECEIVED");
  } catch {
    return sendJson(res, 400, { code: "INVALID_WEBHOOK_PAYLOAD" });
  }
}
