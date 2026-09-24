import assert from 'node:assert/strict';
import { assessPastedLead, pastedProspect } from '../src/leadRadarPasteModel.js';
import { renderPasteLead } from '../src/leadRadarPaste.js';

const hot = assessPastedLead({
  url: 'https://example.org/public-post/1',
  text: 'Looking for mosquito screen installer in Bukit Mertajam. Need a quotation. Call +60123456789'
});
assert.equal(hot.classification, 'hot');
assert.equal(hot.demandType, 'quotation_request');
assert.equal(hot.area, 'Bukit Mertajam');
assert.equal(hot.seekingSupplierQuotation, true);
assert.equal(hot.title.includes('60123456789'), false);
const saved = pastedProspect(hot);
assert.equal(saved.source_url, 'https://example.org/public-post/1');
assert.equal(saved.public_phone, '');
assert.equal(saved.public_whatsapp, '');
assert.equal(saved.notes.includes('60123456789'), false);

assert.equal(assessPastedLead({ text: '我需要在槟城安装纱窗。' }).classification, 'warm');
assert.equal(assessPastedLead({ text: '求推荐槟城安装纱窗的师傅，想要报价。' }).classification, 'hot');
assert.equal(assessPastedLead({ text: 'We offer mosquito screen installation. Contact us today.' }).classification, 'ignore');
assert.equal(assessPastedLead({ text: 'Mosquito screens are installed already.' }).classification, 'ignore');
assert.equal(assessPastedLead({ text: 'Looking for a plumber. Mosquito screens are installed already.' }).classification, 'ignore');
assert.equal(assessPastedLead({ text: 'I need mosquito screens.', area: 'Ipoh' }).area, 'Ipoh');
assert.throws(() => assessPastedLead({ url: 'https://example.org/post' }), /帖子文字/);
assert.throws(() => assessPastedLead({ url: 'javascript:alert(1)', text: '需要纱窗' }), /URL/);
assert.equal(renderPasteLead().includes('Paste Lead'), true);
assert.equal(renderPasteLead().includes('radarSearch'), false);
console.log('Paste Lead: classification, privacy, URL and UI checks passed.');
