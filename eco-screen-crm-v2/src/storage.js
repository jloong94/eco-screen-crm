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
  products: "ecoScreenV2.products",
  quotations: "ecoScreenV2.quotations"
};
