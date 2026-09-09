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
  localStorage.setItem(key, JSON.stringify(value));
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
  [key, key === 'language' ? value : value + '.' + (identity.companyId || 'signed-out')]));
