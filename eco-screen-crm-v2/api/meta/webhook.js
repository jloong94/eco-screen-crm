import { metaConfig, readRawBody, sendJson, supabase, verifyWebhookSignature } from "../_lib/meta.js";
import { scorePublicComment } from "../_lib/social-scoring.js";
import { createHash } from "node:crypto";

export default async function handler(req, res) {
  const config = metaConfig();
  if (!config.webhookVerifyToken || !config.supabaseUrl || !config.supabaseKey || !config.companyId) return sendJson(res, 503, { code: "META_WEBHOOK_NOT_CONFIGURED" });
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
      if ((config.pageId && String(entry.id) !== config.pageId) || change.field !== "feed" || value.item !== "comment" || value.verb !== "add" || !value.comment_id || !value.message) continue;
      const postId = String(value.post_id || "");
      const [pageId, objectId] = postId.split("_");
      const scoring = scorePublicComment(value.message);
      const providerCommentId = String(value.comment_id);
      rows.push({
        id: stableCommentId(String(entry.id || pageId || config.pageId), providerCommentId),
        company_id: config.companyId,
        name: String(value.from?.name || "Public Facebook user"),
        prospect_type: "customer",
        classification: scoring.intentLevel === "HOT" ? "hot" : scoring.intentLevel === "WARM" ? "warm" : "ignore",
        area: scoring.estimatedLocation === "Not stated" ? "" : scoring.estimatedLocation,
        source_platform: "facebook_page_webhook",
        source_url: pageId && objectId ? `https://www.facebook.com/${pageId}/posts/${objectId}` : "https://www.facebook.com/",
        intent_type: `facebook_comment:${providerCommentId}`,
        business_category: scoring.estimatedNeed,
        public_phone: "",
        public_whatsapp: "",
        notes: JSON.stringify({
          providerCommentId,
          commenterId: String(value.from?.id || ""),
          profileUrl: value.from?.id ? `https://www.facebook.com/${encodeURIComponent(value.from.id)}` : "",
          comment: String(value.message),
          commentedAt: value.created_time ? new Date(Number(value.created_time) * 1000).toISOString() : new Date().toISOString(),
          intentReason: scoring.intentReason,
          pageId: String(entry.id || pageId || config.pageId)
        }),
        total_score: scoring.intentScore,
        contact_status: "not_contacted",
        do_not_contact: false
      });
    }
    if (rows.length) await supabase(config, "crm_v2_prospects?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
    res.statusCode = 200; res.end("EVENT_RECEIVED");
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { code: "INVALID_WEBHOOK_PAYLOAD" });
    return sendJson(res, 503, { code: "META_WEBHOOK_PROCESSING_FAILED" });
  }
}

function stableCommentId(pageId, commentId) {
  const hex = createHash("sha256").update(`facebook-page-comment\0${pageId}\0${commentId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
