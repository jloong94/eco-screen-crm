import { supabase, identity } from './session.js';
import { prospectTypes, classifications, contactStatuses, textFields, prospectPayload, safeSourceUrl,
  whatsappUrl, filterProspects, escapeHtml as esc } from './leadRadarModel.js';

export function renderLeadRadarPage() {
  return `<section class="panel page-panel" id="leadRadar"><div class="panel-head"><h2>Lead Radar</h2>
    <button class="btn primary" id="radarAdd">新增 Prospect</button></div>
    <p id="radarMessage" role="status">加载中…</p><div id="radarFilters" class="form-grid compact"></div>
    <div id="radarList" class="product-list"></div><div id="radarEditor"></div></section>`;
}
const options = (values, selected, all = false) => `${all ? '<option value="">全部</option>' : ''}${values.map(value =>
  `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;

export async function attachLeadRadarEvents() {
  const root = document.querySelector('#leadRadar');
  if (!root) return;
  let rows = [], saving = false;
  const companyId = identity.companyId;
  const filters = { area: '', type: '', status: '', sort: 'desc' };
  const message = text => { root.querySelector('#radarMessage').textContent = text; };
  function draw() {
    root.querySelector('#radarFilters').innerHTML = `
      <label>Area<select data-filter="area">${options([...new Set(rows.map(r => r.area).filter(Boolean))].sort(), filters.area, true)}</select></label>
      <label>Type<select data-filter="type">${options(prospectTypes, filters.type, true)}</select></label>
      <label>Status<select data-filter="status">${options(contactStatuses, filters.status, true)}</select></label>
      <label>Score 排序<select data-filter="sort"><option value="desc" ${filters.sort === 'desc' ? 'selected' : ''}>高 → 低</option><option value="asc" ${filters.sort === 'asc' ? 'selected' : ''}>低 → 高</option></select></label>`;
    const visible = filterProspects(rows, filters);
    root.querySelector('#radarList').innerHTML = visible.length ? visible.map(row => {
      const wa = whatsappUrl(row), source = safeSourceUrl(row.source_url);
      return `<article class="card"><div class="card-head"><strong>${esc(row.name)}</strong><span class="pill">Score: ${esc(row.total_score)}</span></div>
        <p>${esc(row.area)} · ${esc(row.prospect_type)} · ${esc(row.classification)} · ${esc(row.contact_status)}</p>
        ${row.do_not_contact ? '<p>Do not contact</p>' : ''}
        <p class="muted-text">${esc(row.notes)}</p><div class="actions">
        <button class="btn" data-edit="${esc(row.id)}">编辑</button>
        ${source ? `<a class="btn" href="${esc(source)}" target="_blank" rel="noopener noreferrer">来源</a>` : ''}
        ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}</div></article>`;
    }).join('') : '<p>暂无符合条件的 prospect。</p>';
  }
  async function load() {
    // Fetch every page; the Supabase default row limit must not truncate manual prospects.
    let offset = 0, collected = [];
    while (true) {
      const { data, error } = await supabase.from('crm_v2_prospects').select('*').eq('company_id', companyId)
        .order('id').range(offset, offset + 499);
      if (error) throw error;
      collected.push(...data);
      if (data.length < 500) break;
      offset += 500;
    }
    rows = collected; draw(); message(`${rows.length} prospects`);
  }
  function editor(row = {}) {
    root.querySelector('#radarEditor').innerHTML = `<form id="radarForm" class="panel stack"><h3>${row.id ? '编辑' : '新增'} Prospect</h3>
      <div class="form-grid compact">${textFields.map(key => `<label>${esc(key)}${key === 'notes'
        ? `<textarea name="${key}" rows="3">${esc(row[key])}</textarea>`
        : `<input name="${key}" value="${esc(row[key])}" ${key === 'name' ? 'required' : ''} ${key === 'source_url' ? 'type="url"' : ''} />`}</label>`).join('')}
      <label>prospect_type<select name="prospect_type">${options(prospectTypes, row.prospect_type || 'customer')}</select></label>
      <label>classification<select name="classification">${options(classifications, row.classification || 'warm')}</select></label>
      <label>contact_status<select name="contact_status">${options(contactStatuses, row.contact_status || 'not_contacted')}</select></label>
      <label>total_score<input name="total_score" type="number" step="any" required value="${esc(row.total_score ?? 0)}" /></label>
      <label>do_not_contact<input name="do_not_contact" type="checkbox" ${row.do_not_contact ? 'checked' : ''} /></label></div>
      <p role="alert" id="radarFormError"></p><div class="actions"><button class="btn primary" type="submit">保存</button>
      <button class="btn" type="button" id="radarCancel">取消</button></div></form>`;
    const form = root.querySelector('#radarForm');
    form.querySelector('#radarCancel').onclick = () => { if (!saving) form.remove(); };
    form.onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      saving = true; form.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        const input = Object.fromEntries(new FormData(form));
        input.do_not_contact = form.elements.do_not_contact.checked;
        const payload = prospectPayload(input);
        const query = row.id ? supabase.from('crm_v2_prospects').update(payload).eq('company_id', companyId).eq('id', row.id)
          : supabase.from('crm_v2_prospects').insert({ ...payload, company_id: companyId });
        const { data, error } = await query.select('id').single();
        if (error || !data) throw error || new Error('保存失败。');
        form.remove(); await load(); message('已保存。');
      } catch (error) {
        if (form.isConnected) form.querySelector('#radarFormError').textContent = error.message || '保存失败，请重试。';
        else message('已保存，但列表刷新失败；请重新打开 Lead Radar。');
      } finally { saving = false; form.querySelectorAll('button').forEach(b => b.disabled = false); }
    };
    form.querySelector('[name="name"]').focus();
  }
  root.querySelector('#radarAdd').onclick = () => { if (!saving) editor(); };
  root.addEventListener('change', event => { if (event.target.dataset.filter) { filters[event.target.dataset.filter] = event.target.value; draw(); } });
  root.addEventListener('click', event => { const id = event.target.closest('[data-edit]')?.dataset.edit; if (id && !saving) editor(rows.find(r => r.id === id)); });
  try { await load(); } catch { message('无法加载 prospects，请检查登录状态和数据库 migration。'); }
}
