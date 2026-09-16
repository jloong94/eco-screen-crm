import { authenticatedHeaders, staffRequest } from './session.js';
import { escapeHtml as esc, safeSourceUrl } from './leadRadarModel.js';
const view = { input: { keyword: '', location: '', radius: '5' }, busy: false, rows: [], message: '输入关键词、地点和半径，搜索公开商家。' };

export function renderPublicSearch() {
  return `<section class="panel stack" id="radarSearch"><form id="radarSearchForm" class="form-grid compact">
    <label>Keyword<input name="keyword" value="${esc(view.input.keyword)}" required maxlength="80" placeholder="例如 restaurant / 五金" /></label>
    <label>Location<input name="location" value="${esc(view.input.location)}" required maxlength="160" placeholder="例如 Bukit Mertajam, Malaysia" /></label>
    <label>Radius (km)<input name="radius" type="number" min="0.1" max="25" step="0.1" value="${esc(view.input.radius)}" required /></label>
    <button class="btn primary" type="submit" ${view.busy ? 'disabled' : ''}>Search</button></form>
    <p id="radarSearchMessage" role="status">${esc(view.message)}</p>
    <div id="radarSearchResults" class="product-list">${resultCards(view.rows)}</div>
    <p class="muted-text">数据：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a> · 地点：Photon。公开数据覆盖可能不完整；未公开的联系方式不显示。</p></section>`;
}
export function resultCards(rows) {
  const link = (url, label) => { const safe = safeSourceUrl(url); return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere">${esc(label)}</a>` : '未公开'; };
  return rows.map(row => `<article class="card"><strong>${esc(row.name)}</strong>
    <p>Category: ${esc(row.category)}</p><p>Area: ${esc(row.area)}</p>
    <p>Public business phone: ${esc(row.phone || '未公开')}</p><p>WhatsApp: ${esc(row.whatsapp || '未公开')}</p>
    <p>Website: ${link(row.website, row.website)}</p><p>Source URL: ${link(row.source_url, row.source_url)}</p></article>`).join('');
}
export function attachPublicSearch(root) {
  const form = root.querySelector('#radarSearchForm');
  const capture = () => { view.input = Object.fromEntries(new FormData(form)); };
  form.addEventListener('input', capture);
  const paint = () => {
    // Cloud sync can rebuild the CRM shell during an in-flight search.
    const current = document.querySelector('#radarSearch');
    if (!current) return;
    current.querySelector('#radarSearchMessage').textContent = view.message;
    current.querySelector('#radarSearchResults').innerHTML = resultCards(view.rows);
    current.querySelector('button').disabled = view.busy;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (view.busy) return;
    capture(); view.busy = true; view.message = '正在搜索公开商家…'; view.rows = []; paint();
    try {
      const response = await staffRequest('/api/lead-radar-search', { method: 'POST', headers: await authenticatedHeaders(), body: JSON.stringify(view.input) });
      view.rows = response.results;
      view.message = `${response.location} · ${response.radius} km：${response.results.length} 个公开结果。${response.truncated ? '结果较多，请缩小范围以查看更多匹配。' : ''}${response.results.length ? '' : '请尝试其他关键词或扩大半径；没有结果不代表当地没有商家。'}`;
    } catch (error) { view.message = error.message || '搜索失败，请稍后重试。'; }
    finally { view.busy = false; paint(); }
  });
}
