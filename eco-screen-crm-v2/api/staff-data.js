import { database, fail, handleError, isAdmin, mutationGuard, publicUser, reply, requireStaff } from './_lib/staff-auth.js';

const collections = ['users', 'products', 'customers', 'quotations', 'orders', 'adsEntries', 'socialLeads', 'productionJobs', 'installationJobs', 'warrantyCards', 'companySettings'];
// Preserve the existing workflow's linked collection updates. Menus/actions and
// Installer assignment checks remain in the original CRM permission functions.
const writes = {
  Secretary: ['customers', 'quotations', 'orders', 'productionJobs', 'installationJobs', 'warrantyCards'],
  Sales: ['customers', 'quotations', 'orders', 'productionJobs'],
  Production: ['productionJobs', 'orders'],
  Installer: ['installationJobs', 'orders', 'productionJobs', 'warrantyCards']
};
export default async function handler(req, res) {
  try {
    const db = database();
    const { user, companyId } = await requireStaff(req, db);
    const collection = new URL(req.url, 'https://crm.invalid').searchParams.get('collection');
    if (!collections.includes(collection)) fail(400, 'Unknown collection.');
    if (req.method === 'GET') {
      const { data, error } = await db.from('crm_v2_sync').select('collection,data,updated_at').eq('company_id', companyId).eq('collection', collection);
      if (error) throw error;
      if (collection === 'users' && !isAdmin(user.role)) for (const row of data) row.data = row.data.map(publicUser);
      return reply(res, 200, data);
    }
    mutationGuard(req);
    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    if (!isAdmin(user.role) && !writes[user.role]?.includes(collection)) fail(403, 'Permission denied.');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!Array.isArray(body?.data) || body.company_id !== companyId || body.collection !== collection) fail(400, 'Invalid collection data.');
    const { error } = await db.from('crm_v2_sync').upsert({ company_id: companyId, collection, data: body.data, updated_at: new Date().toISOString() }, { onConflict: 'company_id,collection' });
    if (error) throw error;
    return reply(res, 200, { ok: true });
  } catch (error) { handleError(res, error); }
}
