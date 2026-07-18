import { quotationStatuses } from "./data.js";
import {
  activeProducts,
  ensureCurrentQuote,
  makeQuote,
  makeQuoteItem,
  nextQuoteNumber,
  persistQuotations,
  persistQuotationsLocally,
  productById,
  state,
  syncCollectionNow,
  uid
} from "./state.js";
import {
  autoCalculatedPrice,
  baseLineTotal,
  chargeableSqft,
  hasManualFinalPrice,
  itemWithCalculatedTotals,
  lineTotal,
  money,
  powdercoatAmount,
  quoteTotals,
  toNumber
} from "./calculations.js";
import {
  convertQuoteToOrder,
  getQuotationDisplayNo,
  openOrderForQuotation,
  quotationOrderAction,
  renderWorkflowModules,
  updateQuotationStatus
} from "./workflow.js";
import {
  COLOR_VALUES,
  OPENING_DIRECTION_VALUES,
  colorLabel,
  normalizeColor,
  normalizeOpeningDirection,
  normalizeStatus,
  openingDirectionLabel,
  statusLabel,
  t
} from "./i18n.js";
import { canDuplicateQuotation, isBossOrAdmin } from "./permissions.js";

const quotationTabs = ["quoted", "follow_up", "won", "lost"];
let activeQuotationTab = "quoted";

const copiedItemFields = [
  "productId", "productName", "category", "calculationType", "minimumSqft",
  "width", "height", "quantity", "measurements", "color", "trackType",
  "trackOpening", "meshType", "meshMaterial", "material", "installType",
  "trackSize", "handleHeight", "handlePosition", "installationLocation",
  "openingDirection", "powdercoat", "powdercoatRate", "lock", "description",
  "label", "remark", "remarks", "unitPrice", "manualFinalPrice",
  "priceAdjustmentRemark", "discount", "discountType"
];

const copiedTaxFields = [
  "taxEnabled", "taxRate", "taxAmount", "serviceTaxEnabled", "serviceTaxRate",
  "sstEnabled", "sstRate"
];

export function renderQuotationForm() {
  const quote = ensureCurrentQuote();
  document.querySelector("#quoteNumber").value = getQuotationDisplayNo(quote);
  document.querySelector("#customerName").value = quote.customer.name;
  document.querySelector("#customerPhone").value = quote.customer.phone;
  document.querySelector("#projectName").value = quotationProjectName(quote);
  document.querySelector("#customerAddress").value = quote.siteAddress || quote.customer.address || "";
  document.querySelector("#customerRemark").value = quote.customer.remark;
  document.querySelector("#appointmentDate").value = quote.appointmentDate;
  quote.status = normalizeStatus(quote.status);
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
    customerRemark: "remark"
  };
  if (customerMap[id]) quote.customer[customerMap[id]] = event.target.value;
  else if (id === "projectName") {
    quote.projectName = event.target.value;
    quote.customer.area = event.target.value;
  }
  else if (id === "customerAddress") {
    quote.siteAddress = event.target.value;
    quote.customer.address = event.target.value;
  }
  else if (id === "quoteNumber") quote.quoteNumber = event.target.value;
  else if (id === "appointmentDate") quote.appointmentDate = event.target.value;
  else if (id === "quoteStatus") {
    if (event.type === "change") saveQuotationStatusFromEvent(event);
  }
  else if (id === "quoteRemark") quote.remark = event.target.value;
  else if (id === "discount") {
    quote.discount = toNumber(event.target.value);
    updateQuoteSummary();
  } else if (id === "deposit") {
    quote.deposit = toNumber(event.target.value);
    updateQuoteSummary();
  }
}

