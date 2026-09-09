import assert from 'node:assert/strict';
import { prospectPayload, filterProspects, whatsappUrl, escapeHtml, safeSourceUrl } from '../src/leadRadarModel.js';
const input = { name: ' Alice ', area: 'Penang', prospect_type: 'customer', classification: 'hot', contact_status: 'not_contacted', total_score: '80', public_whatsapp: '+60 12-345 6789' };
assert.equal(prospectPayload(input).name, 'Alice');
assert.equal(prospectPayload(input).total_score, 80);
for (const invalid of [{ name: '' }, { prospect_type: 'spam' }, { classification: 'cold' }, { contact_status: 'other' }, { total_score: 'NaN' }, { total_score: '' }, { source_url: 'javascript:alert(1)' }]) {
  assert.throws(() => prospectPayload({ ...input, ...invalid }));
}
assert.equal(whatsappUrl(input), 'https://wa.me/60123456789');
assert.equal(whatsappUrl({ ...input, do_not_contact: true }), '');
assert.equal(whatsappUrl({ ...input, contact_status: 'do_not_contact' }), '');
assert.equal(whatsappUrl({ ...input, public_whatsapp: 'javascript:1234567' }), '');
assert.equal(safeSourceUrl('javascript:alert(1)'), '');
assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
const rows = [{ ...input, name: 'A', total_score: 2 }, { ...input, name: 'B', total_score: 100 }, { ...input, name: 'C', area: 'KL', prospect_type: 'partner', contact_status: 'won', total_score: 30 }];
assert.deepEqual(filterProspects(rows, { sort: 'desc' }).map(r => r.name), ['B','C','A']);
assert.deepEqual(filterProspects(rows, { sort: 'asc' }).map(r => r.name), ['A','C','B']);
assert.deepEqual(filterProspects(rows, { area: 'KL', type: 'partner', status: 'won' }).map(r => r.name), ['C']);
assert.equal(filterProspects(rows, { area: 'KL', type: 'customer' }).length, 0);
console.log('Lead Radar: 19 validation, filtering, sorting and contact checks passed.');
