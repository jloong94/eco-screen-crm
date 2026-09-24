import { canUseRadar, database, fail, handleError, mutationGuard, reply, requireStaff } from './_lib/staff-auth.js';
import { prospectPayload } from '../src/leadRadarModel.js';

export default async function handler(req, res) {
  try {
    const db = database();
    const { user, companyId } = await requireStaff(req, db);
    if (!canUseRadar(user.role)) fail(403, 'Permission denied.');
    const params = new URL(req.url, 'https://crm.invalid').searchParams;
    if (req.method === 'GET') {
      const offset = Number(params.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid offset.');
      const { data, error } = await db.from('crm_v2_prospects').select('*').eq('company_id', companyId).order('id').range(offset, offset + 499);
      if (error) throw error;
      return reply(res, 200, data);
    }
    mutationGuard(req);
    if (!['POST', 'PATCH'].includes(req.method)) fail(405, 'Method not allowed.');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let payload;
    try { payload = prospectPayload(body); } catch (error) { fail(400, error.message); }
    const id = params.get('id');
    if (req.method === 'PATCH' && !/^[0-9a-f-]{36}$/i.test(id || '')) fail(400, 'Invalid prospect ID.');
    const query = req.method === 'PATCH'
      ? db.from('crm_v2_prospects').update(payload).eq('company_id', companyId).eq('id', id)
      : db.from('crm_v2_prospects').insert({ ...payload, company_id: companyId });
    const { data, error } = await query.select('id').single();
    if (error) fail(400, 'Unable to save this prospect.');
    return reply(res, 200, data);
  } catch (error) { handleError(res, error); }
}