async function saveQuotationStatusFromEvent(event) {
  const quote = ensureCurrentQuote();
  const previousStatus = normalizeStatus(quote.status);
  const nextStatus = normalizeStatus(event.target.value);
  const isSaved = state.quotations.some((row) => row.id === quote.id);
  if (!isSaved) {
    quote.status = nextStatus;
    event.target.value = nextStatus;
    setSaveStatus("Save the quotation first. The selected status will be saved with it.", "info");
    renderQuotationList();
    return;
  }

  event.target.disabled = true;
  setSaveStatus("Saving quotation status...", "info");
  const statusSave = updateQuotationStatus(quote.id, nextStatus);
  renderQuotationList();
  const result = await statusSave;
  if (!result.ok) {
    quote.status = previousStatus;
    if (event.target.isConnected) event.target.value = previousStatus;
    setSaveStatus(result.message, "error");
  } else {
    quote.status = result.status;
    if (event.target.isConnected) event.target.value = result.status;
    setSaveStatus(result.message, result.cloudOk === false && !result.localOnly ? "warning" : "success");
  }
  if (event.target.isConnected) event.target.disabled = false;
  renderQuotationList();
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

function canonicalSelectOptions(options, currentValue, normalizer, labeler) {
  const raw = String(currentValue ?? "").trim();
  const normalized = normalizer(raw);
  const legacyOption = raw && !options.includes(normalized)
    ? `<option value="${escapeHtml(raw)}" selected>${escapeHtml(labeler(raw))}</option>`
    : "";
  return `${legacyOption}${options.map((option) => `<option value="${option}" ${option === normalized ? "selected" : ""}>${escapeHtml(labeler(option))}</option>`).join("")}`;
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
        ${fieldSelect(t("Color"), item.id, "color", canonicalSelectOptions(COLOR_VALUES, item.color || "white", normalizeColor, colorLabel))}
        ${fieldSelect(t("Install Type / Inside Outside"), item.id, "installType", selectOptions(["Inside install", "Outside install", "Not sure / To confirm"], item.installType || "Not sure / To confirm"))}
        ${fieldInput(t("Installation Location"), item.id, "installationLocation", item.installationLocation, t("Living"))}
        ${fieldSelect(t("Opening Direction"), item.id, "openingDirection", canonicalSelectOptions(OPENING_DIRECTION_VALUES, item.openingDirection || "close_left", normalizeOpeningDirection, openingDirectionLabel))}
        ${fieldSelect(t("Track Type"), item.id, "trackType", trackTypeOptions(item))}
        ${fieldInput(t("Track Size"), item.id, "trackSize", item.trackSize, "25mm")}
        ${fieldInput(t("Handle Height"), item.id, "handleHeight", item.handleHeight, "1000mm")}
        ${fieldSelect(t("Mesh / Net Type"), item.id, "meshType", meshTypeOptions(item))}
        ${fieldInput(t("Unit Price"), item.id, "unitPrice", item.unitPrice, "", "decimal")}
        <label>${t("Powdercoat / Powercoat")}
          <select data-item-id="${item.id}" data-field="powdercoat">
            <option value="false" ${item.powdercoat ? "" : "selected"}>${t("No")}</option>
            <option value="true" ${item.powdercoat ? "selected" : ""}>${t("Yes")}</option>
          </select>
        </label>
        <label>${t("Manual Final Price")}
          <input inputmode="decimal" data-item-id="${item.id}" data-field="manualFinalPrice" value="${escapeHtml(item.manualFinalPrice ?? "")}" placeholder="${t("Optional final RM")}" />
        </label>
        <label class="wide">${t("Adjustment Remark")}
          <input data-item-id="${item.id}" data-field="priceAdjustmentRemark" value="${escapeHtml(item.priceAdjustmentRemark || "")}" placeholder="${t("Reason for price adjustment")}" />
        </label>
        <label class="wide">${t("Remark")}
          <textarea rows="2" data-item-id="${item.id}" data-field="remark" placeholder="${t("Site note, special request")}">${escapeHtml(item.remark || "")}</textarea>
        </label>
        <div class="line-metrics">
          <span>${t("ft2 / Area")}</span>
          <strong data-line-id="${item.id}" data-line-field="area">${chargeableSqft(item).toFixed(2)}</strong>
          <span>${t("Base Total")}</span>
          <strong data-line-id="${item.id}" data-line-field="base">${money(baseLineTotal(item))}</strong>
          <span>${t("Powdercoat 8%")}</span>
          <strong data-line-id="${item.id}" data-line-field="powdercoat">${money(powdercoatAmount(item))}</strong>
          <span>${t("Auto Calculated Price")}</span>
          <strong data-line-id="${item.id}" data-line-field="auto">${money(autoCalculatedPrice(item))}</strong>
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
  } else if (field === "color") {
    item.color = normalizeColor(event.target.value);
  } else if (field === "openingDirection") {
    item.openingDirection = normalizeOpeningDirection(event.target.value);
  } else {
    item[field] = ["width", "height", "quantity", "unitPrice", "manualFinalPrice"].includes(field)
      ? event.target.value.replace(/[^\d.]/g, "")
      : event.target.value;
  }
  item.autoCalculatedPrice = autoCalculatedPrice(item);
  updateLineCalculation(item);
  updateQuoteSummary();
}

