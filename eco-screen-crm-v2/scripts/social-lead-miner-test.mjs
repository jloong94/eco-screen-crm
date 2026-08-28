class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.document = { querySelector: () => null };
globalThis.window = globalThis;

const {
  canQueueSocialLead,
  ingestProviderComments,
  parseSocialLeadCsv,
  scoreSocialLead
} = await import("../src/socialLeadMiner.js");
const {
  socialProvider,
  socialProviderPlatforms,
  validateFacebookSourceUrl,
  validateRedNoteSourceUrl,
  validateTikTokVideoUrl
} = await import("../src/socialProviders.js");
const { canAccessPage, rolePages } = await import("../src/permissions.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const csv = [
  "platform,username,display_name,profile_url,avatar_url,comment,comment_time,source_url,source_author,region,contact_eligibility",
  "tiktok,ali,Ali,https://www.tiktok.com/@ali,,berapa harga untuk sliding door area BM?,2026-08-25T10:00:00+08:00,https://www.tiktok.com/@brand/video/1,brand,,direct_brand_interaction",
  "tiktok,ali,Ali,https://www.tiktok.com/@ali,,berapa harga untuk sliding door area BM?,2026-08-25T10:00:00+08:00,https://www.tiktok.com/@brand/video/1,brand,,direct_brand_interaction",
  "tiktok,mei,Mei,https://www.tiktok.com/@mei,,nice video,2026-08-25T11:00:00+08:00,https://www.tiktok.com/@brand/video/1,brand,,not_eligible"
].join("\n");

const parsed = parseSocialLeadCsv(csv, { maximum: 50 });
assert(parsed.leads.length === 2, "CSV import must retain unique rows only");
assert(parsed.duplicates === 1, "CSV import must count duplicate comments");
assert(parsed.errors.length === 0, "Valid CSV rows must import without validation errors");

const hotLead = parsed.leads.find((lead) => lead.username === "ali");
assert(hotLead.intentLevel === "HOT", "Explicit price, product and location enquiry must score HOT");
assert(hotLead.estimatedNeed === "Sliding Screen", "Product need must be detected");
assert(hotLead.estimatedLocation === "Bukit Mertajam", "Location must be detected");
assert(canQueueSocialLead(hotLead), "Eligible HOT lead with a public profile may enter the manual queue");
assert(!canQueueSocialLead(parsed.leads.find((lead) => lead.username === "mei")), "Not-eligible comment must not enter the queue");

assert(socialProviderPlatforms().includes("tiktok"), "TikTok must be registered through the provider layer");
assert(socialProviderPlatforms().includes("facebook"), "Facebook must be registered through the provider layer");
assert(socialProviderPlatforms().includes("rednote"), "RedNote must be registered through the provider layer");
assert(validateTikTokVideoUrl("https://www.tiktok.com/@brand/video/7591511969182649621"), "Public TikTok video URLs must validate");
assert(!validateTikTokVideoUrl("https://example.com/@brand/video/7591511969182649621"), "Non-TikTok URLs must be rejected");
assert(validateFacebookSourceUrl("https://web.facebook.com/share/v/1CZAX55NpV/"), "Public Facebook share URLs must validate");
assert(validateFacebookSourceUrl("https://www.facebook.com/brand/posts/123456"), "Public Facebook post URLs must validate");
assert(!validateFacebookSourceUrl("https://example.com/share/v/1CZAX55NpV/"), "Non-Facebook URLs must be rejected");
assert(validateRedNoteSourceUrl("https://www.xiaohongshu.com/discovery/item/68e6066a000000000700a31b?source=webshare"), "Public RedNote item URLs must validate");
assert(!validateRedNoteSourceUrl("https://example.com/discovery/item/68e6066a000000000700a31b"), "Non-RedNote URLs must be rejected");
let providerBlocker = null;
try {
  await socialProvider("tiktok").scan({ sourceUrl: "https://www.tiktok.com/@brand/video/7591511969182649621", maximum: 50 });
} catch (error) {
  providerBlocker = error;
}
assert(providerBlocker?.code === "PROVIDER_NOT_CONFIGURED", "Unconfigured TikTok access must return an explicit blocker without mock comments");

