import assert from 'node:assert/strict';
import { validateSearch, buildQuery, normalizeResults, safeWebsite, createPublicSearch } from '../api/_lib/lead-radar-search.js';
import { authorizeSearch } from '../api/lead-radar-search.js';
import { makeToken } from '../api/_lib/staff-auth.js';
import { resultCards, attachPublicSearch, renderPublicSearch } from '../src/leadRadarSearch.js';
import { identity } from '../src/session.js';
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
const input = { keyword: 'restaurant', location: 'Bukit Mertajam, Malaysia', radius: 2 };
for (const override of [{ keyword: '' }, { location: '' }, { radius: 0 }, { radius: 26 }, { radius: 'invalid' }, { keyword: 'a'.repeat(81) }]) {
  assert.throws(() => validateSearch({ ...input, ...override })); checks++;
}
const center = { lat: 5.364, lon: 100.46, label: 'Bukit Mertajam, Malaysia' };
check(buildQuery(input, center).includes('around:2000,5.364,100.46'), 'radius is converted to metres');
check(buildQuery({ ...input, keyword: '五金' }, center).includes('hardware'), 'Chinese category maps to public OSM category');
check(buildQuery({ ...input, keyword: '.*' }, center).includes('\\\\.\\\\*'), 'input is literal, not an injected regex');
check(buildQuery({ ...input, keyword: '"];out;(' }, center).includes('\\"'), 'QL quoted string escaped');
const business = { type: 'node', id: 1, lat: center.lat, lon: center.lon, tags: { name: 'Public Cafe', amenity: 'cafe', 'contact:phone': '+60 123456789', website: 'example.com', 'addr:city': 'Bukit Mertajam' } };
const raw = [business, business, { ...business, id: 2, tags: { name: 'Private home', phone: 'private' } }, { ...business, id: 3, tags: { ...business.tags, access: 'private' } }, { ...business, id: 4, lat: 8 }, { ...business, id: 5, tags: { ...business.tags, disused: 'yes' } }];
const normalized = normalizeResults(raw, input, center);
check(normalized.length === 1, 'exclude private/non-business/out-of-radius/closed; deduplicate OSM IDs');
check(normalized[0].phone === '+60 123456789', 'use explicitly public business phone');
check(normalized[0].whatsapp === '', 'never infer WhatsApp from a phone');
check(normalized[0].source_url === 'https://www.openstreetmap.org/node/1', 'verifiable original source URL');
check(normalized[0].website === 'https://example.com/', 'normalize public website');
check(safeWebsite('javascript:alert(1)') === '', 'unsafe website rejected');
check(safeWebsite('https://user:pass@example.com') === '', 'URL credentials rejected');
const html = resultCards([{ ...normalized[0], name: '<img src=x onerror=alert(1)>', phone: '<script>bad</script>', website: 'javascript:alert(1)' }]);
check(!html.includes('<img') && !html.includes('<script>') && !html.includes('href="javascript:'), 'upstream text/links safely rendered');

let calls = 0, clock = 1;
const search = createPublicSearch({ now: () => clock, fetcher: async url => {
  calls++;
  const u = new URL(url);
  check(u.hostname === 'photon.komoot.io' || u.hostname === 'overpass.private.coffee', 'fixed public sources only');
  return new Response(JSON.stringify(u.hostname.includes('photon') ? { features: [{ geometry: { coordinates: [center.lon, center.lat] }, properties: { name: 'Bukit Mertajam', country: 'Malaysia' } }] } : { elements: [business] }));
} });
const [a, b] = await Promise.all([search(input), search(input)]);
check(a.results.length === 1 && a === b && calls === 2, 'concurrent identical searches coalesced');
await search(input);
check(calls === 2, 'repeat click uses five-minute cache');
clock += 300001;
await search(input);
check(calls === 3, 'location remains cached after result expires');
for (const data of [{ features: [] }, { invalid: true }]) {
  await assert.rejects(createPublicSearch({ fetcher: async () => new Response(JSON.stringify(data)) })(input)); checks++;
}
await assert.rejects(createPublicSearch({ fetcher: async () => new Response('busy', { status: 429 }) })(input)); checks++;
await assert.rejects(createPublicSearch({ fetcher: async () => { throw new Error('offline'); } })(input)); checks++;
let n = 0;
await assert.rejects(createPublicSearch({ fetcher: async () => new Response(JSON.stringify(++n === 1 ? { features: [{ geometry: { coordinates: [center.lon, center.lat] }, properties: {} }] } : { elements: [], remark: 'query timed out' })) })(input)); checks++;

