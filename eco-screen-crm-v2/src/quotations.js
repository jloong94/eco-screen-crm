import { quotationStatuses } from "./data.js";
import {
  activeProducts,
  ensureCurrentQuote,
  makeQuote,
  makeQuoteItem,
  persistQuotations,
  productById,
  state
} from "./state.js";
import { actualSqft, chargeableSqft, lineTotal, money, quoteTotals, toNumber } from "./calculations.js";

export function renderQuotationForm() {
  const quote = ensureCurrentQuote();
  document.querySelector("#quoteNumber").value = quote.quoteNumber;
  document.querySelector("#customerName").value = quote.customer.name;
  document.querySelector("#customerPhone").value = quote.customer.phone;
  document.querySelector("#customerArea").value = quote.customer.area;
  document.querySelector("#customerAddress").value = quote.customer.address;
  document.querySelector("#customerRemark").value = quote.customer.remark;
  document.querySelector("#appointmentDate").value = quote.appointmentDate;
  document.querySelector("#quoteStatus").innerHTML = quotationStatuses
    .map((status) => `<option value="${status}" ${quote.status === status ? "selected" : ""}>${status}</option>`)
    .join("");
  document.querySelector("#quoteRemark").value = quote.remark;
  document.querySelector("#discount").value = quote.discount || "";
  document.querySelector("#deposit").value = quote.deposit || "";
  renderItemCards();
  updateQuoteSummary();
  renderQuotationList();
}

export function attachQuotationEvents() {
  document.querySelector("#quotationForm").addEventListener("input", updateQuoteHeaderFromEvent);
  document.querySelector("#quotationForm").addEventListener("change", updateQuoteHeaderFromEvent);
  document.querySelector("#addItemButton").addEventListener("click", addItem);
  document.querySelector("#saveQuoteButton").addEventListener("click", saveQuote);
  document.querySelector("#newQuoteButton").addEventListener("click", newQuote);
  document.querySelector("#printQuoteButton").addEventListener("click", printQuote);
  document.querySelector("#pdfQuoteButton").addEventListener("click", printQuote);
  document.querySelector("#quoteItems").addEventListener("input", updateItemFromEvent);
  document.querySelector("#quoteItems").addEventListener("change", updateItemFromEvent);
  document.querySelector("#quoteItems").addEventListener("click", removeItemFromEvent);
}

function updateQuoteHeaderFromEvent(event) {
  const quote = ensureCurrentQuote();
  const id = event.target.id;
  if (!id) return;
  const customerMap = {
    customerName: "name",
    customerPhone: "phone",
    customerArea: "area",
    customerAddress: "address",
    customerRemark: "remark"
  };
  if (customerMap[id]) {
    quote.customer[customerMap[id]] = event.target.value;
  } else if (id === "quoteNumber") {
    quote.quoteNumber = event.target.value;
  } else if (id === "appointmentDate") {
    quote.appointmentDate = event.target.value;
  } else if (id === "quoteStatus") {
    quote.status = event.target.value;
  } else if (id === "quoteRemark") {
    quote.remark = event.target.value;
  } else if (id === "discount") {
    quote.discount = toNumber(event.target.value);
    updateQuoteSummary();
  } else if (id === "deposit") {
    quote.deposit = toNumber(event.target.value);
    updateQuoteSummary();
  }
}

export function addItem() {
  const quote = ensureCurrentQuote();
  const item = makeQuoteItem();
  quote.items = [item, ...quote.items];
  renderItemCards();
  updateQuoteSummary();
  const input = document.querySelector(`[data-item-id="${item.id}"][data-field="width"]`);
  input?.focus();
}

function productOptions(selectedId) {
  const options = activeProducts();
  const selected = state.products.find((product) => product.id === selectedId);
  if (selected && !options.some((product) => product.id === selected.id)) options.push(selected);
  return options.map((product) => `<option value="${product.id}" ${product.id === selectedId ? "selected" : ""}>${product.name}${product.active === false ? " (Inactive)" : ""}</option>`).join("");
}

