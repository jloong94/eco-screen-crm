import { defaultProducts } from "./data.js";
import { loadJson, saveJson, storageKeys } from "./storage.js";

export const state = {
  role: localStorage.getItem(storageKeys.role) || "Admin",
  currentPage: localStorage.getItem(storageKeys.page) || "quotation",
  products: normalizeProducts(loadJson(storageKeys.products, defaultProducts)),
  quotations: loadJson(storageKeys.quotations, []),
  orders: loadJson(storageKeys.orders, []),
  productionJobs: loadJson(storageKeys.productionJobs, []),
  installationJobs: loadJson(storageKeys.installationJobs, []),
  warrantyCards: loadJson(storageKeys.warrantyCards, []),
  currentQuote: null
};

function normalizeProducts(products) {
  const renameMap = {
    "sliding-screen": "Sliding Stainless Steel Net Window",
    "sliding-door": "Sliding Security Mesh Door",
    "security-mesh-window": "Hinged Security Mesh Window",
    "security-mesh-door": "Hinged Security Mesh Door"
  };
  const normalized = products.map((product) => {
    const defaultProduct = defaultProducts.find((row) => row.id === product.id) || {};
    return {
      ...defaultProduct,
      ...product,
      name: renameMap[product.id] || product.name || defaultProduct.name
    };
  });
  defaultProducts.forEach((product) => {
    if (!normalized.some((row) => row.id === product.id)) normalized.push({ ...product });
  });
  return normalized;
}

export function persistProducts() {
  saveJson(storageKeys.products, state.products);
}

export function persistQuotations() {
  saveJson(storageKeys.quotations, state.quotations);
}

export function persistOrders() {
  saveJson(storageKeys.orders, state.orders);
}

export function persistProductionJobs() {
  saveJson(storageKeys.productionJobs, state.productionJobs);
}

export function persistInstallationJobs() {
  saveJson(storageKeys.installationJobs, state.installationJobs);
}

export function persistWarrantyCards() {
  saveJson(storageKeys.warrantyCards, state.warrantyCards);
}

export function setRole(role) {
  state.role = role;
  localStorage.setItem(storageKeys.role, role);
}

export function setPage(page) {
  state.currentPage = page;
  localStorage.setItem(storageKeys.page, page);
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nextQuoteNumber() {
  return nextNumber("ESQ", state.quotations, "quoteNumber");
}

export function nextOrderNumber() {
  return nextNumber("ESO", state.orders, "orderNumber");
}

export function nextProductionNumber() {
  return nextNumber("ESP", state.productionJobs, "productionNumber");
}

export function nextInstallationNumber() {
  return nextNumber("ESI", state.installationJobs, "installationNumber");
}

export function nextWarrantyNumber() {
  return nextNumber("WTY", state.warrantyCards, "warrantyNo");
}

function nextNumber(prefix, rows, field) {
  const year = new Date().getFullYear();
  const next = rows
    .map((row) => row[field])
    .filter((number) => number && number.startsWith(`${prefix}-${year}-`))
    .map((number) => Number(number.split("-").pop()))
    .filter(Number.isFinite)
    .reduce((max, number) => Math.max(max, number), 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
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
    installType: "Not sure / To confirm",
    trackSize: "",
    handleHeight: "",
    installationLocation: "",
    openingDirection: "",
    powdercoat: false,
    powdercoatRate: 0.08,
    powdercoatAmount: 0,
    baseLineTotal: 0,
    lineTotal: 0,
    remark: "",
    createdAt: Date.now()
  };
}

export function ensureCurrentQuote() {
  if (!state.currentQuote) state.currentQuote = makeQuote();
  return state.currentQuote;
}
