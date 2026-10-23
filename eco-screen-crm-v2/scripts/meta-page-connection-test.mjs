import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

process.env.META_APP_ID = "test-app";
process.env.META_APP_SECRET = "test-secret";
process.env.META_PAGE_ID = "123";
process.env.META_GRAPH_API_VERSION = "v-test";
process.env.META_STATE_SECRET = "state-secret";
process.env.META_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify";
process.env.PUBLIC_APP_URL = "https://example.test";
process.env.SUPABASE_URL = "https://db.example.test";
process.env.SUPABASE_SECRET_KEY = "server-only";
process.env.CRM_V2_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { encryptToken, graph, metaConfig, oauthUrl, openPageConnection, sealPageConnection, signState, subscribePageWebhook, verifyState, verifyWebhookSignature } = await import("../api/_lib/meta.js");
const { facebookContentReference } = await import("../api/meta/comments.js");
const { scorePublicComment } = await import("../api/_lib/social-scoring.js");
const { default: webhookHandler } = await import("../api/meta/webhook.js");
const config = metaConfig();
assert.deepEqual(config.missing, []);
const authorizationUrl = new URL(oauthUrl(config, "test-state"));
assert.equal(authorizationUrl.searchParams.get("scope"), "pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_metadata");
const originalFetch = globalThis.fetch;
let graphRequestUrl = "";
globalThis.fetch = async (url) => {
  graphRequestUrl = String(url);
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
};
await graph(config, "me/accounts", "page-token");
await subscribePageWebhook(config, "123", "page-token");
globalThis.fetch = originalFetch;
assert.match(new URL(graphRequestUrl).searchParams.get("appsecret_proof"), /^[a-f0-9]{64}$/);
assert.match(graphRequestUrl, /\/123\/subscribed_apps\?subscribed_fields=feed/);
assert.equal(facebookContentReference("https://www.facebook.com/example/posts/pfbidExample123"), "pfbidExample123");
assert.equal(facebookContentReference("https://www.facebook.com/example/videos/123456789"), "123456789");
const state = signState(config, "nonce");
assert.equal(verifyState(config, state, "nonce"), true);
assert.equal(verifyState(config, state, "wrong"), false);
const encrypted = encryptToken(config, "page-access-token");
assert.equal(JSON.stringify(encrypted).includes("page-access-token"), false);
const connection = sealPageConnection(config, { pageId: "123", pageName: "Test Page", accessToken: "page-access-token" });
assert.equal(connection.includes("page-access-token"), false);
assert.equal(openPageConnection(config, connection).pageName, "Test Page");
const raw = Buffer.from('{"object":"page"}');
const signature = `sha256=${crypto.createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
assert.equal(verifyWebhookSignature(config, raw, signature), true);
assert.equal(verifyWebhookSignature(config, raw, "sha256=bad"), false);

const hot = scorePublicComment("berapa harga sliding door area BM?");
assert.equal(hot.intentLevel, "HOT");
assert.equal(hot.contactStatus, "queued");
assert.equal(hot.estimatedNeed, "Sliding Screen");
assert.equal(hot.estimatedLocation, "Bukit Mertajam");
const cold = scorePublicComment("nice sharing");
assert.equal(cold.intentLevel, "NOT_LEAD");
assert.equal(cold.contactStatus, "new");

const webhookPayload = Buffer.from(JSON.stringify({
  entry: [{ id: "123", changes: [{ field: "feed", value: {
    item: "comment", verb: "add", comment_id: "comment-1", post_id: "123_456",
    message: "berapa harga sliding door area BM?", created_time: 1788494400,
    from: { id: "public-user-1", name: "Public User" }
  } }] }]
}));
let insertedWebhookRow = null;
globalThis.fetch = async (_url, init = {}) => {
  if (init.method === "POST") insertedWebhookRow = JSON.parse(init.body || "[]")[0];
  return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
};
const webhookRequest = Readable.from([webhookPayload]);
webhookRequest.method = "POST";
webhookRequest.headers = { "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", config.appSecret).update(webhookPayload).digest("hex")}` };
const webhookResponse = responseRecorder();
await webhookHandler(webhookRequest, webhookResponse);
const firstWebhookId = insertedWebhookRow.id;
const duplicateWebhookRequest = Readable.from([webhookPayload]);
duplicateWebhookRequest.method = "POST";
duplicateWebhookRequest.headers = webhookRequest.headers;
await webhookHandler(duplicateWebhookRequest, responseRecorder());
globalThis.fetch = originalFetch;
assert.equal(webhookResponse.statusCode, 200);
assert.equal(insertedWebhookRow.classification, "hot");
assert.equal(insertedWebhookRow.source_platform, "facebook_page_webhook");
assert.match(insertedWebhookRow.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
assert.equal(insertedWebhookRow.id, firstWebhookId);
assert.equal(insertedWebhookRow.contact_status, "not_contacted");
assert.ok(insertedWebhookRow.total_score >= 80);
assert.equal(JSON.parse(insertedWebhookRow.notes).profileUrl, "https://www.facebook.com/public-user-1");

const migration = await readFile("supabase/migrations/202608300001_meta_page_connection.sql", "utf8");
assert.match(migration, /enable row level security/gi);
assert.match(migration, /revoke all on table public\.meta_page_connections from anon, authenticated/i);
assert.match(migration, /provider_comment_id text not null unique/i);
const build = await readFile("scripts/build.mjs", "utf8");
for (const secret of ["META_APP_SECRET", "META_STATE_SECRET", "META_TOKEN_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY"]) {
  assert.equal(build.includes(secret), false, `${secret} must not enter the browser build.`);
}
console.log("Meta Page connection tests passed");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body += value; }
  };
}