export function renderItemCards() {
  const quote = ensureCurrentQuote();
  const container = document.querySelector("#quoteItems");
  const counter = document.querySelector("#itemsCount");
  counter.textContent = `Items count: ${quote.items.length}`;
  container.hidden = false;
  container.innerHTML = quote.items.length ? quote.items.map((item, index) => itemCardHtml(item, index)).join("") : `
    <div class="empty-state">No product items yet. Click Add Item to create a product card.</div>
  `;
}

function itemCardHtml(item, index) {
  return `
    <article class="item-card" data-card-id="${item.id}">
      <div class="item-head">
        <div>
          <strong>Item ${index + 1}</strong>
          <span class="muted-text">Full product details</span>
        </div>
        <button class="btn danger" data-remove-item="${item.id}" type="button">Remove item</button>
      </div>
      <div class="item-grid">
        <label>Product
          <select data-item-id="${item.id}" data-field="productId">${productOptions(item.productId)}</select>
        </label>
        <label>Width mm
          <input inputmode="numeric" data-item-id="${item.id}" data-field="width" value="${item.width || ""}" placeholder="1000" />
        </label>
        <label>Height mm
          <input inputmode="numeric" data-item-id="${item.id}" data-field="height" value="${item.height || ""}" placeholder="1200" />
        </label>
        <label>Quantity
          <input inputmode="numeric" data-item-id="${item.id}" data-field="quantity" value="${item.quantity || ""}" placeholder="1" />
        </label>
        <label>Color
          <input data-item-id="${item.id}" data-field="color" value="${item.color || ""}" placeholder="White" />
        </label>
        <label>Handle Position
          <input data-item-id="${item.id}" data-field="handlePosition" value="${item.handlePosition || ""}" placeholder="Right" />
        </label>
        <label>Track / Opening
          <input data-item-id="${item.id}" data-field="trackOpening" value="${item.trackOpening || ""}" placeholder="2 Track / Left" />
        </label>
        <label>Mesh / Material
          <input data-item-id="${item.id}" data-field="meshMaterial" value="${item.meshMaterial || ""}" placeholder="Stainless / Security mesh" />
        </label>
        <label>Unit Price
          <input inputmode="decimal" data-item-id="${item.id}" data-field="unitPrice" value="${item.unitPrice || ""}" />
        </label>
        <label class="wide">Remark
          <textarea rows="2" data-item-id="${item.id}" data-field="remark" placeholder="Site note, special request">${item.remark || ""}</textarea>
        </label>
        <div class="line-metrics">
          <span>ft² / Area</span>
          <strong data-line-id="${item.id}" data-line-field="area">${chargeableSqft(item).toFixed(2)}</strong>
          <span>Line Total</span>
          <strong data-line-id="${item.id}" data-line-field="total">${money(lineTotal(item))}</strong>
        </div>
      </div>
    </article>
  `;
}

function updateItemFromEvent(event) {
  const itemId = event.target.dataset.itemId;
  const field = event.target.dataset.field;
  if (!itemId || !field) return;
  const quote = ensureCurrentQuote();
  const item = quote.items.find((row) => row.id === itemId);
  if (!item) return;

  if (field === "productId") {
    const product = productById(event.target.value);
    Object.assign(item, {
      productId: product.id,
      productName: product.name,
      category: product.category,
      calculationType: product.calculationType || "sqft",
      minimumSqft: Number(product.minimumSqft || 0),
      unitPrice: Number(product.sellingPrice || 0)
    });
    renderItemCards();
    updateQuoteSummary();
    return;
  }

  item[field] = ["width", "height", "quantity", "unitPrice"].includes(field)
    ? event.target.value.replace(/[^\d.]/g, "")
    : event.target.value;
  updateLineCalculation(item);
  updateQuoteSummary();
}

