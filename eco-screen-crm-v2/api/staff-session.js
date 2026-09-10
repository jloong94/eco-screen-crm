import { config, database, fail, handleError, makeToken, matchesPin, mutationGuard, publicUser, reply, requireStaff, setCookie, staffRows } from './_lib/staff-auth.js';

// Bound attempts per warm server instance. No staff record or PIN is modified.
const attempts = new Map();
function throttle(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now = Date.now();
  for (const [ip, row] of attempts) if (row.until < now) attempts.delete(ip);
  const row = attempts.get(key) || { count: 0, until: now + 60_000 };
  if (++row.count > 20) fail(429, 'Too many attempts. Please try again in a minute.');
  if (attempts.size > 10000) fail(429, 'Please retry shortly.');
  attempts.set(key, row);
}
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const session = await requireStaff(req);
      return reply(res, 200, { ...session, user: publicUser(session.user) });
    }
    mutationGuard(req);
    if (req.method === 'DELETE') { setCookie(res); return reply(res, 200, { ok: true }); }
    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    throttle(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (typeof body?.username !== 'string' || typeof body?.pin !== 'string' || body.username.length > 200 || body.pin.length > 200) fail(400, 'Invalid account or PIN.');
    // Match the original CRM's first username match, including legacy duplicate
    // directory rows; a later duplicate must never select a different identity.
    const user = (await staffRows(database())).find(u => String(u.username || '').toLowerCase() === body.username.trim().toLowerCase());
    if (!user || !matchesPin(user, body.username, body.pin)) fail(401, 'Invalid account or PIN.');
    setCookie(res, makeToken(user));
    return reply(res, 200, { user: publicUser(user), companyId: config().companyId, mode: 'pin' });
  } catch (error) { handleError(res, error); }
}
