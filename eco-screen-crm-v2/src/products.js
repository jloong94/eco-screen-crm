import { persistProducts, state, uid } from "./state.js";
import { money, toNumber } from "./calculations.js";
import { t } from "./i18n.js";
import { canManageProducts } from "./permissions.js";

export function renderProducts() {
  const list = document.querySelector("#productList");
  const canEdit = canManageProducts();
  if (!list) return;
  list.innerHTML = state.products.map((product) => `
    <article class="card product-card">
      <div class="card-head">
        <strong>${product.name}</strong>
        <span class="pill ${product.active === false ? "muted" : ""}">${product.active === false ? t("Inactive") : t("Active")}</span>
      </div>
      <div class="form-grid compact">
        <label>${t("Product Name")}<input value="${escapeHtml(product.name)}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="name" /></label>
        <label>${t("Category")}<input value="${escapeHtml(product.category || "")}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="category" /></label>
        <label>${t("Selling Price")}<input inputmode="decimal" value="${product.sellingPrice || 0}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="sellingPrice" /></label>
        ${canEdit ? `<label>${t("Cost Price")}<input inputmode="decimal" value="${product.costPrice || 0}" data-product-id="${product.id}" data-product-field="costPrice" /></label>` : ""}
        <label>${t("Calculation Type")}<select ${canEdit ? "" : "disabled"} data-product-id="${product.id}" data-product-field="calculationType">
          ${["sqft", "fixed"].map((type) => `<option value="${type}" ${product.calculationType === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        <label>${t("Minimum sqft")}<input inputmode="decimal" value="${product.minimumSqft || 0}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="minimumSqft" /></label>
        <label>${t("Status")}<select ${canEdit ? "" : "disabled"} data-product-id="${product.id}" data-product-field="active">
          <option value="true" ${product.active !== false ? "selected" : ""}>${t("Active")}</option>
          <option value="false" ${product.active === false ? "selected" : ""}>${t("Inactive")}</option>
        </select></label>
      </div>
    </article>
  `).join("");
}

export function renderAddProductForm() {
  const panel = document.querySelector("#addProductPanel");
  if (!panel) return;
  if (!canManageProducts()) {
    panel.innerHTML = `<p class="muted-text">${t("Only Boss/Admin can add or edit products.")}</p>`;
    return;
  }
  panel.innerHTML = `
    <div class="form-grid compact">
      <label>${t("Product Name")}<input id="newProductName" placeholder="New product name" /></label>
      <label>${t("Category")}<input id="newProductCategory" placeholder="Window / Door / Sliding" /></label>
      <label>${t("Selling Price")}<input id="newProductPrice" inputmode="decimal" placeholder="0.00" /></label>
      <label>${t("Cost Price")}<input id="newProductCost" inputmode="decimal" placeholder="0.00" /></label>
      <label>${t("Calculation Type")}<select id="newProductCalc"><option value="sqft">sqft</option><option value="fixed">fixed</option></select></label>
      <label>${t("Minimum sqft")}<input id="newProductMin" inputmode="decimal" placeholder="11" /></label>
    </div>
    <button class="btn primary" id="addProductButton" type="button">${t("Add Product")}</button>
  `;
}

export function attachProductEvents() {
  document.querySelector("#productList")?.addEventListener("change", updateProductFromEvent);
  document.querySelector("#productList")?.addEventListener("input", updateProductFromEvent);
  document.querySelector("#addProductPanel")?.addEventListener("click", (event) => {
    if (event.target.id !== "addProductButton") return;
    addProduct();
  });
}

function updateProductFromEvent(event) {
  const field = event.target.dataset.productField;
  const id = event.target.dataset.productId;
  if (!field || !id || !canManageProducts()) return;
  state.products = state.products.map((product) => {
    if (product.id !== id) return product;
    const value = field === "active"
      ? event.target.value === "true"
      : ["sellingPrice", "costPrice", "minimumSqft"].includes(field)
        ? toNumber(event.target.value)
        : event.target.value;
    return { ...product, [field]: value };
  });
  persistProducts();
  document.querySelector("#productSaveStatus").textContent = `Products saved. ${money(state.products.reduce((sum, product) => sum + Number(product.sellingPrice || 0), 0))} total price list value.`;
}

function addProduct() {
  if (!canManageProducts()) return;
  const name = document.querySelector("#newProductName").value.trim();
  if (!name) return;
  state.products = [{
    id: uid("product"),
    name,
    category: document.querySelector("#newProductCategory").value.trim(),
    sellingPrice: toNumber(document.querySelector("#newProductPrice").value),
    costPrice: toNumber(document.querySelector("#newProductCost").value),
    calculationType: document.querySelector("#newProductCalc").value,
    minimumSqft: toNumber(document.querySelector("#newProductMin").value),
    active: true
  }, ...state.products];
  persistProducts();
  renderAddProductForm();
  renderProducts();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
