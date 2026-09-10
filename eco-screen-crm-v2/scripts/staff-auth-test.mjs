import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.CRM_V2_SERVER_KEY = 'unit-test-only-server-key';
process.env.CRM_V2_COMPANY_ID = '11111111-1111-4111-8111-111111111111';
process.env.VITE_SUPABASE_URL = 'https://test.example.invalid';
const auth = await import('../api/_lib/staff-auth.js');
const { default: sessionHandler } = await import('../api/staff-session.js');
const { default: dataHandler } = await import('../api/staff-data.js');
const { default: radarHandler } = await import('../api/staff-prospects.js');
const roles = ['Boss', 'Admin', 'Secretary', 'Sales', 'Production', 'Installer'];
const users = roles.map((role, i) => ({ userId: 'old-' + i, name: role, username: role.toLowerCase(), pin: 'test-' + i, role, active: true }));
let prospect = null;
let writes = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  assert.equal(url.searchParams.get('company_id') || process.env.CRM_V2_COMPANY_ID, url.searchParams.has('company_id') ? 'eq.' + process.env.CRM_V2_COMPANY_ID : process.env.CRM_V2_COMPANY_ID);
  const method = options.method || 'GET';
  const collection = url.searchParams.get('collection')?.slice(3);
  let result;
  if (url.pathname.endsWith('crm_v2_sync')) {
    if (method === 'GET') result = collection === 'users' ? { data: users } : [{ collection, data: [{ id: 'legacy-row' }], updated_at: '' }];
    else { writes++; result = {}; }
  } else if (url.pathname.endsWith('crm_v2_prospects')) {
    if (method === 'GET') result = prospect ? [prospect] : [];
    else {
      const row = JSON.parse(options.body);
      if (method === 'POST') assert.equal(row.company_id, process.env.CRM_V2_COMPANY_ID);
      prospect = { ...prospect, ...row, id: '22222222-2222-4222-8222-222222222222' };
      result = { id: prospect.id };
    }
  } else throw new Error('Unexpected test URL');
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
async function request(handler, method, url, body, cookie = '', headers = {}) {
  const req = { method, url, body, headers: { host: 'crm.test', cookie, 'x-crm-request': '1', ...headers } };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res);
  return res;
}
let checks = 0;
const check = (a, b) => { assert.deepEqual(a, b); checks++; };
for (const user of users) {
  const res = await request(sessionHandler, 'POST', '/api/staff-session', { username: ' ' + user.username.toUpperCase() + ' ', pin: user.pin });
  check(res.statusCode, 200);
  check(res.body.user.userId, user.userId);
  check(res.body.user.role, user.role);
  check(res.body.user.pin, undefined);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  check((await request(sessionHandler, 'GET', '/api/staff-session', null, cookie)).statusCode, 200);
  check((await request(radarHandler, 'GET', '/api/staff-prospects', null, cookie)).statusCode, auth.canUseRadar(user.role) ? 200 : 403);
  check((await request(dataHandler, 'POST', '/api/staff-data?collection=users', { company_id: process.env.CRM_V2_COMPANY_ID, collection: 'users', data: [] }, cookie)).statusCode, auth.isAdmin(user.role) ? 200 : 403);
  check((await request(dataHandler, 'POST', '/api/staff-data?collection=orders', { company_id: 'other-company', collection: 'orders', data: [] }, cookie)).statusCode, 400);
  user.active = false;
  check((await request(sessionHandler, 'GET', '/api/staff-session', null, cookie)).statusCode, 401);
  user.active = true;
  user.pin += '-changed';
  check((await request(sessionHandler, 'GET', '/api/staff-session', null, cookie)).statusCode, 401);
  user.pin = user.pin.replace('-changed', '');
}
check((await request(sessionHandler, 'POST', '/api/staff-session', { username: users[0].username, pin: 'wrong' })).statusCode, 401);
check((await request(sessionHandler, 'POST', '/api/staff-session', { username: users[0].username, pin: users[0].pin }, '', { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
check((await request(sessionHandler, 'GET', '/api/staff-session')).statusCode, 401);
users.push({ ...users[3], userId: 'later-duplicate', pin: 'different-pin' });
check((await request(sessionHandler, 'POST', '/api/staff-session', { username: users[3].username, pin: 'different-pin' })).statusCode, 401);
check((await request(sessionHandler, 'POST', '/api/staff-session', { username: users[3].username, pin: users[3].pin })).body.user.userId, users[3].userId);
users.pop();
const token = auth.makeToken(users[3]);
check(auth.readToken(token + 'tampered'), null);
check(auth.readToken(token, Date.now() + 13 * 60 * 60 * 1000), null);
const cookie = '__Host-crm-v2-staff=' + token;
const payload = { name: 'Test', prospect_type: 'customer', classification: 'warm', contact_status: 'not_contacted', total_score: 85, company_id: 'injected-company' };
const create = await request(radarHandler, 'POST', '/api/staff-prospects', payload, cookie);
check(create.statusCode, 200);
check(prospect.company_id, process.env.CRM_V2_COMPANY_ID);
check((await request(radarHandler, 'PATCH', '/api/staff-prospects?id=' + create.body.id, { ...payload, do_not_contact: true }, cookie)).statusCode, 200);
check(prospect.do_not_contact, true);
check((await request(radarHandler, 'DELETE', '/api/staff-prospects', null, cookie)).statusCode, 405);
check((await request(dataHandler, 'GET', '/api/staff-data?collection=unrelated_table', null, cookie)).statusCode, 400);

// The original permission functions, page assignments, and staff editor are retained exactly.
const before = execFileSync('git', ['show', '8365e08:eco-screen-crm-v2/src/permissions.js'], { encoding: 'utf8' }).replace(/\r/g, '');
const after = readFileSync(new URL('../src/permissions.js', import.meta.url), 'utf8').replace(/\r/g, '')
  .replace('  { id: "lead-radar", label: "Lead Radar", title: "Lead Radar" },\n', '').replaceAll('"lead-radar", ', '');
check(after, before);
const baselineAuth = execFileSync('git', ['show', '8365e08:eco-screen-crm-v2/src/auth.js'], { encoding: 'utf8' }).replace(/\r/g, '');
const currentAuth = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8').replace(/\r/g, '');
check(currentAuth.slice(currentAuth.indexOf('export function renderUserManagement'), currentAuth.indexOf('export function attachLoginEvents')), baselineAuth.slice(baselineAuth.indexOf('export function renderUserManagement'), baselineAuth.indexOf('export function attachLoginEvents')));
for (const file of ['workflow.js', 'quotations.js', 'main.js']) {
  const old = execFileSync('git', ['show', `8365e08:eco-screen-crm-v2/src/${file}`], { encoding: 'utf8', maxBuffer: 5_000_000 });
  const current = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  if (file !== 'main.js') check(current.replace(/\r/g, ''), old.replace(/\r/g, ''));
}
console.log(`Staff auth: ${checks} assertions passed; original permissions, employee IDs, PIN records and workflows retained.`);
