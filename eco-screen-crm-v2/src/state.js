import { defaultProducts, defaultUsers } from "./data.js";
import { loadJson, saveJson, storageKeys } from "./storage.js";
import { isCloudConfigured, saveData, syncToCloud } from "./cloudSync.js";

const users = normalizeUsers(loadJson(storageKeys.users, defaultUsers));
const currentUserId = localStorage.getItem(storageKeys.currentUserId) || "";
const currentUser = users.find((user) => user.userId === currentUserId && user.active !== false) || null;

export const state = {
  language: localStorage.getItem(storageKeys.language) || "en",
  users,
  currentUser,
  role: currentUser?.role || localStorage.getItem(storageKeys.role) || "",
  currentPage: localStorage.getItem(storageKeys.page) || "quotation",
  products: normalizeProducts(loadJson(storageKeys.products, defaultProducts)),
  customers: loadJson(storageKeys.customers, []),
  quotations: loadJson(storageKeys.quotations, []),
  orders: loadJson(storageKeys.orders, []),
  adsEntries: loadJson(storageKeys.adsEntries, []),
  productionJobs: loadJson(storageKeys.productionJobs, []),
  installationJobs: loadJson(storageKeys.installationJobs, []),
  warrantyCards: loadJson(storageKeys.warrantyCards, []),
  cloud: {
    status: isCloudConfigured() ? "Checking cloud..." : "Local Mode Only",
    connected: false,
    lastSyncAt: "",
    lastError: "",
    counts: {}
  },
  currentQuote: null
};

saveJson(storageKeys.users, state.users);

function normalizeUsers(users) {
  const rows = Array.isArray(users) ? users : [];
  const merged = [...rows];
  defaultUsers.forEach((user) => {
    if (!merged.some((row) => row.username === user.username || row.userId === user.userId)) merged.push({ ...user });
  });
  return merged.map((user) => ({
    ...user,
    userId: user.userId || uid("user"),
    active: user.active !== false
  }));
}

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
  syncCollectionNow("products");
}

export function persistCustomers() {
  saveJson(storageKeys.customers, state.customers);
  syncCollectionNow("customers");
}

export function persistQuotations() {
  saveJson(storageKeys.quotations, state.quotations);
  return syncCollectionNow("quotations");
}

export function persistOrders() {
  saveJson(storageKeys.orders, state.orders);
  return syncCollectionNow("orders");
}

export function persistAdsEntries() {
  saveJson(storageKeys.adsEntries, state.adsEntries);
  syncCollectionNow("adsEntries");
}

export function persistProductionJobs() {
  saveJson(storageKeys.productionJobs, state.productionJobs);
  return syncCollectionNow("productionJobs");
}

export function persistInstallationJobs() {
  saveJson(storageKeys.installationJobs, state.installationJobs);
  return syncCollectionNow("installationJobs");
}

export function persistWarrantyCards() {
  saveJson(storageKeys.warrantyCards, state.warrantyCards);
  return syncCollectionNow("warrantyCards");
}

export function persistUsers() {
  saveJson(storageKeys.users, state.users);
  return syncCollectionNow("users");
}

export function setLanguage(language) {
  state.language = language === "zh" ? "zh" : "en";
  localStorage.setItem(storageKeys.language, state.language);
}

