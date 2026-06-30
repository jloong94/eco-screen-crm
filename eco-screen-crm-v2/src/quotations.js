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
import { convertQuoteToOrder, renderWorkflowModules } from "./workflow.js";

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
          <span>ft2 / Area</span>
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
    <article class="quote-row">
      <button type="button" data-open-quote="${quote.id}">
        <span><strong>${quote.quoteNumber}</strong><small>${quote.customer.name || "-"}</small></span>
        <span>${money(quote.total || 0)}</span>
      </button>
      <button class="btn primary" type="button" data-convert-quote="${quote.id}">Convert to Order</button>
    </article>
  `).join("") : `<p class="muted-text">No saved quotations yet.</p>`;
  list.querySelectorAll("[data-open-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      const quote = state.quotations.find((row) => row.id === button.dataset.openQuote);
      state.currentQuote = JSON.parse(JSON.stringify(quote));
      renderQuotationForm();
    });
  });
  list.querySelectorAll("[data-convert-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      const result = convertQuoteToOrder(button.dataset.convertQuote);
      document.querySelector("#saveStatus").textContent = result.ok ? "Order created successfully." : result.message;
      renderQuotationList();
      renderWorkflowModules();
    });
  });
}

export function printQuote() {
  const quote = ensureCurrentQuote();
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.print();
    return;
  }
  printWindow.document.open();
  printWindow.document.write(printableDocument(`Quotation ${quote.quoteNumber}`, quoteDocumentHtml(quote)));
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 150);
}

function printableDocument(title, bodyHtml) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <style>${quotePrintStyles()}</style>
      </head>
      <body>${bodyHtml}</body>
    </html>`;
}

function quoteDocumentHtml(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const quoteDate = formatDate(quote.updatedAt || quote.createdAt || new Date().toISOString());
  const discountRow = Number(quote.discount || 0) > 0
    ? `<div class="total-row"><span>Discount</span><strong>- ${money(quote.discount)}</strong></div>`
    : "";
  return `
    <main class="quotation-page">
      <header class="quote-header">
        <section class="company-block">
          <div class="logo-row">
            <div class="es-logo">ES</div>
            <div>
              <h1>Eco Screen Sdn Bhd</h1>
              <p class="specialist">Screen and Security Mesh Specialist</p>
            </div>
          </div>
          <p>24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM</p>
          <p>Tel: 0197563499</p>
          <p class="description">Supply and installation quotation for insect screen, roller screen, stainless steel net and security mesh products.</p>
        </section>
        <aside class="quote-card">
          <p>QUOTATION</p>
          <h2>${escapeHtml(quote.quoteNumber || "-")}</h2>
          <div><span>Date</span><strong>${quoteDate}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(quote.status || "Quoted")}</strong></div>
        </aside>
      </header>

      <div class="divider"></div>

      <section class="customer-grid">
        <div class="info-box">
          <p class="section-label">BILL TO</p>
          <h3>${escapeHtml(quote.customer.name || "-")}</h3>
          <p>${escapeHtml(quote.customer.phone || "-")}</p>
          <p>${escapeHtml(quote.customer.address || "-")}</p>
        </div>
        <div class="info-box">
          <p class="section-label">JOB DETAILS</p>
          <p><strong>Area:</strong> ${escapeHtml(quote.customer.area || "-")}</p>
          <p><strong>Appointment:</strong> ${escapeHtml(quote.appointmentDate || "-")}</p>
          ${quote.remark ? `<p><strong>Remark:</strong> ${escapeHtml(quote.remark)}</p>` : ""}
        </div>
      </section>

      <table class="items-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Product</th>
            <th class="right">Size</th>
            <th class="right">Sqft</th>
            <th class="right">Rate</th>
            <th class="right">Qty</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>${quoteItemRowsHtml(quote.items)}</tbody>
      </table>

      <section class="bottom-grid">
        <div class="terms-box">
          <h3>Terms & Conditions</h3>
          ${quoteTermsHtml()}
        </div>
        <div class="totals-box">
          <div class="total-row"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
          ${discountRow}
          <div class="total-row"><span>Total</span><strong>${money(totals.total)}</strong></div>
          <div class="total-row"><span>Deposit</span><strong>${money(quote.deposit)}</strong></div>
          <div class="total-row balance"><span>Balance</span><strong>${money(totals.balance)}</strong></div>
        </div>
      </section>
    </main>
  `;
}

