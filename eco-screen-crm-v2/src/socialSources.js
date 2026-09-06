const domains = {
  tiktok: new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]),
  facebook: new Set(["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com", "fb.watch"]),
  rednote: new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"])
};

export function socialSource(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const platform = Object.keys(domains).find(key => domains[key].has(url.hostname));
    if (!platform) return null;
    const path = url.pathname.replace(/\/$/, "");
    if (platform === "facebook" && /^\/(groups|messages|settings|login|marketplace|search|friends)(\/|$)/i.test(path)) return null;
    let kind;
    if (platform === "tiktok") kind = /^\/@[^/]+$/.test(path) ? "profile" : /\/@[^/]+\/video\/\d+$/.test(path) ? "post" : ["vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname) || /^\/t\//.test(path) ? "share" : null;
    if (platform === "rednote") kind = /^\/user\/profile\/[a-z0-9]+$/i.test(path) ? "profile" : /^\/(explore|discovery\/item)\/[a-z0-9]+$/i.test(path) ? "post" : url.hostname === "xhslink.com" && path ? "share" : null;
    if (platform === "facebook") kind = /\/(posts|videos|reel)\/[^/]+$|^\/permalink\.php$|^\/watch$/i.test(path) ? "post" : /\/share\/(p|v)\//.test(path) || url.hostname === "fb.watch" && path ? "share" : /^\/[a-z0-9._-]+$/i.test(path) && !path.endsWith(".php") || path === "/profile.php" && /^\d+$/.test(url.searchParams.get("id") || "") ? "profile" : null;
    if (!kind) return null;
    url.hash = "";
    return {platform, kind, url: url.href};
  } catch { return null; }
}

export function postIdentity(value) {
  const source = socialSource(value);
  if (source?.kind !== "post") return "";
  const url = new URL(source.url);
  return `${source.platform}:${url.pathname.replace(/\/$/, "")}:${url.searchParams.get("story_fbid") || url.searchParams.get("v") || ""}`;
}

export function publicPostLinks(values, platform, maximum = 5) {
  const unique = new Map();
  for (const value of values) {
    const source = socialSource(value);
    if (source?.platform !== platform || source.kind !== "post") continue;
    const key = postIdentity(value);
    if (!unique.has(key)) unique.set(key, source.url);
    if (unique.size >= maximum) break;
  }
  return [...unique.values()];
}
