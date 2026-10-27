import assert from 'node:assert/strict';

process.env.CRM_V2_SERVER_KEY = 'batch-test-server-key';
process.env.CRM_V2_COMPANY_ID = '11111111-1111-4111-8111-111111111111';
process.env.VITE_SUPABASE_URL = 'https://test.example.invalid';
const users = [
  { userId: 'boss-test', username: 'boss', pin: 'test-1', role: 'Boss', active: true },
  { userId: 'sales-test', username: 'sales', pin: 'test-2', role: 'Sales', active: true }
];
globalThis.fetch = async (input) => {
  const url = new URL(input);
  assert.equal(url.searchParams.get('company_id'), 'eq.' + process.env.CRM_V2_COMPANY_ID);
  const collection = url.searchParams.get('collection');
  const result = collection === 'eq.users' ? { data: users } : [
    { collection: 'users', data: users, updated_at: '' },
    { collection: 'orders', data: [{ id: 'existing-order' }], updated_at: '' },
    { collection: 'unknown', data: [{ id: 'must-not-leak' }], updated_at: '' }
  ];
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { makeToken } = await import('../api/_lib/staff-auth.js');
const { default: handler } = await import('../api/staff-data.js');
async function request(user, method = 'GET') {
  const req = { method, url: '/api/staff-data?collection=all', headers: {
    host: 'crm.test', cookie: '__Host-crm-v2-staff=' + makeToken(user), 'x-crm-request': '1'
  } };
  const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res);
  return res;
}
const boss = await request(users[0]);
assert.equal(boss.statusCode, 200);
assert.equal(boss.body.find((row) => row.collection === 'users').data[0].pin, 'test-1');
assert.equal(boss.body.find((row) => row.collection === 'orders').data[0].id, 'existing-order');
assert.equal(boss.body.some((row) => row.collection === 'unknown'), false);
const sales = await request(users[1]);
assert.equal(sales.statusCode, 200);
assert.equal(sales.body.find((row) => row.collection === 'users').data[0].pin, undefined);
assert.equal((await request(users[0], 'POST')).statusCode, 400);
console.log('Staff batch read: company isolation, existing records, PIN redaction and read-only access passed.');