function updateLineCalculation(item) {
  const area = document.querySelector(`[data-line-id="${item.id}"][data-line-field="area"]`);
  const base = document.querySelector(`[data-line-id="${item.id}"][data-line-field="base"]`);
  const powdercoat = document.querySelector(`[data-line-id="${item.id}"][data-line-field="powdercoat"]`);
  const auto = document.querySelector(`[data-line-id="${item.id}"][data-line-field="auto"]`);
  const total = document.querySelector(`[data-line-id="${item.id}"][data-line-field="total"]`);
  item.autoCalculatedPrice = autoCalculatedPrice(item);
  if (area) area.textContent = chargeableSqft(item).toFixed(2);
  if (base) base.textContent = money(baseLineTotal(item));
  if (powdercoat) powdercoat.textContent = money(powdercoatAmount(item));
  if (auto) auto.textContent = money(autoCalculatedPrice(item));
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

export function quotationProjectName(quote = {}) {
  return String(quote.projectName || quote.locationProjectName || quote.project || quote.customer?.area || "").trim();
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function duplicateQuoteItem(sourceItem = {}, { copyPrices, copyRemarks }) {
  const item = { id: uid("item") };
  copiedItemFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(sourceItem, field)) item[field] = cloneValue(sourceItem[field]);
  });
  if (!copyPrices) {
    item.unitPrice = 0;
    item.manualFinalPrice = "";
    item.priceAdjustmentRemark = "";
    item.discount = 0;
    item.discountType = "";
    item.powdercoatRate = 0;
  }
  if (!copyRemarks) {
    item.remark = "";
    item.remarks = "";
    item.priceAdjustmentRemark = "";
  }
  item.createdAt = Date.now();
  return itemWithCalculatedTotals(item);
}

function uniqueQuotationId(idFactory = () => uid("quote"), existing = state.quotations) {
  const ids = new Set((Array.isArray(existing) ? existing : []).map((quote) => String(quote?.id || "")).filter(Boolean));
  let id = String(idFactory() || "").trim();
  let attempts = 0;
  while ((!id || ids.has(id)) && attempts < 20) {
    id = String(idFactory() || "").trim();
    attempts += 1;
  }
  if (!id || ids.has(id)) throw new Error("Unable to generate a unique Quotation stable ID.");
  return id;
}

export function buildDuplicateQuotation(source = {}, values = {}, options = {}) {
  const sourceId = String(source.id || "").trim();
  if (!sourceId) throw new Error("The source Quotation stable ID is missing.");
  const now = options.now || new Date().toISOString();
  const nowDate = new Date(now);
  const existing = options.existingQuotations || state.quotations;
  const quoteNumber = options.quoteNumber || nextQuoteNumber(existing, Number.isNaN(nowDate.getTime()) ? new Date() : nowDate);
  const copyItems = values.copyItems !== false;
  const copyPrices = values.copyPrices !== false;
  const copyRemarks = values.copyRemarks !== false;
  const sourceCustomer = source.customer || {};
  const projectName = String(values.projectName ?? quotationProjectName(source)).trim();
  const siteAddress = String(values.siteAddress ?? source.siteAddress ?? sourceCustomer.address ?? "").trim();
  const customerName = String(values.customerName ?? sourceCustomer.name ?? source.customerName ?? "").trim();
  const phone = String(values.phone ?? sourceCustomer.phone ?? source.phone ?? "").trim();
  const email = String(sourceCustomer.email ?? source.email ?? "").trim();
  const company = String(sourceCustomer.company ?? source.company ?? "").trim();
  const items = copyItems
    ? (Array.isArray(source.items) ? source.items : []).map((item) => duplicateQuoteItem(item, { copyPrices, copyRemarks }))
    : [];
  const discount = copyPrices ? Number(source.discount || 0) : 0;
  const totals = quoteTotals(items, discount, 0);
  const duplicate = {
    id: uniqueQuotationId(options.idFactory, existing),
    quoteNumber,
    quotationNo: quoteNumber,
    quoteNo: quoteNumber,
    projectName,
    siteAddress,
    customer: {
      name: customerName,
      phone,
      email,
      company,
      area: projectName,
      address: siteAddress,
      remark: copyRemarks ? String(sourceCustomer.remark || "") : ""
    },
    email,
    company,
    appointmentDate: String(now).slice(0, 10),
    status: "quoted",
    workflowStatus: "quoted",
    remark: copyRemarks ? String(source.remark || source.remarks || "") : "",
    items,
    discount,
    deposit: 0,
    subtotal: totals.subtotal,
    total: totals.total,
    balance: totals.balance,
    salesperson: cloneValue(source.salesperson),
    salespersonId: source.salespersonId || "",
    salespersonName: source.salespersonName || "",
    duplicatedFromQuotationId: sourceId,
    duplicatedFromQuotationNo: getQuotationDisplayNo(source),
    createdAt: now,
    createdBy: state.currentUser?.name || state.currentUser?.username || state.currentUser?.userId || "",
    updatedAt: now
  };
  if (copyPrices) {
    copiedTaxFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(source, field)) duplicate[field] = cloneValue(source[field]);
    });
  }
  return duplicate;
}

