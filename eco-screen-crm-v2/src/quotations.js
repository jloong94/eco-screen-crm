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
import { baseLineTotal, chargeableSqft, itemWithCalculatedTotals, lineTotal, money, powdercoatAmount, quoteTotals, toNumber } from "./calculations.js";
import { convertQuoteToOrder, renderWorkflowModules } from "./workflow.js";
import { statusLabel, t } from "./i18n.js";

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
    .map((status) => `<option value="${status}" ${quote.status === status ? "selected" : ""}>${statusLabel(status)}</option>`)
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
  if (customerMap[id]) quote.customer[customerMap[id]] = event.target.value;
  else if (id === "quoteNumber") quote.quoteNumber = event.target.value;
  else if (id === "appointmentDate") quote.appointmentDate = event.target.value;
  else if (id === "quoteStatus") quote.status = event.target.value;
  else if (id === "quoteRemark") quote.remark = event.target.value;
  else if (id === "discount") {
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
  document.querySelector(`[data-item-id="${item.id}"][data-field="width"]`)?.focus();
}

function productOptions(selectedId) {
  const options = activeProducts();
  const selected = state.products.find((product) => product.id === selectedId);
  if (selected && !options.some((product) => product.id === selected.id)) options.push(selected);
  return options.map((product) => `<option value="${product.id}" ${product.id === selectedId ? "selected" : ""}>${escapeHtml(product.name)}${product.active === false ? ` (${t("Inactive")})` : ""}</option>`).join("");
}

function selectOptions(options, selectedValue) {
  return options.map((option) => `<option value="${option}" ${option === selectedValue ? "selected" : ""}>${statusLabel(option)}</option>`).join("");
}

function trackTypeOptions(item) {
  const options = ["Single Track", "Double Track", "Triple Track"];
  const selectedValue = item.trackType || item.trackOpening || "Single Track";
  const legacyOption = selectedValue && !options.includes(selectedValue)
    ? `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`
    : "";
  return `${legacyOption}${selectOptions(options, selectedValue)}`;
}

function meshTypeOptions(item) {
  const options = [
    "0.6 Stainless Steel Net",
    "1.0 Stainless Steel Net",
    "PET Net",
    "Soft Stainless Steel Net",
    "Standard Mesh",
    "Other / To Confirm"
  ];
  const selectedValue = meshValue(item) || "Other / To Confirm";
  const legacyOption = selectedValue && !options.includes(selectedValue)
    ? `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`
    : "";
  return `${legacyOption}${selectOptions(options, selectedValue)}`;
}

function meshValue(item) {
  return item.meshType || item.meshMaterial || item.material || "";
}

export function renderItemCards() {
  const quote = ensureCurrentQuote();
  const container = document.querySelector("#quoteItems");
  const counter = document.querySelector("#itemsCount");
  counter.textContent = `${t("Items count")}: ${quote.items.length}`;
  container.hidden = false;
  container.innerHTML = quote.items.length ? quote.items.map((item, index) => itemCardHtml(item, index)).join("") : `
    <div class="empty-state">${t("No product items yet. Click Add Item to create a product card.")}</div>
  `;
}

