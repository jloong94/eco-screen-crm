import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const cookieName = '__Host-crm-v2-staff';
const roles = ['Boss', 'Admin', 'Secretary', 'Sales', 'Production', 'Installer'];
export const isAdmin = role => ['Boss', 'Admin'].includes(role);
export const canUseRadar = role => ['Boss', 'Admin', 'Secretary', 'Sales'].includes(role);
export function config() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.CRM_V2_SERVER_KEY;
  const companyId = process.env.CRM_V2_COMPANY_ID;
  if (!url || !key || !companyId) throw Object.assign(new Error('Staff login is not configured.'), { status: 503 });
  return { url, key, companyId };
}
export function database() {
  const { url, key } = config();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
export function mutationGuard(req) {
  // A custom same-origin header prevents cross-site form/CSRF requests.
  if (req.headers['x-crm-request'] !== '1') fail(403, 'Request not allowed.');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Request not allowed.');
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, 'Request not allowed.');
}
const mac = (text, key) => createHmac('sha256', key).update('crm-v2-staff-session-v1\0' + text).digest('base64url');
const equal = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function matchesPin(user, username, pin) {
  return user?.active !== false && roles.includes(user?.role)
    && String(user.username || '').toLowerCase() === String(username || '').trim().toLowerCase()
    && equal(mac(String(user.pin || ''), config().key), mac(String(pin || ''), config().key))
    && String(user.pin || '').length > 0;
}
export const publicUser = ({ pin, ...user }) => user;
export async function staffRows(db = database()) {
  const { data, error } = await db.from('crm_v2_sync').select('data').eq('company_id', config().companyId).eq('collection', 'users').single();
  if (error || !Array.isArray(data?.data)) fail(503, 'Unable to verify staff.');
  return data.data;
}
const fingerprint = user => mac(JSON.stringify([user.userId, user.username, user.pin, user.role, user.active !== false]), config().key);
export function makeToken(user, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id: user.userId, company: config().companyId, fp: fingerprint(user), exp: now + 12 * 60 * 60 * 1000 })).toString('base64url');
  return payload + '.' + mac(payload, config().key);
}
export function readToken(token, now = Date.now()) {
  try {
    const [payload, signature, extra] = String(token || '').split('.');
    if (extra || !signature || !equal(signature, mac(payload, config().key))) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.exp > now && claims.company === config().companyId ? claims : null;
  } catch { return null; }
}
export function setCookie(res, token = '') {
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 43200 : 0}`);
}
export async function requireStaff(req, db = database()) {
  const token = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const claims = readToken(token);
  if (!claims) fail(401, 'Please sign in with your staff account.');
  const user = (await staffRows(db)).find(u => u.userId === claims.id);
  if (!user || user.active === false || !roles.includes(user.role) || !equal(claims.fp, fingerprint(user))) fail(401, 'Staff session expired. Please sign in again.');
  return { user, companyId: claims.company, mode: 'pin' };
}
export function handleError(res, error) {
  reply(res, error.status || 500, { error: error.status ? error.message : 'Request failed. Please retry.' });
}
