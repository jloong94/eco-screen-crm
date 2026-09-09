export const prospectTypes = ['customer', 'partner'];
export const classifications = ['hot', 'warm', 'partner', 'ignore'];
export const contactStatuses = ['not_contacted', 'contacted', 'replied', 'interested', 'won', 'not_interested', 'do_not_contact'];
export const textFields = ['name', 'area', 'source_platform', 'source_url', 'intent_type', 'business_category', 'public_phone', 'public_whatsapp', 'notes'];
export function prospectPayload(input) {
  const row = Object.fromEntries(textFields.map(key => [key, String(input[key] ?? '').trim()]));
  if (!row.name) throw new Error('Name is required.');
  for (const [key, values] of [['prospect_type', prospectTypes], ['classification', classifications], ['contact_status', contactStatuses]]) {
    if (!values.includes(input[key])) throw new Error(`Invalid ${key}.`);
    row[key] = input[key];
  }
  row.total_score = Number(input.total_score);
  if (input.total_score === '' || !Number.isFinite(row.total_score)) throw new Error('Score must be a number.');
  row.do_not_contact = input.do_not_contact === true;
  if (row.source_url && !safeSourceUrl(row.source_url)) throw new Error('Source URL must start with http:// or https://.');
  return row;
}
export function safeSourceUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
export function whatsappUrl(row) {
  if (row.do_not_contact || row.contact_status === 'do_not_contact') return '';
  const digits = String(row.public_whatsapp || '').replace(/[\s()+.-]/g, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? `https://wa.me/${digits}` : '';
}
export function filterProspects(rows, filters) {
  return rows.filter(row => (!filters.area || row.area === filters.area)
    && (!filters.type || row.prospect_type === filters.type)
    && (!filters.status || row.contact_status === filters.status))
    .sort((a, b) => (Number(a.total_score) - Number(b.total_score)) * (filters.sort === 'asc' ? 1 : -1)
      || a.name.localeCompare(b.name));
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