function updateLineCalculation(item) {
  const area = document.querySelector(`[data-line-id="${item.id}"][data-line-field="area"]`);
  const total = document.querySelector(`[data-line-id="${item.id}"][data-line-field="total"]`);
  if (area) area.textContent = chargeableSqft(item).toFixed(2);
  if (total) total.textContent = money(lineTotal(item));
}

function removeItemFromEvent(event) {
  const id = event.target.dataset.removeItem;
  if (!id) return;
  const quote = ensureCurrentQuote();
  quote.items = quote.items.filter((item) => item.id !== id);
  renderItemCards();
  updateQuoteSummary();
}

export function updateQuoteSummary() {
  const quote = ensureCurrentQuote();
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  document.querySelector("#subtotalValue").textContent = money(totals.subtotal);
  document.querySelector("#totalValue").textContent = money(totals.total);
  document.querySelector("#balanceValue").textContent = money(totals.balance);
}

export function saveQuote() {
  const quote = ensureCurrentQuote();
  quote.updatedAt = new Date().toISOString();
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const snapshot = {
    ...quote,
    subtotal: totals.subtotal,
    total: totals.total,
    balance: totals.balance,
    items: quote.items.map((item) => ({ ...item }))
  };
  state.quotations = state.quotations.some((row) => row.id === snapshot.id)
    ? state.quotations.map((row) => row.id === snapshot.id ? snapshot : row)
    : [snapshot, ...state.quotations];
  persistQuotations();
  document.querySelector("#saveStatus").textContent = `Saved ${snapshot.quoteNumber}`;
  renderQuotationList();
}

export function newQuote() {
  state.currentQuote = makeQuote();
  renderQuotationForm();
  document.querySelector("#saveStatus").textContent = "New quote ready.";
}

export function renderQuotationList() {
  const list = document.querySelector("#quotationList");
  list.innerHTML = state.quotations.length ? state.quotations.map((quote) => `
    <button class="quote-row" type="button" data-open-quote="${quote.id}">
      <span><strong>${quote.quoteNumber}</strong><small>${quote.customer.name || "-"}</small></span>
      <span>${money(quote.total || 0)}</span>
    </button>
  `).join("") : `<p class="muted-text">No saved quotations yet.</p>`;
  list.querySelectorAll("[data-open-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      const quote = state.quotations.find((row) => row.id === button.dataset.openQuote);
      state.currentQuote = JSON.parse(JSON.stringify(quote));
      renderQuotationForm();
    });
  });
}

export function printQuote() {
  const quote = ensureCurrentQuote();
  document.querySelector("#printQuoteNumber").textContent = quote.quoteNumber;
  document.querySelector("#printCustomer").innerHTML = `
    <strong>${quote.customer.name || "-"}</strong><br />
    ${quote.customer.phone || "-"}<br />
    ${quote.customer.area || "-"}<br />
    ${quote.customer.address || "-"}
  `;
  document.querySelector("#printItems").innerHTML = quote.items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.productName}</td>
      <td>${item.width || 0} x ${item.height || 0}</td>
      <td>${item.quantity || 0}</td>
      <td>${item.color || "-"}</td>
      <td>${item.handlePosition || "-"}</td>
      <td>${item.meshMaterial || "-"}</td>
      <td>${item.remark || "-"}</td>
      <td class="right">${money(item.unitPrice)}</td>
      <td class="right">${money(lineTotal(item))}</td>
    </tr>
  `).join("");
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  document.querySelector("#printTotals").innerHTML = `
    <div><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
    <div><span>Discount</span><strong>${money(quote.discount)}</strong></div>
    <div><span>Total</span><strong>${money(totals.total)}</strong></div>
    <div><span>Deposit</span><strong>${money(quote.deposit)}</strong></div>
    <div><span>Balance</span><strong>${money(totals.balance)}</strong></div>
  `;
  window.print();
}