function itemCardHtml(item, index) {
  return `
    <article class="item-card" data-card-id="${item.id}">
      <div class="item-head">
        <div>
          <strong>${t("Product")} ${index + 1}</strong>
          <span class="muted-text">${t("Full product details")}</span>
        </div>
        <button class="btn danger" data-remove-item="${item.id}" type="button">${t("Remove item")}</button>
      </div>
      <div class="item-grid">
        ${fieldSelect(t("Product"), item.id, "productId", productOptions(item.productId))}
        ${fieldInput(t("Width mm"), item.id, "width", item.width, "1000", "numeric")}
        ${fieldInput(t("Height mm"), item.id, "height", item.height, "1200", "numeric")}
        ${fieldInput(t("Quantity"), item.id, "quantity", item.quantity, "1", "numeric")}
        ${fieldInput(t("Color"), item.id, "color", item.color, "White")}
        ${fieldSelect(t("Install Type / Inside Outside"), item.id, "installType", selectOptions(["Inside install", "Outside install", "Not sure / To confirm"], item.installType || "Not sure / To confirm"))}
        ${fieldInput(t("Installation Location"), item.id, "installationLocation", item.installationLocation, "Living")}
        ${fieldSelect(t("Opening Direction"), item.id, "openingDirection", selectOptions(["Left", "Right", "Center", "Sliding Left", "Sliding Right", "Not sure"], item.openingDirection || "Not sure"))}
        ${fieldSelect(t("Handle Position"), item.id, "handlePosition", selectOptions(["Left", "Right"], item.handlePosition || "Left"))}
        ${fieldSelect(t("Track Type"), item.id, "trackType", trackTypeOptions(item))}
        ${fieldInput(t("Track Size"), item.id, "trackSize", item.trackSize, "25mm")}
        ${fieldInput(t("Handle Height"), item.id, "handleHeight", item.handleHeight, "1000mm")}
        ${fieldSelect(t("Mesh / Net Type"), item.id, "meshType", meshTypeOptions(item))}
        ${fieldInput(t("Unit Price"), item.id, "unitPrice", item.unitPrice, "", "decimal")}
        <label>${t("Powdercoat / Powercoat")}
          <select data-item-id="${item.id}" data-field="powdercoat">
            <option value="false" ${item.powdercoat ? "" : "selected"}>No</option>
            <option value="true" ${item.powdercoat ? "selected" : ""}>Yes</option>
          </select>
        </label>
        <label class="wide">${t("Remark")}
          <textarea rows="2" data-item-id="${item.id}" data-field="remark" placeholder="Site note, special request">${escapeHtml(item.remark || "")}</textarea>
        </label>
        <div class="line-metrics">
          <span>ft2 / Area</span>
          <strong data-line-id="${item.id}" data-line-field="area">${chargeableSqft(item).toFixed(2)}</strong>
          <span>${t("Base Total")}</span>
          <strong data-line-id="${item.id}" data-line-field="base">${money(baseLineTotal(item))}</strong>
          <span>Powdercoat 8%</span>
          <strong data-line-id="${item.id}" data-line-field="powdercoat">${money(powdercoatAmount(item))}</strong>
          <span>${t("Line Total")}</span>
          <strong data-line-id="${item.id}" data-line-field="total">${money(lineTotal(item))}</strong>
        </div>
      </div>
    </article>
  `;
}

function fieldInput(label, itemId, field, value = "", placeholder = "", inputmode = "") {
  return `<label>${label}<input ${inputmode ? `inputmode="${inputmode}"` : ""} data-item-id="${itemId}" data-field="${field}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" /></label>`;
}

function fieldSelect(label, itemId, field, optionsHtml) {
  return `<label>${label}<select data-item-id="${itemId}" data-field="${field}">${optionsHtml}</select></label>`;
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
      unitPrice: Number(product.sellingPrice || 0),
      powdercoatRate: Number(item.powdercoatRate || 0.08)
    });
    renderItemCards();
    updateQuoteSummary();
    return;
  }

  if (field === "powdercoat") {
    item.powdercoat = event.target.value === "true";
    item.powdercoatRate = Number(item.powdercoatRate || 0.08);
  } else {
    item[field] = ["width", "height", "quantity", "unitPrice"].includes(field)
      ? event.target.value.replace(/[^\d.]/g, "")
      : event.target.value;
  }
  updateLineCalculation(item);
  updateQuoteSummary();
}

function updateLineCalculation(item) {
  const area = document.querySelector(`[data-line-id="${item.id}"][data-line-field="area"]`);
  const base = document.querySelector(`[data-line-id="${item.id}"][data-line-field="base"]`);
  const powdercoat = document.querySelector(`[data-line-id="${item.id}"][data-line-field="powdercoat"]`);
  const total = document.querySelector(`[data-line-id="${item.id}"][data-line-field="total"]`);
  if (area) area.textContent = chargeableSqft(item).toFixed(2);
  if (base) base.textContent = money(baseLineTotal(item));
  if (powdercoat) powdercoat.textContent = money(powdercoatAmount(item));
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
    items: quote.items.map((item) => itemWithCalculatedTotals(item))
  };
  state.quotations = state.quotations.some((row) => row.id === snapshot.id)
    ? state.quotations.map((row) => row.id === snapshot.id ? snapshot : row)
    : [snapshot, ...state.quotations];
  persistQuotations();
  document.querySelector("#saveStatus").textContent = `${t("Save Quote")} ${snapshot.quoteNumber}`;
  renderQuotationList();
}

export function newQuote() {
  state.currentQuote = makeQuote();
  renderQuotationForm();
  document.querySelector("#saveStatus").textContent = t("New quote ready.");
}

