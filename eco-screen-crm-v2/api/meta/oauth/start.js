import crypto from "node:crypto";
import { cookie, metaConfig, oauthUrl, sendJson, signState } from "../../_lib/meta.js";

export default function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
  const config = metaConfig();
  if (config.missing.length) return sendJson(res, 503, { code: "META_NOT_CONFIGURED", message: "Facebook 专页连接尚未配置。", missing: config.missing });
  const nonce = crypto.randomBytes(24).toString("base64url");
  res.setHeader("Set-Cookie", cookie("meta_oauth_state", nonce));
  res.statusCode = 302;
  res.setHeader("Location", oauthUrl(config, signState(config, nonce)));
  res.end();
}