process.env.CRM_V2_SERVER_KEY = 'unit-test-key'; process.env.CRM_V2_COMPANY_ID = 'company-a';
process.env.VITE_SUPABASE_URL = 'https://test.example.invalid';
let staff = { userId: 'original-sales', username: 'sales', pin: 'test', role: 'Sales', active: true };
let member = { role: 'Boss', company_id: 'company-a' };
const db = {
  auth: { getUser: async token => token === 'owner-token' ? { data: { user: { id: 'owner' } } } : { data: { user: null }, error: {} } },
  from(table) { return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { data: [staff] } }), maybeSingle: async () => ({ data: member }) }; }
};
check(await authorizeSearch({ headers: { cookie: '__Host-crm-v2-staff=' + makeToken(staff) } }, db) === staff.userId, 'existing Sales PIN authorized');
staff = { ...staff, role: 'Installer' };
await assert.rejects(authorizeSearch({ headers: { cookie: '__Host-crm-v2-staff=' + makeToken(staff) } }, db)); checks++;
check(await authorizeSearch({ headers: { authorization: 'Bearer owner-token' } }, db) === 'owner', 'verified owner email session authorized');
member = { ...member, role: 'Sales' };
await assert.rejects(authorizeSearch({ headers: { authorization: 'Bearer owner-token' } }, db)); checks++;
await assert.rejects(authorizeSearch({ headers: {} }, db)); checks++;
await assert.rejects(authorizeSearch({ headers: { authorization: 'Bearer forged' } }, db)); checks++;
const handlers = {}, form = { addEventListener: (event, callback) => { handlers[event] = callback; } };
const oldFormData = globalThis.FormData, oldFetch = globalThis.fetch;
globalThis.FormData = class { *[Symbol.iterator]() { yield* Object.entries(input); } };
let current = { status: {}, list: {}, button: {}, querySelector(s) { return s === '#radarSearchMessage' ? this.status : s === '#radarSearchResults' ? this.list : this.button; } };
globalThis.document = { querySelector: () => current };
identity.mode = 'pin'; identity.user = { userId: 'sales', role: 'Sales' }; identity.companyId = 'company-a';
let resolveResponse, signalStarted;
const started = new Promise(resolve => { signalStarted = resolve; });
globalThis.fetch = () => { signalStarted(); return new Promise(resolve => { resolveResponse = resolve; }); };
attachPublicSearch({ querySelector: () => form });
const running = handlers.submit({ preventDefault() {} });
await started;
check(renderPublicSearch().includes('value="restaurant"') && renderPublicSearch().includes('正在搜索公开商家'), 'input/loading survive CRM shell rerender');
current = { ...current, status: {}, list: {}, button: {} };
resolveResponse(new Response(JSON.stringify({ results: normalized, location: center.label, radius: 2 })));
await running;
check(current.list.innerHTML.includes('Public Cafe') && current.button.disabled === false, 'in-flight results update the current panel after rerender');
check(renderPublicSearch().includes('Public Cafe'), 'search results survive page navigation');
globalThis.FormData = oldFormData; globalThis.fetch = oldFetch; delete globalThis.document;
console.log(`Lead Radar public search: ${checks} validation, radius, privacy, source, cache, error and authentication checks passed.`);
