const highIntent = [
  "berapa harga", "price please", "pm price", "how much", "nak buat", "interested",
  "boleh pasang", "can install", "where is your shop", "ada penang", "quotation",
  "多少钱", "价格", "可以安装", "想安装", "有兴趣", "怎么联系"
];

const mediumIntent = [
  "mosquito", "nyamuk", "security", "screen", "sliding door", "roller screen",
  "pintu", "tingkap", "防蚊", "纱窗", "防盗", "推拉门", "卷帘"
];

const productRules = [
  [/sliding|pintu sliding|推拉门/i, "Sliding Screen"],
  [/roller|卷帘/i, "Roller Screen"],
  [/security door|security screen|secure mesh|pintu keselamatan|防盗/i, "Security Screen / Door"],
  [/mosquito|nyamuk|insect|防蚊/i, "Mosquito Screen"],
  [/window|tingkap|窗|纱窗/i, "Window Screen"]
];

const locationRules = [
  [/\bBM\b|bukit mertajam/i, "Bukit Mertajam"],
  [/batu kawan/i, "Batu Kawan"],
  [/penang|pulau pinang/i, "Penang"],
  [/kulim/i, "Kulim"],
  [/seberang perai|butterworth/i, "Seberang Perai"]
];

export function scorePublicComment(message) {
  const comment = String(message || "").trim();
  const normalized = comment.toLocaleLowerCase();
  const highMatches = highIntent.filter((term) => normalized.includes(term.toLocaleLowerCase()));
  const mediumMatches = mediumIntent.filter((term) => normalized.includes(term.toLocaleLowerCase()));
  const hasQuestion = /\?|？|harga|price|how much|berapa|boleh|can |多少|价格|可以|安装/i.test(comment);
  const hasArea = locationRules.some(([expression]) => expression.test(comment));
  const score = Math.max(0, Math.min(100, 10 + highMatches.length * 42 + mediumMatches.length * 9 + (hasQuestion ? 12 : 0) + (hasArea ? 10 : 0)));
  const level = score < 25 ? "NOT_LEAD" : score >= 80 ? "HOT" : score >= 55 ? "WARM" : "COLD";
  const need = firstRuleValue(comment, productRules) || "Eco Screen enquiry";
  const location = firstRuleValue(comment, locationRules) || "Not stated";
  const reason = highMatches.length
    ? `Explicit buying-intent phrase: ${highMatches[0]}.`
    : mediumMatches.length
      ? `Product or problem interest detected: ${mediumMatches[0]}.`
      : "No strong buying-intent phrase detected.";
  return {
    intentScore: score,
    intentLevel: level,
    intentReason: reason,
    estimatedNeed: need,
    estimatedLocation: location,
    contactStatus: ["HOT", "WARM"].includes(level) ? "queued" : "new"
  };
}

function firstRuleValue(value, rules) {
  return rules.find(([expression]) => expression.test(value))?.[1] || "";
}