export async function duplicateQuotation(sourceQuotationId, values = {}, options = {}) {
  if (!canDuplicateQuotation(options.userRole)) {
    return { ok: false, message: "Permission denied: only Boss, Admin or Secretary can duplicate Quotations." };
  }
  const sourceId = String(sourceQuotationId || "").trim();
  const source = sourceId ? state.quotations.find((quote) => String(quote.id || "") === sourceId) : null;
  if (!source) return { ok: false, message: "Source Quotation not found by exact stable ID." };

  const previousQuotations = state.quotations;
  const previousCurrentQuote = state.currentQuote;
  let duplicate;
  try {
    duplicate = buildDuplicateQuotation(source, values, options);
    state.quotations = [duplicate, ...state.quotations];
    const localSave = await Promise.resolve((options.saveLocal || persistQuotationsLocally)());
    if (!localSave?.ok) {
      state.quotations = previousQuotations;
      state.currentQuote = previousCurrentQuote;
      return { ok: false, message: `Duplicate Quotation was rolled back: ${localSave?.reason || "Local save failed."}` };
    }
    state.currentQuote = cloneValue(duplicate);
  } catch (error) {
    state.quotations = previousQuotations;
    state.currentQuote = previousCurrentQuote;
    return { ok: false, message: `Duplicate Quotation was rolled back: ${error.message || "Local save failed."}` };
  }

  try {
    const cloudSync = await (options.syncCloud || (() => syncCollectionNow("quotations")))();
    const localOnly = cloudSync?.reason === "Local Mode Only";
    const cloudOk = Boolean(cloudSync?.ok);
    const message = cloudOk
      ? `Quotation duplicated as ${duplicate.quoteNumber}.`
      : localOnly
        ? `Quotation duplicated locally as ${duplicate.quoteNumber}.`
        : `Quotation duplicated locally as ${duplicate.quoteNumber}, but cloud sync failed: ${cloudSync?.reason || "Unknown error"}`;
    return { ok: true, quotation: duplicate, cloudOk, localOnly, message };
  } catch (error) {
    return {
      ok: true,
      quotation: duplicate,
      cloudOk: false,
      localOnly: false,
      message: `Quotation duplicated locally as ${duplicate.quoteNumber}, but cloud sync failed: ${error.message || "Unknown error"}`
    };
  }
}

