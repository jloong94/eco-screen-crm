import { state, persistProducts, uid } from "./state.js";
import { money, toNumber } from "./calculations.js";

export function renderProducts() {
  const list = document.querySelector("#productList");
  const canEdit = state.role === "Admin";
  if (!list) return;
  list.innerHTML = state.products.map((product) => `
    <article class="card product-card">
      <div class="card-head">
        <strong>${product.name}</strong>
        <span class="pill ${product.active === false ? "muted" : ""}">${product.active === false ? "Inactive" : "Active"}</span>
      </div>
      <div class="form-grid compact">
        <label>Product Name<input value="${product.name}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="name" /></label>
        <label>Category<input value="${product.category || ""}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="category" /></label>
        <label>Selling Price<input inputmode="decimal" value="${product.sellingPrice || 0}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="sellingPrice" /></label>
        <label>Cost Price<input inputmode="decimal" value="${product.costPrice || 0}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="costPrice" /></label>
        <label>Calculation Type<select ${canEdit ? "" : "disabled"} data-product-id="${product.id}" data-product-field="calculationType">
          ${["sqft", "fixed"].map((type) => `<option value="${type}" ${product.calculationType === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        <label>Minimum ft²<input inputmode="decimal" value="${product.minimumSqft || 0}" ${canEdit ? "" : "readonly"} data-product-id="${product.id}" data-product-field="minimumSqft" /></label>
        <label>Status<select ${canEdit ? "" : "disabled"} data-product-id="${product.id}" data-product-field="active">
          <option value="true" ${product.active !== false ? "selected" : ""}>Active</option>
          <option value="false" ${product.active === false ? "selected" : ""}>Inactive</option>
        </select></label>
      </div>
    </article>
  `).join("");
}

export function renderAddProductForm() {
  const panel = document.querySelector("#addProductPanel");
  if (!panel) return;
  if (state.role !== "Admin") {
    panel.innerHTML = `<p class="muted-text">Only Admin can add or edit products.</p>`;
    return;
  }
  panel.innerHTML = `
    <div class="form-grid compact">
      <label>Product Name<input id="newProductName" placeholder="New product name" /></label>
      <label>Category<input id="newProductCategory" placeholder="Window / Door / Sliding" /></label>
      <label>Selling Price<input id="newProductPrice" inputmode="decimal" placeholder="0.00" /></label>
      <label>Cost Price<input id="newProductCost" inputmode="decimal" placeholder="0.00" /></label>
      <label>Calculation Type<select id="newProductCalc"><option value="sqft">sqft</option><option value="fixed">fixed</option></select></label>
      <label>Minimum ft²<input id="newProductMin" inputmode="decimal" placeholder="11" /></label>
    </div>
    <button class="btn primary" id="addProductButton">Add Product</button>
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
  if (!field || !id || state.role !== "Admin") return;
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
