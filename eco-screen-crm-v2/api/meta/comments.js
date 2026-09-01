import { cookies, graph, metaConfig, openPageConnection, sendJson } from "../_lib/meta.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 503, { code: "META_NOT_CONFIGURED", message: "尚未配置 Facebook 专页授权。" });
  const connection = openPageConnection(config, cookies(req).meta_page_connection);
  if (!connection) return sendJson(res, 401, { code: "META_AUTH_REQUIRED", message: "请先连接并授权 Facebook 专页。" });
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const maximum = Math.min(200, Math.max(1, Number(body.maximum || 50)));
    const postId = await resolvePostId(config, connection, String(body.sourceUrl || ""));
    if (!postId) return sendJson(res, 400, { code: "FACEBOOK_POST_NOT_FOUND", message: "找不到该专页贴文。请使用该已授权专页的公开贴文或视频链接。" });
    const payload = await graph(config, `${encodeURIComponent(postId)}/comments?fields=id,message,created_time,from{id,name}&limit=${maximum}`, connection.accessToken);
    const comments = (payload.data || []).map((row) => ({
      id: row.id, platform: "facebook", username: row.from?.id || row.id, displayName: row.from?.name || "Facebook user",
      profileUrl: row.from?.id ? `https://www.facebook.com/${encodeURIComponent(row.from.id)}` : "",
      comment: row.message, commentedAt: row.created_time, sourceUrl: String(body.sourceUrl || ""), sourceAuthor: connection.pageName,
      contactEligibility: "direct_brand_interaction"
    }));
    return sendJson(res, 200, { comments, exhausted: true, cursor: "" });
  } catch (error) {
    return sendJson(res, 503, { code: "META_COMMENTS_FAILED", message: "Facebook 评论暂时无法读取。" });
  }
}

async function resolvePostId(config, connection, sourceUrl) {
  let candidate = sourceUrl;
  try {
    const response = await fetch(sourceUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
    candidate = response.url || sourceUrl;
  } catch {}
  for (const value of [candidate, sourceUrl]) {
    try {
      const url = new URL(value);
      const direct = url.pathname.match(/\/(?:posts|videos|reel)\/([A-Za-z0-9_-]+)/i)?.[1] || url.searchParams.get("story_fbid");
      if (direct) return direct;
    } catch {}
  }
  const feed = await graph(config, `${encodeURIComponent(connection.pageId)}/published_posts?fields=id,permalink_url&limit=100`, connection.accessToken);
  const normalize = (value) => String(value || "").replace(/^https?:\/\/(?:www\.|web\.|m\.)?facebook\.com/i, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  const match = (feed.data || []).find((post) => normalize(post.permalink_url) === normalize(candidate) || normalize(post.permalink_url) === normalize(sourceUrl));
  return match?.id || "";
}
