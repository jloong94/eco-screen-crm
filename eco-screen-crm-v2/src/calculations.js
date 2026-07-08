export const MM2_PER_SQFT = 92903.04;

export function toNumber(value) {
  const number = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function money(value) {
  return `RM ${Number(value || 0).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function actualSqft(item) {
  return toNumber(item.width) && toNumber(item.height)
    ? toNumber(item.width) * toNumber(item.height) / MM2_PER_SQFT
    : 0;
}

export function chargeableSqft(item) {
  return Math.max(actualSqft(item), toNumber(item.minimumSqft));
}

export function baseLineTotal(item) {
  const qty = toNumber(item.quantity);
  const price = toNumber(item.unitPrice);
  if (item.calculationType === "fixed") return price * qty;
  return chargeableSqft(item) * price * qty;
}

export function isPowdercoatSelected(item) {
  return item.powdercoat === true || item.powdercoat === "true" || item.powdercoat === "Yes";
}

export function powdercoatAmount(item) {
  return isPowdercoatSelected(item) ? baseLineTotal(item) * toNumber(item.powdercoatRate || 0.08) : 0;
}

export function autoCalculatedPrice(item) {
  return baseLineTotal(item) + powdercoatAmount(item);
}

export function hasManualFinalPrice(item) {
  return String(item.manualFinalPrice ?? "").trim() !== "";
}

export function lineTotal(item) {
  return hasManualFinalPrice(item) ? toNumber(item.manualFinalPrice) : autoCalculatedPrice(item);
}

export function itemWithCalculatedTotals(item) {
  const base = baseLineTotal(item);
  const powdercoat = powdercoatAmount(item);
  const autoPrice = base + powdercoat;
  return {
    ...item,
    powdercoat: isPowdercoatSelected(item),
    powdercoatRate: toNumber(item.powdercoatRate || 0.08),
    baseLineTotal: base,
    powdercoatAmount: powdercoat,
    autoCalculatedPrice: autoPrice,
    manualFinalPrice: item.manualFinalPrice ?? "",
    priceAdjustmentRemark: item.priceAdjustmentRemark || "",
    lineTotal: hasManualFinalPrice(item) ? toNumber(item.manualFinalPrice) : autoPrice
  };
}

export function quoteSubtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function quoteTotals(items, discount, deposit) {
  const subtotal = quoteSubtotal(items);
  const total = Math.max(subtotal - toNumber(discount), 0);
  const balance = Math.max(total - toNumber(deposit), 0);
  return { subtotal, total, balance };
}
