import { authenticatedHeaders, staffRequest } from './session.js';
import { escapeHtml as esc, safeSourceUrl } from './leadRadarModel.js';

export function renderPublicSearch() {
  return `<section class="panel stack" id="radarSearch"><form id="radarSearchForm" class="form-grid compact">
    <label>Keyword<input name="keyword" required maxlength="80" placeholder="例如 restaurant / 五金" /></label>
    <label>Location<input name="location" required maxlength="160" placeholder="例如 Bukit Mertajam, Malaysia" /></label>
    <label>Radius (km)<input name="radius" type="number" min="0.1" max="25" step="0.1" value="5" required /></label>
    <button class="btn primary" type="submit">Search</button></form>
    <p id="radarSearchMessage" role="status">输入关键词、地点和半径，搜索公开商家。</p>
    <div id="radarSearchResults" class="product-list"></div>
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
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector('button'), status = root.querySelector('#radarSearchMessage'), list = root.querySelector('#radarSearchResults');
    button.disabled = true; status.textContent = '正在搜索公开商家…'; list.replaceChildren();
    try {
      const input = Object.fromEntries(new FormData(form));
      const response = await staffRequest('/api/lead-radar-search', { method: 'POST', headers: await authenticatedHeaders(), body: JSON.stringify(input) });
      if (!root.isConnected) return;
      list.innerHTML = resultCards(response.results);
      status.textContent = `${response.location} · ${response.radius} km：${response.results.length} 个公开结果。${response.truncated ? '结果较多，请缩小范围以查看更多匹配。' : ''}${response.results.length ? '' : '请尝试其他关键词或扩大半径；没有结果不代表当地没有商家。'}`;
    } catch (error) { if (root.isConnected) status.textContent = error.message || '搜索失败，请稍后重试。'; }
    finally { busy = false; button.disabled = false; }
  });
}
