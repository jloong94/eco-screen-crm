const agent = 'EcoCRM-V2-LeadRadar/1.0 (+https://eco-screen-crm-v2.vercel.app)';
const businesses = {
  shop: null, craft: null, office: null,
  amenity: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'pharmacy', 'bank', 'fuel', 'car_rental', 'car_wash', 'cinema', 'dentist', 'clinic', 'veterinary', 'marketplace', 'food_court', 'ice_cream'],
  tourism: ['hotel', 'motel', 'hostel', 'guest_house']
};
const aliases = [
  ['restaurant', 'restaurants', '餐厅', '餐馆', '餐飲', '餐饮', 'restoran'],
  ['cafe', 'coffee', '咖啡', '咖啡店'], ['hardware', '五金', '五金店'],
  ['furniture', '家具', '家具店'], ['car_repair', 'car repair', '汽车维修'],
  ['supermarket', '超市'], ['convenience', '便利店'], ['hotel', '酒店'],
  ['hairdresser', 'salon', '理发店'], ['estate_agent', 'real estate', '房地产'],
  ['interior_design', 'interior designer', '室内设计'], ['carpenter', '木工'],
  ['electrician', '电工'], ['window_construction', 'window', 'windows', '门窗']
];
const categoryKeys = { restaurant: 'amenity', cafe: 'amenity', hardware: 'shop', furniture: 'shop', car_repair: 'shop', supermarket: 'shop', convenience: 'shop', hotel: 'tourism', hairdresser: 'shop', estate_agent: 'office', interior_design: 'office', carpenter: 'craft', electrician: 'craft', window_construction: 'craft', bakery: 'shop', clothes: 'shop', curtains: 'shop', plumber: 'craft', construction_company: 'office', architect: 'office', pharmacy: 'amenity', dentist: 'amenity', clinic: 'amenity', bank: 'amenity', fast_food: 'amenity' };
const error = (status, message) => Object.assign(new Error(message), { status });
export function validateSearch(body) {
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const location = typeof body?.location === 'string' ? body.location.trim() : '';
  const radius = Number(body?.radius);
  if (!keyword || keyword.length > 80 || /[\x00-\x1f]/.test(keyword)) throw error(400, '请输入 Keyword（最多 80 字）。');
  if (!location || location.length > 160 || /[\x00-\x1f]/.test(location)) throw error(400, '请输入 Location（最多 160 字）。');
  if (!Number.isFinite(radius) || radius < 0.1 || radius > 25) throw error(400, 'Radius 必须为 0.1–25 km。');
  return { keyword, location, radius };
}
function keywordPattern(keyword) {
  const terms = aliases.find(group => group.includes(keyword.toLowerCase())) || [keyword];
  return terms.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '[ _]')).join('|');
}
export function buildQuery({ keyword, radius }, { lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw error(502, '地点服务返回无效坐标。');
  // Fixed tag keys let Overpass use its indexes; regex key scans are expensive.
  const around = `(around:${Math.round(radius * 1000)},${lat},${lon})`;
  const canonical = aliases.find(group => group.includes(keyword.toLowerCase()))?.[0] || keyword.toLowerCase().replaceAll(' ', '_');
  const filter = categoryKeys[canonical]
    ? `["${categoryKeys[canonical]}"=${JSON.stringify(canonical)}]`
    : `["name"~${JSON.stringify(keywordPattern(keyword))},i]`;
  return `[out:json][timeout:20][maxsize:16777216];nwr${around}${filter};out center 201;`;
}
export function distanceKm(lat, lon, center) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat - center.lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(center.lat)) * Math.sin(rad(lon - center.lon) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
export function safeWebsite(value) {
  if (!value) return '';
  try {
    const url = new URL(/^[\w+.-]+:/.test(value) ? value : 'https://' + value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function normalizeResults(elements, search, center) {
  const rows = [], seen = new Set();
  for (const element of elements) {
    const t = element.tags || {};
    if (['private', 'no'].includes(t.access) || t.private === 'yes' || ['private', 'residential'].includes(t.office)) continue;
    if (t.disused === 'yes' || t.abandoned === 'yes') continue;
    const category = Object.entries(businesses).find(([key, values]) => t[key] && !['no', 'vacant', 'yes'].includes(t[key]) && (!values || values.includes(t[key])))?.[0];
    const name = t.name || t['name:en'] || t['name:zh'];
    const lat = element.lat ?? element.center?.lat, lon = element.lon ?? element.center?.lon;
    if (!category || !name || !Number.isFinite(lat) || !Number.isFinite(lon) || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id)) continue;
    const distance = distanceKm(lat, lon, center);
    if (distance > search.radius) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name, category: t[category].replaceAll('_', ' '),
      area: [...new Set([t['addr:suburb'], t['addr:city'], t['addr:district'], t['addr:state']].filter(Boolean))].join(', ') || `搜索范围：${center.label}`,
      phone: t['contact:phone'] || t.phone || '', whatsapp: t['contact:whatsapp'] || t.whatsapp || '',
      website: safeWebsite(t['contact:website'] || t.website), source_url: `https://www.openstreetmap.org/${id}`, distance_km: distance });
  }
  return rows.sort((a, b) => a.distance_km - b.distance_km).slice(0, 200);
}

export function createPublicSearch({ fetcher = fetch, now = Date.now } = {}) {
  const locations = new Map(), results = new Map(), pending = new Map();
  const get = (cache, key) => { const entry = cache.get(key); return entry && entry.expires > now() ? entry.value : null; };
  const put = (cache, key, value, ttl) => {
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + ttl });
  };
  async function json(url, options = {}) {
    let response;
    try { response = await fetcher(url, { ...options, headers: { 'User-Agent': agent, ...options.headers }, signal: AbortSignal.timeout(25000) }); }
    catch { throw error(504, '公开数据源暂时无法连接，请稍后重试。'); }
    if (!response.ok) throw error(502, '公开数据源繁忙，请稍后重试。');
    try { return await response.json(); } catch { throw error(502, '公开数据源返回无效内容，请稍后重试。'); }
  }
  return async function searchPublic(input) {
    const search = validateSearch(input), key = JSON.stringify(search);
    const cached = get(results, key);
    if (cached) return cached;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let center = get(locations, search.location.toLowerCase());
      if (!center) {
        const endpoint = new URL(process.env.LEAD_RADAR_GEOCODER_URL || 'https://photon.komoot.io/api/');
        endpoint.searchParams.set('q', search.location); endpoint.searchParams.set('limit', '1');
        const geo = await json(endpoint);
        if (!Array.isArray(geo.features)) throw error(502, '地点服务返回无效内容。');
        const feature = geo.features[0];
        if (!feature) throw error(404, '找不到该地点，请加上城市和国家后重试。');
        const [lon, lat] = feature.geometry?.coordinates || [];
        const p = feature.properties || {};
        center = { lat, lon, label: [...new Set([p.name, p.city, p.state, p.country].filter(Boolean))].join(', ') || search.location };
        buildQuery(search, center);
        put(locations, search.location.toLowerCase(), center, 86400000);
      }
      const overpass = new URL(process.env.LEAD_RADAR_OVERPASS_URL || 'https://overpass.private.coffee/api/interpreter');
      overpass.searchParams.set('data', buildQuery(search, center));
      const raw = await json(overpass);
      if (raw.remark || !Array.isArray(raw.elements)) throw error(502, '公开商家查询未完成，请缩小 Radius 后重试。');
      const value = { results: normalizeResults(raw.elements, search, center), location: center.label,
        radius: search.radius, truncated: raw.elements.length >= 201, source: 'OpenStreetMap', attribution_url: 'https://www.openstreetmap.org/copyright' };
      put(results, key, value, 300000);
      return value;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