export function renderQuotationList() {
  const list = document.querySelector("#quotationList");
  list.innerHTML = state.quotations.length ? state.quotations.map((quote) => `
    <article class="quote-row">
      <button type="button" data-open-quote="${quote.id}">
        <span><strong>${escapeHtml(quote.quoteNumber)}</strong><small>${escapeHtml(quote.customer.name || "-")}</small></span>
        <span>${money(quote.total || 0)}</span>
      </button>
      <button class="btn primary" type="button" data-convert-quote="${quote.id}">${t("Convert to Order")}</button>
    </article>
  `).join("") : `<p class="muted-text">${t("No saved quotations yet.")}</p>`;
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
      document.querySelector("#saveStatus").textContent = result.ok ? t("Order created successfully.") : result.message;
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
  printWindow.document.write(printableDocument(`${t("Quotation")} ${quote.quoteNumber}`, quoteDocumentHtml(quote)));
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 150);
}

function printableDocument(title, bodyHtml) {
  return `<!doctype html><html lang="${state.language === "zh" ? "zh" : "en"}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(title)}</title><style>${quotePrintStyles()}</style></head><body>${bodyHtml}</body></html>`;
}

function quoteDocumentHtml(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const discountRow = Number(quote.discount || 0) > 0
    ? `<div class="total-row"><span>${t("Discount")}</span><strong>- ${money(quote.discount)}</strong></div>`
    : "";
  return `
    <main class="quotation-page">
      <header class="quote-header">
        <section class="company-block">
          <div class="logo-row"><div class="es-logo">ES</div><div><h1>Eco Screen Sdn Bhd</h1><p class="specialist">Screen and Security Mesh Specialist</p></div></div>
          <p>24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM</p>
          <p>Tel: 0197563499</p>
          <p class="description">Supply and installation quotation for insect screen, roller screen, stainless steel net and security mesh products.</p>
        </section>
        <aside class="quote-card">
          <p>${t("Quotation").toUpperCase()}</p>
          <h2>${escapeHtml(quote.quoteNumber || "-")}</h2>
          <div><span>Date</span><strong>${formatDate(quote.updatedAt || quote.createdAt || new Date().toISOString())}</strong></div>
          <div><span>${t("Status")}</span><strong>${statusLabel(quote.status || "Quoted")}</strong></div>
        </aside>
      </header>
      <div class="divider"></div>
      <section class="customer-grid">
        <div class="info-box"><p class="section-label">BILL TO</p><h3>${escapeHtml(quote.customer.name || "-")}</h3><p>${escapeHtml(quote.customer.phone || "-")}</p><p>${escapeHtml(quote.customer.address || "-")}</p></div>
        <div class="info-box"><p class="section-label">JOB DETAILS</p><p><strong>${t("Area")}:</strong> ${escapeHtml(quote.customer.area || "-")}</p><p><strong>${t("Appointment Date")}:</strong> ${escapeHtml(quote.appointmentDate || "-")}</p>${quote.remark ? `<p><strong>${t("Remark")}:</strong> ${escapeHtml(quote.remark)}</p>` : ""}</div>
      </section>
      <table class="items-table"><thead><tr><th>Description</th><th>${t("Product")}</th><th class="right">Size</th><th class="right">Sqft</th><th class="right">Rate</th><th class="right">${t("Quantity")}</th><th class="right">${t("Total")}</th></tr></thead><tbody>${quoteItemRowsHtml(quote.items)}</tbody></table>
      <section class="bottom-grid">
        <div class="terms-box"><h3>Terms & Conditions</h3>${quoteTermsHtml()}</div>
        <div class="totals-box">
          <div class="total-row"><span>${t("Subtotal")}</span><strong>${money(totals.subtotal)}</strong></div>
          ${discountRow}
          <div class="total-row"><span>${t("Total")}</span><strong>${money(totals.total)}</strong></div>
          <div class="total-row"><span>${t("Deposit")}</span><strong>${money(quote.deposit)}</strong></div>
          <div class="total-row balance"><span>${t("Balance")}</span><strong>${money(totals.balance)}</strong></div>
        </div>
      </section>
    </main>
  `;
}

