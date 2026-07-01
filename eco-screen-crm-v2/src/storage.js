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

export const storageKeys = {
  role: "ecoScreenV2.role",
  page: "ecoScreenV2.page",
  language: "ecoScreenV2.language",
  users: "ecoScreenV2.users",
  currentUserId: "ecoScreenV2.currentUserId",
  products: "ecoScreenV2.products",
  customers: "ecoScreenV2.customers",
  quotations: "ecoScreenV2.quotations",
  orders: "ecoScreenV2.orders",
  productionJobs: "ecoScreenV2.productionJobs",
  installationJobs: "ecoScreenV2.installationJobs",
  warrantyCards: "ecoScreenV2.warrantyCards"
};
