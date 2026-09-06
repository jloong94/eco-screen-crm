import assert from "node:assert/strict";
import { socialSource, publicPostLinks } from "../src/socialSources.js";
const profiles = [
  ["https://www.tiktok.com/@veemaxsecuremesh", "tiktok"],
  ["https://www.facebook.com/renexsteel", "facebook"],
  ["https://www.xiaohongshu.com/user/profile/abc123", "rednote"]
];
for (const [url, platform] of profiles) assert.deepEqual(socialSource(url), {url, platform, kind: "profile"});
for (const url of ["http://www.tiktok.com/@a", "https://www.tiktok.com.evil.test/@a", "https://127.0.0.1/x", "https://www.facebook.com/groups/private/posts/12", "https://user:pass@www.facebook.com/a", "https://www.facebook.com:444/a", "https://www.facebook.com/messages"]) assert.equal(socialSource(url), null);
assert.equal(socialSource("https://www.facebook.com/profile.php?id=123").kind, "profile");
assert.equal(socialSource("https://www.tiktok.com/@a/video/123").kind, "post");
assert.equal(socialSource("https://www.xiaohongshu.com/explore/abc123").kind, "post");
assert.equal(socialSource("https://www.facebook.com/a/posts/123").kind, "post");
const links = ["https://www.facebook.com/a/posts/123?a=1", "https://www.facebook.com/a/posts/123?a=2", "https://www.facebook.com/groups/123/posts/456", "https://evil.test/a/posts/123", "https://www.facebook.com/b/videos/456", "https://www.facebook.com/a"];
assert.deepEqual(publicPostLinks(links, "facebook"), [links[0], links[4]]);
assert.equal(publicPostLinks(links, "facebook", 1).length, 1);
assert.equal(publicPostLinks(links, "tiktok").length, 0);
console.log("Profile routing, post limits, duplicate and URL safety tests passed (not live platform results).");
