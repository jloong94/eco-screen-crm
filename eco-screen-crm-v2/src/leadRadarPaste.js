import { assessPastedLead, pastedProspect } from './leadRadarPasteModel.js';
import { escapeHtml as esc } from './leadRadarModel.js';

const view = { input: { url: '', text: '', area: '' }, result: null, message: '粘贴公开帖子文字进行判断；URL 不会被自动读取。', savedId: '' };

export function renderPasteLead() {
  return `<section class="panel stack" id="radarPaste"><h3>Paste Lead</h3>
    <form id="radarPasteForm" class="stack">
      <label>公开帖子 URL<input name="url" type="url" maxlength="2000" value="${esc(view.input.url)}" placeholder="https://…" /></label>
      <label>帖子文字<textarea name="text" rows="5" maxlength="5000" required placeholder="粘贴公开帖子的文字">${esc(view.input.text)}</textarea></label>
      <label>Area（可选）<input name="area" maxlength="160" value="${esc(view.input.area)}" /></label>
      <div class="actions"><button class="btn primary" type="submit">Check Lead</button></div>
    </form><p id="radarPasteMessage" role="status">${esc(view.message)}</p>
    <div id="radarPasteResult">${resultHtml(view.result)}</div></section>`;
}

function resultHtml(result) {
  if (!result) return '';
  return `<article class="card"><div class="card-head"><strong>${esc(result.title)}</strong><span class="pill">${esc(result.classification.toUpperCase())}</span></div>
    <p>Eco Screen 潜在顾客: ${result.classification === 'ignore' ? '未确认' : '是（待人工确认）'}</p>
    <p>Demand Type: ${esc(result.demandType || '未确认')}</p><p>Area: ${esc(result.area || '未确认')}</p>
    <p>明确找 supplier / quotation: ${result.seekingSupplierQuotation ? '是' : '否'}</p><p>${esc(result.reason)} 请核对原帖。</p>
    <div class="actions"><button class="btn primary" type="button" data-paste-action="save">Save Lead</button>
    ${result.sourceUrl ? `<a class="btn" href="${esc(result.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open Source</a>` : ''}
    <button class="btn" type="button" data-paste-action="ignore">Ignore</button>
    ${result.classification === 'hot' ? '<button class="btn" type="button" data-paste-action="follow-up">Follow Up</button>' : ''}</div></article>`;
}

export function attachPasteLead(root, { onSave, onFollowUp }) {
  const form = root.querySelector('#radarPasteForm');
  const capture = () => { view.input = Object.fromEntries(new FormData(form)); };
  const paint = () => {
    const current = document.querySelector('#radarPaste');
    if (!current) return;
    current.querySelector('#radarPasteMessage').textContent = view.message;
    current.querySelector('#radarPasteResult').innerHTML = resultHtml(view.result);
  };
  form.addEventListener('input', () => {
    capture();
    if (view.result) {
      view.result = null;
      view.savedId = '';
      view.message = '内容已修改，请重新判断。';
      paint();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); capture();
    try { view.result = assessPastedLead(view.input); view.savedId = ''; view.message = '请确认判断结果后保存。'; }
    catch (error) { view.result = null; view.message = error.message; }
    paint();
  });
  root.querySelector('#radarPasteResult').addEventListener('click', async event => {
    const action = event.target.closest('[data-paste-action]')?.dataset.pasteAction;
    if (!action || !view.result) return;
    if (action === 'ignore') { view.result = null; view.message = '已忽略；没有保存。'; paint(); return; }
    const draft = pastedProspect(view.result);
    if (action === 'follow-up') { onFollowUp(draft, view.savedId); return; }
    if (action === 'save') {
      if (view.savedId) { view.message = '此帖子已保存。'; paint(); return; }
      const button = event.target;
      button.disabled = true;
      try { view.savedId = await onSave(draft); view.message = '已保存 Lead。'; }
      catch (error) { view.message = error.message || '保存失败，请重试。'; }
      finally { button.disabled = false; paint(); }
    }
  });
}
