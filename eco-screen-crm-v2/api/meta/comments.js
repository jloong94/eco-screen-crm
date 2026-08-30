import { hasSession, metaConfig, sendJson, supabase } from "../_lib/meta.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 503, { code: "META_NOT_CONFIGURED", message: "尚未配置 Facebook 专页授权。" });
  if (!hasSession(req, config)) return sendJson(res, 401, { code: "META_AUTH_REQUIRED", message: "请先连接并授权 Facebook 专页。" });
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const maximum = Math.min(200, Math.max(1, Number(body.maximum || 50)));
    const rows = await supabase(config, `meta_page_comment_events?page_id=eq.${encodeURIComponent(config.pageId)}&select=provider_comment_id,commenter_id,commenter_name,message,commented_at,source_url,page_name&order=commented_at.desc&limit=${maximum}`);
    const comments = (rows || []).map((row) => ({
      id: row.provider_comment_id, platform: "facebook", username: row.commenter_id, displayName: row.commenter_name,
      profileUrl: row.commenter_id ? `https://www.facebook.com/${encodeURIComponent(row.commenter_id)}` : "",
      comment: row.message, commentedAt: row.commented_at, sourceUrl: row.source_url, sourceAuthor: row.page_name,
      contactEligibility: "direct_brand_interaction"
    }));
    return sendJson(res, 200, { comments, exhausted: true, cursor: "" });
  } catch (error) {
    return sendJson(res, 503, { code: "META_COMMENTS_FAILED", message: "Facebook 评论暂时无法读取。" });
  }
}
