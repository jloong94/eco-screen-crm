import { defaultProducts } from "./data.js";
import { loadJson, saveJson, storageKeys } from "./storage.js";

export const state = {
  role: localStorage.getItem(storageKeys.role) || "Admin",
  currentPage: "quotation",
  products: loadJson(storageKeys.products, defaultProducts),
  quotations: loadJson(storageKeys.quotations, []),
  currentQuote: null
};

export function persistProducts() {
  saveJson(storageKeys.products, state.products);
}

export function persistQuotations() {
  saveJson(storageKeys.quotations, state.quotations);
}

export function setRole(role) {
  state.role = role;
  localStorage.setItem(storageKeys.role, role);
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nextQuoteNumber() {
  const year = new Date().getFullYear();
  const next = state.quotations
    .map((quote) => quote.quoteNumber)
    .filter((number) => number && number.startsWith(`ESQ-${year}-`))
    .map((number) => Number(number.split("-").pop()))
    .filter(Number.isFinite)
    .reduce((max, number) => Math.max(max, number), 0) + 1;
  return `ESQ-${year}-${String(next).padStart(4, "0")}`;
}

export function activeProducts() {
  return state.products.filter((product) => product.active !== false);
}

export function productById(id) {
  return state.products.find((product) => product.id === id) || activeProducts()[0] || state.products[0];
}

export function makeQuote() {
  return {
    id: uid("quote"),
    quoteNumber: nextQuoteNumber(),
    customer: {
      name: "",
      phone: "",
      area: "",
      address: "",
      remark: ""
    },
    appointmentDate: today(),
    status: "Draft",
    remark: "",
    items: [],
    discount: 0,
    deposit: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function makeQuoteItem(productId) {
  const product = productById(productId || activeProducts()[0]?.id);
  return {
    id: uid("item"),
    productId: product.id,
    productName: product.name,
    category: product.category,
    calculationType: product.calculationType || "sqft",
    minimumSqft: Number(product.minimumSqft || 0),
    unitPrice: Number(product.sellingPrice || 0),
    width: "",
    height: "",
    quantity: "1",
    color: "",
    handlePosition: "",
    trackOpening: "",
    meshMaterial: "",
    remark: "",
    createdAt: Date.now()
  };
}

export function ensureCurrentQuote() {
  if (!state.currentQuote) state.currentQuote = makeQuote();
  return state.currentQuote;
}
