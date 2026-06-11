import { Order, Product, Quote, QuoteItem, QuoteStatus } from "./types";

export const MM2_PER_SQFT = 92903.04;

export const defaultProducts: Product[] = [
  { id: "roller", name: "Roller", price: 33, minimumSqft: 11 },
  { id: "three-section-screen", name: "3 Section Screen", price: 0, minimumSqft: 11 },
  { id: "pocket-lock-screen", name: "Pocket Lock Screen", price: 50, minimumSqft: 11 },
  { id: "roller-door", name: "Roller Door", price: 41, minimumSqft: 21 },
  {
    id: "sliding-stainless-steel-net",
    name: "Sliding Stainless Steel Net",
    price: 55,
    minimumSqft: 21,
  },
  { id: "magnetic-screen", name: "Magnetic Screen", price: 10, minimumSqft: 11 },
  { id: "security-mesh-window", name: "Security Mesh Window", price: 90, minimumSqft: 11 },
  { id: "security-mesh-door", name: "Security Mesh Door", price: 100, minimumSqft: 21 },
  { id: "with-grill", name: "With Grill", price: 13, minimumSqft: 11 },
  { id: "opening", name: "Opening", price: 35, minimumSqft: 11 },
  { id: "digital-lock", name: "Digital Lock", price: 0, minimumSqft: 21 },
];

export const quoteStatuses: { value: QuoteStatus; label: string }[] = [
  { value: "quoted", label: "Quoted" },
  { value: "follow-up", label: "Follow Up" },
  { value: "won", label: "Won" },
  { value: "cancelled", label: "Cancelled" },
];

export function makeItem(): QuoteItem {
  return {
    id: crypto.randomUUID(),
    label: "",
    productId: defaultProducts[0].id,
    widthMm: 0,
    heightMm: 0,
    quantity: 1,
  };
}

export function formatRM(value: number) {
  return `RM ${value.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function actualSqft(item: QuoteItem) {
  if (!item.widthMm || !item.heightMm) return 0;
  return (item.widthMm * item.heightMm) / MM2_PER_SQFT;
}

export function chargeableSqft(item: QuoteItem, product?: Product) {
  const sqft = actualSqft(item);
  return Math.max(sqft, product?.minimumSqft ?? 0);
}

export function itemTotal(item: QuoteItem, product?: Product) {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  return chargeableSqft(item, product) * (product?.price ?? 0) * quantity;
}

export function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function makeQuoteNo(existingQuotes: Quote[], date = new Date()) {
  const year = date.getFullYear();
  const nextNumber =
    existingQuotes
      .map((quote) => quote.quoteNo)
      .filter((quoteNo) => quoteNo?.startsWith(`ESQ-${year}-`))
      .map((quoteNo) => Number(quoteNo.split("-").at(-1)))
      .filter((number) => Number.isFinite(number))
      .reduce((max, number) => Math.max(max, number), 0) + 1;

  return `ESQ-${year}-${String(nextNumber).padStart(4, "0")}`;
}

export function makeOrderNo(existingOrders: Order[], date = new Date()) {
  const year = date.getFullYear();
  const nextNumber =
    existingOrders
      .map((order) => order.orderNo)
      .filter((orderNo) => orderNo?.startsWith(`ESO-${year}-`))
      .map((orderNo) => Number(orderNo.split("-").at(-1)))
      .filter((number) => Number.isFinite(number))
      .reduce((max, number) => Math.max(max, number), 0) + 1;

  return `ESO-${year}-${String(nextNumber).padStart(4, "0")}`;
}