function quoteItemRowsHtml(items) {
  return items.map((item, index) => {
    const description = item.description || item.label || item.remark || `${t("Product")} ${index + 1}`;
    return `<tr><td><strong>${escapeHtml(description)}</strong>${quoteItemDetailLinesHtml(item)}</td><td>${escapeHtml(item.productName || "-")}</td><td class="right">${escapeHtml(item.width || 0)} x ${escapeHtml(item.height || 0)} mm</td><td class="right">${chargeableSqft(item).toFixed(2)}</td><td class="right">${money(item.unitPrice)}</td><td class="right">${escapeHtml(item.quantity || 0)}</td><td class="right amount">${money(lineTotal(item))}</td></tr>`;
  }).join("");
}

function quoteItemDetailLinesHtml(item) {
  const details = [
    [t("Color"), item.color],
    [t("Install Type / Inside Outside"), item.installType],
    [t("Installation Location"), item.installationLocation],
    [t("Opening Direction"), item.openingDirection],
    [t("Track Size"), item.trackSize],
    [t("Handle Height"), item.handleHeight],
    [t("Handle Position"), item.handlePosition],
    [t("Track Type"), item.trackType || item.trackOpening],
    [t("Mesh / Net Type"), meshValue(item)],
    [t("Powdercoat / Powercoat"), item.powdercoat ? `Yes (${money(powdercoatAmount(item))})` : ""]
  ];
  return details.filter(([, value]) => value).map(([label, value]) => `<small>${label}: ${escapeHtml(value)}</small>`).join("") || `<small>${t("Color")}: -</small>`;
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
    body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .quotation-page { width: 100%; max-width: 780px; margin: 0 auto; padding: 4px; }
    .quote-header { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 22px; align-items: start; }
    .logo-row { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .es-logo { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 8px; background: #047857; color: white; font-size: 18px; font-weight: 900; }
    h1, h2, h3, p { margin: 0; } h1 { font-size: 24px; color: #0f172a; }
    .specialist { margin-top: 3px; color: #475569; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .company-block > p { margin-top: 5px; color: #334155; font-size: 12.5px; line-height: 1.45; }
    .company-block .description { max-width: 470px; margin-top: 10px; color: #64748b; }
    .quote-card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; text-align: right; background: #f8fafc; }
    .quote-card > p { color: #047857; font-size: 12px; font-weight: 900; letter-spacing: .1em; }
    .quote-card h2 { margin: 7px 0 12px; font-size: 20px; color: #0f172a; }
    .quote-card div { display: flex; justify-content: space-between; gap: 14px; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 8px; font-size: 12px; text-align: left; }
    .divider { height: 2px; margin: 18px 0; background: #0f172a; opacity: .8; }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
    .info-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; min-height: 110px; }
    .section-label { color: #047857; font-size: 11px; font-weight: 900; letter-spacing: .08em; margin-bottom: 7px; }
    .info-box h3 { margin-bottom: 6px; font-size: 16px; } .info-box p { color: #334155; font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; }
    .items-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .items-table th { background: #f1f5f9; color: #0f172a; font-size: 11px; text-align: left; text-transform: uppercase; letter-spacing: .04em; }
    .items-table th, .items-table td { border: 1px solid #dbe4ea; padding: 8px; vertical-align: top; font-size: 12px; line-height: 1.35; }
    .items-table td small { display: block; margin-top: 4px; color: #64748b; font-size: 11px; }
    .right { text-align: right; } .amount { font-weight: 900; color: #0f172a; white-space: nowrap; }
    .bottom-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; align-items: start; margin-top: 18px; }
    .terms-box { color: #334155; font-size: 11.5px; line-height: 1.45; } .terms-box h3 { margin-bottom: 7px; font-size: 13px; color: #0f172a; }
    .terms-box p { margin-top: 5px; } .bank-details { margin-top: 7px !important; font-weight: 900; color: #0f172a; }
    .totals-box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; background: #f8fafc; }
    .total-row { display: flex; justify-content: space-between; gap: 14px; border-bottom: 1px solid #e2e8f0; padding: 7px 0; font-size: 13px; }
    .total-row:last-child { border-bottom: 0; padding-bottom: 0; } .total-row.balance strong { color: #047857; font-size: 16px; }
    @media screen and (max-width: 720px) { body { background: #f8fafc; padding: 10px; } .quotation-page { background: white; padding: 14px; } .quote-header, .customer-grid, .bottom-grid { grid-template-columns: 1fr; } .quote-card { text-align: left; } }
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