export function saveQuote() {
  const quote = ensureCurrentQuote();
  const displayNo = String(document.querySelector("#quoteNumber")?.value || getQuotationDisplayNo(quote)).trim();
  quote.quoteNumber = displayNo;
  quote.quotationNo = displayNo;
  quote.quoteNo = displayNo;
  quote.projectName = String(document.querySelector("#projectName")?.value || quotationProjectName(quote)).trim();
  quote.siteAddress = String(document.querySelector("#customerAddress")?.value || quote.siteAddress || quote.customer.address || "").trim();
  quote.customer.area = quote.projectName;
  quote.customer.address = quote.siteAddress;
  quote.updatedAt = new Date().toISOString();
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const snapshot = {
    ...quote,
    quoteNumber: displayNo,
    quotationNo: displayNo,
    quoteNo: displayNo,
    projectName: quote.projectName,
    siteAddress: quote.siteAddress,
    status: normalizeStatus(quote.status),
    subtotal: totals.subtotal,
    total: totals.total,
    balance: totals.balance,
    items: quote.items.map((item) => itemWithCalculatedTotals(item))
  };
  state.quotations = state.quotations.some((row) => row.id === snapshot.id)
    ? state.quotations.map((row) => row.id === snapshot.id ? snapshot : row)
    : [snapshot, ...state.quotations];
  const cloudSave = persistQuotations();
  const saveStatus = document.querySelector("#saveStatus");
  saveStatus.textContent = `${t("Save Quote")} ${getQuotationDisplayNo(snapshot)} - saved locally. Syncing cloud...`;
  cloudSave.then((result) => {
    saveStatus.textContent = result.ok
      ? `${t("Save Quote")} ${getQuotationDisplayNo(snapshot)} - cloud synced.`
      : result.reason === "Local Mode Only"
        ? `${t("Save Quote")} ${getQuotationDisplayNo(snapshot)} - saved locally.`
        : `${t("Save Quote")} ${getQuotationDisplayNo(snapshot)} - saved locally. Cloud sync failed: ${result.reason}`;
  });
  renderQuotationList();
}

export function newQuote() {
  state.currentQuote = makeQuote();
  renderQuotationForm();
  document.querySelector("#saveStatus").textContent = t("New quote ready.");
}

export function renderQuotationList() {
  const list = document.querySelector("#quotationList");
  if (!list) return;
  const cloudIsLoading = state.cloud.status === "Checking cloud...";
  const rows = quotationsForTab(activeQuotationTab);
  list.innerHTML = `
    <div class="filter-tabs" aria-label="${t("Quotation status")}">
      ${quotationTabs.map((status) => `<button class="filter-tab ${activeQuotationTab === status ? "active" : ""}" type="button" data-quotation-tab="${status}">${statusLabel(status)} (${quotationsForTab(status).length})</button>`).join("")}
    </div>
    ${rows.length
      ? rows.map((quote) => quotationListRowHtml(quote, cloudIsLoading, activeQuotationTab)).join("")
      : `<p class="muted-text">${t("No saved quotations yet.")}</p>`}
  `;
  list.querySelectorAll("[data-quotation-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuotationTab = quotationTabs.includes(button.dataset.quotationTab) ? button.dataset.quotationTab : "quoted";
      renderQuotationList();
    });
  });
  list.querySelectorAll("[data-open-quote]").forEach((button) => {
    button.addEventListener("click", () => {
      const quote = state.quotations.find((row) => row.id === button.dataset.openQuote);
      state.currentQuote = JSON.parse(JSON.stringify(quote));
      renderQuotationForm();
    });
  });
  list.querySelectorAll("[data-convert-quote]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Converting...";
      setSaveStatus("Converting quotation. Saving locally first...", "info");
      try {
        const result = await convertQuoteToOrder(button.dataset.convertQuote);
        setSaveStatus(result.message, result.ok ? (result.cloudOk === false && !result.localOnly ? "warning" : "success") : "error");
      } catch (error) {
        console.error("Convert to Order button failed", error);
        setSaveStatus(`Convert to Order failed: ${error.message || "Unknown error"}`, "error");
      } finally {
        renderQuotationList();
        renderWorkflowModules();
      }
    });
  });
  list.querySelectorAll("[data-open-linked-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await openOrderForQuotation(button.dataset.openLinkedOrder);
      if (!result.ok) setSaveStatus(result.message, "error");
    });
  });
  list.querySelectorAll("[data-duplicate-quote]").forEach((button) => {
    button.addEventListener("click", () => openDuplicateQuotationDialog(button.dataset.duplicateQuote));
  });
  list.querySelectorAll("[data-delete-quote]").forEach((button) => {
    button.addEventListener("click", () => deleteQuotation(button.dataset.deleteQuote));
  });
}

export function quotationsForTab(tab, quotations = state.quotations) {
  const status = quotationTabs.includes(tab) ? tab : "quoted";
  return quotations.filter((quote) => {
    if (normalizeStatus(quote.status) !== status) return false;
    if (status !== "follow_up") return true;
    return !String(quote.linkedOrderId || quote.orderId || "").trim();
  });
}

