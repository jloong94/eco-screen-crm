import {
  activeProducts,
  nextInstallationNumber,
  nextProductionNumber,
  nextWarrantyNumber,
  persistOrderConversionLocally,
  persistQuotations,
  persistInstallationJobs,
  persistOrders,
  persistProductionJobs,
  persistWarrantyCards,
  productById,
  state,
  syncOrderConversionCollections,
  uid
} from "./state.js";
import {
  autoCalculatedPrice,
  chargeableSqft,
  hasManualFinalPrice,
  itemWithCalculatedTotals,
  lineTotal,
  money,
  powdercoatAmount,
  quoteTotals,
  toNumber
} from "./calculations.js";
import { normalizeStatus, statusLabel, t } from "./i18n.js";
import {
  canCompleteInstallation,
  canEditOrder,
  canEditProduction,
  canScheduleInstallation,
  canSendOrder,
  canViewPrice,
  isBossOrAdmin,
  role
} from "./permissions.js";

const orderStatuses = [
  "Confirmed",
  "Touch Up",
  "Sent to Production",
  "Production Completed",
  "Sent to Installer",
  "Installation Scheduled",
  "Installing",
  "Installation Completed",
  "Pending Collection",
  "Completed",
  "Serviced",
  "Cancelled"
];
const productionStatuses = ["not_produced", "in_production", "completed"];
const installationStatuses = ["not_scheduled", "scheduled", "installed", "pending_collection", "touch_up"];
const checklistLabels = [
  "Product installed correctly",
  "Door/window tested",
  "Lock/handle tested",
  "Track checked",
  "Mesh checked",
  "Area cleaned",
  "Customer checked and accepted"
];
const warrantyTerms = [
  "Warranty covers manufacturing defects.",
  "Warranty does not cover misuse, accidental damage, modification, or damage caused by pets/children.",
  "Warranty is valid only with this warranty card and order record."
];
const orderFilters = [
  { id: "active", label: "All Active" },
  { id: "new", label: "New Orders" },
  { id: "in-production", label: "In Production" },
  { id: "waiting-installation", label: "Waiting Installation" },
  { id: "pending-collection", label: "Pending Collection" },
  { id: "touch-up", label: "Touch Up" },
  { id: "completed", label: "Completed / Serviced" },
  { id: "archived", label: "Cancelled / Archived" },
  { id: "duplicate-archived", label: "Show Archived Duplicates" },
  { id: "today-installation", label: "Today Installation" },
  { id: "week-installation", label: "This Week Installation" },
  { id: "overdue-installation", label: "Overdue Installation" },
  { id: "all", label: "All Orders" }
];

const progressCategories = [
  { id: "new", title: "New Orders / Haven't Produced", shortTitle: "New Orders" },
  { id: "in-production", title: "In Production", shortTitle: "In Production" },
  { id: "waiting-installation", title: "Production Done / Waiting Installation", shortTitle: "Waiting Installation" },
  { id: "pending-collection", title: "Installed / Pending Collection", shortTitle: "Pending Collection" },
  { id: "completed", title: "Completed / Serviced", shortTitle: "Completed / Serviced" },
  { id: "touch-up", title: "Touch Up", shortTitle: "Touch Up" },
  { id: "archived", title: "Cancelled / Archived", shortTitle: "Cancelled / Archived" }
];

let activeCompletionJobId = null;
const convertingQuoteIds = new Set();
let editingOrderId = "";
let orderEditorDraft = null;
let editingOrderNumberId = "";
let duplicateScanVisible = false;
let duplicateScanResult = null;
let duplicateArchiveBusy = false;
let orderSearch = {
  orderNumber: "",
  customerName: "",
  phone: "",
  filter: "active",
  status: "",
  installationDate: "",
  sort: "updated",
  page: 1,
  highlightId: ""
};

