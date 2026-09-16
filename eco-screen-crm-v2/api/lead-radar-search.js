import { canUseRadar, database, fail, handleError, mutationGuard, reply, requireStaff } from './_lib/staff-auth.js';
import { createPublicSearch, validateSearch } from './_lib/lead-radar-search.js';

const search = createPublicSearch();
const recent = new Map();
export async function authorizeSearch(req, db = database()) {
  if (String(req.headers.cookie || '').includes('__Host-crm-v2-staff=')) {
    const session = await requireStaff(req, db);
    if (!canUseRadar(session.user.role)) fail(403, 'Permission denied.');
    return session.user.userId;
  }
  const token = String(req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
  if (!token) fail(401, 'Please sign in.');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) fail(401, 'Please sign in.');
  const { data: member, error: membershipError } = await db.from('crm_v2_memberships').select('role,company_id')
    .eq('user_id', user.id).eq('active', true).maybeSingle();
  if (membershipError) throw membershipError;
  if (!member || !['Boss', 'Admin'].includes(member.role)) fail(403, 'Permission denied.');
  return user.id;
}
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    mutationGuard(req);
    const userId = await authorizeSearch(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const input = validateSearch(body);
    const now = Date.now();
    for (const [id, time] of recent) if (now - time > 60000) recent.delete(id);
    if (now - (recent.get(userId) || 0) < 3000) fail(429, '请稍候几秒再搜索。');
    recent.set(userId, now);
    reply(res, 200, await search(input));
  } catch (error) { handleError(res, error); }
}
