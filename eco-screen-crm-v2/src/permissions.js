import { state } from "./state.js";

export const pageDefinitions = [
  { id: "dashboard", label: "Dashboard", title: "Dashboard" },
  { id: "quotation", label: "Quotation", title: "Quotation" },
  { id: "customers", label: "Customers", title: "Customers" },
  { id: "orders", label: "Orders", title: "Orders" },
  { id: "ads", label: "Marketing / Ads", title: "Marketing / Ads Tracker" },
  { id: "production", label: "Production", title: "Production Jobs" },
  { id: "installation", label: "Installation", title: "Installation Jobs" },
  { id: "products", label: "Product Management / Settings", title: "Product Management" },
  { id: "users", label: "Staff Management", title: "Staff Management" }
];

export const rolePages = {
  Boss: pageDefinitions.map((page) => page.id),
  Admin: pageDefinitions.map((page) => page.id),
  Secretary: ["dashboard", "orders", "quotation", "customers", "ads", "production", "installation"],
  Sales: ["quotation", "customers", "orders", "ads"],
  Production: ["production"],
  Installer: ["installation"]
};

export const defaultPages = {
  Boss: "dashboard",
  Admin: "dashboard",
  Secretary: "dashboard",
  Sales: "quotation",
  Production: "production",
  Installer: "installation"
};

export function role() {
  return state.currentUser?.role || state.role || "";
}

export function isBossOrAdmin(userRole = role()) {
  return ["Boss", "Admin"].includes(userRole);
}

export function canAccessPage(userRole, page) {
  return (rolePages[userRole] || []).includes(page);
}

export function defaultPageForRole(userRole) {
  return defaultPages[userRole] || "quotation";
}

export function canManageProducts() {
  return isBossOrAdmin();
}

export function canManageUsers() {
  return isBossOrAdmin();
}

export function canDeleteOrders() {
  return isBossOrAdmin();
}

export function canEditOrder() {
  return isBossOrAdmin() || role() === "Secretary";
}

export function canSendOrder() {
  return isBossOrAdmin() || ["Secretary", "Sales"].includes(role());
}

export function canEditProduction() {
  return isBossOrAdmin() || role() === "Production";
}

export function canViewProduction() {
  return canAccessPage(role(), "production");
}

export function canEditInstallation() {
  return isBossOrAdmin() || role() === "Installer";
}

export function canScheduleInstallation() {
  return isBossOrAdmin() || ["Secretary", "Installer"].includes(role());
}

export function canCompleteInstallation() {
  return isBossOrAdmin() || role() === "Installer";
}

export function canViewPrice() {
  return !["Production"].includes(role());
}

export function canViewCost() {
  return isBossOrAdmin();
}
