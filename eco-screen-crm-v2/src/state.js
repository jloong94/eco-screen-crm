import { identity } from './session.js';
import { defaultCompanySettings, defaultProducts, defaultUsers } from "./data.js";
import { loadJson, loadQuotationCache, saveJson, saveQuotationCache, storageKeys } from "./storage.js";
import { isCloudConfigured, safeSyncWithCloud, saveData, syncToCloud } from "./cloudSync.js";

const orderConversionCollections = [
  "orders",
  "productionJobs",
  "installationJobs",
  "warrantyCards",
  "quotations"
];
const workflowCollections = new Set(orderConversionCollections);

const users = normalizeUsers(loadJson(storageKeys.users, defaultUsers));
const currentUserId = localStorage.getItem(storageKeys.currentUserId) || "";
const currentUser = identity.user;

export const state = {
  language: localStorage.getItem(storageKeys.language) || "zh",
  users,
  currentUser,
  company_id: identity.companyId,
  role: currentUser?.role || "",
  currentPage: localStorage.getItem(storageKeys.page) || "quotation",
  products: normalizeProducts(loadJson(storageKeys.products, defaultProducts)),
  customers: loadJson(storageKeys.customers, []),
  quotations: loadJson(storageKeys.quotations, []),
  orders: loadJson(storageKeys.orders, []),
  adsEntries: loadJson(storageKeys.adsEntries, []),
  productionJobs: loadJson(storageKeys.productionJobs, []),
  installationJobs: loadJson(storageKeys.installationJobs, []),
  warrantyCards: loadJson(storageKeys.warrantyCards, []),
  socialLeads: loadJson(storageKeys.socialLeads, []),
  socialLeadDuplicateCount: Number(localStorage.getItem(storageKeys.socialLeadDuplicateCount) || 0),
  companySettings: normalizeCompanySettings(loadJson(storageKeys.companySettings, defaultCompanySettings)),
  cloud: {
    status: isCloudConfigured() ? "Syncing..." : "Local Mode",
    connected: false,
    lastSyncAt: "",
    lastError: "",
    counts: {}
  },
  currentQuote: null
};

try {
  saveJson(storageKeys.users, state.users);
} catch (error) {
  // A full localStorage cache must not prevent login and a full JSON export.
  state.cloud.status = "Local Cache Full";
  state.cloud.lastError = `Staff cache could not be saved locally: ${error.message || "storage quota exceeded"}`;
}

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

