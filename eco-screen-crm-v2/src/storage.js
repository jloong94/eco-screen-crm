import { identity } from './session.js';
export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  const serialized = JSON.stringify(value);
  if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
}

// Replaceable IndexedDB snapshots protect workflow changes when the browser's
// small localStorage cache is full. Never clear either store here.
function recoveryCacheDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable.")); return; }
    const request = indexedDB.open("eco-screen-crm-v2-quotation-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB could not open."));
  });
}

export async function saveQuotationCache(rows) {
  const db = await recoveryCacheDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put(rows, storageKeys.quotations);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB quotation save failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB quotation save aborted."));
    });
  } finally { db.close(); }
}

export async function loadQuotationCache() {
  const db = await recoveryCacheDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readonly");
      const request = transaction.objectStore("snapshots").get(storageKeys.quotations);
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("IndexedDB quotation read failed."));
    });
  } finally { db.close(); }
}

function orderConversionCacheKey() {
  return `${storageKeys.orders}:order-conversion`;
}

export async function saveOrderConversionCache(snapshot) {
  const db = await recoveryCacheDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put(snapshot, orderConversionCacheKey());
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB order conversion save failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB order conversion save aborted."));
    });
  } finally { db.close(); }
}

export async function loadOrderConversionCache() {
  const db = await recoveryCacheDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readonly");
      const request = transaction.objectStore("snapshots").get(orderConversionCacheKey());
      request.onsuccess = () => resolve(request.result && typeof request.result === "object" ? request.result : {});
      request.onerror = () => reject(request.error || new Error("IndexedDB order conversion read failed."));
    });
  } finally { db.close(); }
}

const baseKeys = {
  role: "ecoScreenV2.role",
  page: "ecoScreenV2.page",
  language: "ecoScreenV2.language",
  users: "ecoScreenV2.users",
  currentUserId: "ecoScreenV2.currentUserId",
  products: "ecoScreenV2.products",
  customers: "ecoScreenV2.customers",
  quotations: "ecoScreenV2.quotations",
  orders: "ecoScreenV2.orders",
  adsEntries: "ecoScreenV2.adsEntries",
  productionJobs: "ecoScreenV2.productionJobs",
  installationJobs: "ecoScreenV2.installationJobs",
  warrantyCards: "ecoScreenV2.warrantyCards",
  socialLeads: "ecoScreenV2.socialLeads",
  socialLeadDuplicateCount: "ecoScreenV2.socialLeadDuplicateCount",
  companySettings: "ecoScreenV2.companySettings"
};

// Never read unscoped legacy records into a signed-in company.
export const storageKeys = Object.fromEntries(Object.entries(baseKeys).map(([key, value]) =>
  [key, key === 'language' ? value : value + '.' + (identity.companyId || 'signed-out') + '.' + (identity.user?.userId || 'anonymous')]));
