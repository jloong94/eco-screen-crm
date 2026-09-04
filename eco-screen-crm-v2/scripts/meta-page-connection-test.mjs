import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

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

const { encryptToken, metaConfig, oauthUrl, openPageConnection, sealPageConnection, signState, verifyState, verifyWebhookSignature } = await import("../api/_lib/meta.js");
const config = metaConfig();
assert.deepEqual(config.missing, []);
const authorizationUrl = new URL(oauthUrl(config, "test-state"));
assert.equal(authorizationUrl.searchParams.get("scope"), "pages_show_list,pages_read_engagement,pages_read_user_content");
assert.equal(authorizationUrl.searchParams.get("scope").includes("pages_manage_metadata"), false);
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

const migration = await readFile("supabase/migrations/202608300001_meta_page_connection.sql", "utf8");
assert.match(migration, /enable row level security/gi);
assert.match(migration, /revoke all on table public\.meta_page_connections from anon, authenticated/i);
assert.match(migration, /provider_comment_id text not null unique/i);
const build = await readFile("scripts/build.mjs", "utf8");
for (const secret of ["META_APP_SECRET", "META_STATE_SECRET", "META_TOKEN_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY"]) {
  assert.equal(build.includes(secret), false, `${secret} must not enter the browser build.`);
}
console.log("Meta Page connection tests passed");