function normalizeCompanySettings(settings) {
  return {
    ...defaultCompanySettings,
    ...(settings || {}),
    id: "company"
  };
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

export async function hydrateQuotationCache() {
  try {
    const cached = await loadQuotationCache();
    // The recovery copy is the completed write when timestamps tie within one millisecond.
    if (cached.length) state.quotations = mergeCurrentWorkflowRows(cached, state.quotations, "quotations");
  } catch {
    // localStorage and read-only cloud hydration remain available.
  }
}

export async function persistQuotationStatusLocally() {
  try {
    saveJson(storageKeys.quotations, state.quotations);
    return { ok: true, cacheFull: false };
  } catch (localError) {
    try {
      await saveQuotationCache(state.quotations);
      return { ok: true, cacheFull: true, reason: localError.message || "Local cache full." };
    } catch (indexedError) {
      return { ok: false, reason: `Browser cache: ${localError.message || "save failed"}; recovery storage: ${indexedError.message || "save failed"}` };
    }
  }
}

export function persistQuotationsLocally() {
  const previousValue = localStorage.getItem(storageKeys.quotations);
  try {
    saveJson(storageKeys.quotations, state.quotations);
    return { ok: true };
  } catch (error) {
    try {
      if (previousValue === null) localStorage.removeItem(storageKeys.quotations);
      else localStorage.setItem(storageKeys.quotations, previousValue);
    } catch {
      // Preserve the original local save error for the caller.
    }
    return { ok: false, reason: error.message || "Local quotation save failed." };
  }
}

export function persistOrders() {
  saveJson(storageKeys.orders, state.orders);
  return syncCollectionNow("orders");
}

export function persistOrderConversionLocally(collections = orderConversionCollections) {
  const selected = orderConversionCollections.filter((collection) => collections.includes(collection));
  const previousValues = new Map(selected.map((collection) => [
    collection,
    localStorage.getItem(storageKeys[collection])
  ]));
  const written = [];
  try {
    selected.forEach((collection) => {
      const serialized = JSON.stringify(state[collection]);
      if (serialized === previousValues.get(collection)) return;
      localStorage.setItem(storageKeys[collection], serialized);
      written.push(collection);
    });
    return { ok: true, savedCollections: written };
  } catch (error) {
    const rollbackFailures = [];
    written.reverse().forEach((collection) => {
      const value = previousValues.get(collection);
      try {
        if (value === null) localStorage.removeItem(storageKeys[collection]);
        else localStorage.setItem(storageKeys[collection], value);
      } catch (rollbackError) {
        rollbackFailures.push(`${collection}: ${rollbackError.message || "rollback failed"}`);
      }
    });
    return { ok: false, reason: error.message || "Local order save failed.", rollbackFailures };
  }
}

export async function syncOrderConversionCollections(collections = orderConversionCollections) {
  if (!isCloudConfigured()) {
    updateCloudStatus({
      status: "Local Mode",
      connected: false,
      lastError: ""
    });
    return { ok: false, localOnly: true, reason: "Local Mode Only", results: [] };
  }
  updateCloudStatus({ status: "Syncing...", connected: false });
  const result = await safeSyncWithCloud(stateSnapshot(), { writeCollections: collections });
  const selectedSnapshot = Object.fromEntries(collections.map((collection) => [collection, result.snapshot?.[collection]]));
  const localCache = result.ok ? applyCloudSnapshot(selectedSnapshot) : { ok: true };
  updateCloudStatus(result.ok
    ? {
      status: localCache.ok ? "Cloud Synced" : "Cloud Synced (local cache full)",
      connected: true,
      lastSyncAt: new Date().toISOString(),
      lastError: localCache.ok ? "" : localCache.reason,
      counts: result.summary?.cloudCounts || {}
    }
    : {
      status: "Cloud Sync Failed",
      connected: false,
      lastError: result.reason || "Cloud sync failed.",
      counts: result.summary?.cloudCounts || {}
    });
  return {
    ok: result.ok,
    localCacheOk: localCache.ok,
    localCacheError: localCache.reason || "",
    localOnly: false,
    reason: result.reason || "",
    results: collections.map((collection) => ({ collection, ok: result.ok, reason: result.reason || "" })),
    summary: result.summary
  };
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

export function persistSocialLeads() {
  saveJson(storageKeys.socialLeads, state.socialLeads);
  localStorage.setItem(storageKeys.socialLeadDuplicateCount, String(Number(state.socialLeadDuplicateCount || 0)));
  return syncCollectionNow("socialLeads");
}

export function persistUsers() {
  saveJson(storageKeys.users, state.users);
  return syncCollectionNow("users");
}

export function persistCompanySettings() {
  state.companySettings = normalizeCompanySettings({
    ...state.companySettings,
    updatedAt: new Date().toISOString()
  });
  saveJson(storageKeys.companySettings, state.companySettings);
  return syncCollectionNow("companySettings");
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

export function nextQuoteNumber(rows = state.quotations, date = new Date()) {
  const year = date.getFullYear();
  const expression = new RegExp(`^ESQ-${year}-(\\d+)$`, "i");
  const used = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    [row?.quoteNumber, row?.quotationNo, row?.quoteNo].forEach((value) => {
      const match = String(value || "").trim().match(expression);
      if (match) used.add(Number(match[1]));
    });
  });
  let sequence = used.size ? Math.max(...used) + 1 : 1;
  while (used.has(sequence)) sequence += 1;
  return `ESQ-${year}-${String(sequence).padStart(4, "0")}`;
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
    projectName: "",
    siteAddress: "",
    customer: {
      name: "",
      phone: "",
      area: "",
      address: "",
      remark: ""
    },
    appointmentDate: today(),
    status: "quoted",
    workflowStatus: "quoted",
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
    color: "white",
    trackType: "Single Track",
    trackOpening: "",
    meshType: "Other / To Confirm",
    meshMaterial: "",
    installType: "Not sure / To confirm",
    trackSize: "",
    handleHeight: "",
    installationLocation: "",
    openingDirection: "close_left",
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
    warrantyCards: state.warrantyCards,
    socialLeads: state.socialLeads,
    companySettings: [state.companySettings]
  };
}