for (const [platform, sourceUrl] of [
  ["facebook", "https://web.facebook.com/share/v/1CZAX55NpV/"],
  ["rednote", "https://www.xiaohongshu.com/discovery/item/68e6066a000000000700a31b"]
]) {
  let blocker = null;
  try {
    await socialProvider(platform).scan({ sourceUrl, maximum: 50 });
  } catch (error) {
    blocker = error;
  }
  assert(blocker?.code === "PROVIDER_NOT_CONFIGURED", `Unconfigured ${platform} access must return an explicit blocker without mock comments`);
}

const multiPlatformCsv = [
  "platform,username,display_name,profile_url,avatar_url,comment,comment_time,source_url,source_author,region,contact_eligibility",
  "facebook,faiz,Faiz,https://www.facebook.com/faiz,,price please security screen Penang,2026-08-25T10:00:00+08:00,https://www.facebook.com/brand/posts/123456,brand,,direct_brand_interaction",
  "xiaohongshu,lin,Lin,https://www.xiaohongshu.com/user/profile/abc,,Batu Kawan 可以安装防蚊纱窗吗？,2026-08-25T11:00:00+08:00,https://www.xiaohongshu.com/discovery/item/68e6066a000000000700a31b,brand,,user_consented"
].join("\n");
const multiPlatform = parseSocialLeadCsv(multiPlatformCsv, { maximum: 50 });
assert(multiPlatform.errors.length === 0 && multiPlatform.leads.length === 2, "Facebook and RedNote CSV rows must use the shared import pipeline");
assert(multiPlatform.leads.some((lead) => lead.platform === "facebook"), "Facebook leads must preserve their canonical platform");
assert(multiPlatform.leads.some((lead) => lead.platform === "rednote"), "Xiaohongshu aliases must normalize to RedNote");
assert(multiPlatform.leads.find((lead) => lead.platform === "rednote")?.intentLevel === "HOT", "Chinese installation enquiries must receive buying-intent scoring");

const providerImport = ingestProviderComments([
  { username: "siti", displayName: "Siti", profileUrl: "https://www.tiktok.com/@siti", comment: "price please roller screen Penang", commentedAt: "2026-08-25T12:00:00+08:00" },
  { username: "siti", displayName: "Siti", profileUrl: "https://www.tiktok.com/@siti", comment: "price please roller screen Penang", commentedAt: "2026-08-25T12:00:00+08:00" }
], { sourceUrl: "https://www.tiktok.com/@brand/video/7591511969182649621", maximum: 50 });
assert(providerImport.leads.length === 1 && providerImport.duplicates === 1, "Approved provider comments must use the shared scoring and duplicate pipeline");
assert(providerImport.leads[0].intentLevel === "HOT", "Approved provider comments must receive intent scoring");

const excluded = scoreSocialLead({ comment: "price please giveaway", contactEligibility: "user_consented", profileUrl: "https://www.tiktok.com/@x" }, { excludeKeywords: "giveaway" });
assert(excluded.intentLevel === "NOT_LEAD" && excluded.intentScore === 0, "Exclude keywords must override intent scoring");

const secondImport = parseSocialLeadCsv(csv.split("\n").slice(0, 2).join("\n"), { existing: parsed.leads });
assert(secondImport.leads.length === 0 && secondImport.duplicates === 1, "Duplicate protection must include already stored leads");

assert(rolePages.Boss.includes("social-lead-miner") && rolePages.Admin.includes("social-lead-miner"), "Boss and Admin must receive the module permission");
assert(!canAccessPage("Sales", "social-lead-miner") && !canAccessPage("Installer", "social-lead-miner"), "Operational roles must not see social leads by default");

console.log("Social Lead Miner tests passed");