export async function convertQuoteToOrder(quoteId) {
  const lockKey = String(quoteId ?? "").trim();
  if (!lockKey) return failConversion("Please save quotation first");
  if (convertingQuoteIds.has(lockKey)) {
    return failConversion("Conversion already in progress. Please wait.", { busy: true });
  }

  convertingQuoteIds.add(lockKey);
  let previousState = null;
  let localCommitted = false;
  try {
    const sourceQuote = getQuoteById(lockKey);
    const existing = findExistingOrderForQuote(sourceQuote);
    if (!existing && normalizeStatus(sourceQuote?.status) !== "won") {
      return failConversion("Quotation status must be Won before conversion.");
    }
    const validation = validateQuoteForOrder(sourceQuote);
    if (!validation.ok) return failConversion(validation.message);
    const quote = quotationForConversion(sourceQuote);
    const quoteDisplayNo = ensureQuotationDisplayNo(quote);
    const order = existing || createOrderFromQuote(quote);
    if (!order) return failConversion("Failed to save order.");
    const now = new Date().toISOString();
    const updatedQuote = {
      ...quote,
      status: "won",
      workflowStatus: "converted",
      quoteNumber: quoteDisplayNo,
      quotationNo: quoteDisplayNo,
      quoteNo: quoteDisplayNo,
      orderId: order.id,
      linkedOrderId: order.id,
      orderNo: getOrderDisplayNo(order),
      orderNumber: getOrderDisplayNo(order),
      converted: true,
      convertedToOrder: true,
      convertedAt: quote.convertedAt || now,
      updatedAt: now
    };
    const workflowJobs = upsertWorkflowJobsForOrder(order, state.productionJobs, state.installationJobs);
    const nextWarrantyCards = updateWarrantyOrderNumbers(order, state.warrantyCards);
    const nextQuotations = state.quotations.map((row) => (
      row === sourceQuote || (sourceQuote.id && row.id === sourceQuote.id) ? updatedQuote : row
    ));
    const nextOrders = existing ? state.orders : [order, ...state.orders];

    previousState = {
      orders: state.orders,
      quotations: state.quotations,
      productionJobs: state.productionJobs,
      installationJobs: state.installationJobs,
      warrantyCards: state.warrantyCards
    };
    state.orders = nextOrders;
    state.quotations = nextQuotations;
    state.productionJobs = workflowJobs.productionJobs;
    state.installationJobs = workflowJobs.installationJobs;
    state.warrantyCards = nextWarrantyCards;
    if (state.currentQuote?.id === sourceQuote.id) state.currentQuote = structuredCloneSafe(updatedQuote);

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failConversion(`Failed to save order locally: ${localSave.reason}`);
    }
    localCommitted = true;

    const baseMessage = existing
      ? `Existing Order found: ${getOrderDisplayNo(order)}`
      : `Order created: ${getOrderDisplayNo(order)}`;
    showWorkflowMessage(`${baseMessage} Saved locally. Syncing cloud...`, "info");

    const cloudSync = await syncOrderConversionCollections();
    const cloudFailed = !cloudSync.ok && !cloudSync.localOnly;
    const message = cloudFailed
      ? `${baseMessage} Order saved locally but cloud sync failed: ${cloudSync.reason}`
      : cloudSync.localOnly
        ? `${baseMessage} Saved locally.`
        : baseMessage;
    showWorkflowMessage(message, cloudFailed ? "warning" : "success");
    orderSearch = { ...orderSearch, orderNumber: getOrderDisplayNo(order), filter: "all", highlightId: order.id };
    renderWorkflowModules();
    scrollToOrders();
    return {
      ok: true,
      message,
      order,
      existing: Boolean(existing),
      cloudOk: cloudSync.ok && !cloudSync.localOnly,
      localOnly: cloudSync.localOnly
    };
  } catch (error) {
    console.error("Convert to Order failed", error);
    if (!localCommitted && previousState) restoreConversionState(previousState);
    if (localCommitted) {
      const message = `Order saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, message, cloudOk: false };
    }
    return failConversion(`Unknown error: ${error.message || "Failed to save order."}`);
  } finally {
    convertingQuoteIds.delete(lockKey);
  }
}

export function getQuoteById(quoteId) {
  return state.quotations.find((row) => row.id === quoteId)
    || state.quotations.find((row) => getQuotationDisplayNo(row) === quoteId)
    || null;
}

function quotationForConversion(quote) {
  return {
    ...quote,
    customer: customerFromQuotation(quote),
    items: (Array.isArray(quote.items) ? quote.items : []).map((item) => ({ ...item }))
  };
}

function customerFromQuotation(quote = {}) {
  const customer = quote.customer && typeof quote.customer === "object" ? quote.customer : {};
  return {
    ...customer,
    name: customer.name ?? quote.customerName ?? "",
    phone: customer.phone ?? quote.phone ?? "",
    area: customer.area ?? quote.area ?? "",
    address: customer.address ?? quote.address ?? "",
    remark: customer.remark ?? quote.customerRemark ?? ""
  };
}

export function nextSalesOrderNumber(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `SO${year}${month}`;
  const references = state.orders.flatMap((order) => [order.orderNo, order.orderNumber]).filter(Boolean);
  const usedNumbers = new Set(references.map(normalizeRefNo).filter(Boolean));
  const highest = references
    .map((number) => monthlyOrderSequence(number, year, month))
    .filter((number) => Number.isInteger(number) && number > 0)
    .reduce((max, number) => Math.max(max, number), 0);
  let next = highest + 1;
  let orderNumber = `${prefix}${String(next).padStart(3, "0")}`;
  while (usedNumbers.has(orderNumber)) {
    next += 1;
    orderNumber = `${prefix}${String(next).padStart(3, "0")}`;
  }
  return orderNumber;
}

export function monthlyOrderSequence(value, year, month) {
  const compact = normalizeRefNo(value).replace(/\s+/g, "");
  const match = compact.match(new RegExp(`^SO-?${year}${month}-?(\\d+)$`));
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
}

export function createOrderFromQuote(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const quoteDisplayNo = ensureQuotationDisplayNo(quote);
  const orderNo = nextSalesOrderNumber();
  const customer = customerFromQuotation(quote);
  const appointmentDate = quote.appointmentDate || quote.appointment_date || "";
  const appointmentTime = quote.appointmentTime || quote.appointment_time || "";
  const remark = quote.remark ?? quote.remarks ?? "";
  return {
    id: uid("order"),
    orderNo,
    orderNumber: orderNo,
    quoteId: quote.id,
    quotationId: quote.id,
    quoteNumber: quoteDisplayNo,
    quotationNo: quoteDisplayNo,
    customer: { ...customer },
    customerName: customer.name,
    phone: customer.phone,
    area: customer.area,
    address: customer.address,
    items: quote.items.map((item) => ({ ...itemWithCalculatedTotals(item) })),
    subtotal: totals.subtotal,
    discount: toNumber(quote.discount),
    total: totals.total,
    deposit: toNumber(quote.deposit),
    balance: totals.balance,
    status: "Confirmed",
    sentToProduction: false,
    productionStatus: "not_produced",
    installationStatus: "not_scheduled",
    appointmentDate,
    appointmentTime,
    installationDate: appointmentDate,
    remark,
    remarks: quote.remarks ?? remark,
    customerRemark: customer.remark,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createProductionJobFromOrder(order) {
  const orderNo = getOrderDisplayNo(order);
  return {
    id: uid("production"),
    productionNumber: nextProductionNumber(),
    orderId: order.id,
    orderNo,
    orderNumber: orderNo,
    quoteNumber: order.quoteNumber || order.quotationNo || "",
    quotationNo: order.quoteNumber || order.quotationNo || "",
    customerName: order.customer.name,
    items: order.items.map((item) => itemWithCalculatedTotals(item)),
    installationDate: order.installationDate || "",
    status: order.sentToProduction ? "in_production" : "not_produced",
    remark: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function upsertWorkflowJobsForOrder(order, productionJobs, installationJobs) {
  const orderNo = getOrderDisplayNo(order);
  const productionJob = productionJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo));
  let nextProductionJobs;
  if (productionJob) {
    const updatedProductionJob = {
      ...productionJob,
      orderId: order.id,
      orderNo,
      orderNumber: orderNo,
      quoteNumber: order.quoteNumber || order.quotationNo || productionJob.quoteNumber || "",
      quotationNo: order.quoteNumber || order.quotationNo || productionJob.quotationNo || "",
      customerName: productionJob.customerName || order.customer?.name || "",
      items: Array.isArray(productionJob.items) && productionJob.items.length
        ? productionJob.items
        : order.items.map((item) => itemWithCalculatedTotals(item)),
      installationDate: productionJob.installationDate || order.installationDate || "",
      updatedAt: new Date().toISOString()
    };
    nextProductionJobs = productionJobs.map((job) => job.id === productionJob.id ? updatedProductionJob : job);
  } else {
    nextProductionJobs = [createProductionJobFromOrder(order), ...productionJobs];
  }

  const installationJob = installationJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo));
  let nextInstallationJobs;
  if (installationJob) {
    const updatedInstallationJob = {
      ...installationJob,
      orderId: order.id,
      orderNo,
      orderNumber: orderNo,
      quoteNumber: order.quoteNumber || order.quotationNo || installationJob.quoteNumber || "",
      quotationNo: order.quoteNumber || order.quotationNo || installationJob.quotationNo || "",
      customer: installationJob.customer || { ...order.customer },
      items: Array.isArray(installationJob.items) && installationJob.items.length
        ? installationJob.items
        : order.items.map((item) => itemWithCalculatedTotals(item)),
      installationDate: installationJob.installationDate || order.installationDate || "",
      balance: installationJob.balance ?? order.balance,
      balanceToCollect: installationJob.balanceToCollect ?? order.balance,
      updatedAt: new Date().toISOString()
    };
    nextInstallationJobs = installationJobs.map((job) => job.id === installationJob.id ? updatedInstallationJob : job);
  } else {
    nextInstallationJobs = [createInstallationJobFromOrder(order), ...installationJobs];
  }

  return {
    productionJobs: nextProductionJobs,
    installationJobs: nextInstallationJobs
  };
}

function updateWarrantyOrderNumbers(order, warrantyCards) {
  const orderNo = getOrderDisplayNo(order);
  return warrantyCards.map((card) => {
    const sameOrder = card.orderId === order.id || normalizeRefNo(card.orderNo || card.orderNumber) === normalizeRefNo(orderNo);
    if (!sameOrder) return card;
    return {
      ...card,
      orderId: order.id,
      orderNo,
      orderNumber: orderNo,
      quoteNumber: order.quoteNumber || order.quotationNo || "",
      quotationNo: order.quoteNumber || order.quotationNo || "",
      updatedAt: new Date().toISOString()
    };
  });
}

export function createInstallationJobFromOrder(order) {
  const orderNo = getOrderDisplayNo(order);
  return {
    id: uid("installation"),
    installationNumber: nextInstallationNumber(),
    orderId: order.id,
    orderNo,
    orderNumber: orderNo,
    quoteNumber: order.quoteNumber || order.quotationNo || "",
    quotationNo: order.quoteNumber || order.quotationNo || "",
    customer: { ...order.customer },
    items: order.items.map((item) => itemWithCalculatedTotals(item)),
    installationDate: order.installationDate,
    balance: order.balance,
    balanceToCollect: order.balance,
    amountCollected: "",
    paymentMethod: "Cash",
    paymentReference: "",
    balanceCollected: false,
    beforePhoto: "",
    afterPhoto: "",
    defectPhoto: "",
    beforePhotos: [],
    afterPhotos: [],
    defectPhotos: [],
    touchUpPhotos: [],
    installationVideos: [],
    mediaRemarks: "",
    touchUpRequired: false,
    touchUpRemark: "",
    touchUpStatus: "Pending",
    installerName: "",
    completionDate: "",
    installationRemark: "",
    checklist: {},
    customerSignature: "",
    completionStatus: "Open",
    warrantyNo: "",
    installerRemark: "",
    status: order.installationDate ? "scheduled" : "not_scheduled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function saveOrders() {
  return persistOrders();
}

export function loadOrders() {
  return state.orders;
}

function restoreConversionState(previousState) {
  if (!previousState) return;
  state.orders = previousState.orders;
  state.quotations = previousState.quotations;
  state.productionJobs = previousState.productionJobs;
  state.installationJobs = previousState.installationJobs;
  state.warrantyCards = previousState.warrantyCards;
}

function failConversion(message, extra = {}) {
  console.warn("Convert to Order:", message);
  showWorkflowMessage(message, "error");
  return { ok: false, message, ...extra };
}

function validateQuoteForOrder(quote) {
  if (!quote) return { ok: false, message: "Please save quotation first" };
  const customer = customerFromQuotation(quote);
  if (!String(customer.name || "").trim()) return { ok: false, message: "Missing customer name" };
  if (!Array.isArray(quote.items) || !quote.items.length) return { ok: false, message: "Missing quotation items" };
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  if (!Number.isFinite(totals.total)) return { ok: false, message: "Quote total must be a valid number" };
  if (totals.total <= 0) return { ok: false, message: "Quote total must be more than 0" };
  return { ok: true, totals };
}

export function getQuotationDisplayNo(quote = {}) {
  return String(quote.quotationNo || quote.quoteNo || quote.quoteNumber || quote.number || quote.refNo || "").trim();
}

export function normalizeRefNo(value) {
  return String(value ?? "").trim().toUpperCase();
}

function ensureQuotationDisplayNo(quote = {}) {
  const existingNo = getQuotationDisplayNo(quote);
  if (existingNo) return existingNo;
  const fallback = `QUOTE-${String(quote.id || uid("quote")).replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase()}`;
  quote.quoteNumber = fallback;
  quote.quotationNo = fallback;
  quote.quoteNo = fallback;
  showWorkflowMessage(`Missing quotation number. Using safe order number: ${fallback}`, "warning");
  return fallback;
}

function getOrderDisplayNo(order = {}) {
  return String(order.orderNo || order.orderNumber || order.quoteNumber || order.quotationNo || "").trim();
}

export function findExistingOrderForQuote(quote) {
  if (!quote || typeof quote !== "object") return null;

  const linkedOrderId = String(quote.linkedOrderId || quote.orderId || "").trim();
  if (linkedOrderId) {
    const linked = state.orders.find((order) => String(order.id || "") === linkedOrderId);
    if (linked) return resolveMainOrder(linked);
  }

  if (quote.id) {
    const byQuoteId = state.orders.find((order) => order.quoteId === quote.id || order.quotationId === quote.id);
    if (byQuoteId) return resolveMainOrder(byQuoteId);
  }

  const quoteReferences = new Set(quotationReferenceValues(quote));
  if (!quoteReferences.size) return null;
  const byExactReference = state.orders.find((order) => {
    const linkedReferences = quotationReferenceValues(order);
    if (linkedReferences.some((reference) => quoteReferences.has(reference))) return true;
    if (order.quoteId || order.quotationId || linkedReferences.length) return false;
    const legacyOrderNumber = normalizeRefNo(order.orderNo || order.orderNumber);
    return Boolean(legacyOrderNumber && quoteReferences.has(legacyOrderNumber));
  });
  return byExactReference ? resolveMainOrder(byExactReference) : null;
}

export function quotationOrderAction(quote) {
  const order = findExistingOrderForQuote(quote);
  const status = normalizeStatus(quote?.status);
  return {
    status,
    order,
    canConvert: status === "won" && !order,
    warning: order && status !== "won" ? "This quotation already has an Order." : ""
  };
}

export async function updateQuotationStatus(quoteId, nextStatus) {
  const quote = getQuoteById(quoteId);
  if (!quote) return failQuotationStatus("Quotation not found.");
  const normalized = normalizeStatus(nextStatus);
  if (!["quoted", "follow_up", "won", "lost"].includes(normalized)) {
    return failQuotationStatus("Please select a valid quotation status.");
  }
  const existingOrder = findExistingOrderForQuote(quote);
  if (existingOrder && normalized !== "won") {
    return failQuotationStatus("An Order already exists. Update the Order status instead.", { order: existingOrder });
  }

  const previousQuotations = state.quotations;
  const previousCurrentQuote = state.currentQuote;
  const now = new Date().toISOString();
  const updatedQuote = { ...quote, status: normalized, updatedAt: now };
  state.quotations = state.quotations.map((row) => row.id === quote.id ? updatedQuote : row);
  if (state.currentQuote?.id === quote.id) state.currentQuote = { ...state.currentQuote, status: normalized, updatedAt: now };

  try {
    const cloudSync = await persistQuotations();
    const cloudFailed = !cloudSync.ok && cloudSync.reason !== "Local Mode Only";
    const message = cloudFailed
      ? `Quotation status saved locally but cloud sync failed: ${cloudSync.reason}`
      : cloudSync.reason === "Local Mode Only"
        ? "Quotation status saved locally."
        : "Quotation status saved.";
    showWorkflowMessage(message, cloudFailed ? "warning" : "success");
    return { ok: true, status: normalized, order: existingOrder, cloudOk: cloudSync.ok, localOnly: cloudSync.reason === "Local Mode Only", message };
  } catch (error) {
    state.quotations = previousQuotations;
    state.currentQuote = previousCurrentQuote;
    return failQuotationStatus(`Failed to save quotation status: ${error.message || "Unknown error"}`);
  }
}

export async function openOrderForQuotation(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) return failQuotationStatus("Quotation not found.");
  const order = findExistingOrderForQuote(quote);
  if (!order) return failQuotationStatus("Order not found.");

  const repaired = repairQuotationLinkObject(quote, order);
  const needsRepair = repaired.orderId !== quote.orderId
    || repaired.linkedOrderId !== quote.linkedOrderId
    || repaired.orderNo !== quote.orderNo
    || repaired.orderNumber !== quote.orderNumber;
  if (needsRepair) {
    const previousQuotations = state.quotations;
    state.quotations = state.quotations.map((row) => row.id === quote.id ? repaired : row);
    if (state.currentQuote?.id === quote.id) state.currentQuote = { ...state.currentQuote, ...repaired };
    try {
      const cloudSync = await persistQuotations();
      if (!cloudSync.ok && cloudSync.reason !== "Local Mode Only") {
        showWorkflowMessage(`Quotation link repaired locally but cloud sync failed: ${cloudSync.reason}`, "warning");
      }
    } catch (error) {
      state.quotations = previousQuotations;
      return failQuotationStatus(`Failed to repair quotation link: ${error.message || "Unknown error"}`);
    }
  }

  orderSearch = { ...orderSearch, orderNumber: getOrderDisplayNo(order), filter: "all", page: 1, highlightId: order.id };
  document.querySelector?.('[data-page="orders"]')?.click();
  setTimeout(() => document.querySelector?.(`[data-order-card="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  showWorkflowMessage(`Existing Order found: ${getOrderDisplayNo(order)}`, "success");
  return { ok: true, order, repaired: needsRepair };
}

function quotationReferenceValues(record = {}) {
  return [record.quoteNumber, record.quotationNo, record.quoteNo, record.quotationRef, record.quoteRef, record.refNo]
    .map(normalizeRefNo)
    .filter(Boolean);
}

function resolveMainOrder(order) {
  if (!order || order.status !== "duplicate_archived" || !order.duplicateOfOrderId) return order;
  return state.orders.find((row) => row.id === order.duplicateOfOrderId && row.status !== "duplicate_archived") || order;
}

function repairQuotationLinkObject(quote, order) {
  const now = new Date().toISOString();
  const orderNumber = getOrderDisplayNo(order);
  return {
    ...quote,
    orderId: order.id,
    linkedOrderId: order.id,
    orderNo: orderNumber,
    orderNumber,
    converted: true,
    convertedToOrder: true,
    convertedAt: quote.convertedAt || now,
    updatedAt: now
  };
}

function failQuotationStatus(message, extra = {}) {
  showWorkflowMessage(message, "error");
  return { ok: false, message, ...extra };
}

function showWorkflowMessage(message, type = "info") {
  const status = document.querySelector("#workflowStatus") || document.querySelector("#saveStatus");
  if (!status) return;
  status.textContent = t(message);
  status.dataset.type = type;
}

function scrollToOrders() {
  document.querySelector("#ordersPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function renderWorkflowModules() {
  renderOrders();
  renderProductionJobs();
  renderInstallationJobs();
}

export function attachWorkflowEvents() {
  document.querySelector("#orderTools")?.addEventListener("input", handleOrderSearchInput);
  document.querySelector("#orderTools")?.addEventListener("click", handleOrderToolsClick);
  document.querySelector("#orderProgressBoard")?.addEventListener("click", handleOrderToolsClick);
  document.querySelector("#orderList")?.addEventListener("click", handleOrderClick);
  document.querySelector("#orderList")?.addEventListener("input", handleOrderItemInput);
  document.querySelector("#orderList")?.addEventListener("change", handleOrderChange);
  document.querySelector("#productionList")?.addEventListener("click", handleProductionClick);
  document.querySelector("#productionList")?.addEventListener("change", handleProductionChange);
  document.querySelector("#installationList")?.addEventListener("click", handleInstallationClick);
  document.querySelector("#installationList")?.addEventListener("change", handleInstallationChange);
}

export function renderOrders() {
  renderOrderTools();
  renderOrderProgressBoard();
  renderOrderList();
}

function renderOrderList() {
  const list = document.querySelector("#orderList");
  if (!list) return;
  const orders = sortedOrders(filteredOrders());
  const totalPages = Math.max(1, Math.ceil(orders.length / 20));
  orderSearch.page = Math.min(Math.max(1, Number(orderSearch.page || 1)), totalPages);
  const pageRows = orders.slice((orderSearch.page - 1) * 20, orderSearch.page * 20);
  list.innerHTML = `
    <div class="compact-order-list">
      ${pageRows.length ? pageRows.map((order) => renderCompactOrderRow(order)).join("") : `<p class="muted-text">${state.orders.length ? t("No order found") : t("No orders yet. Convert a saved quote to create an order.")}</p>`}
    </div>
    <div class="pagination-row">
      <button class="btn" type="button" data-order-page="${orderSearch.page - 1}" ${orderSearch.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>${orders.length} orders | Page ${orderSearch.page} / ${totalPages}</span>
      <button class="btn" type="button" data-order-page="${orderSearch.page + 1}" ${orderSearch.page >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function renderOrderProgressBoard() {
  const board = document.querySelector("#orderProgressBoard");
  if (!board) return;
  if (!["Boss", "Admin", "Secretary"].includes(role())) {
    board.innerHTML = "";
    return;
  }
  const filtered = state.orders.filter((order) => matchesOrderSearch(order) && matchesBoardDateFilter(order));
  board.innerHTML = `
    <section class="progress-board">
      <div class="section-head">
        <div>
          <h3>${t("Order Progress Board")}</h3>
          <p class="muted-text">${t("Production and installation progress for every order.")}</p>
        </div>
      </div>
      <div class="progress-summary-grid">
        ${progressCategories.map((category) => {
          const rows = filtered.filter((order) => getOrderProgressCategory(order) === category.id);
          return `<button class="metric-card progress-summary-card ${orderSearch.filter === category.id ? "active" : ""}" type="button" data-order-filter="${category.id}"><span>${t(category.shortTitle)}</span><strong>${rows.length}</strong></button>`;
        }).join("")}
      </div>
    </section>
  `;
}

function renderOrderTools() {
  const tools = document.querySelector("#orderTools");
  if (!tools) return;
  const visibleFilters = orderFilters.filter((filter) => filter.id !== "duplicate-archived" || isBossOrAdmin());
  tools.innerHTML = `
    <section class="order-tools">
      <div class="form-grid compact">
        <label>${t("Search Order Number")}<input data-order-search="orderNumber" value="${orderSearch.orderNumber}" placeholder="ESO-2026-0001 or 0001" /></label>
        <label>${t("Search Customer Name")}<input data-order-search="customerName" value="${orderSearch.customerName}" placeholder="Customer name" /></label>
        <label>${t("Search Phone Number")}<input data-order-search="phone" value="${orderSearch.phone}" placeholder="0123456789" /></label>
        <label>${t("Status")}<select data-order-search="status"><option value="">All status</option>${visibleFilters.map((filter) => `<option value="${filter.id}" ${orderSearch.status === filter.id ? "selected" : ""}>${t(filter.label)}</option>`).join("")}</select></label>
        <label>${t("Installation Date")}<input type="date" data-order-search="installationDate" value="${orderSearch.installationDate}" /></label>
        <label>Sort by<select data-order-search="sort">
          ${[["updated", "Latest Updated"], ["installationDate", "Installation Date"], ["orderNumber", "Order Number"]].map(([value, label]) => `<option value="${value}" ${orderSearch.sort === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" data-order-tool="search">${t("Search")}</button>
        <button class="btn" type="button" data-order-tool="clear">${t("Clear Search")}</button>
        <button class="btn" type="button" data-order-tool="find">${t("Find Order")}</button>
        ${isBossOrAdmin() ? `<button class="btn" type="button" data-order-tool="duplicates">${t("Duplicate Order Check")}</button>` : ""}
        ${isBossOrAdmin() ? `<button class="btn danger" type="button" data-order-tool="move-selected-follow-up">${t("Move Selected to Follow Up")}</button>` : ""}
      </div>
      <div class="filter-tabs">
        ${visibleFilters.map((filter) => `<button class="filter-tab ${orderSearch.filter === filter.id ? "active" : ""}" type="button" data-order-filter="${filter.id}">${t(filter.label)}</button>`).join("")}
      </div>
      ${duplicateOrderPanelHtml()}
    </section>
  `;
}

export function scanDuplicateOrders() {
  const entries = state.orders
    .map((order, index) => ({ order, index, key: orderEntryKey(order, index) }))
    .filter((entry) => entry.order.status !== "duplicate_archived");
  const parent = new Map(entries.map((entry) => [entry.key, entry.key]));
  const edges = [];
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = key;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const connect = (left, right, reason) => {
    const leftRoot = find(left.key);
    const rightRoot = find(right.key);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    edges.push({ left: left.key, right: right.key, reason });
  };
  const connectRows = (rows, reason) => {
    if (rows.length < 2) return;
    for (let index = 1; index < rows.length; index += 1) connect(rows[0], rows[index], reason);
  };

  groupedEntries(entries, (entry) => String(entry.order.id || "").trim())
    .filter(([key, rows]) => key && rows.length > 1)
    .forEach(([key, rows]) => connectRows(rows, `Same stable Order ID: ${key}`));
  groupedEntries(entries, (entry) => orderQuotationId(entry.order))
    .filter(([key, rows]) => key && rows.length > 1)
    .forEach(([key, rows]) => connectRows(rows, `Same quotation ID: ${key}`));

  const numberConflicts = [];
  groupedEntries(entries, (entry) => normalizeRefNo(getOrderDisplayNo(entry.order)))
    .filter(([key, rows]) => key && rows.length > 1)
    .forEach(([orderNumber, rows]) => {
      const quotationIds = new Set(rows.map((entry) => orderQuotationId(entry.order)).filter(Boolean));
      if (quotationIds.size > 1) {
        numberConflicts.push(makeDuplicateGroup("number-conflict", rows, [`Order Number Conflict: ${orderNumber} belongs to different quotations.`]));
        return;
      }
      connectRows(rows, `Exact same Order No: ${orderNumber}`);
    });

  const components = new Map();
  entries.forEach((entry) => {
    const root = find(entry.key);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(entry);
  });
  const confirmedGroups = [...components.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const keys = new Set(rows.map((entry) => entry.key));
      const reasons = [...new Set(edges.filter((edge) => keys.has(edge.left) && keys.has(edge.right)).map((edge) => edge.reason))];
      return makeDuplicateGroup("confirmed", rows, reasons);
    });

  const confirmedPairs = new Set();
  confirmedGroups.forEach((group) => {
    group.members.forEach((left, leftIndex) => group.members.slice(leftIndex + 1).forEach((right) => {
      confirmedPairs.add(pairKey(left.key, right.key));
    }));
  });
  const possibleGroups = [];
  entries.forEach((left, leftIndex) => entries.slice(leftIndex + 1).forEach((right) => {
    if (confirmedPairs.has(pairKey(left.key, right.key))) return;
    const leftQuoteId = orderQuotationId(left.order);
    const rightQuoteId = orderQuotationId(right.order);
    if (!leftQuoteId || !rightQuoteId || leftQuoteId === rightQuoteId) return;
    if (!samePossibleDuplicateSignature(left.order, right.order)) return;
    possibleGroups.push(makeDuplicateGroup("possible", [left, right], ["Same phone, total and item details within 30 minutes, but different quotation IDs."]));
  }));

  return {
    scannedAt: new Date().toISOString(),
    confirmedGroups,
    possibleGroups,
    numberConflicts
  };
}

function duplicateOrderPanelHtml() {
  if (!isBossOrAdmin() || !duplicateScanVisible) return "";
  const scan = duplicateScanResult || scanDuplicateOrders();
  const issueCount = scan.confirmedGroups.length + scan.possibleGroups.length + scan.numberConflicts.length;
  return `
    <section class="duplicate-order-panel">
      <div class="section-head">
        <div>
          <h3>${t("Duplicate Order Check")}</h3>
          <p class="muted-text">${t("Preview only. Nothing is archived until a Main Order is selected and confirmed.")}</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-order-tool="duplicates-refresh">${t("Scan Again")}</button>
          <button class="btn" type="button" data-order-tool="duplicates-close">${t("Close")}</button>
        </div>
      </div>
      <div class="duplicate-summary">
        <span>${t("Confirmed duplicate groups")}: <strong>${scan.confirmedGroups.length}</strong></span>
        <span>${t("Order number conflicts")}: <strong>${scan.numberConflicts.length}</strong></span>
        <span>${t("Possible duplicate groups")}: <strong>${scan.possibleGroups.length}</strong></span>
      </div>
      ${issueCount ? "" : `<p class="empty-state">${t("No duplicate orders detected.")}</p>`}
      ${duplicateGroupsHtml(t("Confirmed Duplicates"), scan.confirmedGroups, "confirmed")}
      ${duplicateGroupsHtml(t("Order Number Conflicts"), scan.numberConflicts, "conflict")}
      ${duplicateGroupsHtml(t("Possible Duplicates"), scan.possibleGroups, "possible")}
    </section>
  `;
}

function duplicateGroupsHtml(title, groups, type) {
  if (!groups.length) return "";
  return `
    <div class="duplicate-section">
      <h4>${title}</h4>
      ${groups.map((group) => `
        <article class="duplicate-group-card" data-duplicate-group-card="${group.id}">
          <p><strong>${escapeHtml(group.reasons.join(" | "))}</strong></p>
          <div class="duplicate-member-list">
            ${group.members.map((member, index) => duplicateMemberHtml(member, group, type === "confirmed", index === 0)).join("")}
          </div>
          ${type === "confirmed" ? `
            <div class="actions">
              <button class="btn danger" type="button" data-archive-duplicate-group="${group.id}" ${duplicateArchiveBusy ? "disabled" : ""}>${t("Archive Duplicate")}</button>
            </div>
          ` : type === "conflict" ? `<p class="warning-text">${t("Do not archive automatically. Open an order and edit one Order No manually.")}</p>` : `<p class="muted-text">${t("Possible duplicates are preview only and cannot be archived here.")}</p>`}
        </article>
      `).join("")}
    </div>
  `;
}

function duplicateMemberHtml(member, group, selectable, checked) {
  const order = member.order;
  const details = duplicateOrderDetails(member);
  return `
    <div class="duplicate-member">
      ${selectable ? `<label class="duplicate-main-choice"><input type="radio" name="duplicate-main-${group.id}" data-duplicate-main="${escapeHtml(member.key)}" ${checked ? "checked" : ""} /> ${t("Keep as Main Order")}</label>` : ""}
      <div class="duplicate-member-grid">
        <span>${t("Order ID")}<strong>${escapeHtml(order.id || "-")}</strong></span>
        <span>${t("Order No")}<strong>${escapeHtml(getOrderDisplayNo(order) || "-")}</strong></span>
        <span>${t("Quotation Number")}<strong>${escapeHtml(details.quotationNo || "-")}</strong></span>
        <span>${t("Customer")}<strong>${escapeHtml(order.customer?.name || order.customerName || "-")}</strong></span>
        <span>${t("Phone")}<strong>${escapeHtml(order.customer?.phone || order.phone || "-")}</strong></span>
        <span>${t("Total")}<strong>${money(order.total)}</strong></span>
        <span>${t("Created At")}<strong>${escapeHtml(order.createdAt || "-")}</strong></span>
        <span>${t("Status")}<strong>${statusLabel(order.status || "-")}</strong></span>
        <span>${t("Production job count")}<strong>${details.productionCount}</strong></span>
        <span>${t("Installation job count")}<strong>${details.installationCount}</strong></span>
      </div>
      ${selectable ? "" : `<button class="btn" type="button" data-duplicate-open-order="${escapeHtml(order.id || "")}">${t("Open Order")}</button>`}
    </div>
  `;
}

function makeDuplicateGroup(type, rows, reasons) {
  const sorted = [...rows].sort((left, right) => left.index - right.index);
  return {
    id: `${type}-${sorted.map((entry) => entry.index).join("-")}`,
    type,
    reasons,
    members: sorted
  };
}

function groupedEntries(entries, keyForEntry) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = keyForEntry(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.entries()];
}

function orderEntryKey(order, index) {
  return `${String(order.id || "missing")}::${index}`;
}

function orderQuotationId(order = {}) {
  return String(order.quotationId || order.quoteId || "").trim();
}

function pairKey(left, right) {
  return [left, right].sort().join("|");
}

function samePossibleDuplicateSignature(left, right) {
  const leftPhone = String(left.customer?.phone || left.phone || "").replace(/\D/g, "");
  const rightPhone = String(right.customer?.phone || right.phone || "").replace(/\D/g, "");
  if (!leftPhone || leftPhone !== rightPhone) return false;
  if (left.total === undefined || left.total === null || left.total === "" || right.total === undefined || right.total === null || right.total === "") return false;
  if (Number(left.total) !== Number(right.total)) return false;
  if (!Array.isArray(left.items) || !left.items.length || !Array.isArray(right.items) || !right.items.length) return false;
  if (savedItemSignature(left.items) !== savedItemSignature(right.items)) return false;
  const leftCreated = Date.parse(left.createdAt || "");
  const rightCreated = Date.parse(right.createdAt || "");
  return Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && Math.abs(leftCreated - rightCreated) <= 30 * 60 * 1000;
}

function savedItemSignature(items) {
  return JSON.stringify(items.map((item) => ({
    productId: item.productId ?? "",
    productName: item.productName ?? "",
    width: item.width ?? "",
    height: item.height ?? "",
    sqft: item.sqft ?? item.area ?? "",
    quantity: item.quantity ?? "",
    color: item.color ?? "",
    location: item.installationLocation ?? item.location ?? "",
    unitPrice: item.unitPrice ?? "",
    manualFinalPrice: item.manualFinalPrice ?? "",
    lineTotal: item.lineTotal ?? "",
    remark: item.remark ?? ""
  })));
}

function duplicateOrderDetails(member) {
  const order = member.order;
  const orderNumber = normalizeRefNo(getOrderDisplayNo(order));
  const quotation = state.quotations.find((quote) => quote.id === order.quoteId || quote.id === order.quotationId);
  const belongs = (record) => record.orderId === order.id
    || (orderNumber && normalizeRefNo(record.orderNo || record.orderNumber) === orderNumber);
  return {
    quotationNo: order.quoteNumber || order.quotationNo || order.quoteNo || getQuotationDisplayNo(quotation || {}),
    productionCount: state.productionJobs.filter(belongs).length,
    installationCount: state.installationJobs.filter(belongs).length
  };
}

function renderCompactOrderRow(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="compact-order-row ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      ${isBossOrAdmin() ? `<label class="checkbox-row"><input type="checkbox" data-order-select="${order.id}" /> Select</label>` : ""}
      <div><strong>${getOrderDisplayNo(order)}</strong><span>${t("Quote")}: ${order.quoteNumber || order.quotationNo || "-"} | ${order.customer?.name || "-"} | ${order.customer?.phone || "-"}</span></div>
      <div><span>${order.customer?.area || "-"}</span><span>${order.installationDate || installationJob?.installationDate || "-"}</span></div>
      <div><span>${t("Production")}: ${statusLabel(getOrderProductionStatus(order, productionJob))}</span><span>${t("Installation")}: ${statusLabel(getOrderInstallationStatus(order, installationJob))}</span></div>
      <div><span>${t("Remaining Balance")}: ${money(getRemainingBalance(order, installationJob))}</span><span>Updated: ${formatShortDate(order.updatedAt || order.createdAt)}</span></div>
      ${orderActionsHtml(order)}
      ${editingOrderId === order.id && orderEditorDraft ? orderItemEditorHtml(orderEditorDraft) : ""}
    </article>
  `;
}

function orderActionsHtml(order) {
  if (order.status === "duplicate_archived") {
    const orderIndex = state.orders.indexOf(order);
    return `
      <div class="actions">
        <button class="btn" type="button" data-view-order="${order.id}">${t("View Order")}</button>
        <button class="btn" type="button" data-print-order="${order.id}">${t("Print Order")}</button>
        ${isBossOrAdmin() ? `<button class="btn primary" type="button" data-restore-duplicate="${escapeHtml(orderEntryKey(order, orderIndex))}">${t("Restore Archived Duplicate")}</button>` : ""}
      </div>
      <p class="warning-text">${t("Archived duplicate of")} ${escapeHtml(order.duplicateOfOrderNo || order.duplicateOfOrderId || "-")} | ${escapeHtml(order.duplicateReason || "-")}</p>
    `;
  }
  return `
    <div class="actions">
      <button class="btn" type="button" data-view-order="${order.id}">${t("View Order")}</button>
      <button class="btn primary" type="button" data-print-order="${order.id}">${t("Print Order")}</button>
      ${canSendOrder() ? `<button class="btn" type="button" data-send-production="${order.id}">${t("Send to Production")}</button><button class="btn" type="button" data-send-installer="${order.id}">${t("Send to Installer")}</button>` : ""}
      <button class="btn" type="button" data-whatsapp-order="${order.id}">${t("WhatsApp Customer")}</button>
      <button class="btn" type="button" data-highlight-order="${order.id}">${t("Search / Open Customer")}</button>
      ${canEditOrder() ? `<button class="btn" type="button" data-edit-order-items="${order.id}">${editingOrderId === order.id ? t("Close Item Editor") : t("Edit Order Items")}</button>` : ""}
      ${isBossOrAdmin() ? `<button class="btn" type="button" data-edit-order-number="${order.id}">${editingOrderNumberId === order.id ? t("Cancel Order Number Edit") : t("Edit Order Number")}</button>` : ""}
      ${isBossOrAdmin() ? `<button class="btn danger" type="button" data-move-follow-up="${order.id}">${t("Move Back to Follow Up")}</button>` : ""}
    </div>
    ${canSendOrder() ? orderStatusActionHtml(order) : ""}
    ${editingOrderNumberId === order.id && isBossOrAdmin() ? orderNumberEditorHtml(order) : ""}
  `;
}

function orderStatusActionHtml(order) {
  return `
    <div class="order-status-action">
      <label>${t("Order Status")}
        <select data-order-status-select="${order.id}">${orderStatusOptions(order.status)}</select>
      </label>
      <button class="btn" type="button" data-update-order-status="${order.id}">${t("Update Status")}</button>
    </div>
  `;
}

function orderStatusOptions(currentStatus) {
  const values = orderStatuses.includes(currentStatus) || !currentStatus
    ? orderStatuses
    : [currentStatus, ...orderStatuses];
  return values.map((status) => `<option value="${escapeHtml(status)}" ${status === currentStatus ? "selected" : ""}>${statusLabel(status)}</option>`).join("");
}

function orderNumberEditorHtml(order) {
  const currentNumber = getOrderDisplayNo(order);
  return `
    <section class="order-number-editor" data-order-number-editor="${order.id}">
      <div>
        <strong>${t("Current Order Number")}: ${escapeHtml(currentNumber)}</strong>
        <p class="muted-text">${t("Recommended format")}: SOYYMMNNN (${t("Example")}: SO2607001)</p>
      </div>
      <label>${t("New Order Number")}
        <input data-order-number-input="${order.id}" value="${escapeHtml(currentNumber)}" autocomplete="off" />
      </label>
      <div class="actions">
        <button class="btn primary" type="button" data-save-order-number="${order.id}">${t("Save Order Number")}</button>
        <button class="btn" type="button" data-cancel-order-number="${order.id}">${t("Cancel")}</button>
      </div>
    </section>
  `;
}

function orderItemEditorHtml(order) {
  return `
    <section class="order-item-editor" data-order-item-editor="${order.id}">
      <div class="section-head">
        <div>
          <h3>${t("Edit Order Items")}</h3>
          <p class="muted-text">${t("Order No")}: ${escapeHtml(getOrderDisplayNo(order))} (${t("Read only")})</p>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-save-order-items="${order.id}">${t("Save Order Items")}</button>
          <button class="btn" type="button" data-cancel-order-items="${order.id}">${t("Cancel")}</button>
        </div>
      </div>
      <div class="order-edit-items">
        ${order.items.map((item, index) => orderItemEditCardHtml(order.id, item, index)).join("")}
      </div>
      <div class="order-editor-summary">
        <span>${t("Subtotal")} <strong data-order-editor-summary="subtotal">${money(order.subtotal)}</strong></span>
        <span>${t("Discount")} <strong>${money(order.discount)}</strong></span>
        <span>${t("Total")} <strong data-order-editor-summary="total">${money(order.total)}</strong></span>
        <span>${t("Deposit")} <strong>${money(order.deposit)}</strong></span>
        <span>${t("Balance")} <strong data-order-editor-summary="balance">${money(order.balance)}</strong></span>
      </div>
    </section>
  `;
}

function orderItemEditCardHtml(orderId, item, index) {
  return `
    <article class="order-item-edit-card" data-order-edit-item="${item.id}">
      <strong>${t("Product")} ${index + 1}</strong>
      <div class="form-grid compact">
        <label>${t("Product")}<select data-order-id="${orderId}" data-order-item-id="${item.id}" data-order-item-field="productId">${orderProductOptions(item)}</select></label>
        ${orderItemInput(t("Width mm"), orderId, item.id, "width", item.width, "decimal")}
        ${orderItemInput(t("Height mm"), orderId, item.id, "height", item.height, "decimal")}
        ${orderItemInput(t("Quantity"), orderId, item.id, "quantity", item.quantity, "decimal")}
        ${orderItemInput(t("Color"), orderId, item.id, "color", item.color)}
        ${orderItemInput(t("Installation Location"), orderId, item.id, "installationLocation", item.installationLocation)}
        ${orderItemInput(t("Unit Price"), orderId, item.id, "unitPrice", item.unitPrice, "decimal")}
        ${orderItemInput(t("Manual Final Price"), orderId, item.id, "manualFinalPrice", item.manualFinalPrice, "decimal", "Optional final RM")}
        <label>${t("ft2 / Area")}<input value="${chargeableSqft(item).toFixed(2)}" data-order-line="${item.id}" data-order-line-field="area" readonly /></label>
        <label>${t("Auto Calculated Price")}<input value="${money(autoCalculatedPrice(item))}" data-order-line="${item.id}" data-order-line-field="auto" readonly /></label>
        <label>${t("Line Total")}<input value="${money(lineTotal(item))}" data-order-line="${item.id}" data-order-line-field="total" readonly /></label>
        <label class="wide">${t("Remark")}<textarea rows="2" data-order-id="${orderId}" data-order-item-id="${item.id}" data-order-item-field="remark">${escapeHtml(item.remark || "")}</textarea></label>
      </div>
    </article>
  `;
}

function orderItemInput(label, orderId, itemId, field, value = "", inputMode = "", placeholder = "") {
  return `<label>${label}<input ${inputMode ? `inputmode="${inputMode}"` : ""} data-order-id="${orderId}" data-order-item-id="${itemId}" data-order-item-field="${field}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(placeholder)}" /></label>`;
}

function orderProductOptions(item) {
  const products = activeProducts();
  const selected = state.products.find((product) => product.id === item.productId);
  if (selected && !products.some((product) => product.id === selected.id)) products.push(selected);
  const options = products.map((product) => `<option value="${product.id}" ${product.id === item.productId ? "selected" : ""}>${escapeHtml(product.name)}</option>`).join("");
  if (selected || !item.productName) return options;
  return `<option value="" selected>${escapeHtml(item.productName)}</option>${options}`;
}

function renderOrderProgressCard(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="progress-card ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      <strong>${getOrderDisplayNo(order)}</strong>
      <p class="muted-text">${t("Quote")}: ${order.quoteNumber || order.quotationNo || "-"}</p>
      <p>${order.customer?.name || "-"} | ${order.customer?.phone || "-"}</p>
      <p class="muted-text">${order.customer?.area || "-"} | ${order.customer?.address || "-"}</p>
      <p class="muted-text">${productSummary(order.items)}</p>
      <div class="progress-meta">
        <span>${t("Installation Date")}: ${order.installationDate || installationJob?.installationDate || "-"}</span>
        <span>${t("Order")}: ${statusLabel(order.status || "-")}</span>
        <span>${t("Production")}: ${statusLabel(productionJob?.status || "Not sent")}</span>
        <span>${t("Installation")}: ${statusLabel(installationJob?.status || "Not sent")}</span>
        <span>${t("Balance")}: ${money(getOrderBalance(order))}</span>
        <span>Updated: ${formatShortDate(order.updatedAt || order.createdAt)}</span>
      </div>
      ${orderActionsHtml(order)}
    </article>
  `;
}

function productSummary(items = []) {
  return items.map((item) => `${item.productName} x ${item.quantity || 0}`).join(", ") || "-";
}

function filteredOrders() {
  return state.orders.filter((order) => matchesOrderFilter(order) && matchesOrderSearch(order));
}

function matchesOrderSearch(order) {
  const orderNumber = normalizeText(getOrderDisplayNo(order));
  const customerName = normalizeText(order.customer?.name);
  const phone = normalizeText(order.customer?.phone);
  const installationJob = getOrderInstallationJob(order);
  const installDate = installationJob?.installationDate || order.installationDate || "";
  return (!orderSearch.orderNumber || orderNumber.includes(normalizeText(orderSearch.orderNumber)))
    && (!orderSearch.customerName || customerName.includes(normalizeText(orderSearch.customerName)))
    && (!orderSearch.phone || phone.includes(normalizeText(orderSearch.phone)))
    && (!orderSearch.status || getOrderProgressCategory(order) === orderSearch.status)
    && (!orderSearch.installationDate || installDate === orderSearch.installationDate);
}

function matchesOrderFilter(order) {
  if (orderSearch.filter === "all") return true;
  if (orderSearch.filter === "duplicate-archived") return order.status === "duplicate_archived";
  if (["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return matchesBoardDateFilter(order);
  if (orderSearch.filter === "active") return !["archived", "duplicate-archived", "completed"].includes(getOrderProgressCategory(order));
  return getOrderProgressCategory(order) === orderSearch.filter;
}

function matchesProgressFilter(categoryId, order) {
  if (orderSearch.filter === "all") return true;
  if (["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return matchesBoardDateFilter(order);
  if (orderSearch.filter === "active") return !["archived", "duplicate-archived", "completed"].includes(categoryId);
  return categoryId === orderSearch.filter;
}

function sortedOrders(rows) {
  return [...rows].sort((a, b) => {
    if (orderSearch.sort === "installationDate") return String(a.installationDate || "").localeCompare(String(b.installationDate || ""));
    if (orderSearch.sort === "orderNumber") return String(getOrderDisplayNo(a)).localeCompare(String(getOrderDisplayNo(b)));
    return Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0);
  });
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getOrderProductionJob(order) {
  const orderNo = getOrderDisplayNo(order);
  return state.productionJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo)) || null;
}

function getOrderInstallationJob(order) {
  const orderNo = getOrderDisplayNo(order);
  return state.installationJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo)) || null;
}

function getOrderBalance(order) {
  const installationJob = getOrderInstallationJob(order);
  return getRemainingBalance(order, installationJob);
}

function normalizeProductionStatus(value, sentToProduction = false) {
  const map = {
    "Not Sent": "not_produced",
    "Pending": sentToProduction ? "in_production" : "not_produced",
    "Pending Production": sentToProduction ? "in_production" : "not_produced",
    "In Production": "in_production",
    "Production Completed": "completed",
    Completed: "completed",
    not_produced: "not_produced",
    in_production: "in_production",
    completed: "completed"
  };
  return map[value] || "not_produced";
}

function normalizeInstallationStatus(value) {
  const map = {
    Pending: "not_scheduled",
    "Not Scheduled": "not_scheduled",
    Scheduled: "scheduled",
    Installing: "scheduled",
    Installed: "installed",
    Completed: "installed",
    "Installation Completed": "installed",
    "Pending Collection": "pending_collection",
    "Touch Up": "touch_up",
    not_scheduled: "not_scheduled",
    scheduled: "scheduled",
    installed: "installed",
    pending_collection: "pending_collection",
    touch_up: "touch_up"
  };
  return map[value] || "not_scheduled";
}

function getOrderProductionStatus(order, productionJob = getOrderProductionJob(order)) {
  return normalizeProductionStatus(order.productionStatus || productionJob?.status, order.sentToProduction === true);
}

function getOrderInstallationStatus(order, installationJob = getOrderInstallationJob(order)) {
  return normalizeInstallationStatus(order.installationStatus || installationJob?.status);
}

function getRemainingBalance(order, installationJob = getOrderInstallationJob(order)) {
  const baseBalance = Number(installationJob?.balanceToCollect ?? order.balance ?? 0);
  const collected = Number(installationJob?.amountCollected || 0);
  if (installationJob?.balanceCollected && collected >= baseBalance) return 0;
  const explicitBalance = Number(installationJob?.balance ?? Number.NaN);
  if (Number.isFinite(explicitBalance) && installationJob?.completionStatus === "Completed") return Math.max(0, explicitBalance);
  return Math.max(0, baseBalance - collected);
}

function getOrderProgressCategory(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  const productionStatus = getOrderProductionStatus(order, productionJob);
  const installationStatus = getOrderInstallationStatus(order, installationJob);
  const balance = getRemainingBalance(order, installationJob);
  const sentToProduction = order.sentToProduction === true || ["Sent to Production", "In Production", "Production Completed"].includes(order.status);
  if (order.status === "duplicate_archived") return "duplicate-archived";
  if (order.isArchived || order.status === "Cancelled") return "archived";
  if (installationStatus === "touch_up" || order.status === "Touch Up") return "touch-up";
  if (installationStatus === "installed" && balance <= 0) return "completed";
  if (installationStatus === "pending_collection" || (["installed", "pending_collection"].includes(installationStatus) && balance > 0)) return "pending-collection";
  if (productionStatus === "completed" && !["installed", "pending_collection", "touch_up"].includes(installationStatus)) return "waiting-installation";
  if (sentToProduction && productionStatus === "in_production") return "in-production";
  return "new";
}

function matchesBoardDateFilter(order) {
  const installationJob = getOrderInstallationJob(order);
  const dateValue = installationJob?.installationDate || order.installationDate;
  if (!["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return true;
  if (!dateValue) return false;
  const today = startOfDay(new Date());
  const date = startOfDay(new Date(dateValue));
  if (Number.isNaN(date.getTime())) return false;
  if (orderSearch.filter === "today-installation") return date.getTime() === today.getTime();
  if (orderSearch.filter === "week-installation") {
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    return date >= today && date <= weekEnd;
  }
  if (orderSearch.filter === "overdue-installation") return date < today && !["completed", "archived"].includes(getOrderProgressCategory(order));
  return true;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function renderProductionJobs() {
  const list = document.querySelector("#productionList");
  if (!list) return;
  list.innerHTML = state.productionJobs.length ? state.productionJobs.map((job) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${job.productionNumber}</strong>
          <p class="muted-text">${t("Order")}: ${job.orderNo || job.orderNumber} | ${job.customerName || "-"}</p>
          <p class="muted-text">${t("Quote")}: ${job.quoteNumber || job.quotationNo || "-"}</p>
          <p class="muted-text">${t("Installation Date")}: ${job.installationDate || "-"}</p>
        </div>
        <span class="pill">${statusLabel(job.status)}</span>
      </div>
      <label>${t("Production Status")}<select data-production-id="${job.id}" data-production-field="status" ${canEditProduction() ? "" : "disabled"}>${productionStatuses.map((status) => `<option value="${status}" ${normalizeProductionStatus(job.status, true) === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label>
      <label>${t("Production Remark")}<textarea rows="2" data-production-id="${job.id}" data-production-field="remark" ${canEditProduction() ? "" : "readonly"}>${job.remark || ""}</textarea></label>
      ${itemsSummary(job.items)}
      <div class="actions">
        <button class="btn" type="button" data-view-production="${job.id}">${t("View Production Job")}</button>
        <button class="btn primary" type="button" data-print-production="${job.id}">${t("Print Production Sheet")}</button>
        ${canEditProduction() ? `<button class="btn" type="button" data-mark-production-status="${job.id}" data-status="in_production">${t("Mark In Production")}</button><button class="btn" type="button" data-mark-production-status="${job.id}" data-status="completed">${t("Mark Production Completed")}</button>` : ""}
      </div>
    </article>
  `).join("") : `<p class="muted-text">${t("No production jobs yet.")}</p>`;
}

function renderInstallationJobs() {
  const list = document.querySelector("#installationList");
  if (!list) return;
  list.innerHTML = state.installationJobs.length ? state.installationJobs.map((job) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${job.installationNumber}</strong>
          <p class="muted-text">${t("Order")}: ${job.orderNo || job.orderNumber} | ${job.customer.name || "-"}</p>
          <p class="muted-text">${t("Quote")}: ${job.quoteNumber || job.quotationNo || "-"}</p>
          <p class="muted-text">${job.customer.phone || "-"} | ${job.customer.address || "-"}</p>
        </div>
        <span class="pill">${money(getRemainingBalance(findOrder(job.orderId) || {}, job))} ${t("Remaining Balance")}</span>
      </div>
      <div class="form-grid compact">
        <label>${t("Installation Date")}<input type="date" data-installation-id="${job.id}" data-installation-field="installationDate" value="${job.installationDate || ""}" ${canScheduleInstallation() ? "" : "readonly"} /></label>
        <label>${t("Status")}<select data-installation-id="${job.id}" data-installation-field="status" ${canScheduleInstallation() ? "" : "disabled"}>${installationStatuses.map((status) => `<option value="${status}" ${normalizeInstallationStatus(job.status) === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label>
        <label class="wide">${t("Installer Remark")}<textarea rows="2" data-installation-id="${job.id}" data-installation-field="installerRemark" ${canScheduleInstallation() ? "" : "readonly"}>${job.installerRemark || ""}</textarea></label>
      </div>
      ${itemsSummary(job.items)}
      ${completionSummaryHtml(job)}
      <div class="actions">
        <button class="btn" type="button" data-view-installation="${job.id}">${t("View Installation Job")}</button>
        <button class="btn primary" type="button" data-print-installation="${job.id}">${t("Print Installation Sheet")}</button>
        <button class="btn" type="button" data-whatsapp-installation="${job.id}">${t("WhatsApp Customer")}</button>
        ${canScheduleInstallation() ? `<button class="btn" type="button" data-mark-installation-status="${job.id}" data-status="scheduled">${t("Mark Scheduled")}</button>` : ""}
        ${job.status === "touch_up" && canCompleteInstallation() ? `<button class="btn" type="button" data-mark-touchup-completed="${job.id}">${t("Mark Touch Up Completed")}</button>` : ""}
        ${canCompleteInstallation() ? `<button class="btn" type="button" data-complete-installation="${job.id}">${t("Complete Installation")}</button><button class="btn" type="button" data-generate-warranty="${job.id}">${t("Generate Warranty Card")}</button>` : ""}
        <button class="btn" type="button" data-print-warranty="${job.id}">${t("Print Warranty Card")}</button>
        <button class="btn" type="button" data-print-warranty="${job.id}">${t("PDF Warranty Card")}</button>
      </div>
      ${activeCompletionJobId === job.id ? completionFormHtml(job) : ""}
    </article>
  `).join("") : `<p class="muted-text">${t("No installation jobs yet.")}</p>`;
  if (activeCompletionJobId) setupSignatureCanvas(activeCompletionJobId);
}

function completionSummaryHtml(job) {
  if (!job.completionDate && !job.afterPhoto && !job.afterPhotos?.length && !job.customerSignature) return "";
  return `
    <div class="completion-summary">
      <strong>${t("Completed / Serviced")}</strong>
      <span>${t("Installer")}: ${job.installerName || "-"}</span>
      <span>${t("Installation Date")}: ${job.completionDate || "-"}</span>
      <span>${t("Amount collected")}: ${money(job.amountCollected || 0)} / ${money(job.balanceToCollect ?? job.balance ?? 0)}</span>
      <span>${t("Warranty Card")}: ${job.warrantyNo || "-"}</span>
    </div>
  `;
}

function completionFormHtml(job) {
  const checklist = job.checklist || {};
  const balance = job.balanceToCollect ?? job.balance ?? 0;
  return `
    <section class="completion-panel" data-completion-panel="${job.id}">
      <div class="section-head">
        <div>
          <h3>${t("Complete Installation")}</h3>
          <p class="muted-text">Photo, checklist, collection and customer signature are required.</p>
        </div>
        <button class="btn" type="button" data-close-completion="${job.id}">Close</button>
      </div>
      <div class="form-grid">
        <label>${t("Installer")}<input data-completion-field="installerName" value="${job.installerName || ""}" placeholder="Installer name" /></label>
        <label>${t("Installation Date")} / Time<input type="datetime-local" data-completion-field="completionDate" value="${job.completionDate || currentDateTimeLocal()}" /></label>
        <label class="wide">${t("Installer Remark")}<textarea rows="2" data-completion-field="installationRemark" placeholder="Installation remark">${job.installationRemark || job.installerRemark || ""}</textarea></label>
      </div>

      <div class="photo-grid">
        ${mediaUploadHtml(job, "beforePhotos", "Before Photos", "image/*")}
        ${mediaUploadHtml(job, "afterPhotos", "After Photos", "image/*")}
        ${mediaUploadHtml(job, "defectPhotos", "Defect Photos", "image/*")}
        ${mediaUploadHtml(job, "touchUpPhotos", "Touch-up Photos", "image/*")}
        ${mediaUploadHtml(job, "installationVideos", "Installation Videos", "video/*")}
      </div>
      <label>${t("Installation Videos")} / ${t("Remark")}<textarea rows="2" data-completion-field="mediaRemarks" placeholder="Media note">${job.mediaRemarks || ""}</textarea></label>

      <div class="checklist-box">
        <h3>Customer Inspection Checklist</h3>
        <div class="checklist-grid">
          ${checklistLabels.map((label) => `
            <label class="checkbox-row"><input type="checkbox" data-checklist="${label}" ${checklist[label] ? "checked" : ""} /> ${label}</label>
          `).join("")}
        </div>
      </div>

      <div class="form-grid">
        <label>${t("Balance")}<input inputmode="decimal" data-completion-field="balanceToCollect" value="${balance}" /></label>
        <label>${t("Amount collected")}<input inputmode="decimal" data-completion-field="amountCollected" value="${job.amountCollected || ""}" placeholder="0.00" /></label>
        <label>${t("Payment Method")}<select data-completion-field="paymentMethod">
          ${["Cash", "Bank Transfer", "DuitNow", "TNG", "Other"].map((method) => `<option value="${method}" ${job.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
        </select></label>
        <label>Balance collected?<select data-completion-field="balanceCollected">
          <option value="false" ${job.balanceCollected ? "" : "selected"}>No</option>
          <option value="true" ${job.balanceCollected ? "selected" : ""}>Yes</option>
        </select></label>
        <label class="wide">Payment Reference / Remark<textarea rows="2" data-completion-field="paymentReference" placeholder="Transfer ref, cash note, collection remark">${job.paymentReference || ""}</textarea></label>
        <label>${t("Touch up required?")}<select data-completion-field="touchUpRequired">
          <option value="false" ${job.touchUpRequired ? "" : "selected"}>No</option>
          <option value="true" ${job.touchUpRequired ? "selected" : ""}>Yes</option>
        </select></label>
        <label>Touch up status<select data-completion-field="touchUpStatus">
          ${["Pending", "Completed"].map((status) => `<option value="${status}" ${job.touchUpStatus === status ? "selected" : ""}>${status}</option>`).join("")}
        </select></label>
        <label class="wide">${t("Touch up remark")}<textarea rows="2" data-completion-field="touchUpRemark" placeholder="Touch-up issue / action needed">${job.touchUpRemark || ""}</textarea></label>
      </div>

      <div class="signature-box">
        <div class="section-head">
          <div>
            <h3>${t("Customer Signature")}</h3>
            <p class="muted-text">Customer signs here with finger or mouse.</p>
          </div>
          <button class="btn" type="button" data-clear-signature="${job.id}">Clear Signature</button>
        </div>
        <canvas class="signature-canvas" width="720" height="220" data-signature-canvas="${job.id}"></canvas>
      </div>

      <p class="muted-text" data-completion-error="${job.id}"></p>
      <div class="actions">
        <button class="btn primary" type="button" data-save-completion="${job.id}">${t("Save Completion")}</button>
      </div>
    </section>
  `;
}

function mediaUploadHtml(job, field, label, accept) {
  const rows = mediaRows(job, field);
  return `
    <div class="photo-box">
      <label>${t(label)}<input type="file" accept="${accept}" multiple capture="environment" data-photo-field="${field}" data-installation-photo-id="${job.id}" /></label>
      <div class="media-preview-grid">
        ${rows.length ? rows.map((item, index) => mediaPreviewHtml(item, job.id, field, index)).join("") : `<p class="muted-text">No media uploaded.</p>`}
      </div>
    </div>
  `;
}

function mediaRows(job, field) {
  if (Array.isArray(job[field])) return job[field];
  const legacy = {
    beforePhotos: job.beforePhoto,
    afterPhotos: job.afterPhoto,
    defectPhotos: job.defectPhoto
  }[field];
  return legacy ? [{ type: "image", dataUrl: legacy, name: "legacy-photo" }] : [];
}

function mediaPreviewHtml(item, jobId, field, index) {
  const source = item.dataUrl || item.url || item;
  const type = item.type || (String(source).startsWith("data:video") ? "video" : "image");
  return `
    <div class="media-preview">
      ${type === "video" ? `<video src="${source}" controls></video>` : `<img src="${source}" alt="${field}" />`}
      <button class="btn danger" type="button" data-remove-media-job="${jobId}" data-remove-media-field="${field}" data-remove-media-index="${index}">Remove</button>
    </div>
  `;
}

function itemsSummary(items) {
  return `<div class="mini-table">${items.map((item) => `
    <div>
      <strong>${item.productName}</strong>
      <span>${item.width || 0} x ${item.height || 0} | ${t("Quantity")} ${item.quantity || 0} | ${t("Color")}: ${item.color || "-"} | ${t("Install Type / Inside Outside")}: ${item.installType || "-"} | ${t("Installation Location")}: ${item.installationLocation || "-"} | ${t("Opening Direction")}: ${item.openingDirection || "-"} | ${t("Track Size")}: ${item.trackSize || "-"} | ${t("Handle Height")}: ${item.handleHeight || "-"} | ${t("Handle Position")}: ${item.handlePosition || "-"} | ${t("Track Type")}: ${item.trackType || item.trackOpening || "-"} | ${t("Mesh / Net Type")}: ${meshValue(item) || "-"} | ${t("Powdercoat / Powercoat")}: ${item.powdercoat ? `Yes ${money(powdercoatAmount(item))}` : "No"} | ${item.remark || "-"}</span>
    </div>
  `).join("")}</div>`;
}

function meshValue(item) {
  return item.meshType || item.meshMaterial || item.material || "";
}

function handleOrderClick(event) {
  const page = event.target.dataset.orderPage;
  const printId = event.target.dataset.printOrder;
  const viewId = event.target.dataset.viewOrder;
  const sendProductionId = event.target.dataset.sendProduction;
  const sendInstallerId = event.target.dataset.sendInstaller;
  const updateStatusId = event.target.dataset.updateOrderStatus;
  const moveFollowUpId = event.target.dataset.moveFollowUp;
  const whatsappId = event.target.dataset.whatsappOrder;
  const highlightId = event.target.dataset.highlightOrder;
  const editItemsId = event.target.dataset.editOrderItems;
  const saveItemsId = event.target.dataset.saveOrderItems;
  const cancelItemsId = event.target.dataset.cancelOrderItems;
  const editOrderNumberId = event.target.dataset.editOrderNumber;
  const saveOrderNumberId = event.target.dataset.saveOrderNumber;
  const cancelOrderNumberId = event.target.dataset.cancelOrderNumber;
  const restoreDuplicateKey = event.target.dataset.restoreDuplicate;
  if (page) {
    orderSearch = { ...orderSearch, page: Number(page) || 1 };
    renderOrderList();
  }
  if (printId) printOrder(printId);
  if (viewId) printOrder(viewId);
  if (sendProductionId) sendOrderToProduction(sendProductionId);
  if (sendInstallerId) sendOrderToInstaller(sendInstallerId);
  if (updateStatusId) updateOrderStatusFromCard(updateStatusId, event.target);
  if (moveFollowUpId) moveOrderBackToFollowUpFlow(moveFollowUpId);
  if (whatsappId) whatsappOrderCustomer(whatsappId);
  if (highlightId) highlightOrder(highlightId);
  if (editItemsId) toggleOrderItemEditor(editItemsId);
  if (saveItemsId) saveOrderItemEditor(saveItemsId, event.target);
  if (cancelItemsId) closeOrderItemEditor();
  if (editOrderNumberId) toggleOrderNumberEditor(editOrderNumberId);
  if (saveOrderNumberId) saveOrderNumberFromEditor(saveOrderNumberId, event.target);
  if (cancelOrderNumberId) closeOrderNumberEditor();
  if (restoreDuplicateKey) restoreArchivedDuplicate(restoreDuplicateKey);
}

function handleOrderChange(event) {
  if (event.target.dataset.orderItemField) {
    handleOrderItemInput(event);
    return;
  }
  if (!canEditOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const id = event.target.dataset.orderId;
  const field = event.target.dataset.orderField;
  if (!id || !field) return;
  state.orders = state.orders.map((order) => order.id === id ? {
    ...order,
    [field]: event.target.value,
    isArchived: field === "status" && event.target.value === "Cancelled" ? true : order.isArchived,
    archivedAt: field === "status" && event.target.value === "Cancelled" ? new Date().toISOString() : order.archivedAt,
    updatedAt: new Date().toISOString()
  } : order);
  if (field === "installationDate") syncJobInstallationDate(id, event.target.value);
  persistOrders();
  renderOrders();
}

function toggleOrderItemEditor(orderId) {
  if (!canEditOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  if (editingOrderId === orderId) {
    closeOrderItemEditor();
    return;
  }
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  editingOrderNumberId = "";
  editingOrderId = orderId;
  orderEditorDraft = {
    ...structuredCloneSafe(order),
    items: (order.items || []).map((item) => ({ ...item, id: item.id || uid("item") }))
  };
  recalculateOrderEditorDraft();
  renderOrderList();
  setTimeout(() => document.querySelector(`[data-order-item-editor="${orderId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
}

function closeOrderItemEditor() {
  editingOrderId = "";
  orderEditorDraft = null;
  renderOrderList();
}

function toggleOrderNumberEditor(orderId) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  if (editingOrderNumberId === orderId) {
    closeOrderNumberEditor();
    return;
  }
  if (!findOrder(orderId)) return showWorkflowMessage("Order not found.", "error");
  editingOrderId = "";
  orderEditorDraft = null;
  editingOrderNumberId = orderId;
  renderOrderList();
  setTimeout(() => document.querySelector(`[data-order-number-editor="${orderId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
}

function closeOrderNumberEditor() {
  editingOrderNumberId = "";
  renderOrderList();
}

function saveOrderNumberFromEditor(orderId, button) {
  const input = button.closest("[data-order-number-editor]")?.querySelector("[data-order-number-input]")
    || document.querySelector(`[data-order-number-input="${orderId}"]`);
  if (!input) return showWorkflowMessage("Order number input is unavailable.", "error");
  updateOrderNumber(orderId, input.value, { button });
}

function handleOrderItemInput(event) {
  const orderId = event.target.dataset.orderId;
  const itemId = event.target.dataset.orderItemId;
  const field = event.target.dataset.orderItemField;
  if (!orderId || !itemId || !field || orderId !== editingOrderId || orderEditorDraft?.id !== orderId) return;
  if (!canEditOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const item = orderEditorDraft.items.find((row) => row.id === itemId);
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
    const priceInput = document.querySelector(`[data-order-item-id="${itemId}"][data-order-item-field="unitPrice"]`);
    if (priceInput) priceInput.value = item.unitPrice;
  } else if (["width", "height", "quantity", "unitPrice", "manualFinalPrice"].includes(field)) {
    item[field] = event.target.value.replace(/[^\d.]/g, "");
  } else {
    item[field] = event.target.value;
  }

  recalculateOrderEditorDraft();
  updateOrderEditorMetrics(itemId);
}

function recalculateOrderEditorDraft() {
  if (!orderEditorDraft) return;
  orderEditorDraft.items = orderEditorDraft.items.map((item) => itemWithCalculatedTotals(item));
  const totals = quoteTotals(orderEditorDraft.items, orderEditorDraft.discount, orderEditorDraft.deposit);
  const installationJob = getOrderInstallationJob(orderEditorDraft);
  orderEditorDraft.subtotal = totals.subtotal;
  orderEditorDraft.total = totals.total;
  orderEditorDraft.balance = Math.max(totals.balance - toNumber(installationJob?.amountCollected), 0);
}

function updateOrderEditorMetrics(itemId) {
  const item = orderEditorDraft?.items.find((row) => row.id === itemId);
  if (!item) return;
  const values = {
    area: chargeableSqft(item).toFixed(2),
    auto: money(autoCalculatedPrice(item)),
    total: money(lineTotal(item))
  };
  Object.entries(values).forEach(([field, value]) => {
    const output = document.querySelector(`[data-order-line="${itemId}"][data-order-line-field="${field}"]`);
    if (output) output.value = value;
  });
  ["subtotal", "total", "balance"].forEach((field) => {
    const output = document.querySelector(`[data-order-editor-summary="${field}"]`);
    if (output) output.textContent = money(orderEditorDraft[field]);
  });
}

async function saveOrderItemEditor(orderId, button) {
  if (!canEditOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  if (!orderEditorDraft || editingOrderId !== orderId || orderEditorDraft.id !== orderId) return showWorkflowMessage("Order editor data is unavailable.", "error");
  const original = findOrder(orderId);
  if (!original) return showWorkflowMessage("Order not found.", "error");
  button.disabled = true;
  button.textContent = t("Saving...");

  const previousState = {
    orders: state.orders,
    productionJobs: state.productionJobs,
    installationJobs: state.installationJobs
  };
  const now = new Date().toISOString();
  const items = orderEditorDraft.items.map((item) => itemWithCalculatedTotals(item));
  const totals = quoteTotals(items, original.discount, original.deposit);
  const installationJob = getOrderInstallationJob(original);
  const amountCollected = toNumber(installationJob?.amountCollected);
  const remainingBalance = Math.max(totals.balance - amountCollected, 0);
  const updatedOrder = {
    ...original,
    items,
    subtotal: totals.subtotal,
    total: totals.total,
    balance: remainingBalance,
    updatedAt: now
  };

  state.orders = state.orders.map((order) => order.id === orderId ? updatedOrder : order);
  state.productionJobs = state.productionJobs.map((job) => isJobForOrder(job, original) ? {
    ...job,
    items: items.map((item) => ({ ...item })),
    updatedAt: now
  } : job);
  state.installationJobs = state.installationJobs.map((job) => isJobForOrder(job, original) ? {
    ...job,
    items: items.map((item) => ({ ...item })),
    balanceToCollect: totals.balance,
    balance: Math.max(totals.balance - toNumber(job.amountCollected), 0),
    updatedAt: now
  } : job);

  const localSave = persistOrderConversionLocally();
  if (!localSave.ok) {
    state.orders = previousState.orders;
    state.productionJobs = previousState.productionJobs;
    state.installationJobs = previousState.installationJobs;
    button.disabled = false;
    button.textContent = t("Save Order Items");
    return showWorkflowMessage(`Failed to save order locally: ${localSave.reason}`, "error");
  }

  editingOrderId = "";
  orderEditorDraft = null;
  renderOrders();
  showWorkflowMessage(`Order items saved locally: ${getOrderDisplayNo(updatedOrder)}. Syncing cloud...`, "info");
  const cloudSync = await syncOrderConversionCollections();
  if (!cloudSync.ok && !cloudSync.localOnly) {
    showWorkflowMessage(`Order items saved locally but cloud sync failed: ${cloudSync.reason}`, "warning");
    return;
  }
  showWorkflowMessage(`Order items updated: ${getOrderDisplayNo(updatedOrder)}`, "success");
}

function isJobForOrder(job, order) {
  if (job.orderId && job.orderId === order.id) return true;
  const orderNo = normalizeRefNo(getOrderDisplayNo(order));
  return Boolean(orderNo && normalizeRefNo(job.orderNo || job.orderNumber) === orderNo);
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function handleOrderSearchInput(event) {
  const field = event.target.dataset.orderSearch;
  if (!field) return;
  orderSearch = { ...orderSearch, [field]: event.target.value, page: 1, highlightId: "" };
  renderOrderProgressBoard();
  renderOrderList();
}

function handleOrderToolsClick(event) {
  const filter = event.target.dataset.orderFilter;
  const tool = event.target.dataset.orderTool;
  const archiveGroupId = event.target.dataset.archiveDuplicateGroup;
  const duplicateOrderId = event.target.dataset.duplicateOpenOrder;
  if (filter) {
    orderSearch = { ...orderSearch, filter, status: "", page: 1, highlightId: "" };
    renderOrders();
  }
  if (tool === "search") renderOrders();
  if (tool === "clear") {
    orderSearch = { orderNumber: "", customerName: "", phone: "", filter: "active", status: "", installationDate: "", sort: "updated", page: 1, highlightId: "" };
    renderOrders();
  }
  if (tool === "find") quickFindOrder();
  if (tool === "move-selected-follow-up") moveSelectedOrdersBackToFollowUp();
  if (tool === "duplicates" || tool === "duplicates-refresh") {
    if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    duplicateScanVisible = true;
    duplicateScanResult = scanDuplicateOrders();
    renderOrderTools();
  }
  if (tool === "duplicates-close") {
    duplicateScanVisible = false;
    duplicateScanResult = null;
    renderOrderTools();
  }
  if (archiveGroupId) archiveDuplicateGroupFromPanel(archiveGroupId, event.target);
  if (duplicateOrderId) highlightOrder(duplicateOrderId);
}

async function archiveDuplicateGroupFromPanel(groupId, button) {
  const groupCard = button.closest("[data-duplicate-group-card]");
  const selectedMain = groupCard?.querySelector("[data-duplicate-main]:checked")?.dataset.duplicateMain;
  if (!selectedMain) return showWorkflowMessage("Select the Main Order first.", "error");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = t("Archiving...");
  const result = await archiveDuplicateGroup(groupId, selectedMain);
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (result.ok) {
    duplicateScanResult = scanDuplicateOrders();
    orderSearch = { ...orderSearch, filter: "active", page: 1, highlightId: result.mainOrder.id };
    renderOrders();
  }
}

export async function archiveDuplicateGroup(groupId, mainMemberKey, options = {}) {
  if (!isBossOrAdmin()) return failDuplicateAction("Permission denied: your role cannot perform this action.");
  if (duplicateArchiveBusy) return failDuplicateAction("Duplicate archive is already in progress.");
  const scan = scanDuplicateOrders();
  const group = scan.confirmedGroups.find((row) => row.id === groupId);
  if (!group) return failDuplicateAction("Confirmed duplicate group not found. Please scan again.");
  const mainMember = group.members.find((member) => member.key === mainMemberKey);
  if (!mainMember) return failDuplicateAction("Select the Main Order first.");
  const duplicateMembers = group.members.filter((member) => member.key !== mainMember.key);
  if (!duplicateMembers.length) return failDuplicateAction("No duplicate order selected for archiving.");

  if (options.confirm !== false) {
    const confirmation = window.prompt("Type ARCHIVE DUPLICATE to confirm. No order will be permanently deleted.");
    if (confirmation !== "ARCHIVE DUPLICATE") return { ok: false, cancelled: true, message: "Archive cancelled." };
  }
  if (options.downloadBackup !== false && !downloadDuplicateArchiveBackup(group, mainMember)) {
    return failDuplicateAction("Backup download failed. Duplicate orders were not changed.");
  }

  duplicateArchiveBusy = true;
  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    const mainOrder = mainMember.order;
    const mainOrderNo = getOrderDisplayNo(mainOrder);
    const duplicateIndexes = new Set(duplicateMembers.map((member) => member.index));
    const duplicateIds = new Set(duplicateMembers.map((member) => String(member.order.id || "")).filter((id) => id && id !== String(mainOrder.id || "")));
    const duplicateNumbers = new Set(duplicateMembers
      .map((member) => normalizeRefNo(getOrderDisplayNo(member.order)))
      .filter((number) => number && number !== normalizeRefNo(mainOrderNo)));
    const quotationIds = new Set(group.members.map((member) => orderQuotationId(member.order)).filter(Boolean));
    const duplicateReason = group.reasons.join(" | ");
    const archivedBy = state.currentUser?.name || state.currentUser?.username || state.currentUser?.userId || role();

    state.orders = state.orders.map((order, index) => {
      const withUpdatedPayments = relinkEmbeddedOrderReferences(order, duplicateIds, duplicateNumbers, mainOrder);
      if (!duplicateIndexes.has(index)) return withUpdatedPayments;
      return {
        ...withUpdatedPayments,
        statusBeforeDuplicateArchive: order.status,
        isArchivedBeforeDuplicateArchive: order.isArchived === true,
        archivedAtBeforeDuplicateArchive: order.archivedAt || null,
        status: "duplicate_archived",
        isArchived: true,
        duplicateOfOrderId: mainOrder.id,
        duplicateOfOrderNo: mainOrderNo,
        duplicateReason,
        archivedAt: now,
        archivedBy,
        updatedAt: now
      };
    });
    state.quotations = state.quotations.map((quote) => quotationBelongsToDuplicateGroup(quote, quotationIds, duplicateIds, duplicateNumbers)
      ? repairQuotationLinkObject(quote, mainOrder)
      : quote);
    state.productionJobs = state.productionJobs.map((job) => relinkWorkflowRecord(job, duplicateIds, duplicateNumbers, mainOrder, now));
    state.installationJobs = state.installationJobs.map((job) => relinkWorkflowRecord(job, duplicateIds, duplicateNumbers, mainOrder, now));
    state.warrantyCards = state.warrantyCards.map((card) => relinkWorkflowRecord(card, duplicateIds, duplicateNumbers, mainOrder, now));

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failDuplicateAction(`Failed to archive duplicates locally: ${localSave.reason}`);
    }
    localCommitted = true;

    const cloudSync = await syncOrderConversionCollections();
    const cloudFailed = !cloudSync.ok && !cloudSync.localOnly;
    const message = cloudFailed
      ? `Duplicate cleanup saved locally but cloud sync failed: ${cloudSync.reason}`
      : cloudSync.localOnly
        ? "Duplicate orders archived locally."
        : "Duplicate orders archived successfully.";
    showWorkflowMessage(message, cloudFailed ? "warning" : "success");
    return {
      ok: true,
      mainOrder,
      archivedOrderIds: duplicateMembers.map((member) => member.order.id),
      cloudOk: cloudSync.ok && !cloudSync.localOnly,
      localOnly: cloudSync.localOnly,
      message
    };
  } catch (error) {
    console.error("Archive duplicate orders failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failDuplicateAction(`Failed to archive duplicates: ${error.message || "Unknown error"}`);
    }
    const message = `Duplicate cleanup saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, mainOrder: mainMember.order, cloudOk: false, message };
  } finally {
    duplicateArchiveBusy = false;
  }
}

export async function restoreArchivedDuplicate(memberKey, options = {}) {
  if (!isBossOrAdmin()) return failDuplicateAction("Permission denied: your role cannot perform this action.");
  const entry = state.orders
    .map((order, index) => ({ order, index, key: orderEntryKey(order, index) }))
    .find((member) => member.key === memberKey || (member.order.id === memberKey && member.order.status === "duplicate_archived"));
  if (!entry || entry.order.status !== "duplicate_archived") return failDuplicateAction("Archived duplicate order not found.");
  if (options.confirm !== false && !window.confirm(`Restore archived duplicate ${getOrderDisplayNo(entry.order)}?`)) {
    return { ok: false, cancelled: true, message: "Restore cancelled." };
  }

  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    state.orders = state.orders.map((order, index) => index === entry.index ? {
      ...order,
      status: order.statusBeforeDuplicateArchive || "Confirmed",
      isArchived: order.isArchivedBeforeDuplicateArchive === true,
      archivedAt: order.archivedAtBeforeDuplicateArchive || null,
      duplicateRestoredAt: now,
      duplicateRestoredBy: state.currentUser?.name || state.currentUser?.username || role(),
      updatedAt: now
    } : order);
    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failDuplicateAction(`Failed to restore duplicate locally: ${localSave.reason}`);
    }
    localCommitted = true;
    const cloudSync = await syncOrderConversionCollections();
    duplicateScanResult = duplicateScanVisible ? scanDuplicateOrders() : null;
    renderOrders();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Archived duplicate restored locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, message };
    }
    showWorkflowMessage("Archived duplicate restored.", "success");
    return { ok: true, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly };
  } catch (error) {
    console.error("Restore archived duplicate failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failDuplicateAction(`Failed to restore duplicate: ${error.message || "Unknown error"}`);
    }
    const message = `Archived duplicate restored locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, message };
  }
}

function quotationBelongsToDuplicateGroup(quote, quotationIds, duplicateIds, duplicateNumbers) {
  if (quote.id && quotationIds.has(String(quote.id))) return true;
  if (duplicateIds.has(String(quote.linkedOrderId || quote.orderId || ""))) return true;
  return [quote.orderNo, quote.orderNumber].some((value) => duplicateNumbers.has(normalizeRefNo(value)));
}

function relinkWorkflowRecord(record, duplicateIds, duplicateNumbers, mainOrder, now) {
  const orderReference = normalizeRefNo(record.orderNo || record.orderNumber || record.orderReference || record.orderRef);
  const matches = duplicateIds.has(String(record.orderId || "")) || (orderReference && duplicateNumbers.has(orderReference));
  const withUpdatedPayments = relinkEmbeddedOrderReferences(record, duplicateIds, duplicateNumbers, mainOrder);
  if (!matches) return withUpdatedPayments;
  return {
    ...withUpdatedPayments,
    orderId: mainOrder.id,
    orderNo: getOrderDisplayNo(mainOrder),
    orderNumber: getOrderDisplayNo(mainOrder),
    duplicateRelinkedAt: now,
    updatedAt: now
  };
}

function relinkEmbeddedOrderReferences(record, duplicateIds, duplicateNumbers, mainOrder) {
  const next = { ...record };
  ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
    if (!Array.isArray(record[field])) return;
    next[field] = record[field].map((entry) => {
      const orderReference = normalizeRefNo(entry.orderNo || entry.orderNumber || entry.orderReference || entry.orderRef || entry.order_no || entry.order_number);
      const matches = duplicateIds.has(String(entry.orderId || "")) || (orderReference && duplicateNumbers.has(orderReference));
      if (!matches) return entry;
      const updated = { ...entry, orderId: mainOrder.id };
      ["orderNo", "orderNumber", "orderReference", "orderRef", "order_no", "order_number"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(entry, key)) updated[key] = getOrderDisplayNo(mainOrder);
      });
      return updated;
    });
  });
  return next;
}

function duplicateArchiveBackupPayload(group, mainMember) {
  return {
    type: "eco-screen-crm-v2-duplicate-order-archive-backup",
    timestamp: new Date().toISOString(),
    selectedMainOrderKey: mainMember.key,
    selectedGroup: {
      id: group.id,
      reasons: group.reasons,
      orderKeys: group.members.map((member) => member.key)
    },
    quotations: structuredCloneSafe(state.quotations),
    orders: structuredCloneSafe(state.orders),
    productionJobs: structuredCloneSafe(state.productionJobs),
    installationJobs: structuredCloneSafe(state.installationJobs),
    warrantyCards: structuredCloneSafe(state.warrantyCards),
    paymentCollectionReferences: collectPaymentCollectionReferences()
  };
}

function collectPaymentCollectionReferences() {
  const references = [];
  [
    ["orders", state.orders],
    ["productionJobs", state.productionJobs],
    ["installationJobs", state.installationJobs],
    ["warrantyCards", state.warrantyCards]
  ].forEach(([collection, rows]) => rows.forEach((row) => {
    ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
      if (!Array.isArray(row[field]) || !row[field].length) return;
      references.push({ collection, recordId: row.id || "", field, records: structuredCloneSafe(row[field]) });
    });
  }));
  return references;
}

function downloadDuplicateArchiveBackup(group, mainMember) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const payload = duplicateArchiveBackupPayload(group, mainMember);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-backup-before-duplicate-archive-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Duplicate archive backup failed", error);
    return false;
  }
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").replace(/\.\d{3}Z$/, "");
}

function failDuplicateAction(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

function quickFindOrder() {
  const value = window.prompt("Enter order number");
  if (value === null) return;
  const order = findOrderByNumber(value)
    || state.orders.find((row) => normalizeText(getOrderDisplayNo(row)).includes(normalizeText(value)));
  if (!order) {
    showWorkflowMessage("Order not found", "error");
    return;
  }
  orderSearch = { ...orderSearch, orderNumber: value, filter: "all", highlightId: order.id };
  renderOrders();
  setTimeout(() => document.querySelector(`[data-order-card="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  showWorkflowMessage(`Order found: ${getOrderDisplayNo(order)}`, "success");
}

function highlightOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return;
  orderSearch = {
    ...orderSearch,
    orderNumber: getOrderDisplayNo(order),
    filter: "all",
    highlightId: order.id
  };
  renderOrders();
  setTimeout(() => document.querySelector(`[data-order-card="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
}

function whatsappOrderCustomer(orderId) {
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const phone = String(order.customer?.phone || "").replace(/\D/g, "");
  if (!phone) return showWorkflowMessage("Customer phone number is missing.", "error");
  const text = encodeURIComponent(`Hi ${order.customer?.name || ""}, this is Eco Screen. Your order ${getOrderDisplayNo(order)} is currently ${order.status || "in progress"}. Thank you.`);
  window.open(`https://wa.me/6${phone.replace(/^6/, "")}?text=${text}`, "_blank", "noopener");
}

function updateOrderStatusFromCard(orderId, button) {
  const select = button.closest("[data-order-card]")?.querySelector(`[data-order-status-select="${orderId}"]`)
    || document.querySelector(`[data-order-status-select="${orderId}"]`);
  if (!select) return showWorkflowMessage("Order status selector is unavailable.", "error");
  updateOrderStatus(orderId, select.value, { button });
}

export async function updateOrderStatus(orderId, nextStatus, options = {}) {
  if (!canSendOrder()) return failOrderUpdate("Permission denied: your role cannot perform this action.");
  const order = findOrder(orderId);
  if (!order) return failOrderUpdate("Order not found.");
  const status = String(nextStatus || "").trim();
  const validStatuses = new Set([...orderStatuses, order.status].filter(Boolean));
  if (!status || !validStatuses.has(status)) return failOrderUpdate("Please select a valid order status.");

  const button = options.button || null;
  setOrderActionBusy(button, t("Updating..."));
  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    state.orders = state.orders.map((row) => row.id === orderId ? {
      ...row,
      status,
      isArchived: status === "Cancelled" ? true : row.isArchived,
      archivedAt: status === "Cancelled" ? (row.archivedAt || now) : row.archivedAt,
      updatedAt: now
    } : row);

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      renderOrders();
      return failOrderUpdate(`Failed to save status locally: ${localSave.reason}`);
    }
    localCommitted = true;
    showWorkflowMessage("Status saved locally. Syncing cloud...", "info");

    const cloudSync = await syncOrderConversionCollections();
    renderOrders();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Status updated locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, status, cloudOk: false, message };
    }
    showWorkflowMessage("Status updated successfully.", "success");
    return { ok: true, status, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly };
  } catch (error) {
    console.error("Update order status failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      renderOrders();
      return failOrderUpdate(`Failed to update status: ${error.message || "Unknown error"}`);
    }
    renderOrders();
    const message = `Status updated locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, status, cloudOk: false, message };
  } finally {
    restoreOrderActionButton(button, t("Update Status"));
  }
}

export async function updateOrderNumber(orderId, rawOrderNumber, options = {}) {
  if (!isBossOrAdmin()) return failOrderUpdate("Permission denied: your role cannot perform this action.");
  const order = findOrder(orderId);
  if (!order) return failOrderUpdate("Order not found.");
  const nextOrderNumber = String(rawOrderNumber ?? "").trim().toUpperCase();
  if (!nextOrderNumber) return failOrderUpdate("Order number cannot be blank.");
  const oldOrderNumber = getOrderDisplayNo(order);
  const normalizedNext = normalizeRefNo(nextOrderNumber);
  const duplicate = state.orders.some((row) => row.id !== orderId && [row.orderNo, row.orderNumber].some((value) => normalizeRefNo(value) === normalizedNext));
  if (duplicate) return failOrderUpdate("This order number is already in use.");
  if (String(oldOrderNumber ?? "").trim() === nextOrderNumber) {
    editingOrderNumberId = "";
    renderOrders();
    showWorkflowMessage(`Order number updated to ${nextOrderNumber}`, "success");
    return { ok: true, orderNumber: nextOrderNumber, unchanged: true };
  }

  if (options.confirmChange !== false) {
    const confirmed = window.confirm(`Change order number from ${oldOrderNumber} to ${nextOrderNumber}?`);
    if (!confirmed) return { ok: false, cancelled: true, message: "Order number change cancelled." };
  }

  const button = options.button || null;
  setOrderActionBusy(button, t("Saving..."));
  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    const oldNormalized = normalizeRefNo(oldOrderNumber);
    state.orders = state.orders.map((row) => row.id === orderId
      ? updateOrderReferenceFields(row, orderId, oldNormalized, nextOrderNumber, now)
      : row);
    state.quotations = state.quotations.map((quote) => isQuotationLinkedToOrder(quote, order, oldNormalized)
      ? updateOrderReferenceFields({ ...quote, orderId }, orderId, oldNormalized, nextOrderNumber, now)
      : quote);
    state.productionJobs = state.productionJobs.map((job) => isRecordLinkedToOrder(job, orderId, oldNormalized)
      ? updateOrderReferenceFields(job, orderId, oldNormalized, nextOrderNumber, now)
      : job);
    state.installationJobs = state.installationJobs.map((job) => isRecordLinkedToOrder(job, orderId, oldNormalized)
      ? updateOrderReferenceFields(job, orderId, oldNormalized, nextOrderNumber, now)
      : job);
    state.warrantyCards = state.warrantyCards.map((card) => isRecordLinkedToOrder(card, orderId, oldNormalized)
      ? updateOrderReferenceFields(card, orderId, oldNormalized, nextOrderNumber, now)
      : card);

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      renderOrders();
      return failOrderUpdate(`Failed to save order number locally: ${localSave.reason}`);
    }
    localCommitted = true;
    editingOrderNumberId = "";
    if (orderSearch.highlightId === orderId || normalizeRefNo(orderSearch.orderNumber) === oldNormalized) {
      orderSearch = { ...orderSearch, orderNumber: nextOrderNumber, highlightId: orderId };
    }
    showWorkflowMessage(`Order number saved locally as ${nextOrderNumber}. Syncing cloud...`, "info");

    const cloudSync = await syncOrderConversionCollections();
    renderOrders();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Order number updated locally to ${nextOrderNumber}, but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, orderNumber: nextOrderNumber, cloudOk: false, message };
    }
    showWorkflowMessage(`Order number updated to ${nextOrderNumber}`, "success");
    return { ok: true, orderNumber: nextOrderNumber, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly };
  } catch (error) {
    console.error("Update order number failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      renderOrders();
      return failOrderUpdate(`Failed to update order number: ${error.message || "Unknown error"}`);
    }
    renderOrders();
    const message = `Order number updated locally to ${nextOrderNumber}, but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, orderNumber: nextOrderNumber, cloudOk: false, message };
  } finally {
    restoreOrderActionButton(button, t("Save Order Number"));
  }
}

export function findOrderByNumber(value) {
  const normalized = normalizeRefNo(value);
  if (!normalized) return null;
  return state.orders.find((order) => [order.orderNo, order.orderNumber].some((number) => normalizeRefNo(number) === normalized)) || null;
}

function snapshotOrderWorkflowState() {
  return {
    orders: state.orders,
    quotations: state.quotations,
    productionJobs: state.productionJobs,
    installationJobs: state.installationJobs,
    warrantyCards: state.warrantyCards
  };
}

function isQuotationLinkedToOrder(quote, order, oldNormalized) {
  if (quote.orderId) return quote.orderId === order.id;
  if (quote.id && [order.quoteId, order.quotationId].includes(quote.id)) return true;
  return Boolean(oldNormalized && [quote.orderNo, quote.orderNumber].some((value) => normalizeRefNo(value) === oldNormalized));
}

function isRecordLinkedToOrder(record, orderId, oldNormalized) {
  if (record.orderId) return record.orderId === orderId;
  return Boolean(oldNormalized && [record.orderNo, record.orderNumber, record.orderReference, record.orderRef].some((value) => normalizeRefNo(value) === oldNormalized));
}

function updateOrderReferenceFields(record, orderId, oldNormalized, nextOrderNumber, now) {
  const next = {
    ...record,
    orderId,
    orderNo: nextOrderNumber,
    orderNumber: nextOrderNumber,
    updatedAt: now
  };
  if (Object.prototype.hasOwnProperty.call(record, "orderReference")) next.orderReference = nextOrderNumber;
  if (Object.prototype.hasOwnProperty.call(record, "orderRef")) next.orderRef = nextOrderNumber;
  if (Object.prototype.hasOwnProperty.call(record, "order_no")) next.order_no = nextOrderNumber;
  if (Object.prototype.hasOwnProperty.call(record, "order_number")) next.order_number = nextOrderNumber;
  return updateEmbeddedPaymentReferences(next, orderId, oldNormalized, nextOrderNumber);
}

function updateEmbeddedPaymentReferences(record, orderId, oldNormalized, nextOrderNumber) {
  const next = { ...record };
  ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
    if (!Array.isArray(record[field])) return;
    next[field] = record[field].map((entry) => {
      const entryRef = normalizeRefNo(entry.orderNo || entry.orderNumber || entry.orderReference || entry.orderRef || entry.order_no || entry.order_number);
      if (entry.orderId !== orderId && (!oldNormalized || entryRef !== oldNormalized)) return entry;
      const updated = { ...entry, orderId };
      ["orderNo", "orderNumber", "orderReference", "orderRef", "order_no", "order_number"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(entry, key)) updated[key] = nextOrderNumber;
      });
      return updated;
    });
  });
  return next;
}

function setOrderActionBusy(button, label) {
  if (!button) return;
  button.disabled = true;
  button.dataset.originalLabel = button.textContent || "";
  button.textContent = label;
}

function restoreOrderActionButton(button, fallbackLabel) {
  if (!button || !button.isConnected) return;
  button.disabled = false;
  button.textContent = button.dataset.originalLabel || fallbackLabel;
  delete button.dataset.originalLabel;
}

function failOrderUpdate(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

function moveSelectedOrdersBackToFollowUp() {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const selectedIds = [...document.querySelectorAll("[data-order-select]:checked")].map((input) => input.dataset.orderSelect);
  if (!selectedIds.length) return showWorkflowMessage("Please select at least one order.", "warning");
  const confirmation = window.prompt(`Move ${selectedIds.length} selected order(s) back to Follow Up?\nType FOLLOW UP to confirm.`);
  if (confirmation !== "FOLLOW UP") return showWorkflowMessage("Move back cancelled.", "warning");
  const result = moveOrdersBackToFollowUp(selectedIds);
  persistMovedBackOrders(result);
}

function moveOrderBackToFollowUpFlow(orderId) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const confirmation = window.prompt(`Move ${getOrderDisplayNo(order)} back to Follow Up?\nType FOLLOW UP to confirm.`);
  if (confirmation !== "FOLLOW UP") return showWorkflowMessage("Move back cancelled.", "warning");
  const result = moveOrdersBackToFollowUp([orderId]);
  persistMovedBackOrders(result);
}

function moveOrdersBackToFollowUp(orderIds) {
  const ids = new Set(orderIds);
  const now = new Date().toISOString();
  const movedOrders = state.orders.filter((order) => ids.has(order.id));
  const movedOrderNumbers = new Set(movedOrders.map((order) => normalizeRefNo(getOrderDisplayNo(order))).filter(Boolean));
  const movedOrderIds = new Set(movedOrders.map((order) => order.id));
  const movedQuoteIds = new Set(movedOrders.flatMap((order) => [order.quoteId, order.quotationId]).filter(Boolean));
  const movedQuoteNumbers = new Set(movedOrders.flatMap((order) => [order.quoteNumber, order.quotationNo]).map(normalizeRefNo).filter(Boolean));

  state.orders = state.orders.filter((order) => !movedOrderIds.has(order.id));
  state.productionJobs = state.productionJobs.filter((job) => !movedOrderIds.has(job.orderId) && !movedOrderNumbers.has(normalizeRefNo(job.orderNo || job.orderNumber)));
  state.installationJobs = state.installationJobs.filter((job) => !movedOrderIds.has(job.orderId) && !movedOrderNumbers.has(normalizeRefNo(job.orderNo || job.orderNumber)));
  state.warrantyCards = state.warrantyCards.filter((card) => !movedOrderIds.has(card.orderId) && !movedOrderNumbers.has(normalizeRefNo(card.orderNo || card.orderNumber)));
  state.quotations = state.quotations.map((quote) => {
    const quoteNo = normalizeRefNo(getQuotationDisplayNo(quote));
    const linked = movedQuoteIds.has(quote.id) || (quoteNo && movedQuoteNumbers.has(quoteNo));
    if (!linked) return quote;
    return {
      ...quote,
      status: "follow_up",
      workflowStatus: "follow_up",
      convertedToOrder: false,
      converted: false,
      orderId: null,
      orderNo: null,
      orderNumber: null,
      convertedAt: null,
      updatedAt: now
    };
  });
  orderSearch = { ...orderSearch, highlightId: "", filter: "active" };
  return { movedCount: movedOrders.length };
}

function persistMovedBackOrders(result) {
  const syncs = [
    persistQuotations(),
    persistOrders(),
    persistProductionJobs(),
    persistInstallationJobs(),
    persistWarrantyCards()
  ];
  Promise.all(syncs).then((results) => {
    const failed = results.find((row) => row && !row.ok && row.reason !== "Local Mode Only");
    renderWorkflowModules();
    showWorkflowMessage(failed
      ? `Moved back locally but cloud sync failed. ${result.movedCount} order(s) affected.`
      : "Moved back to Follow Up successfully.", failed ? "warning" : "success");
  }).catch((error) => {
    console.error("Move back to Follow Up sync failed", error);
    renderWorkflowModules();
    showWorkflowMessage("Moved back locally but cloud sync failed.", "warning");
  });
  renderWorkflowModules();
  showWorkflowMessage("Moving order(s) back to Follow Up...", "info");
}

function sendOrderToProduction(orderId) {
  if (!canSendOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const existing = state.productionJobs.find((job) => job.orderId === order.id);
  const wasAlreadySent = order.sentToProduction === true || ["Sent to Production", "Production Completed"].includes(order.status);
  order.status = "Sent to Production";
  order.sentToProduction = true;
  order.productionStatus = "in_production";
  order.updatedAt = new Date().toISOString();

  if (existing) {
    existing.installationDate = order.installationDate || existing.installationDate || "";
    if (normalizeProductionStatus(existing.status, true) !== "completed") existing.status = "in_production";
    existing.updatedAt = new Date().toISOString();
    persistOrders();
    persistProductionJobs();
    renderWorkflowModules();
    showWorkflowMessage(wasAlreadySent ? "Production job already exists" : "Order sent to Production", wasAlreadySent ? "warning" : "success");
    return;
  }

  state.productionJobs = [{ ...createProductionJobFromOrder(order), status: "in_production" }, ...state.productionJobs];
  persistOrders();
  persistProductionJobs();
  renderWorkflowModules();
  showWorkflowMessage("Order sent to Production", "success");
}

function sendOrderToInstaller(orderId) {
  if (!canSendOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const existing = state.installationJobs.find((job) => job.orderId === order.id);
  const wasAlreadySent = ["Sent to Installer", "Installation Scheduled", "Installing", "Installation Completed", "Pending Collection", "Completed"].includes(order.status);
  order.status = "Sent to Installer";
  order.installationStatus = order.installationDate ? "scheduled" : "not_scheduled";
  order.updatedAt = new Date().toISOString();

  if (existing) {
    existing.installationDate = order.installationDate || existing.installationDate || "";
    existing.balance = order.balance;
    existing.status = order.installationStatus;
    existing.updatedAt = new Date().toISOString();
    persistOrders();
    persistInstallationJobs();
    renderWorkflowModules();
    showWorkflowMessage(wasAlreadySent ? "Installation job already exists" : "Order sent to Installer", wasAlreadySent ? "warning" : "success");
    return;
  }

  state.installationJobs = [createInstallationJobFromOrder(order), ...state.installationJobs];
  persistOrders();
  persistInstallationJobs();
  renderWorkflowModules();
  showWorkflowMessage("Order sent to Installer", "success");
}

function syncJobInstallationDate(orderId, installationDate) {
  state.productionJobs = state.productionJobs.map((job) => job.orderId === orderId ? { ...job, installationDate, updatedAt: new Date().toISOString() } : job);
  state.installationJobs = state.installationJobs.map((job) => job.orderId === orderId ? { ...job, installationDate, status: normalizeInstallationStatus(job.status) === "not_scheduled" && installationDate ? "scheduled" : job.status, updatedAt: new Date().toISOString() } : job);
  state.orders = state.orders.map((order) => order.id === orderId ? { ...order, installationStatus: order.installationStatus === "not_scheduled" && installationDate ? "scheduled" : order.installationStatus, updatedAt: new Date().toISOString() } : order);
  persistProductionJobs();
  persistInstallationJobs();
  renderProductionJobs();
  renderInstallationJobs();
}

function handleProductionClick(event) {
  const printId = event.target.dataset.printProduction;
  const viewId = event.target.dataset.viewProduction;
  const markId = event.target.dataset.markProductionStatus;
  if (printId) printProduction(printId);
  if (viewId) printProduction(viewId);
  if (markId) markProductionStatus(markId, event.target.dataset.status);
}

function handleProductionChange(event) {
  if (!canEditProduction()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const id = event.target.dataset.productionId;
  const field = event.target.dataset.productionField;
  if (!id || !field) return;
  if (field === "status") {
    markProductionStatus(id, event.target.value);
    return;
  }
  state.productionJobs = state.productionJobs.map((job) => job.id === id ? { ...job, [field]: event.target.value, updatedAt: new Date().toISOString() } : job);
  persistProductionJobs();
  renderProductionJobs();
}

function markProductionStatus(jobId, status) {
  if (!canEditProduction()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.productionJobs.find((row) => row.id === jobId);
  if (!job || !status) return;
  const normalizedStatus = normalizeProductionStatus(status, true);
  job.status = normalizedStatus;
  job.updatedAt = new Date().toISOString();
  const order = findOrder(job.orderId);
  if (order) {
    order.status = normalizedStatus === "completed" ? "Production Completed" : normalizedStatus === "in_production" ? "Sent to Production" : "Confirmed";
    order.sentToProduction = normalizedStatus !== "not_produced";
    order.productionStatus = normalizedStatus;
    order.updatedAt = new Date().toISOString();
  }
  persistProductionJobs();
  persistOrders();
  renderWorkflowModules();
  showWorkflowMessage(normalizedStatus === "completed" ? "Production marked completed" : "Production marked in progress", "success");
}

function handleInstallationClick(event) {
  const printId = event.target.dataset.printInstallation;
  const viewId = event.target.dataset.viewInstallation;
  const whatsappId = event.target.dataset.whatsappInstallation;
  const markId = event.target.dataset.markInstallationStatus;
  const completeId = event.target.dataset.completeInstallation;
  const touchupCompletedId = event.target.dataset.markTouchupCompleted;
  const closeId = event.target.dataset.closeCompletion;
  const saveId = event.target.dataset.saveCompletion;
  const clearSignatureId = event.target.dataset.clearSignature;
  const removeMediaJobId = event.target.dataset.removeMediaJob;
  const warrantyId = event.target.dataset.generateWarranty;
  const printWarrantyId = event.target.dataset.printWarranty;
  if (printId) printInstallation(printId);
  if (viewId) printInstallation(viewId);
  if (whatsappId) whatsappInstallationCustomer(whatsappId);
  if (markId) markInstallationStatus(markId, event.target.dataset.status);
  if (completeId) openCompletionForm(completeId);
  if (touchupCompletedId) markTouchUpCompleted(touchupCompletedId);
  if (closeId) closeCompletionForm();
  if (saveId) saveInstallationCompletion(saveId);
  if (clearSignatureId) clearSignature(clearSignatureId);
  if (removeMediaJobId) removeInstallationMedia(removeMediaJobId, event.target.dataset.removeMediaField, event.target.dataset.removeMediaIndex);
  if (warrantyId) generateWarrantyCard(warrantyId);
  if (printWarrantyId) printWarrantyCard(printWarrantyId);
}

function handleInstallationChange(event) {
  const photoJobId = event.target.dataset.installationPhotoId;
  const photoField = event.target.dataset.photoField;
  if (photoJobId && photoField) {
    if (!canCompleteInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    handlePhotoUpload(photoJobId, photoField, [...(event.target.files || [])]);
    return;
  }
  const id = event.target.dataset.installationId;
  const field = event.target.dataset.installationField;
  if (!id || !field) return;
  if (!canScheduleInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  if (field === "status") {
    markInstallationStatus(id, event.target.value);
    return;
  }
  state.installationJobs = state.installationJobs.map((job) => job.id === id ? { ...job, [field]: event.target.value, updatedAt: new Date().toISOString() } : job);
  persistInstallationJobs();
}

function markInstallationStatus(jobId, status) {
  if (!canScheduleInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job || !status) return;
  const normalizedStatus = normalizeInstallationStatus(status);
  if (normalizedStatus === "installed" && job.completionStatus !== "Completed") {
    activeCompletionJobId = jobId;
    renderInstallationJobs();
    showWorkflowMessage("Please complete the installation form before marking completed.", "warning");
    return;
  }
  job.status = normalizedStatus;
  job.updatedAt = new Date().toISOString();
  const order = findOrder(job.orderId);
  if (order) {
    order.installationStatus = normalizedStatus;
    if (normalizedStatus === "scheduled") order.status = "Installation Scheduled";
    if (normalizedStatus === "installed") order.status = getRemainingBalance(order, job) > 0 ? "Pending Collection" : "Completed";
    if (normalizedStatus === "pending_collection") order.status = "Pending Collection";
    if (normalizedStatus === "touch_up") order.status = "Touch Up";
    order.updatedAt = new Date().toISOString();
  }
  persistInstallationJobs();
  persistOrders();
  renderWorkflowModules();
  showWorkflowMessage(normalizedStatus === "installed" ? "Installation marked completed" : `Installation marked ${statusLabel(normalizedStatus)}`, "success");
}

function whatsappInstallationCustomer(jobId) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return showWorkflowMessage("Installation job not found.", "error");
  const phone = String(job.customer.phone || "").replace(/\D/g, "");
  if (!phone) return showWorkflowMessage("Customer phone number is missing.", "error");
  const text = encodeURIComponent(`Hi ${job.customer.name || ""}, this is Eco Screen. We would like to confirm your installation appointment on ${job.installationDate || "the scheduled date"}. Thank you.`);
  window.open(`https://wa.me/6${phone.replace(/^6/, "")}?text=${text}`, "_blank", "noopener");
}

function findOrder(orderId) {
  return state.orders.find((order) => order.id === orderId) || null;
}

function openCompletionForm(jobId) {
  if (!canCompleteInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  activeCompletionJobId = jobId;
  renderInstallationJobs();
}

function closeCompletionForm() {
  activeCompletionJobId = null;
  renderInstallationJobs();
}

async function handlePhotoUpload(jobId, field, files) {
  if (!files?.length) return;
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  try {
    const existing = mediaRows(job, field);
    const converted = await Promise.all(files.map((file) => mediaFileToRecord(file)));
    job[field] = [...existing, ...converted].slice(0, 12);
    job.updatedAt = new Date().toISOString();
    persistInstallationJobs();
    renderInstallationJobs();
    if (JSON.stringify(job[field]).length > 1800000) showWorkflowMessage("Media saved, but it is large. Cloud sync may take longer on mobile.", "warning");
  } catch (error) {
    showWorkflowMessage(error.message || "Media upload failed.", "error");
  }
}

function removeInstallationMedia(jobId, field, index) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job || !field) return;
  const rows = mediaRows(job, field);
  rows.splice(Number(index), 1);
  job[field] = rows;
  job.updatedAt = new Date().toISOString();
  persistInstallationJobs();
  renderInstallationJobs();
}

function saveInstallationCompletion(jobId) {
  if (!canCompleteInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  const panel = document.querySelector(`[data-completion-panel="${jobId}"]`);
  const error = document.querySelector(`[data-completion-error="${jobId}"]`);
  if (!panel) return;

  const completionData = readCompletionForm(panel);
  Object.assign(job, completionData.fields);
  job.checklist = completionData.checklist;
  job.balanceCollected = completionData.fields.balanceCollected === "true";
  job.touchUpRequired = completionData.fields.touchUpRequired === "true";

  const signature = signatureDataUrl(jobId);
  const validationError = validateCompletion(job, completionData, signature);
  if (validationError) {
    if (error) error.textContent = validationError;
    return;
  }

  job.customerSignature = signature;
  job.completionStatus = "Completed";
  job.balanceToCollect = parseAmount(job.balanceToCollect);
  job.amountCollected = parseAmount(job.amountCollected);
  if (job.balanceCollected && job.amountCollected < job.balanceToCollect) job.amountCollected = job.balanceToCollect;
  job.balance = Math.max(0, job.balanceToCollect - job.amountCollected);
  job.status = job.touchUpRequired ? "touch_up" : job.balance <= 0 ? "installed" : "pending_collection";
  job.updatedAt = new Date().toISOString();

  const order = findOrder(job.orderId);
  if (order) {
    order.installationStatus = job.status;
    order.status = job.status === "touch_up" ? "Touch Up" : job.status === "installed" ? "Completed" : "Pending Collection";
    order.balance = job.balance;
    order.updatedAt = new Date().toISOString();
    persistOrders();
  }

  persistInstallationJobs();
  activeCompletionJobId = null;
  renderWorkflowModules();
  showWorkflowMessage(job.status === "touch_up" ? "Installation saved with touch up required" : job.status === "installed" ? "Installation completed" : "Installation completed with pending collection", "success");
}

function readCompletionForm(panel) {
  const fields = {};
  panel.querySelectorAll("[data-completion-field]").forEach((input) => {
    fields[input.dataset.completionField] = input.value;
  });
  const checklist = {};
  panel.querySelectorAll("[data-checklist]").forEach((input) => {
    checklist[input.dataset.checklist] = input.checked;
  });
  return { fields, checklist };
}

function validateCompletion(job, completionData, signature) {
  if (!mediaRows(job, "afterPhotos").length) return "Please upload after installation photo";
  if (!completionData.fields.completionDate) return "Please fill completion date";
  if (completionData.fields.amountCollected === "") return "Please fill collection amount";
  if (!checklistLabels.every((label) => completionData.checklist[label])) return "Please complete customer inspection checklist";
  if (!signature) return "Please get customer signature";
  return "";
}

function markTouchUpCompleted(jobId) {
  if (!canCompleteInstallation()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  job.touchUpStatus = "Completed";
  job.touchUpRequired = false;
  const order = findOrder(job.orderId);
  const remaining = getRemainingBalance(order || {}, job);
  job.status = remaining <= 0 ? "installed" : "pending_collection";
  job.balance = remaining;
  job.updatedAt = new Date().toISOString();
  if (order) {
    order.installationStatus = job.status;
    order.status = remaining <= 0 ? "Completed" : "Pending Collection";
    order.balance = remaining;
    order.updatedAt = new Date().toISOString();
    persistOrders();
  }
  persistInstallationJobs();
  renderWorkflowModules();
  showWorkflowMessage("Touch up completed", "success");
}

function setupSignatureCanvas(jobId) {
  const canvas = document.querySelector(`[data-signature-canvas="${jobId}"]`);
  if (!canvas) return;
  const job = state.installationJobs.find((row) => row.id === jobId);
  const context = canvas.getContext("2d");
  context.lineWidth = 3;
  context.lineCap = "round";
  context.strokeStyle = "#10201b";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (job?.customerSignature) {
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = job.customerSignature;
  }

  let drawing = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height
    };
  };
  const start = (event) => {
    event.preventDefault();
    drawing = true;
    const pos = point(event);
    context.beginPath();
    context.moveTo(pos.x, pos.y);
    canvas.dataset.signed = "true";
  };
  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const pos = point(event);
    context.lineTo(pos.x, pos.y);
    context.stroke();
  };
  const stop = () => {
    drawing = false;
  };
  canvas.onmousedown = start;
  canvas.onmousemove = move;
  canvas.onmouseup = stop;
  canvas.onmouseleave = stop;
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = stop;
}

function clearSignature(jobId) {
  const canvas = document.querySelector(`[data-signature-canvas="${jobId}"]`);
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  canvas.dataset.signed = "";
}

function signatureDataUrl(jobId) {
  const canvas = document.querySelector(`[data-signature-canvas="${jobId}"]`);
  if (!canvas) return "";
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!canvas.dataset.signed && !job?.customerSignature) return "";
  return canvas.toDataURL("image/png");
}

function generateWarrantyCard(jobId) {
  if (!canCompleteInstallation() && !isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return showWorkflowMessage("Installation job not found.", "error");
  if (!["installed", "pending_collection", "Completed", "Pending Collection"].includes(job.status)) {
    showWorkflowMessage("Complete installation before generating warranty card.", "error");
    return;
  }
  const existing = state.warrantyCards.find((card) => card.installationJobNo === job.installationNumber);
  if (existing) {
    job.warrantyNo = existing.warrantyNo;
    persistInstallationJobs();
    showWorkflowMessage(`Warranty card already exists: ${existing.warrantyNo}`, "warning");
    renderInstallationJobs();
    return;
  }
  const card = {
    id: uid("warranty"),
    warrantyNo: nextWarrantyNumber(),
    orderNo: job.orderNo || job.orderNumber,
    orderNumber: job.orderNo || job.orderNumber,
    quoteNumber: job.quoteNumber || job.quotationNo || "",
    quotationNo: job.quoteNumber || job.quotationNo || "",
    installationJobNo: job.installationNumber,
    customer: { ...job.customer },
    products: job.items.map((item) => ({
      productName: item.productName,
      meshType: meshValue(item),
      warrantyPeriod: warrantyPeriodForProduct(item.productName)
    })),
    startDate: (job.completionDate || new Date().toISOString()).slice(0, 10),
    warrantyPeriod: warrantySummary(job.items),
    warrantyTerms,
    createdAt: new Date().toISOString()
  };
  state.warrantyCards = [card, ...state.warrantyCards];
  job.warrantyNo = card.warrantyNo;
  persistWarrantyCards();
  persistInstallationJobs();
  renderInstallationJobs();
  showWorkflowMessage(`Warranty card generated: ${card.warrantyNo}`, "success");
}

function printWarrantyCard(jobId) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  let card = state.warrantyCards.find((row) => row.installationJobNo === job.installationNumber);
  if (!card) {
    generateWarrantyCard(jobId);
    card = state.warrantyCards.find((row) => row.installationJobNo === job.installationNumber);
  }
  if (!card) return;
  openPrint(t("Warranty Card"), card.warrantyNo, `
    <div class="print-box"><strong>${card.customer.name || "-"}</strong><br>${card.customer.phone || "-"}<br>${card.customer.address || "-"}</div>
    <p><strong>${t("Order")}:</strong> ${card.orderNo}</p>
    <p><strong>${t("Quote")}:</strong> ${card.quoteNumber || card.quotationNo || "-"}</p>
    <p><strong>${t("Installation Jobs")}:</strong> ${card.installationJobNo}</p>
    <p><strong>Start Date:</strong> ${card.startDate}</p>
    <p><strong>${t("Warranty Card")}:</strong> ${card.warrantyPeriod}</p>
    <table><thead><tr><th>${t("Product")}</th><th>${t("Mesh / Net Type")}</th><th>${t("Warranty Card")}</th></tr></thead><tbody>
      ${card.products.map((product) => `<tr><td>${product.productName}</td><td>${product.meshType || "-"}</td><td>${product.warrantyPeriod}</td></tr>`).join("")}
    </tbody></table>
    <div class="terms">
      <h3>Warranty Terms</h3>
      ${card.warrantyTerms.map((term) => `<p>${term}</p>`).join("")}
    </div>
  `);
}

function warrantyPeriodForProduct(productName = "") {
  const name = productName.toLowerCase();
  if (name.includes("security mesh")) return "10 years";
  if (name.includes("roller") || name.includes("invisible")) return "3 years";
  return "1 year";
}

function warrantySummary(items) {
  return [...new Set(items.map((item) => `${item.productName}: ${warrantyPeriodForProduct(item.productName)}`))].join(", ");
}

function currentDateTimeLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function parseAmount(value) {
  const parsed = Number(String(value || "0").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please upload an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to load image file."));
      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.68));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function mediaFileToRecord(file) {
  if (file.type.startsWith("image/")) {
    return imageFileToDataUrl(file).then((dataUrl) => ({
      type: "image",
      name: file.name,
      dataUrl,
      createdAt: new Date().toISOString()
    }));
  }
  if (file.type.startsWith("video/")) {
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error("Video is too large for browser storage. Please upload a shorter video."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Unable to read video file."));
      reader.onload = () => resolve({
        type: "video",
        name: file.name,
        dataUrl: reader.result,
        createdAt: new Date().toISOString()
      });
      reader.readAsDataURL(file);
    });
  }
  return Promise.reject(new Error("Please upload image or video files."));
}

function printOrder(id) {
  const order = state.orders.find((row) => row.id === id);
  if (!order) return;
  openPrint(t("Order"), getOrderDisplayNo(order), `
    ${customerBlock(order.customer)}
    <p><strong>${t("Quote")}:</strong> ${order.quoteNumber || order.quotationNo || "-"}</p>
    <p><strong>${t("Status")}:</strong> ${statusLabel(order.status)}</p>
    <p><strong>${t("Installation Date")}:</strong> ${order.installationDate || "-"}</p>
    ${printItemsTable(order.items, true)}
    ${totalsBlock(order)}
    <p><strong>${t("Remark")}:</strong> ${order.remark || "-"}</p>
  `);
}

function printProduction(id) {
  const job = state.productionJobs.find((row) => row.id === id);
  if (!job) return;
  openPrint(t("Print Production Sheet"), job.productionNumber, `
    <p><strong>${t("Order")}:</strong> ${job.orderNo || job.orderNumber}</p>
    <p><strong>${t("Quote")}:</strong> ${job.quoteNumber || job.quotationNo || "-"}</p>
    <p><strong>${t("Customer Name")}:</strong> ${job.customerName || "-"}</p>
    <p><strong>${t("Status")}:</strong> ${statusLabel(job.status)}</p>
    ${printItemsTable(job.items, false)}
    <p><strong>${t("Production Remark")}:</strong> ${job.remark || "-"}</p>
    <div class="print-sign"><span>Prepared by</span><span>Checked by</span></div>
  `);
}

function printInstallation(id) {
  const job = state.installationJobs.find((row) => row.id === id);
  if (!job) return;
  openPrint(t("Print Installation Sheet"), job.installationNumber, `
    ${customerBlock(job.customer)}
    <p><strong>${t("Order")}:</strong> ${job.orderNo || job.orderNumber}</p>
    <p><strong>${t("Quote")}:</strong> ${job.quoteNumber || job.quotationNo || "-"}</p>
    <p><strong>${t("Installation Date")}:</strong> ${job.installationDate || "-"}</p>
    <p><strong>${t("Status")}:</strong> ${statusLabel(job.status)}</p>
    <p><strong>${t("Balance")}:</strong> ${money(job.balance)}</p>
    ${printItemsTable(job.items, false)}
    <p><strong>${t("Installer Remark")}:</strong> ${job.installerRemark || "-"}</p>
    ${installationCompletionPrintHtml(job)}
  `);
}

function installationCompletionPrintHtml(job) {
  const checklist = job.checklist || {};
  return `
    <div class="print-box">
      <h3>${t("Complete Installation")}</h3>
      <p><strong>${t("Installer")}:</strong> ${job.installerName || "-"}</p>
      <p><strong>${t("Installation Date")}:</strong> ${job.completionDate || "-"}</p>
      <p><strong>${t("Installer Remark")}:</strong> ${job.installationRemark || "-"}</p>
      <p><strong>${t("Amount collected")}:</strong> ${money(job.amountCollected || 0)}</p>
      <p><strong>${t("Payment Method")}:</strong> ${job.paymentMethod || "-"}</p>
      <p><strong>Payment Reference:</strong> ${job.paymentReference || "-"}</p>
    </div>
    <table><thead><tr><th>Checklist</th><th>Status</th></tr></thead><tbody>
      ${checklistLabels.map((label) => `<tr><td>${t(label)}</td><td>${checklist[label] ? "Done" : "Pending"}</td></tr>`).join("")}
    </tbody></table>
    <div class="print-photo-grid">
      ${printImageBox(t("Before installation photo"), job.beforePhoto)}
      ${printImageBox(t("After installation photo"), job.afterPhoto)}
      ${printImageBox(t("Problem / defect photo"), job.defectPhoto)}
      ${printImageBox(t("Customer Signature"), job.customerSignature)}
    </div>
  `;
}

function printImageBox(label, source) {
  return `<div class="print-image-box"><strong>${label}</strong>${source ? `<img src="${source}" alt="${label}" />` : `<p>-</p>`}</div>`;
}

function customerBlock(customer) {
  return `<div class="print-box"><strong>${customer.name || "-"}</strong><br>${customer.phone || "-"}<br>${customer.area || "-"}<br>${customer.address || "-"}</div>`;
}

function printItemsTable(items, showPrice) {
  return `<table><thead><tr><th>${t("Product")}</th><th>${t("Installation Location")}</th><th>Size</th><th>${t("Quantity")}</th><th>${t("Color")}</th><th>${t("Install Type / Inside Outside")}</th><th>${t("Opening Direction")}</th><th>${t("Track Size")}</th><th>${t("Handle Height")}</th><th>${t("Handle Position")}</th><th>${t("Track Type")}</th><th>${t("Mesh / Net Type")}</th><th>${t("Powdercoat / Powercoat")}</th><th>${t("Remark")}</th>${showPrice ? `<th>${t("Unit Price")}</th><th>${t("Total")}</th>` : ""}</tr></thead><tbody>
    ${items.map((item) => `<tr><td>${item.productName}</td><td>${item.installationLocation || "-"}</td><td>${item.width || 0} x ${item.height || 0}</td><td>${item.quantity || 0}</td><td>${item.color || "-"}</td><td>${item.installType || "-"}</td><td>${item.openingDirection || "-"}</td><td>${item.trackSize || "-"}</td><td>${item.handleHeight || "-"}</td><td>${item.handlePosition || "-"}</td><td>${item.trackType || item.trackOpening || "-"}</td><td>${meshValue(item) || "-"}</td><td>${item.powdercoat ? `Yes ${money(powdercoatAmount(item))}` : "No"}</td><td>${item.remark || "-"}</td>${showPrice ? `<td>${money(item.unitPrice)}</td><td>${money(lineTotal(item))}${priceAdjustmentPrintNote(item)}</td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}

function priceAdjustmentPrintNote(item) {
  if (!hasManualFinalPrice(item)) return "";
  const remark = item.priceAdjustmentRemark ? `<small>Remark: ${item.priceAdjustmentRemark}</small>` : "";
  return `<small>Adjusted from ${money(autoCalculatedPrice(item))}</small>${remark}`;
}

function totalsBlock(order) {
  return `<div class="print-totals">
    <div><span>${t("Subtotal")}</span><strong>${money(order.subtotal)}</strong></div>
    <div><span>${t("Discount")}</span><strong>${money(order.discount)}</strong></div>
    <div><span>${t("Total")}</span><strong>${money(order.total)}</strong></div>
    <div><span>${t("Deposit")}</span><strong>${money(order.deposit)}</strong></div>
    <div><span>${t("Balance")}</span><strong>${money(order.balance)}</strong></div>
  </div>`;
}

function openPrint(title, number, body) {
  const area = document.querySelector("#workflowPrintArea");
  const company = state.companySettings;
  area.innerHTML = `
    <div class="print-head">
      <div>
        <h1>${company.companyName || "Eco Screen Sdn Bhd"}</h1>
        <p>${company.companyAddress || ""}</p>
        <p>Tel: ${company.companyPhone || ""}</p>
        ${company.companyEmail ? `<p>Email: ${company.companyEmail}</p>` : ""}
      </div>
      <div><p>${title}</p><h2>${number}</h2></div>
    </div>
    ${body}
  `;
  document.body.classList.add("workflow-print-mode");
  window.print();
  setTimeout(() => document.body.classList.remove("workflow-print-mode"), 300);
}