function quoteItemRowsHtml(items) {
  return items.map((item, index) => {
    const description = item.description || item.label || item.remark || `Item ${index + 1}`;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(description)}</strong>
          <small>Colour: ${escapeHtml(item.color || "-")}</small>
        </td>
        <td>${escapeHtml(item.productName || "-")}</td>
        <td class="right">${escapeHtml(item.width || 0)} x ${escapeHtml(item.height || 0)} mm</td>
        <td class="right">${chargeableSqft(item).toFixed(2)}</td>
        <td class="right">${money(item.unitPrice)}</td>
        <td class="right">${escapeHtml(item.quantity || 0)}</td>
        <td class="right amount">${money(lineTotal(item))}</td>
      </tr>
    `;
  }).join("");
}

function quoteTermsHtml() {
  return `
    <p>i) Prices quoted are valid for a period of two (2) weeks from the quotation date.</p>
    <p>ii) 50% deposit is required upon confirmation, balance of payment upon completion.</p>
    <p>iii) Deposit paid is non-refundable.</p>
    <p>iv) All cheques should not be crossed and make payable to:</p>
    <p class="bank-details">ECO SCREEN SDN BHD<br>PUBLIC BANK<br>3242952413</p>
  `;
}

function quotePrintStyles() {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .quotation-page {
      width: 100%;
      max-width: 780px;
      margin: 0 auto;
      padding: 4px;
    }
    .quote-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 230px;
      gap: 22px;
      align-items: start;
    }
    .logo-row {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 8px;
    }
    .es-logo {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: #047857;
      color: white;
      font-size: 18px;
      font-weight: 900;
      letter-spacing: .04em;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 24px; color: #0f172a; }
    .specialist {
      margin-top: 3px;
      color: #475569;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .company-block > p {
      margin-top: 5px;
      color: #334155;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .company-block .description {
      max-width: 470px;
      margin-top: 10px;
      color: #64748b;
    }
    .quote-card {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 14px;
      text-align: right;
      background: #f8fafc;
    }
    .quote-card > p {
      color: #047857;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .1em;
    }
    .quote-card h2 {
      margin: 7px 0 12px;
      font-size: 20px;
      color: #0f172a;
    }
    .quote-card div {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      margin-top: 8px;
      font-size: 12px;
      text-align: left;
    }
    .quote-card span { color: #64748b; }
    .divider {
      height: 2px;
      margin: 18px 0;
      background: #0f172a;
      opacity: .8;
    }
    .customer-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    .info-box {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px;
      min-height: 110px;
    }
    .section-label {
      color: #047857;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .08em;
      margin-bottom: 7px;
    }
    .info-box h3 {
      margin-bottom: 6px;
      font-size: 16px;
    }
    .info-box p {
      color: #334155;
      font-size: 12.5px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }
    .items-table th {
      background: #f1f5f9;
      color: #0f172a;
      font-size: 11px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .items-table th,
    .items-table td {
      border: 1px solid #dbe4ea;
      padding: 8px;
      vertical-align: top;
      font-size: 12px;
      line-height: 1.35;
    }
    .items-table td small {
      display: block;
      margin-top: 4px;
      color: #64748b;
      font-size: 11px;
    }
    .right { text-align: right; }
    .amount {
      font-weight: 900;
      color: #0f172a;
      white-space: nowrap;
    }
    .bottom-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 18px;
      align-items: start;
      margin-top: 18px;
    }
    .terms-box {
      color: #334155;
      font-size: 11.5px;
      line-height: 1.45;
    }
    .terms-box h3 {
      margin-bottom: 7px;
      font-size: 13px;
      color: #0f172a;
    }
    .terms-box p { margin-top: 5px; }
    .bank-details {
      margin-top: 7px !important;
      font-weight: 900;
      color: #0f172a;
    }
    .totals-box {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 12px;
      background: #f8fafc;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 0;
      font-size: 13px;
    }
    .total-row:first-child { padding-top: 0; }
    .total-row:last-child { border-bottom: 0; padding-bottom: 0; }
    .total-row span { color: #475569; }
    .total-row strong { color: #0f172a; white-space: nowrap; }
    .total-row.balance strong {
      color: #047857;
      font-size: 16px;
    }
    @media screen and (max-width: 720px) {
      body { background: #f8fafc; padding: 10px; }
      .quotation-page { background: white; padding: 14px; }
      .quote-header, .customer-grid, .bottom-grid { grid-template-columns: 1fr; }
      .quote-card { text-align: left; }
    }
  `;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("en-MY");
  return date.toLocaleDateString("en-MY", { year: "numeric", month: "short", day: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