function quotationListRowHtml(quote, cloudIsLoading, tab) {
  const action = tab === "won"
    ? quotationOrderAction(quote)
    : { order: null, canConvert: false, warning: "" };
  const orderNumber = action.order?.orderNo || action.order?.orderNumber || "";
  return `
    <article class="quote-row">
      <button type="button" data-open-quote="${quote.id}">
        <span><strong>${escapeHtml(getQuotationDisplayNo(quote))}</strong><small>${escapeHtml(quote.customer.name || "-")} | ${statusLabel(quote.status)}</small><small>${t("Location / Project Name")}: ${escapeHtml(quotationProjectName(quote) || "-")}</small>${action.warning ? `<small class="warning-text">${t(action.warning)}</small>` : ""}</span>
        <span>${money(quote.total || 0)}</span>
      </button>
      ${action.order
        ? `<button class="btn primary" type="button" data-open-linked-order="${quote.id}">${t("Open Order")}: ${escapeHtml(orderNumber || "-")}</button>`
        : action.canConvert
          ? `<button class="btn primary" type="button" data-convert-quote="${quote.id}" ${cloudIsLoading ? "disabled" : ""} title="${cloudIsLoading ? "Waiting for cloud data to finish loading" : ""}">${t("Convert to Order")}</button>`
          : ""}
      ${canDuplicateQuotation() ? `<button class="btn" type="button" data-duplicate-quote="${quote.id}">${t("Duplicate Quotation")}</button>` : ""}
      ${isBossOrAdmin() ? `<button class="btn danger" type="button" data-delete-quote="${quote.id}">${t("Delete")}</button>` : ""}
    </article>
  `;
}

