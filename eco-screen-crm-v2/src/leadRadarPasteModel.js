import { safeSourceUrl } from './leadRadarModel.js';

const screen = /纱窗|防蚊网|蚊纱|防盗纱门|mosquito\s*(?:screen|mesh)|insect\s*screen|fly\s*screen|flyscreen|window\s*mesh|security\s*screen|jaring\s*nyamuk|tingkap\s*nyamuk|pintu\s*nyamuk/i;
const request = /求(?:推荐|购|报价|安装|师傅|供应商|纱窗)|想(?:找|装|做|买|询价)|需要|请问(?:哪里|谁|有)|哪里(?:有|能)|有没有(?:人|师傅|公司)|looking\s+for|(?:i|we)\s+(?:need|want)|need\s+(?:a|an|to|someone)|want\s+(?:a|an|to)|can\s+(?:anyone|someone)\s+recommend|any\s+recommendations|where\s+can\s+(?:i|we)\s+(?:find|get|buy)|cari|nak\s+(?:pasang|buat|quote)|perlukan|ada\s+(?:siapa|tak)/i;
const supplier = /求(?:报价|推荐|师傅|供应商)|找(?:师傅|供应商|厂家|公司|安装)|报价|询价|推荐(?:师傅|供应商|公司)|supplier|installer|contractor|vendor|quotation|(?:get|give|need|want|request|for)\s+(?:a\s+)?quote|recommend|sebut\s+harga|pemasang|kontraktor/i;
const promotion = /we\s+(?:offer|supply|install|provide)|our\s+(?:service|product|team)|contact\s+us|pm\s+(?:us|me)\s+for|kami\s+(?:menyediakan|menjual)|欢迎(?:咨询|下单)|本公司|促销|出售|厂家直销/i;
const places = ['Bukit Mertajam', 'Simpang Ampat', 'Seberang Jaya', 'Butterworth', 'Bayan Lepas', 'George Town', 'Georgetown', 'Perai', 'Penang', 'Pulau Pinang', 'Kuala Lumpur', 'Selangor', 'Johor Bahru', 'Ipoh', '槟城', '大山脚', '北海'];

export function assessPastedLead(input) {
  const text = String(input.text || '').trim();
  const source = String(input.url || '').trim();
  const area = String(input.area || '').trim();
  if (text.length > 5000 || area.length > 160) throw new Error('文字最多 5000 字，Area 最多 160 字。');
  if (source && !safeSourceUrl(source)) throw new Error('帖子 URL 必须是 http:// 或 https:// 链接。');
  if (!text) throw new Error('请粘贴帖子文字；系统不会读取 URL 中的网页内容。');
  const foundArea = area || places.find(place => text.toLowerCase().includes(place.toLowerCase())) || '';
  const product = screen.test(text);
  const buyer = text.split(/[\n.。！？!?;；]+/).some(sentence => screen.test(sentence) && request.test(sentence));
  const seller = promotion.test(text);
  const seeking = product && buyer && !seller && supplier.test(text);
  const classification = product && buyer && !seller ? (seeking ? 'hot' : 'warm') : 'ignore';
  const demandType = classification === 'ignore' ? '' : /报价|询价|quotation|\bquote\b|sebut\s+harga/i.test(text) ? 'quotation_request'
    : /供应商|厂家|supplier|vendor|contractor|kontraktor/i.test(text) ? 'supplier_search'
      : /安装|师傅|install|pemasang|pasang/i.test(text) ? 'screen_installation' : 'screen_purchase';
  const reason = seller ? '文字像商家推广，无法确认买家需求。'
    : !product ? '未找到明确的纱窗或防蚊网需求。'
      : !buyer ? '提到了产品，但没有明确的求购或安装意向。'
        : seeking ? '明确需要纱窗，并在寻找供应商、安装者或报价。'
          : '表达了纱窗需求，但未明确要求供应商或报价。';
  return {
    classification, demandType, area: foundArea,
    seekingSupplierQuotation: seeking, reason, sourceUrl: source ? safeSourceUrl(source) : '',
    title: (text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '').slice(0, 120)
      .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, '[number removed]')
  };
}

export function pastedProspect(assessment) {
  return {
    name: assessment.title, area: assessment.area, source_platform: assessment.sourceUrl ? new URL(assessment.sourceUrl).hostname.replace(/^www\./, '') : 'pasted public post',
    source_url: assessment.sourceUrl, intent_type: assessment.demandType, business_category: '',
    public_phone: '', public_whatsapp: '', notes: assessment.reason,
    prospect_type: 'customer', classification: assessment.classification,
    contact_status: 'not_contacted', total_score: 0,
    do_not_contact: false
  };
}