export function setCurrentUser(user) {
  state.currentUser = user;
  state.role = user?.role || "";
  if (user) {
    localStorage.setItem(storageKeys.currentUserId, user.userId);
    localStorage.setItem(storageKeys.role, user.role);
  } else {
    localStorage.removeItem(storageKeys.currentUserId);
    localStorage.removeItem(storageKeys.role);
  }
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
    status: "quoted",
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
    handlePosition: "Left",
    trackType: "Single Track",
    trackOpening: "",
    meshType: "Other / To Confirm",
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

export function stateSnapshot() {
  return {
    users: state.users,
    customers: state.customers,
    products: state.products,
    quotations: state.quotations,
    orders: state.orders,
    adsEntries: state.adsEntries,
    productionJobs: state.productionJobs,
    installationJobs: state.installationJobs,
    warrantyCards: state.warrantyCards
  };
}

export function applyCloudSnapshot(snapshot = {}) {
  applyCollection("users", snapshot.users, normalizeUsers);
  applyCollection("products", snapshot.products, normalizeProducts);
  applyCollection("customers", snapshot.customers);
  applyCollection("quotations", snapshot.quotations);
  applyCollection("orders", snapshot.orders);
  applyCollection("adsEntries", snapshot.adsEntries);
  applyCollection("productionJobs", snapshot.productionJobs);
  applyCollection("installationJobs", snapshot.installationJobs);
  applyCollection("warrantyCards", snapshot.warrantyCards);
}

export function replaceStateFromBackup(snapshot = {}) {
  state.users = normalizeUsers(Array.isArray(snapshot.users) ? snapshot.users : []);
  state.products = normalizeProducts(Array.isArray(snapshot.products) ? snapshot.products : []);
  state.customers = Array.isArray(snapshot.customers) ? snapshot.customers : [];
  state.quotations = Array.isArray(snapshot.quotations) ? snapshot.quotations : [];
  state.orders = Array.isArray(snapshot.orders) ? snapshot.orders : [];
  state.adsEntries = Array.isArray(snapshot.adsEntries) ? snapshot.adsEntries : [];
  state.productionJobs = Array.isArray(snapshot.productionJobs) ? snapshot.productionJobs : [];
  state.installationJobs = Array.isArray(snapshot.installationJobs) ? snapshot.installationJobs : [];
  state.warrantyCards = Array.isArray(snapshot.warrantyCards) ? snapshot.warrantyCards : [];
  persistLocalSnapshot();
}

export async function syncCollectionNow(collection) {
  if (!isCloudConfigured()) {
    updateCloudStatus({
      status: "Local Mode Only",
      connected: false,
      lastError: ""
    });
    return { ok: false, reason: "Local Mode Only" };
  }
  const result = await saveData(collection, stateSnapshot()[collection] || []);
  if (result.ok) {
    updateCloudStatus({
      status: "Cloud Connected",
      connected: true,
      lastSyncAt: result.syncedAt || new Date().toISOString(),
      lastError: "",
      counts: {
        ...state.cloud.counts,
        [collection]: stateSnapshot()[collection]?.length || 0
      }
    });
  } else {
    updateCloudStatus({
      status: "Cloud Sync Failed",
      connected: false,
      lastError: result.reason || "Cloud sync failed."
    });
  }
  return result;
}

let cloudSyncTimer = null;

export function queueCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    syncToCloud(stateSnapshot()).then((result) => {
      updateCloudStatus(result.ok
        ? {
          status: "Cloud Connected",
          connected: true,
          lastSyncAt: result.syncedAt || new Date().toISOString(),
          lastError: ""
        }
        : {
          status: "Cloud Sync Failed",
          connected: false,
          lastError: result.reason || "Cloud sync failed."
        });
    });
  }, 800);
}

export function updateCloudStatus(update = {}) {
  state.cloud = {
    ...state.cloud,
    ...update,
    counts: {
      ...state.cloud.counts,
      ...(update.counts || {})
    }
  };
}

function applyCollection(collection, incoming, normalizer) {
  if (!Array.isArray(incoming)) return;
  const localRows = Array.isArray(state[collection]) ? state[collection] : [];
  if (localRows.length > 0 && incoming.length === 0) return;
  state[collection] = normalizer ? normalizer(incoming) : incoming;
  saveJson(storageKeys[collection], state[collection]);
}

function persistLocalSnapshot() {
  saveJson(storageKeys.users, state.users);
  saveJson(storageKeys.products, state.products);
  saveJson(storageKeys.customers, state.customers);
  saveJson(storageKeys.quotations, state.quotations);
  saveJson(storageKeys.orders, state.orders);
  saveJson(storageKeys.adsEntries, state.adsEntries);
  saveJson(storageKeys.productionJobs, state.productionJobs);
  saveJson(storageKeys.installationJobs, state.installationJobs);
  saveJson(storageKeys.warrantyCards, state.warrantyCards);
}