function openDuplicateQuotationDialog(sourceQuotationId) {
  if (!canDuplicateQuotation()) {
    setSaveStatus("Permission denied: only Boss, Admin or Secretary can duplicate Quotations.", "error");
    return;
  }
  const sourceId = String(sourceQuotationId || "").trim();
  const source = state.quotations.find((quote) => String(quote.id || "") === sourceId);
  if (!source) {
    setSaveStatus("Source Quotation not found by exact stable ID.", "error");
    return;
  }
  document.querySelector("#duplicateQuotationDialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "duplicateQuotationDialog";
  dialog.className = "detail-dialog duplicate-quotation-dialog";
  dialog.innerHTML = `
    <form id="duplicateQuotationForm" class="stack" method="dialog">
      <div class="panel-head">
        <div><p class="eyebrow">${t("Quotation")}</p><h2>${t("Duplicate Quotation")}</h2><p class="muted-text">${escapeHtml(getQuotationDisplayNo(source))} · ${escapeHtml(sourceId)}</p></div>
        <button class="btn" type="button" data-close-duplicate-quotation>${t("Close")}</button>
      </div>
      <div class="form-grid compact">
        <label>${t("Customer Name")}<input name="customerName" value="${escapeHtml(source.customer?.name || source.customerName || "")}" required /></label>
        <label>${t("Phone")}<input name="phone" value="${escapeHtml(source.customer?.phone || source.phone || "")}" /></label>
        <label>${t("Location / Project Name")}<input name="projectName" value="${escapeHtml(quotationProjectName(source))}" /></label>
        <label class="wide">${t("Site Address")}<textarea name="siteAddress" rows="3">${escapeHtml(source.siteAddress || source.customer?.address || "")}</textarea></label>
      </div>
      <div class="duplicate-quotation-options">
        <label><input type="checkbox" name="copyItems" checked /> ${t("Copy items")}</label>
        <label><input type="checkbox" name="copyPrices" checked /> ${t("Copy prices")}</label>
        <label><input type="checkbox" name="copyRemarks" checked /> ${t("Copy remarks")}</label>
      </div>
      <p class="muted-text">${t("A new Quoted record will be created. Order, payment, Production, Installation and Warranty links are never copied.")}</p>
      <p class="muted-text" data-duplicate-quotation-status></p>
      <div class="actions">
        <button class="btn" type="button" data-close-duplicate-quotation>${t("Cancel")}</button>
        <button class="btn primary" type="submit">${t("Duplicate Quotation")}</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  const closeDialog = () => dialog.close();
  dialog.querySelectorAll("[data-close-duplicate-quotation]").forEach((button) => button.addEventListener("click", closeDialog));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.querySelector("#duplicateQuotationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    const status = form.querySelector("[data-duplicate-quotation-status]");
    submit.disabled = true;
    status.textContent = t("Saving duplicate locally...");
    const result = await duplicateQuotation(sourceId, {
      customerName: form.elements.customerName.value,
      phone: form.elements.phone.value,
      projectName: form.elements.projectName.value,
      siteAddress: form.elements.siteAddress.value,
      copyItems: form.elements.copyItems.checked,
      copyPrices: form.elements.copyPrices.checked,
      copyRemarks: form.elements.copyRemarks.checked
    });
    if (!result.ok) {
      status.textContent = t(result.message);
      status.className = "warning-text";
      submit.disabled = false;
      return;
    }
    activeQuotationTab = "quoted";
    dialog.close();
    renderQuotationForm();
    setSaveStatus(result.message, result.cloudOk === false && !result.localOnly ? "warning" : "success");
  });
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function deleteQuotation(quoteId) {
  if (!isBossOrAdmin()) {
    setSaveStatus("Permission denied: your role cannot perform this action.", "error");
    return;
  }
  const quote = state.quotations.find((row) => row.id === quoteId);
  if (!quote) {
    setSaveStatus("Quotation not found.", "error");
    return;
  }
  if (quotationHasLinkedOrder(quote)) {
    setSaveStatus("This quotation has been converted to order. Please cancel/archive the order first.", "error");
    return;
  }
  const confirmation = window.prompt("Are you sure you want to delete this quotation?\nType DELETE to confirm.");
  if (confirmation !== "DELETE") {
    setSaveStatus("Delete cancelled.", "info");
    return;
  }
  state.quotations = state.quotations.filter((row) => row.id !== quoteId);
  if (state.currentQuote?.id === quoteId) state.currentQuote = null;
  const cloudSave = persistQuotations();
  setSaveStatus("Quotation deleted successfully. Syncing cloud...", "success");
  cloudSave.then((result) => {
    setSaveStatus(result.ok
      ? "Quotation deleted successfully."
      : `Quotation deleted locally. Cloud sync failed: ${result.reason}`, result.ok ? "success" : "warning");
  }).catch((error) => {
    console.error("Quotation delete cloud sync failed", error);
    setSaveStatus("Quotation deleted locally. Cloud sync failed.", "warning");
  });
  renderQuotationForm();
}

function quotationHasLinkedOrder(quote) {
  return Boolean(quotationOrderAction(quote).order);
}

function setSaveStatus(message, type = "info") {
  const status = document.querySelector("#saveStatus");
  if (!status) return;
  status.textContent = t(message);
  status.dataset.type = type;
}

export function printQuote() {
  const quote = ensureCurrentQuote();
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.print();
    return;
  }
  printWindow.document.open();
  printWindow.document.write(printableDocument(`${t("Quotation")} ${getQuotationDisplayNo(quote)}`, quoteDocumentHtml(quote)));
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 150);
}

function printableDocument(title, bodyHtml) {
  return `<!doctype html><html lang="${state.language === "zh" ? "zh" : "en"}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(title)}</title><style>${quotePrintStyles()}</style></head><body>${bodyHtml}</body></html>`;
}

export function quoteDocumentHtml(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const company = state.companySettings;
  const discountRow = Number(quote.discount || 0) > 0
    ? `<div class="total-row"><span>${t("Discount")}</span><strong>- ${money(quote.discount)}</strong></div>`
    : "";
  return `
    <main class="quotation-page">
      <header class="quote-header">
        <section class="company-block">
          <div class="logo-row"><div class="es-logo">ES</div><div><h1>${escapeHtml(company.companyName)}</h1><p class="specialist">${t("Screen and Security Mesh Specialist")}</p></div></div>
          <p>${escapeHtml(company.companyAddress)}</p>
          <p>${t("Phone")}: ${escapeHtml(company.companyPhone)}</p>
          <p class="company-website">${t("Website")}: www.ecosecurityscreens.com</p>
          ${company.companyEmail ? `<p>${t("Email")}: ${escapeHtml(company.companyEmail)}</p>` : ""}
          <p class="description">${t("Supply and installation quotation for insect screen, roller screen, stainless steel net and security mesh products.")}</p>
        </section>
        <aside class="quote-card">
          <p>${t("Quotation").toUpperCase()}</p>
          <h2>${escapeHtml(getQuotationDisplayNo(quote) || "-")}</h2>
          <div><span>${t("Quotation Date")}</span><strong>${formatDate(quote.updatedAt || quote.createdAt || new Date().toISOString())}</strong></div>
          <div><span>${t("Status")}</span><strong>${statusLabel(quote.status || "Quoted")}</strong></div>
        </aside>
      </header>
      <div class="divider"></div>
      <section class="customer-grid">
        <div class="info-box"><p class="section-label">${t("Bill To").toUpperCase()}</p><h3>${escapeHtml(quote.customer.name || "-")}</h3><p>${escapeHtml(quote.customer.phone || "-")}</p><p><strong>${t("Site Address")}:</strong> ${escapeHtml(quote.siteAddress || quote.customer.address || "-")}</p></div>
        <div class="info-box"><p class="section-label">${t("Job Details").toUpperCase()}</p><p><strong>${t("Location / Project Name")}:</strong> ${escapeHtml(quotationProjectName(quote) || "-")}</p><p><strong>${t("Appointment Date")}:</strong> ${escapeHtml(quote.appointmentDate || "-")}</p><p><strong>${t("Status")}:</strong> ${statusLabel(quote.status || "quoted")}</p></div>
      </section>
      <table class="items-table"><thead><tr><th>${t("Description")}</th><th>${t("Product")}</th><th class="right">${t("Size")}</th><th class="right">${t("Sqft")}</th><th class="right">${t("Rate")}</th><th class="right">${t("Quantity")}</th><th class="right">${t("Total")}</th></tr></thead><tbody>${quoteItemRowsHtml(quote.items)}</tbody></table>
      <section class="bottom-grid">
        <div class="terms-box"><h3>${t("Terms & Conditions")}</h3>${quoteTermsHtml(company)}</div>
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
    return `<tr><td><strong>${escapeHtml(description)}</strong>${quoteItemDetailLinesHtml(item)}</td><td>${escapeHtml(item.productName || "-")}</td><td class="right">${escapeHtml(item.width || 0)} x ${escapeHtml(item.height || 0)} mm</td><td class="right">${chargeableSqft(item).toFixed(2)}</td><td class="right">${money(item.unitPrice)}</td><td class="right">${escapeHtml(item.quantity || 0)}</td><td class="right amount">${money(lineTotal(item))}${priceAdjustmentNoteHtml(item)}</td></tr>`;
  }).join("");
}

function priceAdjustmentNoteHtml(item) {
  if (!hasManualFinalPrice(item)) return "";
  const remark = item.priceAdjustmentRemark
    ? `<small>${t("Remark")}: ${escapeHtml(item.priceAdjustmentRemark)}</small>`
    : "";
  return `<small>${t("Adjusted from")} ${money(autoCalculatedPrice(item))}</small>${remark}`;
}

function quoteItemDetailLinesHtml(item) {
  const details = [
    [t("Color"), colorLabel(item.color)],
    [t("Install Type / Inside Outside"), item.installType],
    [t("Installation Location"), item.installationLocation],
    [t("Opening Direction"), openingDirectionLabel(item.openingDirection)],
    [t("Track Size"), item.trackSize],
    [t("Handle Height"), item.handleHeight],
    [t("Track Type"), item.trackType || item.trackOpening],
    [t("Mesh / Net Type"), meshValue(item)],
    [t("Powdercoat / Powercoat"), item.powdercoat ? `${t("Yes")} (${money(powdercoatAmount(item))})` : ""]
  ];
  return details.filter(([, value]) => value).map(([label, value]) => `<small>${label}: ${escapeHtml(value)}</small>`).join("") || `<small>${t("Color")}: -</small>`;
}

function quoteTermsHtml(company = state.companySettings) {
  return `
    <p>i) ${t("Prices quoted are valid for a period of two (2) weeks from the quotation date.")}</p>
    <p>ii) ${t("50% deposit is required upon confirmation, balance of payment upon completion.")}</p>
    <p>iii) ${t("Deposit paid is non-refundable.")}</p>
    <p>iv) ${t("All cheques should not be crossed and make payable to:")}</p>
    <p class="bank-details">${escapeHtml(company.bankAccountName)}<br>${escapeHtml(company.bankName)}<br>${escapeHtml(company.bankAccountNumber)}</p>
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
  const locale = state.language === "zh" ? "zh-CN" : "en-MY";
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString(locale);
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
