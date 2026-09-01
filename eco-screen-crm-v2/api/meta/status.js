import { cookies, metaConfig, openPageConnection, sendJson } from "../_lib/meta.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 200, { configured: false, connected: false, missing: config.missing });
  const page = openPageConnection(config, cookies(req).meta_page_connection);
  return sendJson(res, 200, { configured: true, connected: Boolean(page), pageName: page?.pageName || "", webhookSubscribed: false });
}