export function applyCloudSnapshot(snapshot = {}) {
  const failures = [
    applyCollection("users", snapshot.users, normalizeUsers),
    applyCollection("products", snapshot.products, normalizeProducts),
    ...["customers", "quotations", "orders", "adsEntries", "productionJobs", "installationJobs", "warrantyCards", "socialLeads"]
      .map((collection) => applyCollection(collection, snapshot[collection])),
    applyCompanySettings(snapshot.companySettings)
  ].filter(Boolean);
  return failures.length ? { ok: false, reason: `Cloud data loaded, but local cache could not save: ${failures.join("; ")}` } : { ok: true, reason: "" };
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
  state.socialLeads = Array.isArray(snapshot.socialLeads) ? snapshot.socialLeads : [];
  state.companySettings = normalizeCompanySettings(Array.isArray(snapshot.companySettings) ? snapshot.companySettings[0] : snapshot.companySettings);
  persistLocalSnapshot();
}

export async function syncCollectionNow(collection) {
  if (!isCloudConfigured()) {
    updateCloudStatus({
      status: "Local Mode",
      connected: false,
      lastError: ""
    });
    return { ok: false, reason: "Local Mode Only" };
  }
  updateCloudStatus({ status: "Syncing...", connected: false });
  const result = await saveData(collection, stateSnapshot()[collection] || [], { localSnapshot: stateSnapshot() });
  if (result.ok) {
    const localCacheError = applyCollection(collection, result.data);
    updateCloudStatus({
      status: localCacheError ? "Cloud Synced (local cache full)" : "Cloud Synced",
      connected: true,
      lastSyncAt: result.syncedAt || new Date().toISOString(),
      lastError: localCacheError || "",
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
  return result.ok ? { ...result, localCacheError: state.cloud.lastError } : result;
}

let cloudSyncTimer = null;

export function queueCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    syncToCloud(stateSnapshot()).then((result) => {
      if (result.ok) applyCloudSnapshot(result.snapshot || {});
      updateCloudStatus(result.ok
        ? {
          status: "Cloud Synced",
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
  const rows = workflowCollections.has(collection)
    ? mergeCurrentWorkflowRows(localRows, incoming, collection)
    : incoming;
  const nextRows = normalizer ? normalizer(rows) : rows;
  const serialized = JSON.stringify(nextRows);
  state[collection] = nextRows;
  try {
    if (localStorage.getItem(storageKeys[collection]) !== serialized) localStorage.setItem(storageKeys[collection], serialized);
  } catch (error) {
    return `${collection}: ${error.message || "storage quota exceeded"}`;
  }
}

function mergeCurrentWorkflowRows(localRows, incomingRows, collection) {
  const rows = new Map();
  incomingRows.forEach((row) => rows.set(workflowRowKey(row, collection), row));
  localRows.forEach((row) => {
    const key = workflowRowKey(row, collection);
    const incoming = rows.get(key);
    if (!incoming || preferLocalWorkflowRow(row, incoming)) rows.set(key, row);
  });
  return [...rows.values()];
}

function workflowRowKey(row = {}, collection = "workflow") {
  return row.id
    ? `${collection}:id:${row.id}`
    : `${collection}:missing-stable-id:${JSON.stringify(row)}`;
}

function preferLocalWorkflowRow(local, incoming) {
  const localTime = workflowRowTime(local);
  const incomingTime = workflowRowTime(incoming);
  if (Number.isFinite(localTime) && Number.isFinite(incomingTime)) return localTime >= incomingTime;
  if (Number.isFinite(localTime)) return true;
  if (Number.isFinite(incomingTime)) return false;
  return true;
}

function workflowRowTime(row = {}) {
  const value = Date.parse(row.updatedAt || row.createdAt || row.updated_at || row.created_at || "");
  return Number.isFinite(value) ? value : NaN;
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
  saveJson(storageKeys.socialLeads, state.socialLeads);
  localStorage.setItem(storageKeys.socialLeadDuplicateCount, String(Number(state.socialLeadDuplicateCount || 0)));
  saveJson(storageKeys.companySettings, state.companySettings);
}

function applyCompanySettings(incoming) {
  const settings = Array.isArray(incoming) ? incoming[0] : incoming;
  if (!settings || typeof settings !== "object") return;
  state.companySettings = normalizeCompanySettings(settings);
  const serialized = JSON.stringify(state.companySettings);
  try {
    if (localStorage.getItem(storageKeys.companySettings) !== serialized) localStorage.setItem(storageKeys.companySettings, serialized);
  } catch (error) {
    return `companySettings: ${error.message || "storage quota exceeded"}`;
  }
}
