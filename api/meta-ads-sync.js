const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
};

const env = (name) => process.env[name] || "";
const numberValue = (value) => Number(value || 0) || 0;
const isoNow = () => new Date().toISOString();

function safeId(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function stableDailyId(row) {
  return [
    row.date,
    row.campaign_id,
    row.adset_id,
    row.ad_id
  ].map(safeId).join("_");
}

function actionCount(actions, matchers) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => {
    const type = String(action.action_type || "").toLowerCase();
    return matchers.some((matcher) => type.includes(matcher))
      ? sum + numberValue(action.value)
      : sum;
  }, 0);
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Supabase request failed (${response.status}).`);
  return text ? JSON.parse(text) : null;
}

async function requireAdmin(req) {
  const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Cloud login required.");
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase server configuration.");

  const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${token}` }
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user || !user.id) throw new Error("Invalid or expired login session.");

  const profiles = await supabaseRequest(`/rest/v1/eco_screen_profiles?id=eq.${encodeURIComponent(user.id)}&select=role,active`);
  const profile = profiles && profiles[0];
  const role = String(profile && profile.role || "").toLowerCase();
  if (!profile || profile.active === false || !["admin", "boss"].includes(role)) {
    throw new Error("Admin permission required.");
  }
  return user;
}

async function fetchMetaInsights({ dateFrom, dateTo }) {
  const token = env("META_ACCESS_TOKEN");
  const adAccountId = env("META_AD_ACCOUNT_ID");
  const apiVersion = env("META_API_VERSION") || "v21.0";
  if (!token || !adAccountId) throw new Error("Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID.");
  const normalizedAccount = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = [
    "date_start",
    "date_stop",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "inline_link_clicks",
    "actions"
  ].join(",");
  let url = `https://graph.facebook.com/${apiVersion}/${normalizedAccount}/insights?level=ad&time_increment=1&limit=500&fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}&access_token=${encodeURIComponent(token)}`;
  const rows = [];
  while (url) {
    const response = await fetch(url);
    const result = await response.json().catch(() => null);
    if (!response.ok || result && result.error) {
      throw new Error(result && result.error && result.error.message || `Meta API failed (${response.status}).`);
    }
    rows.push(...(result.data || []));
    url = result.paging && result.paging.next || "";
  }
  return rows;
}

function toDailyRow(row) {
  const actions = row.actions || [];
  const daily = {
    date: row.date_start || row.date_stop,
    campaign_id: row.campaign_id || "",
    campaign_name: row.campaign_name || "",
    adset_id: row.adset_id || "",
    adset_name: row.adset_name || "",
    ad_id: row.ad_id || "",
    ad_name: row.ad_name || "",
    spend: numberValue(row.spend),
    impressions: numberValue(row.impressions),
    reach: numberValue(row.reach),
    clicks: numberValue(row.clicks),
    inline_link_clicks: numberValue(row.inline_link_clicks),
    whatsapp_conversations: actionCount(actions, ["whatsapp", "messaging_conversation_started", "conversation_started"]),
    leads: actionCount(actions, ["lead"]),
    appointments: 0,
    closed_orders: 0,
    revenue: 0,
    lead_quality: "",
    source: "meta",
    raw_meta: row,
    updated_at: isoNow(),
    created_at: isoNow()
  };
  return { id: stableDailyId(daily), ...daily };
}

async function logSync(row) {
  try {
    await supabaseRequest("/rest/v1/facebook_sync_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row)
    });
  } catch (error) {
    // Do not hide the main sync result if logging fails.
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch (error) { return Promise.reject(new Error("Invalid JSON body.")); }
  }
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(new Error("Invalid JSON body.")); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed. Use POST." });
  const startedAt = isoNow();
  let payload = {};
  try {
    payload = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }
  const dateFrom = payload.date_from;
  const dateTo = payload.date_to;
  if (!dateFrom || !dateTo) return sendJson(res, 400, { error: "date_from and date_to are required." });

  try {
    await requireAdmin(req);
    const metaRows = await fetchMetaInsights({ dateFrom, dateTo });
    const dailyRows = metaRows.map(toDailyRow).filter((row) => row.date);
    if (dailyRows.length) {
      await supabaseRequest("/rest/v1/facebook_ads_daily", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(dailyRows)
      });
    }
    const finishedAt = isoNow();
    await supabaseRequest("/rest/v1/facebook_ad_accounts", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: "main",
        ad_account_id: env("META_AD_ACCOUNT_ID"),
        account_name: env("META_AD_ACCOUNT_NAME") || "",
        currency: env("META_AD_ACCOUNT_CURRENCY") || "",
        active: true,
        last_synced_at: finishedAt,
        sync_status: "success",
        sync_error: null,
        updated_at: finishedAt
      })
    });
    await logSync({
      sync_started_at: startedAt,
      sync_finished_at: finishedAt,
      date_from: dateFrom,
      date_to: dateTo,
      status: "success",
      rows_synced: dailyRows.length
    });
    return sendJson(res, 200, { status: "success", rows_synced: dailyRows.length, rows: dailyRows, last_synced_at: finishedAt });
  } catch (error) {
    const message = String(error.message || error);
    await logSync({
      sync_started_at: startedAt,
      sync_finished_at: isoNow(),
      date_from: dateFrom,
      date_to: dateTo,
      status: "failed",
      error_message: message,
      rows_synced: 0
    });
    try {
      await supabaseRequest("/rest/v1/facebook_ad_accounts", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: "main",
          ad_account_id: env("META_AD_ACCOUNT_ID") || "",
          active: true,
          sync_status: "failed",
          sync_error: message,
          updated_at: isoNow()
        })
      });
    } catch (ignored) {}
    return sendJson(res, 500, { error: message });
  }
};
