import { cookies, metaConfig, openPageConnection, sendJson, supabase } from "../_lib/meta.js";

const allowedStatuses = new Set(["queued", "contacted", "rejected"]);

export default async function handler(req, res) {
  const config = metaConfig();
  if (config.missing.length || !config.supabaseUrl || !config.supabaseKey || !config.companyId) {
    return sendJson(res, 503, { code: "META_LEADS_NOT_CONFIGURED", message: "Facebook 自动获客数据库尚未配置。" });
  }
  const connection = openPageConnection(config, cookies(req).meta_page_connection);
  if (!connection) return sendJson(res, 401, { code: "META_AUTH_REQUIRED", message: "请先连接并授权 Facebook 专页。" });

  if (req.method === "GET") return listLeads(config, connection, res);
  if (req.method === "PATCH") return updateLead(config, connection, req, res);
  return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
}

async function listLeads(config, connection, res) {
  try {
    const fields = "id,name,area,source_url,intent_type,business_category,notes,total_score,classification,contact_status,do_not_contact";
    const rows = await supabase(config, `crm_v2_prospects?company_id=eq.${encodeURIComponent(config.companyId)}&source_platform=eq.facebook_page_webhook&select=${fields}&order=total_score.desc&limit=200`);
    return sendJson(res, 200, { leads: (rows || []).map(toLead) });
  } catch {
    return sendJson(res, 503, { code: "META_LEADS_FAILED", message: "暂时无法读取 Facebook 新客户。" });
  }
}

async function updateLead(config, connection, req, res) {
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const id = String(body.id || "");
    const status = String(body.status || "").toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !allowedStatuses.has(status)) {
      return sendJson(res, 400, { code: "INVALID_LEAD_UPDATE" });
    }
    const update = status === "rejected"
      ? { contact_status: "do_not_contact", do_not_contact: true }
      : { contact_status: status === "contacted" ? "contacted" : "not_contacted", do_not_contact: false };
    await supabase(config, `crm_v2_prospects?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(config.companyId)}&source_platform=eq.facebook_page_webhook`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(update)
    });
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 503, { code: "META_LEAD_UPDATE_FAILED", message: "暂时无法更新客户状态。" });
  }
}

function toLead(row) {
  const details = parseDetails(row.notes);
  const level = row.classification === "hot" ? "HOT" : row.classification === "warm" ? "WARM" : Number(row.total_score) >= 25 ? "COLD" : "NOT_LEAD";
  return {
    id: row.id,
    providerCommentId: details.providerCommentId || String(row.intent_type || "").replace(/^facebook_comment:/, ""),
    platform: "facebook",
    username: details.commenterId || details.providerCommentId || row.id,
    displayName: row.name || "Facebook user",
    profileUrl: details.profileUrl || "",
    comment: details.comment || "",
    commentedAt: details.commentedAt || "",
    sourceUrl: row.source_url || "https://www.facebook.com/",
    sourceAuthor: "Facebook Page",
    contactEligibility: "direct_brand_interaction",
    acquisitionSource: "facebook_page_webhook",
    intentScore: Number(row.total_score || 0),
    intentLevel: level,
    intentReason: details.intentReason || "",
    estimatedNeed: row.business_category || "Eco Screen enquiry",
    estimatedLocation: row.area || "Not stated",
    status: row.do_not_contact || row.contact_status === "do_not_contact" ? "Rejected" : row.contact_status === "contacted" ? "Contacted" : ["HOT", "WARM"].includes(level) ? "Queued" : "New"
  };
}

function parseDetails(value) {
  try { return JSON.parse(String(value || "{}")); }
  catch { return {}; }
}
