import { database, fail, handleError, isAdmin, mutationGuard, reply, requireStaff } from './_lib/staff-auth.js';
import { itemWithCalculatedTotals, quoteTotals } from '../src/calculations.js';

const expectedQuotes = new Map([
  ['quote-1792555162804-9f4453838cb178', '2026-11-09T05:57:06.900Z'],
  ['quote-1793589745758-1fb0abc98d499', '2026-11-07T07:12:58.709Z'],
  ['quote-1793770567918-dfb44114b6332', '2026-11-06T03:02:05.378Z'],
  ['quote-1793936617720-ac2cca1ab432d8', '2026-11-06T10:04:35.562Z'],
  ['quote-1794018793718-0b984476e6e1d8', '2026-11-07T02:43:10.202Z'],
  ['quote-1794286288023-fe50d50cb18f3', '2026-11-10T07:45:57.467Z']
]);

export function buildHollowCorrection(quotations, now = new Date().toISOString()) {
  if (!Array.isArray(quotations)) fail(409, 'Quotation data is unavailable.');
  const selected = quotations.filter((quote) => expectedQuotes.has(quote.id));
  if (selected.length !== expectedQuotes.size || new Set(selected.map((quote) => quote.id)).size !== expectedQuotes.size) {
    fail(409, 'The six quotation IDs changed. No data was updated.');
  }
  const unexpectedLegacy = quotations.some((quote) => !expectedQuotes.has(quote.id)
    && quote.items?.some((item) => item.hollowProductId && item.hollowPricingUnit !== 'piece'));
  if (unexpectedLegacy) fail(409, 'A new legacy Hollow quote appeared. No data was updated.');

  const summary = [];
  const updated = quotations.map((quote) => {
    if (!expectedQuotes.has(quote.id)) return quote;
    const hollowItems = quote.items?.filter((item) => item.hollowProductId) || [];
    if (quote.updatedAt !== expectedQuotes.get(quote.id) || !hollowItems.length
      || hollowItems.some((item) => item.hollowPricingUnit === 'piece' || !Number(item.hollowRate))
      || quote.orderId || quote.linkedOrderId || quote.orderNo || quote.orderNumber || quote.converted || quote.convertedToOrder) {
      fail(409, 'A selected quotation changed or has an Order. No data was updated.');
    }
    const before = quoteTotals(quote.items, quote.discount, quote.deposit);
    if (['subtotal', 'total', 'balance'].some((field) => Math.abs(Number(quote[field] || 0) - before[field]) > 0.011)) {
      fail(409, 'A selected quotation total does not match the saved items. No data was updated.');
    }
    const items = quote.items.map((item) => item.hollowProductId
      ? itemWithCalculatedTotals({ ...item, hollowPricingUnit: 'piece' })
      : item);
    const after = quoteTotals(items, quote.discount, quote.deposit);
    summary.push({ id: quote.id, quoteNumber: quote.quoteNumber || quote.quotationNo || quote.quoteNo,
      hollowItems: hollowItems.length, before: before.total, after: after.total });
    return { ...quote, items, subtotal: after.subtotal, total: after.total, balance: after.balance, updatedAt: now };
  });
  if (summary.reduce((count, row) => count + row.hollowItems, 0) !== 8) {
    fail(409, 'The Hollow item count changed. No data was updated.');
  }
  return { updated, summary };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    mutationGuard(req);
    const db = database();
    const { user, companyId } = await requireStaff(req, db);
    if (!isAdmin(user.role)) fail(403, 'Boss or Admin access required.');
    const { data: row, error: readError } = await db.from('crm_v2_sync')
      .select('data,updated_at').eq('company_id', companyId).eq('collection', 'quotations').single();
    if (readError || !row) fail(503, 'Could not read current quotations.');
    const now = new Date().toISOString();
    const { updated, summary } = buildHollowCorrection(row.data, now);
    const { data: saved, error: writeError } = await db.from('crm_v2_sync')
      .update({ data: updated, updated_at: now })
      .eq('company_id', companyId).eq('collection', 'quotations').eq('updated_at', row.updated_at)
      .select('updated_at');
    if (writeError) throw writeError;
    if (saved?.length !== 1) fail(409, 'Quotations changed during correction. No data was updated.');
    return reply(res, 200, { ok: true, summary });
  } catch (error) { handleError(res, error); }
}
