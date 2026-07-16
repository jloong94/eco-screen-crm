import {
  activeProducts,
  nextInstallationNumber,
  nextProductionNumber,
  persistOrderConversionLocally,
  persistQuotations,
  persistInstallationJobs,
  persistOrders,
  persistProductionJobs,
  persistWarrantyCards,
  productById,
  state,
  stateSnapshot,
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
import {
  isActiveOrderRecord,
  isActiveWorkflowRecord,
  normalizeWorkflowStatus,
  scanWorkflowIntegrity as scanWorkflowIntegrityRecords,
  uniqueActiveOrders,
  uniqueActiveProductionJobs
} from "./workflowIntegrity.js";

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
const returnToFollowUpReasons = ["Customer did not confirm", "Customer postponed", "Mistakenly converted", "Duplicate Order", "Other"];
const paymentTypes = ["Deposit", "Progress Payment", "Final Payment"];
const paymentMethods = ["Bank Transfer", "Cash", "Card", "Other"];
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
  { id: "all", label: "All Orders" },
  { id: "pending", label: "Pending" },
  { id: "production", label: "Production" },
  { id: "installation", label: "Installation" },
  { id: "completed", label: "Completed" },
  { id: "duplicate-archived", label: "Archived duplicates" }
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
const duplicateMainSelections = new Map();
let productionSearch = "";
let productionDuplicateScanVisible = false;
let productionDuplicateScanResult = null;
let productionDuplicateArchiveBusy = false;
let showArchivedProductionDuplicates = false;
const productionDuplicateMainSelections = new Map();
let workflowIntegrityVisible = false;
let workflowIntegrityResult = null;
let coveredOrderRecovery = null;
let returnToFollowUpPanel = null;
let paymentPanel = null;
let paymentReversalPanel = null;
let installationDispatchPreviewId = "";
let installationRecallJobId = "";
let warrantyPreviewCardId = "";
function defaultOrderSearch() {
  return {
    orderNumber: "",
    customerName: "",
    phone: "",
    filter: "all",
    status: "",
    installationDate: "",
    sort: "updated",
    page: 1,
    highlightId: ""
  };
}

let orderSearch = defaultOrderSearch();

export function resetWorkflowNavigationState(page) {
  if (page === "orders") orderSearch = defaultOrderSearch();
  if (page === "production") {
    productionSearch = "";
    showArchivedProductionDuplicates = false;
  }
}

export function setOrderNavigationFilter(filter) {
  orderSearch = { ...orderSearch, filter: String(filter || "all"), status: "", page: 1, highlightId: "" };
}

export function setProductionNavigationState({ search = productionSearch, showArchived = showArchivedProductionDuplicates } = {}) {
  productionSearch = String(search || "");
  showArchivedProductionDuplicates = Boolean(showArchived);
}

export function workflowNavigationState() {
  return {
    orders: { ...orderSearch },
    production: { search: productionSearch, showArchived: showArchivedProductionDuplicates }
  };
}

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
    const workflowJobs = upsertWorkflowJobsForOrder(order, state.productionJobs, state.installationJobs);
    const linkedOrder = {
      ...order,
      productionJobId: workflowJobs.productionJob.id,
      installationJobId: workflowJobs.installationJob.id,
      productionStatus: normalizeProductionStatus(workflowJobs.productionJob.status, order.sentToProduction === true),
      installationStatus: normalizeInstallationStatus(workflowJobs.installationJob.status),
      updatedAt: now
    };
    const updatedQuote = {
      ...quote,
      status: "won",
      workflowStatus: "converted",
      quoteNumber: quoteDisplayNo,
      quotationNo: quoteDisplayNo,
      quoteNo: quoteDisplayNo,
      orderId: linkedOrder.id,
      linkedOrderId: linkedOrder.id,
      orderNo: getOrderDisplayNo(linkedOrder),
      orderNumber: getOrderDisplayNo(linkedOrder),
      converted: true,
      convertedToOrder: true,
      convertedAt: quote.convertedAt || now,
      updatedAt: now
    };
    const nextWarrantyCards = updateWarrantyOrderNumbers(linkedOrder, state.warrantyCards);
    const nextQuotations = state.quotations.map((row) => (
      row === sourceQuote || (sourceQuote.id && row.id === sourceQuote.id) ? updatedQuote : row
    ));
    const nextOrders = existing
      ? state.orders.map((row) => row.id === linkedOrder.id ? linkedOrder : row)
      : [linkedOrder, ...state.orders];

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
      ? `Existing Order found: ${getOrderDisplayNo(linkedOrder)}`
      : `Order created: ${getOrderDisplayNo(linkedOrder)}`;
    showWorkflowMessage(`${baseMessage} Saved locally. Syncing cloud...`, "info");

    const cloudSync = await syncOrderConversionCollections();
    const cloudFailed = !cloudSync.ok && !cloudSync.localOnly;
    const message = cloudFailed
      ? `${baseMessage} Order saved locally but cloud sync failed: ${cloudSync.reason}`
      : cloudSync.localOnly
        ? `${baseMessage} Saved locally.`
        : baseMessage;
    showWorkflowMessage(message, cloudFailed ? "warning" : "success");
    openOrderInOrders(linkedOrder, message, cloudFailed ? "warning" : "success");
    return {
      ok: true,
      message,
      order: linkedOrder,
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
  return state.quotations.find((row) => String(row.id || "") === String(quoteId || "")) || null;
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

export function createOrderFromQuote(quote, options = {}) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const quoteDisplayNo = String(options.quoteNumber || "").trim() || ensureQuotationDisplayNo(quote);
  const orderNo = String(options.orderNo || "").trim() || nextSalesOrderNumber();
  const customer = customerFromQuotation(quote);
  const appointmentDate = quote.appointmentDate || quote.appointment_date || "";
  const appointmentTime = quote.appointmentTime || quote.appointment_time || "";
  const remark = quote.remark ?? quote.remarks ?? "";
  const now = options.now || new Date().toISOString();
  return {
    id: options.id || uid("order"),
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
    createdAt: now,
    updatedAt: now
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
  const productionJob = activeProductionJobForOrder(order, productionJobs);
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

  const installationJob = installationJobs.find((job) => isActiveWorkflowRecord(job) && String(job.orderId || "") === String(order.id || ""));
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
    installationJobs: nextInstallationJobs,
    productionJob: nextProductionJobs.find((job) => job.id === (productionJob?.id || nextProductionJobs[0].id)),
    installationJob: nextInstallationJobs.find((job) => job.id === (installationJob?.id || nextInstallationJobs[0].id))
  };
}

export function isArchivedProductionJob(job = {}) {
  return !isActiveWorkflowRecord(job);
}

export function activeProductionJobForOrder(order = {}, productionJobs = state.productionJobs) {
  if (!order.id) return null;
  return uniqueActiveProductionJobs(productionJobs).find((job) => String(job.orderId || "") === String(order.id)) || null;
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
    installationDate: order.installationDate || "",
    installationTime: "",
    assignedInstallerId: "",
    assignedInstallerName: "",
    address: order.customer?.address || "",
    contactPerson: order.customer?.name || "",
    phone: order.customer?.phone || "",
    installationRemarks: "",
    requiredItems: "",
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
    status: "pending_arrangement",
    dispatchStatus: "pending",
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
  return String(order.orderNo || order.orderNumber || "").trim();
}

export function findExistingOrderForQuote(quote) {
  if (!quote || typeof quote !== "object") return null;

  const linkedOrderId = String(quote.linkedOrderId || quote.orderId || "").trim();
  if (linkedOrderId) {
    const linked = state.orders.find((order) => String(order.id || "") === linkedOrderId);
    const resolved = resolveMainOrder(linked);
    if (resolved && isActiveOrderRecord(resolved)) return resolved;
  }

  if (quote.id) {
    const byQuoteId = state.orders.find((order) => isActiveOrderRecord(order) && (order.quoteId === quote.id || order.quotationId === quote.id));
    if (byQuoteId) return resolveMainOrder(byQuoteId);
  }
  return null;
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

  const message = `Existing Order found: ${getOrderDisplayNo(order)}`;
  openOrderInOrders(order, message, "success");
  return { ok: true, order, repaired: false };
}

function resolveMainOrder(order) {
  if (!order || String(order.status || "").toLowerCase() !== "duplicate_archived" || !order.duplicateOfOrderId) return order;
  return state.orders.find((row) => row.id === order.duplicateOfOrderId && isActiveOrderRecord(row)) || order;
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

function resetOrderSearchForOrder(order) {
  orderSearch = {
    orderNumber: "",
    customerName: "",
    phone: "",
    filter: "all",
    status: "",
    installationDate: "",
    sort: "updated",
    page: 1,
    highlightId: order.id
  };
}

function openOrderInOrders(order, message, type = "success") {
  resetOrderSearchForOrder(order);
  const ordersNavigation = document.querySelector?.('[data-page="orders"]');
  if (ordersNavigation && state.currentPage !== "orders") ordersNavigation.click();
  else renderOrders();
  setTimeout(() => {
    document.querySelector?.(`[data-order-id="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    showWorkflowMessage(message, type);
  }, 50);
}

export function renderWorkflowModules() {
  renderOrders();
  renderProductionJobs();
  renderInstallationJobs();
}

export function attachWorkflowEvents() {
  document.querySelector("#orderTools")?.addEventListener("input", handleOrderSearchInput);
  document.querySelector("#orderTools")?.addEventListener("click", handleOrderToolsClick);
  document.querySelector("#orderTools")?.addEventListener("change", handleOrderToolsChange);
  document.querySelector("#orderProgressBoard")?.addEventListener("click", handleOrderToolsClick);
  document.querySelector("#orderList")?.addEventListener("click", handleOrderClick);
  document.querySelector("#orderList")?.addEventListener("input", handleOrderItemInput);
  document.querySelector("#orderList")?.addEventListener("change", handleOrderChange);
  document.querySelector("#productionList")?.addEventListener("click", handleProductionClick);
  document.querySelector("#productionList")?.addEventListener("change", handleProductionChange);
  document.querySelector("#productionTools")?.addEventListener("input", handleProductionSearch);
  document.querySelector("#productionTools")?.addEventListener("click", handleProductionSearchClick);
  document.querySelector("#productionTools")?.addEventListener("change", handleProductionToolsChange);
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
  const orders = sortedOrders(ordersForDisplay());
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
  const filtered = uniqueActiveOrders(state.orders).filter((order) => matchesOrderSearch(order) && matchesBoardDateFilter(order));
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
        <label>Search SO Order No / Quotation No<input data-order-search="orderNumber" value="${orderSearch.orderNumber}" placeholder="SO2607001 or quotation number" /></label>
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
        ${isBossOrAdmin() ? `<button class="btn" type="button" data-order-tool="workflow-integrity">Workflow Integrity Check</button>` : ""}
        ${isBossOrAdmin() ? `<button class="btn" type="button" data-order-tool="recover-covered-order">Recover Covered Order</button>` : ""}
      </div>
      <div class="filter-tabs">
        ${visibleFilters.map((filter) => `<button class="filter-tab ${orderSearch.filter === filter.id ? "active" : ""}" type="button" data-order-filter="${filter.id}">${t(filter.label)}</button>`).join("")}
      </div>
      ${duplicateOrderPanelHtml()}
      ${workflowIntegrityPanelHtml()}
      ${coveredOrderRecoveryPanelHtml()}
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
  return `
    <div class="duplicate-section">
      <h4>${title}</h4>
      ${groups.length ? "" : `<p class="muted-text">${t("None found in this section.")}</p>`}
      ${groups.map((group) => `
        <article class="duplicate-group-card" data-duplicate-group-card="${group.id}">
          <p><strong>${escapeHtml(group.reasons.join(" | "))}</strong></p>
          <div class="duplicate-member-list">
            ${group.members.map((member) => duplicateMemberHtml(member, group, type === "confirmed")).join("")}
          </div>
          ${type === "confirmed" ? duplicateArchiveActionHtml(group) : `<p class="warning-text"><strong>${t("Manual review required")}</strong></p>`}
        </article>
      `).join("")}
    </div>
  `;
}

function duplicateMemberHtml(member, group, selectable) {
  const order = member.order;
  const details = duplicateOrderDetails(member);
  const selected = duplicateMainSelections.get(group.id) === member.key;
  return `
    <div class="duplicate-member">
      ${selectable ? `<label class="duplicate-main-choice"><input type="radio" name="duplicate-main-${group.id}" data-duplicate-main="${escapeHtml(member.key)}" data-duplicate-group="${group.id}" ${selected ? "checked" : ""} /> ${t("Select as Main Order")}</label>` : ""}
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
        <span>Warranty count<strong>${details.warrantyCount}</strong></span>
      </div>
      ${selectable ? "" : `<button class="btn" type="button" data-duplicate-open-order="${escapeHtml(order.id || "")}">${t("Open Order")}</button>`}
    </div>
  `;
}

export function duplicateArchiveActionHtml(group, selectedKey = duplicateMainSelections.get(group.id)) {
  if (!selectedKey) return `<p class="muted-text">${t("Select one Main Order to reveal the archive action.")}</p>`;
  const mainMember = group.members.find((member) => member.key === selectedKey);
  if (!mainMember) return "";
  const duplicateMembers = group.members.filter((member) => member.key !== selectedKey);
  const linkedCounts = duplicateMembers.reduce((counts, member) => {
    const details = duplicateOrderDetails(member);
    counts.production += details.productionCount;
    counts.installation += details.installationCount;
    counts.warranty += details.warrantyCount;
    return counts;
  }, { production: 0, installation: 0, warranty: 0 });
  return `
    <div class="duplicate-archive-action">
      <p><strong>Main Order:</strong> ${escapeHtml(getOrderDisplayNo(mainMember.order) || mainMember.order.id || "-")}</p>
      <p><strong>Orders to archive:</strong> ${duplicateMembers.map((member) => escapeHtml(getOrderDisplayNo(member.order) || member.order.id || "-")).join(", ")}</p>
      <p><strong>Linked records:</strong> Production ${linkedCounts.production} | Installation ${linkedCounts.installation} | Warranty ${linkedCounts.warranty}</p>
      <button class="btn danger" type="button" data-archive-duplicate-group="${group.id}" ${duplicateArchiveBusy ? "disabled" : ""}>${t("Archive Other Duplicates")}</button>
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
    installationCount: state.installationJobs.filter(belongs).length,
    warrantyCount: state.warrantyCards.filter(belongs).length
  };
}

function renderCompactOrderRow(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="compact-order-row ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${escapeHtml(order.id)}" data-order-id="${escapeHtml(order.id)}">
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
  const bossActiveOrder = isBossOrAdmin() && isActiveOrderRecord(order);
  return `
    <div class="actions">
      <button class="btn" type="button" data-view-order="${order.id}">${t("View Order")}</button>
      <button class="btn primary" type="button" data-print-order="${order.id}">${t("Print Order")}</button>
      ${canSendOrder() ? `<button class="btn" type="button" data-send-production="${order.id}">${t("Send to Production")}</button>` : ""}
      ${canScheduleInstallation() ? `<button class="btn" type="button" data-send-installer="${order.id}">Arrange Installation</button>` : ""}
      <button class="btn" type="button" data-whatsapp-order="${order.id}">${t("WhatsApp Customer")}</button>
      <button class="btn" type="button" data-highlight-order="${order.id}">${t("Search / Open Customer")}</button>
      ${canEditOrder() ? `<button class="btn" type="button" data-edit-order-items="${order.id}">${editingOrderId === order.id ? t("Close Item Editor") : t("Edit Order Items")}</button>` : ""}
      ${isBossOrAdmin() ? `<button class="btn" type="button" data-edit-order-number="${order.id}">${editingOrderNumberId === order.id ? t("Cancel Order Number Edit") : t("Edit Order Number")}</button>` : ""}
      ${bossActiveOrder ? `<button class="btn" type="button" data-return-follow-up="${escapeHtml(order.id)}">Return to Follow Up</button>` : ""}
      ${bossActiveOrder ? `<button class="btn" type="button" data-record-payment="${escapeHtml(order.id)}">Record Payment / Add Deposit</button>` : ""}
    </div>
    ${canSendOrder() ? orderStatusActionHtml(order) : ""}
    ${editingOrderNumberId === order.id && isBossOrAdmin() ? orderNumberEditorHtml(order) : ""}
    ${isBossOrAdmin() ? paymentHistoryHtml(order) : ""}
    ${returnToFollowUpPanel?.orderId === order.id ? returnToFollowUpPanelHtml(order) : ""}
    ${paymentPanel?.orderId === order.id ? recordPaymentPanelHtml(order) : ""}
    ${paymentReversalPanel?.orderId === order.id ? reversePaymentPanelHtml(order) : ""}
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

function returnToFollowUpPanelHtml(order) {
  const panel = returnToFollowUpPanel;
  const plan = panel?.preview ? buildReturnToFollowUpPlan(order.id, panel.reason) : null;
  const summary = getOrderPaymentSummary(order);
  const productionIds = state.productionJobs.filter((job) => String(job.orderId || "") === String(order.id)).map((job) => job.id).filter(Boolean);
  const installationIds = state.installationJobs.filter((job) => String(job.orderId || "") === String(order.id)).map((job) => job.id).filter(Boolean);
  return `
    <section class="order-action-panel" data-return-follow-up-panel="${escapeHtml(order.id)}">
      <div class="section-head">
        <div><h3>Return to Follow Up</h3><p class="muted-text">The Order and exact orderId-linked jobs are archived for audit; the exact linked quotation returns to Follow Up.</p></div>
        <button class="btn" type="button" data-cancel-return-follow-up="${escapeHtml(order.id)}">Close</button>
      </div>
      ${orderActionFactsHtml(order, summary, productionIds, installationIds)}
      ${summary.totalPaid > 0 ? `<p class="payment-warning"><strong>Payment warning:</strong> ${money(summary.totalPaid)} is recorded as paid/deposit. All financial values will be preserved and a second confirmation is required.</p>` : ""}
      ${panel?.preview && plan?.ok ? `
        <h4>Before / After Preview</h4>
        ${fieldChangesPreviewHtml(plan.changes)}
        <div class="actions">
          <button class="btn danger" type="button" data-confirm-return-follow-up="${escapeHtml(order.id)}">Confirm Return to Follow Up</button>
          <button class="btn" type="button" data-return-follow-up="${escapeHtml(order.id)}">Back</button>
        </div>
      ` : `
        <label>Reason
          <select data-return-follow-up-reason>
            ${returnToFollowUpReasons.map((reason) => `<option value="${escapeHtml(reason)}" ${panel?.reason === reason ? "selected" : ""}>${escapeHtml(reason)}</option>`).join("")}
          </select>
        </label>
        <button class="btn primary" type="button" data-preview-return-follow-up="${escapeHtml(order.id)}">Show Before / After Preview</button>
      `}
    </section>
  `;
}

function recordPaymentPanelHtml(order) {
  const panel = paymentPanel;
  const plan = panel?.preview ? buildRecordPaymentPlan(panel.values) : null;
  const summary = getOrderPaymentSummary(order);
  return `
    <section class="order-action-panel" data-record-payment-panel="${escapeHtml(order.id)}">
      <div class="section-head">
        <div><h3>Record Payment / Add Deposit</h3><p class="muted-text">Append an auditable payment using its actual payment date.</p></div>
        <button class="btn" type="button" data-cancel-payment="${escapeHtml(order.id)}">Close</button>
      </div>
      ${panel?.preview && plan?.ok ? `
        <div class="payment-preview-grid">
          <span>Order total<strong>${money(plan.before.total)}</strong></span>
          <span>Existing paid<strong>${money(plan.before.totalPaid)}</strong></span>
          <span>New payment<strong>${money(plan.payment.amount)}</strong></span>
          <span>New total paid<strong>${money(plan.after.totalPaid)}</strong></span>
          <span>New balance<strong>${money(plan.after.balance)}</strong></span>
        </div>
        <p><strong>Actual date:</strong> ${escapeHtml(plan.payment.paymentDate)} | <strong>Type:</strong> ${escapeHtml(plan.payment.type)} | <strong>Method:</strong> ${escapeHtml(plan.payment.method)}</p>
        ${plan.requiresOverpaymentConfirmation ? `<p class="payment-warning"><strong>Overpayment warning:</strong> This payment exceeds the current balance by ${money(plan.payment.amount - plan.before.balance)}. Boss/Admin confirmation is required.</p>` : ""}
        <h4>Before / After Preview</h4>
        ${fieldChangesPreviewHtml(plan.changes)}
        <div class="actions">
          <button class="btn primary" type="button" data-confirm-payment="${escapeHtml(order.id)}">Confirm Record Payment</button>
          <button class="btn" type="button" data-record-payment="${escapeHtml(order.id)}">Back</button>
        </div>
      ` : `
        <div class="payment-preview-grid">
          <span>Order total<strong>${money(summary.total)}</strong></span>
          <span>Existing paid<strong>${money(summary.totalPaid)}</strong></span>
          <span>Current balance<strong>${money(summary.balance)}</strong></span>
        </div>
        <div class="form-grid compact">
          <label>Amount<input inputmode="decimal" data-payment-field="amount" value="${escapeHtml(panel?.values?.amount || "")}" /></label>
          <label>Actual payment date<input type="date" data-payment-field="paymentDate" value="${escapeHtml(panel?.values?.paymentDate || "")}" /></label>
          <label>Payment type<select data-payment-field="type">${paymentTypes.map((value) => `<option value="${value}" ${panel?.values?.type === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label>Payment method<select data-payment-field="method">${paymentMethods.map((value) => `<option value="${value}" ${panel?.values?.method === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label>Reference number<input data-payment-field="referenceNumber" value="${escapeHtml(panel?.values?.referenceNumber || "")}" /></label>
          <label class="wide">Note<textarea rows="2" data-payment-field="note">${escapeHtml(panel?.values?.note || "")}</textarea></label>
        </div>
        <button class="btn primary" type="button" data-preview-payment="${escapeHtml(order.id)}">Show Before / After Preview</button>
      `}
    </section>
  `;
}

function reversePaymentPanelHtml(order) {
  const panel = paymentReversalPanel;
  const plan = panel?.preview ? buildReversePaymentPlan(panel.values) : null;
  const payment = getOrderPaymentSummary(order).payments.find((entry) => paymentStableId(entry) === panel?.paymentId);
  return `
    <section class="order-action-panel" data-reverse-payment-panel="${escapeHtml(order.id)}">
      <div class="section-head">
        <div><h3>Reverse Payment</h3><p class="muted-text">Payment ${escapeHtml(panel?.paymentId || "-")} | ${money(payment?.amount || 0)}</p></div>
        <button class="btn" type="button" data-cancel-reverse-payment="${escapeHtml(order.id)}">Close</button>
      </div>
      ${panel?.preview && plan?.ok ? `
        <div class="payment-preview-grid">
          <span>Current total paid<strong>${money(plan.before.totalPaid)}</strong></span>
          <span>Reversed payment<strong>${money(plan.payment.amount)}</strong></span>
          <span>New total paid<strong>${money(plan.after.totalPaid)}</strong></span>
          <span>New balance<strong>${money(plan.after.balance)}</strong></span>
        </div>
        ${fieldChangesPreviewHtml(plan.changes)}
        <div class="actions">
          <button class="btn danger" type="button" data-confirm-reverse-payment="${escapeHtml(order.id)}">Confirm Reverse Payment</button>
          <button class="btn" type="button" data-reverse-payment="${escapeHtml(panel.paymentId)}" data-order-id="${escapeHtml(order.id)}">Back</button>
        </div>
      ` : `
        <label>Reversal reason<textarea rows="2" data-reversal-reason>${escapeHtml(panel?.values?.reversalReason || "")}</textarea></label>
        <button class="btn primary" type="button" data-preview-reverse-payment="${escapeHtml(order.id)}">Show Before / After Preview</button>
      `}
    </section>
  `;
}

function paymentHistoryHtml(order) {
  const summary = getOrderPaymentSummary(order);
  return `
    <details class="payment-history" ${paymentPanel?.orderId === order.id || paymentReversalPanel?.orderId === order.id ? "open" : ""}>
      <summary>Payment History — Paid ${money(summary.totalPaid)} | Balance ${money(summary.balance)}</summary>
      ${summary.legacyPaid > 0 ? `<div class="payment-history-row"><span>Legacy paid/deposit preserved</span><strong>${money(summary.legacyPaid)}</strong></div>` : ""}
      ${summary.payments.length ? summary.payments.map((payment) => {
        const stableId = paymentStableId(payment);
        return `<div class="payment-history-row">
          <span><strong>${escapeHtml(payment.type || "Payment")}</strong> ${escapeHtml(payment.paymentDate || payment.date || "-")} | ${escapeHtml(payment.method || "-")} | ${escapeHtml(payment.referenceNumber || payment.reference || "-")}<small>${escapeHtml(payment.note || "")}</small><small>ID: ${escapeHtml(stableId || "legacy record without stable ID")}</small></span>
          <strong>${money(payment.amount)} — ${escapeHtml(payment.status || "active")}</strong>
          ${isActivePaymentRecord(payment) && stableId ? `<button class="btn danger" type="button" data-reverse-payment="${escapeHtml(stableId)}" data-order-id="${escapeHtml(order.id)}">Reverse Payment</button>` : ""}
        </div>`;
      }).join("") : `<p class="muted-text">No appended payment records.</p>`}
    </details>
  `;
}

function orderActionFactsHtml(order, paymentSummary, productionIds, installationIds) {
  return `<div class="order-action-facts">
    <span>Customer<strong>${escapeHtml(order.customer?.name || order.customerName || "-")}</strong></span>
    <span>Phone<strong>${escapeHtml(order.customer?.phone || order.phone || "-")}</strong></span>
    <span>Quotation<strong>${escapeHtml(order.quoteNumber || order.quotationNo || "-")}</strong></span>
    <span>Order<strong>${escapeHtml(getOrderDisplayNo(order))}</strong></span>
    <span>Total<strong>${money(paymentSummary.total)}</strong></span>
    <span>Paid / Deposit<strong>${money(paymentSummary.totalPaid)}</strong></span>
    <span>Production IDs<strong>${escapeHtml(productionIds.join(", ") || "-")}</strong></span>
    <span>Installation IDs<strong>${escapeHtml(installationIds.join(", ") || "-")}</strong></span>
  </div>`;
}

function fieldChangesPreviewHtml(changes = []) {
  return `<div class="change-preview-list">${changes.map((change) => `<div><strong>${escapeHtml(change.collection)} / ${escapeHtml(change.stableId)} / ${escapeHtml(change.field)}</strong><span>Before: ${escapeHtml(previewValue(change.from))}</span><span>After: ${escapeHtml(previewValue(change.to))}</span></div>`).join("")}</div>`;
}

function previewValue(value) {
  if (value === undefined) return "(missing)";
  if (value === "") return "(blank)";
  if (value === null) return "null";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
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
    <article class="progress-card ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${escapeHtml(order.id)}" data-order-id="${escapeHtml(order.id)}">
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

export function ordersForDisplay(orders = state.orders) {
  const source = orderSearch.filter === "duplicate-archived" || orderSearch.status === "duplicate-archived"
    ? orders
    : uniqueActiveOrders(orders);
  return source.filter((order) => matchesOrderFilter(order) && matchesOrderSearch(order));
}

function matchesOrderSearch(order) {
  const orderNumber = normalizeText(getOrderDisplayNo(order));
  const quotationNumber = normalizeText(order.quoteNumber || order.quotationNo || order.quoteNo);
  const customerName = normalizeText(order.customer?.name);
  const phone = normalizeText(order.customer?.phone);
  const installationJob = getOrderInstallationJob(order);
  const installDate = installationJob?.installationDate || order.installationDate || "";
  return (!orderSearch.orderNumber || orderNumber.includes(normalizeText(orderSearch.orderNumber)) || quotationNumber.includes(normalizeText(orderSearch.orderNumber)))
    && (!orderSearch.customerName || customerName.includes(normalizeText(orderSearch.customerName)))
    && (!orderSearch.phone || phone.includes(normalizeText(orderSearch.phone)))
    && (!orderSearch.status || matchesOrderNavigationFilter(order, orderSearch.status))
    && (!orderSearch.installationDate || installDate === orderSearch.installationDate);
}

function matchesOrderFilter(order) {
  return matchesOrderNavigationFilter(order, orderSearch.filter);
}

function matchesOrderNavigationFilter(order, filter) {
  if (filter === "duplicate-archived") return isBossOrAdmin() && normalizeWorkflowStatus(order.status) === "duplicate_archived";
  if (!isActiveOrderRecord(order)) return false;
  if (filter === "all") return true;
  if (filter === "pending") return getOrderProgressCategory(order) === "new";
  if (filter === "production") return ["in-production", "waiting-installation"].includes(getOrderProgressCategory(order));
  if (filter === "installation") return ["waiting-installation", "pending-collection", "touch-up"].includes(getOrderProgressCategory(order));
  if (filter === "completed") return getOrderProgressCategory(order) === "completed";
  if (["today-installation", "week-installation", "overdue-installation"].includes(filter)) return matchesBoardDateFilter(order);
  return getOrderProgressCategory(order) === filter;
}

export function scanWorkflowIntegrity(snapshot = state) {
  return scanWorkflowIntegrityRecords(snapshot);
}

function workflowIntegrityPanelHtml() {
  if (!isBossOrAdmin() || !workflowIntegrityVisible) return "";
  const scan = workflowIntegrityResult || scanWorkflowIntegrity();
  return `
    <section class="duplicate-order-panel workflow-integrity-panel">
      <div class="section-head">
        <div>
          <h3>Workflow Integrity Check</h3>
          <p class="muted-text">Preview only. Scanning does not modify, rename, merge, archive, create or sync any record.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-order-tool="workflow-integrity-refresh">Scan Again</button>
          <button class="btn" type="button" data-order-tool="workflow-integrity-close">Close</button>
        </div>
      </div>
      <div class="duplicate-summary">
        ${"ABCDEFGHIJKLM".split("").map((category) => `<span>${category}: <strong>${scan.categories[category].length}</strong></span>`).join("")}
      </div>
      ${scan.issues.length ? `
        <div style="overflow-x:auto">
          <table class="workflow-integrity-table">
            <thead><tr><th>Select</th><th>Category</th><th>Record type</th><th>Stable ID</th><th>Order No</th><th>Quotation No</th><th>Customer</th><th>Phone</th><th>Amount</th><th>Status</th><th>Linked IDs</th><th>Problem</th><th>Recommended action</th></tr></thead>
            <tbody>${scan.issues.map((issue) => workflowIntegrityIssueRow(issue)).join("")}</tbody>
          </table>
        </div>
        <p class="muted-text">Select one issue at a time. Relationship repairs require an exact stable ID; duplicate archives require selecting the exact Main record.</p>
        <button class="btn primary" type="button" data-order-tool="workflow-integrity-repair">Repair Selected Record</button>
      ` : `<p class="empty-state">No workflow integrity conflicts detected.</p>`}
    </section>
  `;
}

function workflowIntegrityIssueRow(issue) {
  const repair = issue.repair;
  const selector = repair
    ? `<label class="workflow-integrity-selector"><input type="radio" name="workflow-integrity-issue" data-workflow-integrity-issue="${escapeHtml(issue.id)}" /> Select</label>${workflowIntegrityRepairInput(issue)}`
    : "Preview only";
  return `
    <tr data-workflow-integrity-row="${escapeHtml(issue.id)}">
      <td>${selector}</td><td>${escapeHtml(issue.category)}</td><td>${escapeHtml(issue.recordType)}</td><td>${escapeHtml(issue.stableId || "-")}</td>
      <td>${escapeHtml(issue.orderNo || "-")}</td><td>${escapeHtml(issue.quotationNo || "-")}</td><td>${escapeHtml(issue.customer || "-")}</td>
      <td>${escapeHtml(issue.phone || "-")}</td><td>${escapeHtml(issue.amount === "" ? "-" : issue.amount)}</td><td>${escapeHtml(issue.status || "-")}</td>
      <td>${escapeHtml(issue.linkedIds || "-")}</td><td>${escapeHtml(issue.problem)}</td><td>${escapeHtml(issue.recommendedAction)}</td>
    </tr>
  `;
}

function workflowIntegrityRepairInput(issue) {
  if (issue.repair.type === "order-status") {
    return `<select data-workflow-integrity-status>${orderStatuses.map((status) => `<option value="${escapeHtml(status)}">${statusLabel(status)}</option>`).join("")}</select>`;
  }
  if (issue.repair.type === "order-ownership") return safeOrderOwnershipRepairHtml(issue);
  const targetId = issue.repair.targetId || "";
  return `<input data-workflow-integrity-target value="${escapeHtml(targetId)}" placeholder="${escapeHtml(issue.repair.targetLabel || "Exact target stable ID")}" ${targetId ? "readonly" : ""} />`;
}

export function buildSafeOrderOwnershipComparison(quotationId, orderId, snapshot = state) {
  const quote = (snapshot.quotations || []).find((row) => String(row.id || "") === String(quotationId || "")) || null;
  const order = (snapshot.orders || []).find((row) => isActiveOrderRecord(row) && String(row.id || "") === String(orderId || "")) || null;
  if (!quote || !order) return null;
  const productionJobs = (snapshot.productionJobs || []).filter((row) => String(row.orderId || "") === String(order.id || ""));
  const installationJobs = (snapshot.installationJobs || []).filter((row) => String(row.orderId || "") === String(order.id || ""));
  const targetOrderNo = getOrderDisplayNo(order);
  const conflicts = (snapshot.orders || []).filter((row) => isActiveOrderRecord(row)
    && String(row.id || "") !== String(order.id || "")
    && normalizeRefNo(getOrderDisplayNo(row))
    && normalizeRefNo(getOrderDisplayNo(row)) === normalizeRefNo(targetOrderNo));
  return {
    quotation: ownershipRecordView(quote, "quotation", snapshot),
    order: ownershipRecordView(order, "order", snapshot),
    productionJobIds: productionJobs.map((row) => String(row.id || "")),
    installationJobIds: installationJobs.map((row) => String(row.id || "")),
    forwardLink: {
      orderId: String(quote.orderId || ""),
      linkedOrderId: String(quote.linkedOrderId || ""),
      orderNo: String(quote.orderNo || ""),
      orderNumber: String(quote.orderNumber || "")
    },
    reverseLink: {
      quoteId: String(order.quoteId || ""),
      quotationId: String(order.quotationId || ""),
      quoteNumber: String(order.quoteNumber || ""),
      quotationNo: String(order.quotationNo || "")
    },
    conflicts: conflicts.map((row) => ownershipRecordView(row, "order", snapshot))
  };
}

function ownershipRecordView(record, type, snapshot) {
  const customer = record.customer && typeof record.customer === "object" ? record.customer : {};
  const id = String(record.id || "");
  return {
    type,
    id,
    orderNo: type === "order" ? getOrderDisplayNo(record) : String(record.orderNo || record.orderNumber || ""),
    quotationNo: type === "quotation" ? getQuotationDisplayNo(record) : String(record.quotationNo || record.quoteNumber || ""),
    customer: String(customer.name ?? record.customerName ?? ""),
    phone: String(customer.phone ?? record.phone ?? ""),
    items: structuredCloneSafe(Array.isArray(record.items) ? record.items : []),
    total: record.total ?? record.amount ?? "",
    deposit: record.deposit ?? "",
    balance: record.balance ?? "",
    productionJobIds: (snapshot.productionJobs || []).filter((row) => String(row.orderId || "") === id).map((row) => String(row.id || "")),
    installationJobIds: (snapshot.installationJobs || []).filter((row) => String(row.orderId || "") === id).map((row) => String(row.id || "")),
    forwardLinks: type === "quotation" ? {
      orderId: String(record.orderId || ""),
      linkedOrderId: String(record.linkedOrderId || "")
    } : {},
    reverseLinks: type === "order" ? {
      quoteId: String(record.quoteId || ""),
      quotationId: String(record.quotationId || "")
    } : {}
  };
}

function safeOrderOwnershipRepairHtml(issue) {
  const comparison = buildSafeOrderOwnershipComparison(issue.repair.quotationId, issue.repair.orderId);
  if (!comparison) return `<span class="danger-text">Exact Quotation or active Order is no longer available. Scan again.</span>`;
  return `
    <details class="safe-ownership-repair" open>
      <summary>Safe Order Ownership Repair</summary>
      <p class="danger-text"><strong>Exact stable IDs only.</strong> Customer, items and financial values will never be copied or merged.</p>
      <div class="safe-ownership-grid">
        ${ownershipRecordHtml("Correct Quotation candidate", comparison.quotation)}
        ${ownershipRecordHtml("Correct Order candidate", comparison.order)}
      </div>
      <div class="safe-ownership-links">
        <div><strong>Existing forward links</strong><pre>${escapeHtml(JSON.stringify(comparison.forwardLink, null, 2))}</pre></div>
        <div><strong>Existing reverse links</strong><pre>${escapeHtml(JSON.stringify(comparison.reverseLink, null, 2))}</pre></div>
      </div>
      <label>Correct Quotation stable ID<input data-order-ownership-quotation-id placeholder="Type the exact Quotation stable ID" /></label>
      <label>Correct Order stable ID<input data-order-ownership-order-id placeholder="Type the exact Order stable ID" /></label>
      ${comparison.conflicts.length ? `
        <div class="safe-ownership-conflict">
          <strong>Order Number Ownership Conflict</strong>
          <p>${escapeHtml(comparison.order.orderNo)} is also used by the following exact Order record(s). Each must receive a new unused SO number first.</p>
          ${comparison.conflicts.map((conflict) => `
            ${ownershipRecordHtml("Conflicting Order", conflict)}
            <label>Conflicting Order stable ID<input data-order-ownership-conflict-id="${escapeHtml(conflict.id)}" placeholder="Type ${escapeHtml(conflict.id)}" /></label>
            <label>New unused SO number for this exact Order<input data-order-ownership-replacement data-conflict-order-id="${escapeHtml(conflict.id)}" placeholder="Example: ${escapeHtml(nextSalesOrderNumber())}" /></label>
          `).join("")}
        </div>
      ` : `<p class="muted-text">No active Order Number Ownership Conflict was found for ${escapeHtml(comparison.order.orderNo)}.</p>`}
      <p class="muted-text">A full JSON backup and a complete field-by-field change preview are required before the confirmation phrase REPAIR ORDER OWNERSHIP is accepted.</p>
    </details>
  `;
}

function coveredOrderRecoveryPanelHtml() {
  if (!coveredOrderRecovery) return "";
  if (coveredOrderRecovery.mode === "so") return coveredOrderSoPanelHtml();
  if (coveredOrderRecovery.mode === "quote") return missingConfirmedOrderPanelHtml();
  return `
    <section class="covered-order-panel" data-covered-order-panel>
      <div class="section-head">
        <div><h3>Recover Covered Order</h3><p class="muted-text">Choose a search method. Stable IDs are selected from the results and never need to be typed.</p></div>
        <button class="btn" type="button" data-order-tool="recover-covered-order-close">Close</button>
      </div>
      ${coveredOrderSearchControlsHtml()}
      <div class="covered-order-safety"><strong>Choose a recovery mode</strong><p>Use SO search when the correct active Order still exists. Use customer or ESQ search when the confirmed quotation exists but its correct Order payload is missing or covered.</p></div>
    </section>`;
}

function coveredOrderSearchControlsHtml(values = {}) {
  return `<div class="covered-order-search-grid">
    <label>Search by SO number<span class="covered-order-search-action"><input data-covered-order-so-search value="${escapeHtml(values.orderNo || "")}" placeholder="SO2607011" /><button class="btn" type="button" data-order-tool="recover-covered-order-search-so">Search SO</button></span></label>
    <label>Search by customer or ESQ<span class="covered-order-search-action"><input data-covered-order-quote-search value="${escapeHtml(values.query || "")}" placeholder="Datin Conni or ESQ-2026-0005" /><button class="btn" type="button" data-order-tool="recover-covered-order-search-quote">Search Quotation</button></span></label>
  </div>`;
}

function missingConfirmedOrderPanelHtml() {
  const recovery = coveredOrderRecovery;
  const scan = recovery.scan || { records: [] };
  const missingScan = recovery.missingScan;
  const records = missingScan?.records || scan.records || [];
  return `
    <section class="covered-order-panel" data-covered-order-panel>
      <div class="section-head">
        <div><h3>Recover Missing Confirmed Order</h3><p class="muted-text">Select the exact confirmed quotation, enter its intended SO number, then review every stable-ID and alias-linked conflict.</p></div>
        <div class="actions"><button class="btn" type="button" data-order-tool="recover-covered-order-refresh">Refresh</button><button class="btn" type="button" data-order-tool="recover-covered-order-home">Search modes</button><button class="btn" type="button" data-order-tool="recover-covered-order-close">Close</button></div>
      </div>
      ${coveredOrderSearchControlsHtml({ query: recovery.query })}
      ${scan.message ? `<p class="${records.length ? "muted-text" : "danger-text"}">${escapeHtml(scan.message)}</p>` : ""}
      <div class="form-grid compact covered-order-intended-so"><label>Intended SO number<input data-covered-order-intended-so value="${escapeHtml(recovery.intendedOrderNo || "")}" placeholder="SO2607013" /></label></div>
      <div class="table-wrap covered-order-table-wrap">
        <table class="data-table covered-order-table">
          <thead><tr><th>Role</th><th>Record</th><th>Customer / Phone</th><th>Quotation / Order</th><th>Status</th><th>Total</th><th>Stable IDs</th><th>Production / Installation IDs</th><th>Forward / Reverse links</th></tr></thead>
          <tbody>${records.map((entry) => missingConfirmedOrderRowHtml(entry, recovery)).join("") || `<tr><td colspan="9">No quotation candidate found.</td></tr>`}</tbody>
        </table>
      </div>
      ${missingScan?.message ? `<p class="${missingScan.ok ? "muted-text" : "danger-text"}">${escapeHtml(missingScan.message)}</p>` : ""}
      ${missingScan ? `<div class="covered-order-safety">
        <strong>Recovery roles</strong>
        <p>Confirmed quotation to recover: ${escapeHtml(recovery.selectedQuotationId || "-")}</p>
        <p>Incorrect quotations returning to Follow Up and incorrect Orders being archived must be explicitly selected below.</p>
        <p>Remaining active SO conflicts: ${escapeHtml(missingScan.activeSoOwnerIds?.join(", ") || "none")}</p>
      </div>` : ""}
      ${missingScan
        ? `<button class="btn primary" type="button" data-order-tool="recover-missing-order-apply" ${missingScan.ok ? "" : "disabled"}>Preview &amp; Recover Missing Confirmed Order</button><p class="muted-text">Confirmation phrase: RECOVER MISSING ORDER</p>`
        : `<button class="btn" type="button" data-order-tool="recover-missing-order-preview" ${records.length ? "" : "disabled"}>Show Related &amp; Conflicting Records</button>`}
      <div class="covered-order-safety"><strong>Before repair</strong><p>A full JSON backup and exact before/after preview are required. Existing customer, phone, items, totals, deposit, balance, remarks, progress, staff and history are preserved. No record is hard-deleted.</p></div>
    </section>`;
}

function missingConfirmedOrderRowHtml(entry, recovery) {
  const view = entry.view;
  const selectedQuotationId = String(recovery.selectedQuotationId || "");
  const ownId = String(entry.record.id || "");
  let roleControl = "Reference only";
  if (!recovery.missingScan && entry.collection === "quotations") {
    roleControl = `<label><input type="radio" name="missing-confirmed-quotation" value="${escapeHtml(ownId)}" ${selectedQuotationId === ownId ? "checked" : ""} /> Confirmed Quotation to Recover</label>`;
  } else if (entry.collection === "quotations" && ownId === selectedQuotationId) {
    roleControl = "<strong>Confirmed quotation to recover</strong>";
  } else if (entry.collection === "quotations") {
    roleControl = `<label><input type="checkbox" name="missing-incorrect-quotation" value="${escapeHtml(ownId)}" /> Incorrect quotation returning to Follow Up</label>`;
  } else if (entry.collection === "orders") {
    roleControl = `<label><input type="checkbox" name="missing-incorrect-order" value="${escapeHtml(ownId)}" /> Incorrect Order being archived</label>`;
  }
  return `<tr>
    <td>${roleControl}</td>
    <td>${escapeHtml(entry.collectionLabel)}<br><span class="muted-text">${escapeHtml(entry.matchReason)}</span></td>
    <td>${escapeHtml(view.customer || "-")}<br>${escapeHtml(view.phone || "-")}</td>
    <td>${escapeHtml(view.quotationNo || "-")}<br>${escapeHtml(view.orderNo || "-")}</td>
    <td>${escapeHtml(view.quotationStatus || "-")}<br>${escapeHtml(view.orderStatus || "-")}</td>
    <td>${escapeHtml(view.total === "" ? "-" : view.total)}</td>
    <td><strong>Q:</strong> ${escapeHtml(view.quotationStableId || "-")}<br><strong>O:</strong> ${escapeHtml(view.orderStableId || "-")}</td>
    <td><strong>P:</strong> ${escapeHtml(view.productionJobIds.join(", ") || "-")}<br><strong>I:</strong> ${escapeHtml(view.installationJobIds.join(", ") || "-")}</td>
    <td><pre>${escapeHtml(JSON.stringify({ forward: view.forwardLinks, reverse: view.reverseLinks }, null, 2))}</pre></td>
  </tr>`;
}

function coveredOrderSoPanelHtml() {
  if (!coveredOrderRecovery) return "";
  const { orderNo, scan } = coveredOrderRecovery;
  const records = scan.records || [];
  return `
    <section class="covered-order-panel" data-covered-order-panel data-covered-order-no="${escapeHtml(orderNo)}">
      <div class="section-head">
        <div>
          <h3>Recover Covered Order · ${escapeHtml(orderNo)}</h3>
          <p class="muted-text">Choose one exact active Order to keep and one exact quotation to return to Follow Up. Stable IDs are used automatically.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-order-tool="recover-covered-order-refresh">Refresh</button>
          <button class="btn" type="button" data-order-tool="recover-covered-order-home">Search modes</button>
          <button class="btn" type="button" data-order-tool="recover-covered-order-close">Close</button>
        </div>
      </div>
      ${scan.message ? `<p class="${scan.ok ? "muted-text" : "danger-text"}">${escapeHtml(scan.message)}</p>` : ""}
      <div class="table-wrap covered-order-table-wrap">
        <table class="data-table covered-order-table">
          <thead><tr><th>Role</th><th>Record</th><th>Customer / Phone</th><th>Quotation / Order</th><th>Status</th><th>Total</th><th>Stable IDs</th><th>Production / Installation IDs</th><th>Forward / Reverse links</th></tr></thead>
          <tbody>${records.map((entry) => coveredOrderRecoveryRowHtml(entry)).join("") || `<tr><td colspan="9">No records reference this exact SO number.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="covered-order-safety">
        <strong>Before repair</strong>
        <p>A full JSON backup and exact before/after preview are required. Customer, phone, items, totals, deposit, balance and remarks are preserved. No record is hard-deleted.</p>
      </div>
      <button class="btn primary" type="button" data-order-tool="recover-covered-order-apply" ${scan.ok ? "" : "disabled"}>Preview &amp; Repair Selected Records</button>
      <p class="muted-text">Confirmation phrase: REPAIR COVERED ORDER</p>
    </section>
  `;
}

function coveredOrderRecoveryRowHtml(entry) {
  const view = entry.view;
  const activeOrder = entry.collection === "orders" && isActiveOrderRecord(entry.record);
  const quotation = entry.collection === "quotations";
  const roleControl = activeOrder
    ? `<label><input type="radio" name="covered-confirmed-order" value="${escapeHtml(view.orderStableId)}" /> Keep as Confirmed Order</label>`
    : quotation
      ? `<label><input type="radio" name="covered-unconfirmed-quotation" value="${escapeHtml(view.quotationStableId)}" /> Return to Quotation / Follow Up</label>`
      : "Reference only";
  return `<tr>
    <td>${roleControl}</td>
    <td>${escapeHtml(entry.collectionLabel)}<br><span class="muted-text">${escapeHtml(entry.matchReason)}</span></td>
    <td>${escapeHtml(view.customer || "-")}<br>${escapeHtml(view.phone || "-")}</td>
    <td>${escapeHtml(view.quotationNo || "-")}<br>${escapeHtml(view.orderNo || "-")}</td>
    <td>${escapeHtml(view.quotationStatus || "-")}<br>${escapeHtml(view.orderStatus || "-")}</td>
    <td>${escapeHtml(view.total === "" ? "-" : view.total)}</td>
    <td><strong>Q:</strong> ${escapeHtml(view.quotationStableId || "-")}<br><strong>O:</strong> ${escapeHtml(view.orderStableId || "-")}</td>
    <td><strong>P:</strong> ${escapeHtml(view.productionJobIds.join(", ") || "-")}<br><strong>I:</strong> ${escapeHtml(view.installationJobIds.join(", ") || "-")}</td>
    <td><pre>${escapeHtml(JSON.stringify({ forward: view.forwardLinks, reverse: view.reverseLinks }, null, 2))}</pre></td>
  </tr>`;
}

function ownershipRecordHtml(title, record) {
  return `<div class="safe-ownership-record">
    <strong>${escapeHtml(title)}</strong>
    <dl>
      <dt>${record.type === "quotation" ? "Quotation" : "Order"} stable ID</dt><dd>${escapeHtml(record.id || "-")}</dd>
      <dt>Order No</dt><dd>${escapeHtml(record.orderNo || "-")}</dd>
      <dt>Quotation No</dt><dd>${escapeHtml(record.quotationNo || "-")}</dd>
      <dt>Customer</dt><dd>${escapeHtml(record.customer || "-")}</dd>
      <dt>Phone</dt><dd>${escapeHtml(record.phone || "-")}</dd>
      <dt>Items</dt><dd><pre>${escapeHtml(JSON.stringify(record.items, null, 2))}</pre></dd>
      <dt>Total</dt><dd>${escapeHtml(record.total === "" ? "-" : record.total)}</dd>
      <dt>Deposit</dt><dd>${escapeHtml(record.deposit === "" ? "-" : record.deposit)}</dd>
      <dt>Balance</dt><dd>${escapeHtml(record.balance === "" ? "-" : record.balance)}</dd>
      <dt>Production Job IDs</dt><dd>${escapeHtml(record.productionJobIds.join(", ") || "-")}</dd>
      <dt>Installation Job IDs</dt><dd>${escapeHtml(record.installationJobIds.join(", ") || "-")}</dd>
    </dl>
  </div>`;
}

function matchesProgressFilter(categoryId, order) {
  if (!isActiveOrderRecord(order)) return false;
  if (orderSearch.filter === "all") return true;
  if (["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return matchesBoardDateFilter(order);
  if (orderSearch.filter === "pending") return categoryId === "new";
  if (orderSearch.filter === "production") return ["in-production", "waiting-installation"].includes(categoryId);
  if (orderSearch.filter === "installation") return ["waiting-installation", "pending-collection", "touch-up"].includes(categoryId);
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
  return activeProductionJobForOrder(order);
}

function getOrderInstallationJob(order) {
  return state.installationJobs.find((job) => isActiveWorkflowRecord(job) && String(job.orderId || "") === String(order.id || "")) || null;
}

function getOrderBalance(order) {
  const installationJob = getOrderInstallationJob(order);
  return getRemainingBalance(order, installationJob);
}

export function normalizeProductionStatus(value) {
  const normalized = normalizeWorkflowStatus(value);
  const map = {
    not_sent: "not_produced",
    pending: "not_produced",
    pending_production: "not_produced",
    not_started: "not_produced",
    ready: "not_produced",
    not_produced: "not_produced",
    sent_to_production: "in_production",
    in_production: "in_production",
    production_completed: "completed",
    completed: "completed"
  };
  return map[normalized] || "not_produced";
}

function normalizeInstallationStatus(value) {
  const map = {
    pending_arrangement: "not_scheduled",
    ready_to_send: "scheduled",
    sent_to_installer: "scheduled",
    completed: "installed",
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
  const paymentSummary = getOrderPaymentSummary(order);
  const baseBalance = paymentSummary.balance;
  const collected = Number(installationJob?.amountCollected || 0);
  if (installationJob?.balanceCollected && collected >= baseBalance) return 0;
  return Math.max(0, baseBalance - collected);
}

function getOrderProgressCategory(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  const productionStatus = getOrderProductionStatus(order, productionJob);
  const installationStatus = getOrderInstallationStatus(order, installationJob);
  const balance = getRemainingBalance(order, installationJob);
  const orderStatus = normalizeWorkflowStatus(order.status);
  const sentToProduction = order.sentToProduction === true || ["sent_to_production", "in_production", "production_completed"].includes(orderStatus);
  if (orderStatus === "duplicate_archived") return "duplicate-archived";
  if (!isActiveOrderRecord(order)) return "archived";
  if (installationStatus === "touch_up" || orderStatus === "touch_up") return "touch-up";
  if (["completed", "serviced"].includes(orderStatus)) return "completed";
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
  renderProductionTools();
  const list = document.querySelector("#productionList");
  if (!list) return;
  const jobs = productionJobsForCurrentView();
  list.innerHTML = jobs.length ? jobs.map((job) => {
    const order = linkedOrderForProduction(job);
    const orderNumber = productionOrderNumber(job);
    const customerName = order?.customer?.name || order?.customerName || job.customerName || "-";
    return `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(orderNumber)}</strong>
          <p>${escapeHtml(customerName)}</p>
          <p class="muted-text">${t("Quote")}: ${job.quoteNumber || job.quotationNo || "-"}</p>
          <p class="muted-text">${t("Installation Date")}: ${job.installationDate || "-"}</p>
        </div>
        <span class="pill">${statusLabel(job.status)}</span>
      </div>
      ${!order && isBossOrAdmin() ? `<p class="warning-text"><strong>Linked Order record is missing.</strong> Production job ID: ${escapeHtml(job.id || "-")}. Repair the order relationship before production.</p>` : ""}
      <label>${t("Production Status")}<select data-production-id="${job.id}" data-production-field="status" ${canEditProduction() && !isArchivedProductionJob(job) ? "" : "disabled"}>${isArchivedProductionJob(job) ? `<option selected value="duplicate_archived">${statusLabel("duplicate_archived")}</option>` : productionStatuses.map((status) => `<option value="${status}" ${normalizeProductionStatus(job.status, true) === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}</select></label>
      <label>${t("Production Remark")}<textarea rows="2" data-production-id="${job.id}" data-production-field="remark" ${canEditProduction() && !isArchivedProductionJob(job) ? "" : "readonly"}>${job.remark || ""}</textarea></label>
      ${itemsSummary(job.items)}
      ${isBossOrAdmin() ? `<details class="internal-details"><summary>Internal Details</summary><p>Production Job ID: ${escapeHtml(job.id || "-")}</p><p>ESP reference: ${escapeHtml(job.productionNumber || "-")}</p></details>` : ""}
      <div class="actions">
        <button class="btn" type="button" data-view-production="${job.id}">${t("View Production Job")}</button>
        <button class="btn primary" type="button" data-print-production="${job.id}">${t("Print Production Sheet")}</button>
        ${canEditProduction() && !isArchivedProductionJob(job) ? `<button class="btn" type="button" data-mark-production-status="${job.id}" data-status="in_production">${t("Mark In Production")}</button><button class="btn" type="button" data-mark-production-status="${job.id}" data-status="completed">${t("Mark Production Completed")}</button>` : ""}
        ${isBossOrAdmin() && isArchivedProductionJob(job) ? `<button class="btn" type="button" data-restore-production-job="${escapeHtml(job.id || "")}">${t("Restore Production Job")}</button>` : ""}
      </div>
    </article>
  `;
  }).join("") : `<p class="muted-text">${state.productionJobs.length ? "No production job matches this search or filter." : t("No production jobs yet.")}</p>`;
}

function renderProductionTools() {
  const tools = document.querySelector("#productionTools");
  if (!tools) return;
  tools.innerHTML = `
    <section class="order-tools production-tools">
      <label>Search SO Order No, Customer, Phone or Quotation No
        <input data-production-search value="${escapeHtml(productionSearch)}" placeholder="SO2607006, customer, phone or quotation" />
      </label>
      <div class="actions">
        <button class="btn" type="button" data-production-search-clear>Clear Search</button>
        ${isBossOrAdmin() ? `<button class="btn" type="button" data-production-tool="duplicates">${t("Duplicate Production Check")}</button>` : ""}
        ${isBossOrAdmin() ? `<button class="btn ${showArchivedProductionDuplicates ? "primary" : ""}" type="button" data-production-tool="archived">${t("Show Archived Production Duplicates")}</button>` : ""}
      </div>
      ${productionDuplicatePanelHtml()}
    </section>
  `;
}

export function productionJobsForDisplay(jobs = state.productionJobs, showArchived = showArchivedProductionDuplicates) {
  if (showArchived && isBossOrAdmin()) return jobs.filter((job) => isArchivedProductionJob(job));
  return uniqueActiveProductionJobs(jobs);
}

export function productionJobsForCurrentView() {
  return productionJobsForDisplay().filter((job) => productionJobMatchesSearch(job));
}

export function linkedOrderForProduction(job = {}) {
  if (!job.orderId) return null;
  return state.orders.find((order) => isActiveOrderRecord(order) && String(order.id || "") === String(job.orderId)) || null;
}

function resolveProductionOrderId(job = {}) {
  return linkedOrderForProduction(job)?.id || job.orderId || "";
}

export function productionOrderNumber(job = {}) {
  const order = linkedOrderForProduction(job);
  return order ? getOrderDisplayNo(order) || "Order Number Missing" : "Order Number Missing";
}

export function productionJobMatchesSearch(job = {}, search = productionSearch) {
  const term = normalizeText(search);
  if (!term) return true;
  const order = linkedOrderForProduction(job);
  return [
    productionOrderNumber(job),
    order?.customer?.name,
    order?.customerName,
    order?.customer?.phone,
    order?.phone,
    job.customerName,
    job.quoteNumber,
    job.quotationNo
  ].some((value) => normalizeText(value).includes(term));
}

export function scanDuplicateProductionJobs() {
  const entries = state.productionJobs
    .map((job, index) => ({ job, index, key: productionEntryKey(job, index) }))
    .filter((entry) => !isArchivedProductionJob(entry.job));
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
  const connect = (left, right, reasons) => {
    const leftRoot = find(left.key);
    const rightRoot = find(right.key);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    edges.push({ left: left.key, right: right.key, reasons });
  };

  entries.forEach((left, leftIndex) => entries.slice(leftIndex + 1).forEach((right) => {
    const leftOrderId = String(resolveProductionOrderId(left.job) || "");
    const rightOrderId = String(resolveProductionOrderId(right.job) || "");
    const sameResolvedOrder = Boolean(leftOrderId && leftOrderId === rightOrderId);
    const sameExactOrderId = Boolean(left.job.orderId && String(left.job.orderId) === String(right.job.orderId || ""));
    const leftItems = productionItemSignature(left.job.items);
    if (!sameResolvedOrder || leftItems === "[]" || leftItems !== productionItemSignature(right.job.items)) return;
    connect(left, right, [
      sameExactOrderId ? `Same exact orderId: ${left.job.orderId}` : `Resolved to the same linked Order ID: ${leftOrderId}`,
      "Same product items, dimensions and quantities."
    ]);
  }));

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
      const reasons = [...new Set(edges
        .filter((edge) => keys.has(edge.left) && keys.has(edge.right))
        .flatMap((edge) => edge.reasons))];
      return makeProductionDuplicateGroup("confirmed", rows, reasons);
    });
  const confirmedPairs = new Set();
  confirmedGroups.forEach((group) => group.members.forEach((left, index) => {
    group.members.slice(index + 1).forEach((right) => confirmedPairs.add(pairKey(left.key, right.key)));
  }));

  const possibleGroups = [];
  entries.forEach((left, leftIndex) => entries.slice(leftIndex + 1).forEach((right) => {
    if (confirmedPairs.has(pairKey(left.key, right.key))) return;
    const exactOrderId = String(left.job.orderId || "") && String(left.job.orderId || "") === String(right.job.orderId || "");
    if (exactOrderId) return;
    const sameOrderNo = normalizeRefNo(productionOrderReference(left.job))
      && normalizeRefNo(productionOrderReference(left.job)) === normalizeRefNo(productionOrderReference(right.job));
    const sameCustomer = normalizeText(productionCustomerName(left.job))
      && normalizeText(productionCustomerName(left.job)) === normalizeText(productionCustomerName(right.job));
    if (!sameOrderNo || !sameCustomer || !productionItemsAreSimilar(left.job.items, right.job.items)) return;
    possibleGroups.push(makeProductionDuplicateGroup("possible", [left, right], [
      `Same SO Order No: ${productionOrderReference(left.job)}`,
      `Same customer: ${productionCustomerName(left.job)}`,
      "Similar product items, but no exact matching orderId. Manual review required."
    ]));
  }));

  return { scannedAt: new Date().toISOString(), confirmedGroups, possibleGroups };
}

function productionEntryKey(job, index) {
  return `${String(job.id || "missing")}::${index}`;
}

function makeProductionDuplicateGroup(type, rows, reasons) {
  const sorted = [...rows].sort((left, right) => left.index - right.index);
  return { id: `production-${type}-${sorted.map((entry) => entry.index).join("-")}`, type, reasons, members: sorted };
}

function productionOrderReference(job = {}) {
  const order = linkedOrderForProduction(job);
  return order ? getOrderDisplayNo(order) : job.orderNo || job.orderNumber || "";
}

function productionCustomerName(job = {}) {
  const order = linkedOrderForProduction(job);
  return order?.customer?.name || order?.customerName || job.customerName || job.customer?.name || "";
}

function productionAssignedStaff(job = {}) {
  const value = job.assignedStaff ?? job.assignedTo ?? job.staffName ?? job.productionStaff ?? "";
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function normalizedProductionItem(item = {}) {
  return {
    product: normalizeText(item.productId || item.productName || item.name),
    width: String(toNumber(item.width)),
    height: String(toNumber(item.height)),
    quantity: String(toNumber(item.quantity))
  };
}

function productionItemSignature(items = []) {
  if (!Array.isArray(items) || !items.length) return "[]";
  return JSON.stringify(items.map(normalizedProductionItem)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function productionItemsAreSimilar(leftItems = [], rightItems = []) {
  if (!Array.isArray(leftItems) || !leftItems.length || !Array.isArray(rightItems) || !rightItems.length) return false;
  const left = leftItems.map(normalizedProductionItem);
  const right = [...rightItems.map(normalizedProductionItem)];
  let matches = 0;
  left.forEach((item) => {
    const index = right.findIndex((candidate) => item.product && item.product === candidate.product
      && item.quantity === candidate.quantity
      && dimensionsAreSimilar(item.width, candidate.width)
      && dimensionsAreSimilar(item.height, candidate.height));
    if (index < 0) return;
    matches += 1;
    right.splice(index, 1);
  });
  return matches / Math.max(left.length, rightItems.length) >= 0.5;
}

function dimensionsAreSimilar(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (leftNumber === rightNumber) return true;
  if (!leftNumber || !rightNumber) return false;
  return Math.abs(leftNumber - rightNumber) / Math.max(leftNumber, rightNumber) <= 0.1;
}

function productionDuplicatePanelHtml() {
  if (!isBossOrAdmin() || !productionDuplicateScanVisible) return "";
  const scan = productionDuplicateScanResult || scanDuplicateProductionJobs();
  return `
    <section class="duplicate-order-panel production-duplicate-panel">
      <div class="section-head">
        <div><h3>${t("Duplicate Production Check")}</h3><p class="muted-text">Preview only. Compare all differences and select the Production Job with the correct/latest progress.</p></div>
        <div class="actions"><button class="btn" type="button" data-production-tool="duplicates-refresh">${t("Scan Again")}</button><button class="btn" type="button" data-production-tool="duplicates-close">${t("Close")}</button></div>
      </div>
      <div class="duplicate-summary"><span>Confirmed duplicate groups: <strong>${scan.confirmedGroups.length}</strong></span><span>Possible duplicate groups: <strong>${scan.possibleGroups.length}</strong></span></div>
      ${scan.confirmedGroups.length || scan.possibleGroups.length ? "" : `<p class="empty-state">${t("No duplicate Production Jobs detected.")}</p>`}
      ${productionDuplicateGroupsHtml("Confirmed Duplicates", scan.confirmedGroups, true)}
      ${productionDuplicateGroupsHtml("Possible Duplicates", scan.possibleGroups, false)}
    </section>`;
}

function productionDuplicateGroupsHtml(title, groups, selectable) {
  return `<div class="duplicate-section"><h4>${t(title)}</h4>${groups.length ? "" : `<p class="muted-text">${t("None found in this section.")}</p>`}${groups.map((group) => `
    <article class="duplicate-group-card" data-production-duplicate-group-card="${group.id}">
      <p><strong>${escapeHtml(group.reasons.join(" | "))}</strong></p>
      <p><strong>Differences:</strong> ${escapeHtml(productionGroupDifferences(group))}</p>
      <div class="table-wrap production-duplicate-table"><table><thead><tr><th>Main</th><th>Production Job internal ID</th><th>SO Order No</th><th>Customer</th><th>Quotation No</th><th>Production Status</th><th>Item count</th><th>Assigned staff</th><th>Created At</th><th>Updated At</th><th>Installation link</th><th>Duplicate reason</th></tr></thead><tbody>
        ${group.members.map((member) => productionDuplicateMemberRowHtml(member, group, selectable)).join("")}
      </tbody></table></div>
      ${selectable ? productionDuplicateArchiveActionHtml(group) : `<p class="warning-text"><strong>Possible duplicates are never archived automatically. Manual review required.</strong></p>`}
    </article>`).join("")}</div>`;
}

function productionDuplicateMemberRowHtml(member, group, selectable) {
  const job = member.job;
  const selected = productionDuplicateMainSelections.get(group.id) === member.key;
  return `<tr>
    <td>${selectable ? `<label><input type="radio" name="production-duplicate-main-${group.id}" data-production-duplicate-main="${escapeHtml(member.key)}" data-production-duplicate-group="${group.id}" ${selected ? "checked" : ""} /> Select as Main Production Job</label>` : "Review"}</td>
    <td>${escapeHtml(job.id || "-")}</td><td>${escapeHtml(productionOrderReference(job) || "-")}</td><td>${escapeHtml(productionCustomerName(job) || "-")}</td>
    <td>${escapeHtml(job.quoteNumber || job.quotationNo || "-")}</td><td>${escapeHtml(statusLabel(job.status || "-") || "-")}</td><td>${Array.isArray(job.items) ? job.items.length : 0}</td>
    <td>${escapeHtml(productionAssignedStaff(job) || "-")}</td><td>${escapeHtml(job.createdAt || "-")}</td><td>${escapeHtml(job.updatedAt || "-")}</td>
    <td>${escapeHtml(productionInstallationLinks(job) || "-")}</td><td>${escapeHtml(group.reasons.join(" | "))}</td>
  </tr>`;
}

function productionInstallationLinks(job = {}) {
  const explicit = state.installationJobs.filter((installation) => String(installation.productionJobId || "") === String(job.id || ""));
  const orderId = String(resolveProductionOrderId(job) || "");
  const linked = explicit.length ? explicit : state.installationJobs.filter((installation) => (
    orderId && String(installation.orderId || "") === orderId
  ));
  return linked.map((installation) => installation.installationNumber || installation.id || "Linked Installation").join(", ");
}

function productionGroupDifferences(group) {
  const fields = [
    ["orderId", (job) => job.orderId], ["SO Order No", productionOrderReference], ["customer", productionCustomerName],
    ["quotation", (job) => job.quoteNumber || job.quotationNo], ["status", (job) => job.status],
    ["items", (job) => productionItemSignature(job.items)], ["assigned staff", productionAssignedStaff],
    ["createdAt", (job) => job.createdAt], ["updatedAt", (job) => job.updatedAt], ["installation link", productionInstallationLinks],
    ["production remarks", (job) => job.remark || job.remarks]
  ];
  const changed = fields.filter(([, getter]) => new Set(group.members.map((member) => JSON.stringify(getter(member.job) ?? ""))).size > 1).map(([label]) => label);
  return changed.length ? changed.join(", ") : "No field differences detected.";
}

export function productionDuplicateArchiveActionHtml(group, selectedKey = productionDuplicateMainSelections.get(group.id)) {
  if (!selectedKey) return `<p class="muted-text">Select one Main Production Job to reveal the archive action.</p>`;
  const main = group.members.find((member) => member.key === selectedKey);
  if (!main) return "";
  const duplicates = group.members.filter((member) => member.key !== selectedKey);
  return `<div class="duplicate-archive-action"><p><strong>Main Production Job:</strong> ${escapeHtml(main.job.id || "-")}</p><p><strong>Production Jobs to archive:</strong> ${duplicates.map((member) => escapeHtml(member.job.id || "-")).join(", ")}</p><p>The selected Main Job is not overwritten. A full JSON backup is downloaded before the local transaction.</p><button class="btn danger" type="button" data-archive-production-duplicate-group="${group.id}" ${productionDuplicateArchiveBusy ? "disabled" : ""}>${t("Archive Other Production Duplicates")}</button></div>`;
}

async function archiveProductionDuplicateGroupFromPanel(groupId, button) {
  const card = button.closest("[data-production-duplicate-group-card]");
  const selectedMain = productionDuplicateMainSelections.get(groupId)
    || card?.querySelector("[data-production-duplicate-main]:checked")?.dataset.productionDuplicateMain;
  if (!selectedMain) return showWorkflowMessage("Select the Main Production Job first.", "error");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = t("Archiving...");
  const result = await archiveProductionDuplicateGroup(groupId, selectedMain);
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (!result.ok) return;
  productionDuplicateScanResult = scanDuplicateProductionJobs();
  showArchivedProductionDuplicates = false;
  renderProductionJobs();
}

export async function archiveProductionDuplicateGroup(groupId, mainMemberKey, options = {}) {
  if (!isBossOrAdmin()) return failProductionDuplicateAction("Permission denied: your role cannot perform this action.");
  if (productionDuplicateArchiveBusy) return failProductionDuplicateAction("Production duplicate archive is already in progress.");
  const group = scanDuplicateProductionJobs().confirmedGroups.find((row) => row.id === groupId);
  if (!group) return failProductionDuplicateAction("Confirmed Production duplicate group not found. Please scan again.");
  const mainMember = group.members.find((member) => member.key === mainMemberKey);
  if (!mainMember) return failProductionDuplicateAction("Select the Main Production Job first.");
  const duplicateMembers = group.members.filter((member) => member.key !== mainMember.key);
  if (!duplicateMembers.length) return failProductionDuplicateAction("No duplicate Production Job selected for archiving.");

  if (options.confirm !== false) {
    const confirmation = window.prompt([
      `Main Production Job: ${mainMember.job.id || "-"}`,
      `Production Jobs to archive: ${duplicateMembers.map((member) => member.job.id || "-").join(", ")}`,
      "The Main Production Job will not be overwritten.",
      "Type ARCHIVE PRODUCTION DUPLICATE to confirm. No Production Job will be permanently deleted."
    ].join("\n"));
    if (confirmation !== "ARCHIVE PRODUCTION DUPLICATE") return { ok: false, cancelled: true, message: "Archive cancelled." };
  }
  if (options.downloadBackup !== false && !downloadProductionDuplicateBackup(group, mainMember)) {
    return failProductionDuplicateAction("Full JSON backup download failed. Production Jobs were not changed.");
  }

  productionDuplicateArchiveBusy = true;
  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    const mainJob = mainMember.job;
    const mainOrderId = resolveProductionOrderId(mainJob) || mainJob.orderId || "";
    const mainOrderNo = productionOrderReference(mainJob);
    const duplicateIndexes = new Set(duplicateMembers.map((member) => member.index));
    const duplicateIds = new Set(duplicateMembers.map((member) => String(member.job.id || "")).filter(Boolean));
    const duplicateReason = group.reasons.join(" | ");
    const archivedBy = state.currentUser?.name || state.currentUser?.username || state.currentUser?.userId || role();

    state.productionJobs = state.productionJobs.map((job, index) => {
      if (index === mainMember.index) return job;
      if (!duplicateIndexes.has(index)) return repairProductionJobReferences(job, duplicateIds, mainJob.id, now);
      return {
        ...job,
        statusBeforeDuplicateArchive: job.status,
        isArchivedBeforeDuplicateArchive: job.isArchived === true,
        archivedAtBeforeDuplicateArchive: job.archivedAt || null,
        status: "duplicate_archived",
        isArchived: true,
        duplicateOfProductionJobId: mainJob.id,
        duplicateOfOrderId: mainOrderId,
        duplicateOfOrderNo: mainOrderNo,
        duplicateReason,
        archivedAt: now,
        archivedBy,
        updatedAt: now
      };
    });
    state.orders = state.orders.map((record) => repairProductionJobReferences(record, duplicateIds, mainJob.id, now));
    state.quotations = state.quotations.map((record) => repairProductionJobReferences(record, duplicateIds, mainJob.id, now));
    state.installationJobs = state.installationJobs.map((record) => repairProductionJobReferences(record, duplicateIds, mainJob.id, now));
    state.warrantyCards = state.warrantyCards.map((record) => repairProductionJobReferences(record, duplicateIds, mainJob.id, now));

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failProductionDuplicateAction(`Failed to archive Production duplicates locally: ${localSave.reason}`);
    }
    localCommitted = true;
    const cloudSync = await syncOrderConversionCollections();
    const cloudFailed = !cloudSync.ok && !cloudSync.localOnly;
    const message = cloudFailed
      ? `Production duplicate archive saved locally but cloud sync failed: ${cloudSync.reason}`
      : cloudSync.localOnly
        ? "Production duplicates archived locally."
        : "Production duplicates archived successfully.";
    showWorkflowMessage(message, cloudFailed ? "warning" : "success");
    return {
      ok: true,
      mainProductionJob: mainJob,
      archivedProductionJobIds: duplicateMembers.map((member) => member.job.id),
      cloudOk: cloudSync.ok && !cloudSync.localOnly,
      localOnly: cloudSync.localOnly,
      message
    };
  } catch (error) {
    console.error("Archive duplicate Production Jobs failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failProductionDuplicateAction(`Failed to archive Production duplicates: ${error.message || "Unknown error"}`);
    }
    const message = `Production duplicate archive saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, mainProductionJob: mainMember.job, cloudOk: false, message };
  } finally {
    productionDuplicateArchiveBusy = false;
  }
}

export async function restoreArchivedProductionJob(jobId, options = {}) {
  if (!isBossOrAdmin()) return failProductionDuplicateAction("Permission denied: your role cannot perform this action.");
  const entry = state.productionJobs
    .map((job, index) => ({ job, index }))
    .find(({ job }) => String(job.id || "") === String(jobId || "") && isArchivedProductionJob(job));
  if (!entry) return failProductionDuplicateAction("Archived Production Job not found.");
  if (options.confirm !== false && !window.confirm(`Restore archived Production Job ${entry.job.id}?`)) {
    return { ok: false, cancelled: true, message: "Restore cancelled." };
  }

  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    const now = new Date().toISOString();
    state.productionJobs = state.productionJobs.map((job, index) => index === entry.index ? {
      ...job,
      status: job.statusBeforeDuplicateArchive || "not_produced",
      isArchived: job.isArchivedBeforeDuplicateArchive === true,
      archivedAt: job.archivedAtBeforeDuplicateArchive || null,
      duplicateRestoredAt: now,
      duplicateRestoredBy: state.currentUser?.name || state.currentUser?.username || role(),
      updatedAt: now
    } : job);
    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failProductionDuplicateAction(`Failed to restore Production Job locally: ${localSave.reason}`);
    }
    localCommitted = true;
    const cloudSync = await syncOrderConversionCollections();
    productionDuplicateScanResult = productionDuplicateScanVisible ? scanDuplicateProductionJobs() : null;
    renderProductionJobs();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Production Job restored locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, message };
    }
    showWorkflowMessage("Production Job restored.", "success");
    return { ok: true, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly };
  } catch (error) {
    console.error("Restore archived Production Job failed", error);
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failProductionDuplicateAction(`Failed to restore Production Job: ${error.message || "Unknown error"}`);
    }
    const message = `Production Job restored locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, message };
  }
}

function repairProductionJobReferences(record, duplicateIds, mainProductionJobId, now) {
  if (!record || typeof record !== "object") return record;
  let changed = false;
  const next = { ...record };
  ["productionJobId", "linkedProductionJobId", "productionId", "production_job_id"].forEach((field) => {
    if (!duplicateIds.has(String(record[field] || ""))) return;
    next[field] = mainProductionJobId;
    changed = true;
  });
  ["workflow", "links", "references"].forEach((field) => {
    if (!record[field] || typeof record[field] !== "object" || Array.isArray(record[field])) return;
    const repaired = repairProductionJobReferences(record[field], duplicateIds, mainProductionJobId, now);
    if (repaired === record[field]) return;
    next[field] = repaired;
    changed = true;
  });
  if (Array.isArray(record.workflowReferences)) {
    const repaired = record.workflowReferences.map((reference) => repairProductionJobReferences(reference, duplicateIds, mainProductionJobId, now));
    if (repaired.some((reference, index) => reference !== record.workflowReferences[index])) {
      next.workflowReferences = repaired;
      changed = true;
    }
  }
  if (!changed) return record;
  next.productionReferenceRepairedAt = now;
  if (Object.prototype.hasOwnProperty.call(record, "updatedAt")) next.updatedAt = now;
  return next;
}

function productionDuplicateBackupPayload(group, mainMember) {
  return {
    type: "eco-screen-crm-v2-full-backup-before-production-duplicate-archive",
    timestamp: new Date().toISOString(),
    selectedMainProductionJobKey: mainMember.key,
    selectedGroup: { id: group.id, reasons: group.reasons, productionJobKeys: group.members.map((member) => member.key) },
    state: structuredCloneSafe(state)
  };
}

function downloadProductionDuplicateBackup(group, mainMember) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const blob = new Blob([JSON.stringify(productionDuplicateBackupPayload(group, mainMember), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-full-backup-before-production-duplicate-archive-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Production duplicate archive backup failed", error);
    return false;
  }
}

function failProductionDuplicateAction(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

function renderInstallationJobs() {
  const list = document.querySelector("#installationList");
  if (!list) return;
  const activeJobs = installationJobsForUser();
  const diagnostics = installationDispatchDiagnostics();
  list.innerHTML = `
    ${canScheduleInstallation() ? `<section class="installation-diagnostics">
      <span>Pending Arrangement<strong>${diagnostics.pendingArrangement}</strong></span>
      <span>Ready to Send<strong>${diagnostics.readyToSend}</strong></span>
      <span>Sent to Installer<strong>${diagnostics.sentToInstaller}</strong></span>
      <span>Completed<strong>${diagnostics.completed}</strong></span>
      <span>Missing assignedInstallerId<strong>${diagnostics.missingAssignedInstallerId}</strong></span>
    </section>` : ""}
    ${activeJobs.length ? activeJobs.map((job) => installationJobCardHtml(job)).join("") : `<p class="muted-text">${t("No installation jobs yet.")}</p>`}
  `;
  if (activeCompletionJobId) setupSignatureCanvas(activeCompletionJobId);
}

export function installationJobsForUser(user = state.currentUser) {
  const userRole = normalizeText(user?.role || state.role);
  const activeJobs = state.installationJobs.filter(isActiveWorkflowRecord);
  if (["boss", "admin", "secretary"].includes(userRole)) return activeJobs;
  if (userRole !== "installer") return [];
  const exactInstallerId = String(user?.userId || "").trim();
  if (!exactInstallerId) return [];
  return activeJobs.filter((job) => ["sent_to_installer", "completed"].includes(installationDispatchStage(job))
    && String(job.assignedInstallerId || "").trim() === exactInstallerId);
}

export function installationDispatchDiagnostics() {
  const counts = { pendingArrangement: 0, readyToSend: 0, sentToInstaller: 0, completed: 0, missingAssignedInstallerId: 0 };
  state.installationJobs.filter(isActiveWorkflowRecord).forEach((job) => {
    const stage = installationDispatchStage(job);
    if (stage === "pending_arrangement") counts.pendingArrangement += 1;
    if (stage === "ready_to_send") counts.readyToSend += 1;
    if (stage === "sent_to_installer") counts.sentToInstaller += 1;
    if (stage === "completed") counts.completed += 1;
    if (!String(job.assignedInstallerId || "").trim()) counts.missingAssignedInstallerId += 1;
  });
  return counts;
}

function installationDispatchStage(job = {}) {
  const status = String(job.status || "").trim().toLowerCase();
  if (status === "completed" || (job.completionStatus === "Completed" && ["installed", "pending_collection", "touch_up"].includes(status))) return "completed";
  if (status === "sent_to_installer") return "sent_to_installer";
  if (status === "ready_to_send") return "ready_to_send";
  if (status === "pending_arrangement") return "pending_arrangement";
  if (job.installationDate && job.assignedInstallerId) return "ready_to_send";
  return "pending_arrangement";
}

function installationDispatchLabel(job) {
  return ({ pending_arrangement: "Pending Arrangement", ready_to_send: "Ready to Send", sent_to_installer: "Sent to Installer", completed: "Completed" })[installationDispatchStage(job)];
}

function installationJobCardHtml(job) {
  const stage = installationDispatchStage(job);
  const existingWarranty = existingWarrantyForInstallation(job.id);
  const warrantyPreview = warrantyPreviewCardId
    ? state.warrantyCards.find((card) => String(card.id || "") === warrantyPreviewCardId && String(card.installationId || "") === String(job.id || ""))
    : null;
  return `
    <article class="card" data-installation-card="${escapeHtml(job.id)}">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(job.installationNumber || job.id)}</strong>
          <p class="muted-text">${t("Order")}: ${escapeHtml(job.orderNo || job.orderNumber || "-")} | ${escapeHtml(job.customer?.name || job.contactPerson || "-")}</p>
          <p class="muted-text">${t("Quote")}: ${job.quoteNumber || job.quotationNo || "-"}</p>
          <p class="muted-text">${escapeHtml(job.phone || job.customer?.phone || "-")} | ${escapeHtml(job.address || job.customer?.address || "-")}</p>
        </div>
        <div><span class="pill">${escapeHtml(installationDispatchLabel(job))}</span><span class="pill">${money(getRemainingBalance(findOrder(job.orderId) || {}, job))} ${t("Remaining Balance")}</span></div>
      </div>
      ${canScheduleInstallation() ? installationArrangementHtml(job, stage) : installationAssignedSummaryHtml(job)}
      ${itemsSummary(job.items)}
      ${completionSummaryHtml(job)}
      <div class="actions">
        <button class="btn" type="button" data-view-installation="${job.id}">${t("View Installation Job")}</button>
        <button class="btn primary" type="button" data-print-installation="${job.id}">${t("Print Installation Sheet")}</button>
        <button class="btn" type="button" data-whatsapp-installation="${job.id}">${t("WhatsApp Customer")}</button>
        ${canScheduleInstallation() && !["sent_to_installer", "completed"].includes(stage) ? `<button class="btn primary" type="button" data-preview-installation-send="${job.id}">Send to Installer</button>` : ""}
        ${isBossOrAdmin() && stage === "sent_to_installer" ? `<button class="btn danger" type="button" data-open-installation-recall="${job.id}">Recall from Installer</button>` : ""}
        ${canCompleteInstallationJob(job) && stage === "sent_to_installer" ? `<button class="btn" type="button" data-complete-installation="${job.id}">${t("Complete Installation")}</button>` : ""}
        ${job.completionOutcome === "touch_up" && canCompleteInstallationJob(job) ? `<button class="btn" type="button" data-mark-touchup-completed="${job.id}">${t("Mark Touch Up Completed")}</button>` : ""}
        ${canGenerateWarrantyCard() && stage === "completed" && !existingWarranty ? `<button class="btn" type="button" data-generate-warranty="${job.id}">Generate Warranty Card</button>` : ""}
        ${canGenerateWarrantyCard() && existingWarranty ? `<button class="btn" type="button" data-view-warranty="${existingWarranty.id}">View Existing Warranty Card</button>${stage === "completed" ? `<button class="btn" type="button" data-regenerate-warranty="${job.id}">Regenerate Warranty Card</button>` : ""}` : ""}
      </div>
      ${installationDispatchPreviewId === job.id ? installationDispatchPreviewHtml(job) : ""}
      ${installationRecallJobId === job.id ? installationRecallPanelHtml(job) : ""}
      ${activeCompletionJobId === job.id ? completionFormHtml(job) : ""}
      ${warrantyPreview ? warrantyCardPreviewHtml(warrantyPreview) : ""}
    </article>
  `;
}

function installationArrangementHtml(job, stage) {
  const locked = ["sent_to_installer", "completed"].includes(stage);
  return `<section class="installation-arrangement" data-installation-arrangement="${escapeHtml(job.id)}">
    <div class="form-grid compact">
      <label>Installation Date<input type="date" data-arrangement-field="installationDate" value="${escapeHtml(job.installationDate || "")}" ${locked ? "disabled" : ""} /></label>
      <label>Installation Time<input type="time" data-arrangement-field="installationTime" value="${escapeHtml(job.installationTime || "")}" ${locked ? "disabled" : ""} /></label>
      <label>Assigned Installer<select data-arrangement-field="assignedInstallerId" ${locked ? "disabled" : ""}>${installerOptionsHtml(job.assignedInstallerId)}</select></label>
      <label>Contact Person<input data-arrangement-field="contactPerson" value="${escapeHtml(job.contactPerson || job.customer?.name || "")}" ${locked ? "disabled" : ""} /></label>
      <label>Phone<input data-arrangement-field="phone" value="${escapeHtml(job.phone || job.customer?.phone || "")}" ${locked ? "disabled" : ""} /></label>
      <label class="wide">Address<textarea rows="2" data-arrangement-field="address" ${locked ? "disabled" : ""}>${escapeHtml(job.address || job.customer?.address || "")}</textarea></label>
      <label class="wide">Installation Remarks<textarea rows="2" data-arrangement-field="installationRemarks" ${locked ? "disabled" : ""}>${escapeHtml(job.installationRemarks || job.installerRemark || "")}</textarea></label>
      <label class="wide">Required Items / Checklist<textarea rows="2" data-arrangement-field="requiredItems" ${locked ? "disabled" : ""}>${escapeHtml(job.requiredItems || "")}</textarea></label>
    </div>
    ${locked ? `<p class="muted-text">Recall the job before changing its arrangement. Editing never sends automatically.</p>` : `<button class="btn" type="button" data-save-installation-arrangement="${escapeHtml(job.id)}">Save Arrangement</button>`}
  </section>`;
}

function installationAssignedSummaryHtml(job) {
  return `<div class="installation-assigned-summary"><span>Date / Time<strong>${escapeHtml([job.installationDate, job.installationTime].filter(Boolean).join(" ") || "-")}</strong></span><span>Assigned Installer<strong>${escapeHtml(job.assignedInstallerName || "-")}</strong></span><span>Address<strong>${escapeHtml(job.address || job.customer?.address || "-")}</strong></span><span>Phone<strong>${escapeHtml(job.phone || job.customer?.phone || "-")}</strong></span></div>`;
}

function installerOptionsHtml(selectedId) {
  const installers = state.users.filter((user) => user.active !== false && normalizeText(user.role) === "installer" && String(user.userId || "").trim());
  return `<option value="">Select installer</option>${installers.map((user) => `<option value="${escapeHtml(user.userId)}" ${String(user.userId) === String(selectedId || "") ? "selected" : ""}>${escapeHtml(user.name || user.username || user.userId)}</option>`).join("")}`;
}

function installationDispatchPreviewHtml(job) {
  const order = findOrder(job.orderId);
  return `<section class="installation-dispatch-preview">
    <h3>Send to Installer</h3>
    ${installationDispatchSummaryHtml(job, order)}
    <div class="actions"><button class="btn primary" type="button" data-confirm-installation-send="${escapeHtml(job.id)}">Confirm Send to Installer</button><button class="btn" type="button" data-close-installation-send="${escapeHtml(job.id)}">Cancel</button></div>
  </section>`;
}

function installationRecallPanelHtml(job) {
  return `<section class="installation-dispatch-preview" data-installation-recall-panel="${escapeHtml(job.id)}"><h3>Recall from Installer</h3><p>Assignment and dispatch history remain stored for audit.</p><label>Recall reason<textarea rows="2" data-installation-recall-reason></textarea></label><div class="actions"><button class="btn danger" type="button" data-confirm-installation-recall="${escapeHtml(job.id)}">Confirm Recall</button><button class="btn" type="button" data-close-installation-recall="${escapeHtml(job.id)}">Cancel</button></div></section>`;
}

function installationDispatchSummaryHtml(job, order) {
  return `<div class="installation-assigned-summary"><span>Customer<strong>${escapeHtml(order?.customer?.name || job.customer?.name || "-")}</strong></span><span>SO Number<strong>${escapeHtml(getOrderDisplayNo(order || job) || "-")}</strong></span><span>Date / Time<strong>${escapeHtml([job.installationDate, job.installationTime].filter(Boolean).join(" ") || "-")}</strong></span><span>Assigned Installer<strong>${escapeHtml(job.assignedInstallerName || "-")}</strong></span><span>Address<strong>${escapeHtml(job.address || job.customer?.address || "-")}</strong></span><span>Phone<strong>${escapeHtml(job.phone || job.customer?.phone || "-")}</strong></span><span>Remarks<strong>${escapeHtml(job.installationRemarks || job.installerRemark || "-")}</strong></span></div>`;
}

function canCompleteInstallationJob(job) {
  if (isBossOrAdmin()) return true;
  return normalizeText(role()) === "installer"
    && String(state.currentUser?.userId || "") === String(job.assignedInstallerId || "")
    && ["sent_to_installer", "completed"].includes(String(job.status || "").toLowerCase());
}

function canGenerateWarrantyCard() {
  return isBossOrAdmin() || normalizeText(role()) === "secretary";
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

function itemsSummary(items = []) {
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
  const whatsappId = event.target.dataset.whatsappOrder;
  const highlightId = event.target.dataset.highlightOrder;
  const editItemsId = event.target.dataset.editOrderItems;
  const saveItemsId = event.target.dataset.saveOrderItems;
  const cancelItemsId = event.target.dataset.cancelOrderItems;
  const editOrderNumberId = event.target.dataset.editOrderNumber;
  const saveOrderNumberId = event.target.dataset.saveOrderNumber;
  const cancelOrderNumberId = event.target.dataset.cancelOrderNumber;
  const restoreDuplicateKey = event.target.dataset.restoreDuplicate;
  const returnFollowUpId = event.target.dataset.returnFollowUp;
  const previewReturnFollowUpId = event.target.dataset.previewReturnFollowUp;
  const confirmReturnFollowUpId = event.target.dataset.confirmReturnFollowUp;
  const cancelReturnFollowUpId = event.target.dataset.cancelReturnFollowUp;
  const recordPaymentId = event.target.dataset.recordPayment;
  const previewPaymentId = event.target.dataset.previewPayment;
  const confirmPaymentId = event.target.dataset.confirmPayment;
  const cancelPaymentId = event.target.dataset.cancelPayment;
  const reversePaymentId = event.target.dataset.reversePayment;
  const previewReversePaymentId = event.target.dataset.previewReversePayment;
  const confirmReversePaymentId = event.target.dataset.confirmReversePayment;
  const cancelReversePaymentId = event.target.dataset.cancelReversePayment;
  if (page) {
    orderSearch = { ...orderSearch, page: Number(page) || 1 };
    renderOrderList();
  }
  if (printId) printOrder(printId);
  if (viewId) printOrder(viewId);
  if (sendProductionId) sendOrderToProduction(sendProductionId);
  if (sendInstallerId) sendOrderToInstaller(sendInstallerId);
  if (updateStatusId) updateOrderStatusFromCard(updateStatusId, event.target);
  if (whatsappId) whatsappOrderCustomer(whatsappId);
  if (highlightId) highlightOrder(highlightId);
  if (editItemsId) toggleOrderItemEditor(editItemsId);
  if (saveItemsId) saveOrderItemEditor(saveItemsId, event.target);
  if (cancelItemsId) closeOrderItemEditor();
  if (editOrderNumberId) toggleOrderNumberEditor(editOrderNumberId);
  if (saveOrderNumberId) saveOrderNumberFromEditor(saveOrderNumberId, event.target);
  if (cancelOrderNumberId) closeOrderNumberEditor();
  if (restoreDuplicateKey) restoreArchivedDuplicate(restoreDuplicateKey);
  if (returnFollowUpId) openReturnToFollowUpPanel(returnFollowUpId);
  if (previewReturnFollowUpId) previewReturnToFollowUp(previewReturnFollowUpId, event.target);
  if (confirmReturnFollowUpId) confirmReturnToFollowUp(confirmReturnFollowUpId, event.target);
  if (cancelReturnFollowUpId) closeReturnToFollowUpPanel();
  if (recordPaymentId) openRecordPaymentPanel(recordPaymentId);
  if (previewPaymentId) previewRecordPayment(previewPaymentId, event.target);
  if (confirmPaymentId) confirmRecordPayment(confirmPaymentId, event.target);
  if (cancelPaymentId) closeRecordPaymentPanel();
  if (reversePaymentId) openReversePaymentPanel(event.target.dataset.orderId, reversePaymentId);
  if (previewReversePaymentId) previewReversePayment(previewReversePaymentId, event.target);
  if (confirmReversePaymentId) confirmReversePayment(confirmReversePaymentId, event.target);
  if (cancelReversePaymentId) closeReversePaymentPanel();
}

function openReturnToFollowUpPanel(orderId) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order || !isActiveOrderRecord(order)) return showWorkflowMessage("Active Order not found.", "error");
  returnToFollowUpPanel = { orderId, reason: "Customer did not confirm", preview: false };
  paymentPanel = null;
  paymentReversalPanel = null;
  renderOrderList();
}

function closeReturnToFollowUpPanel() {
  returnToFollowUpPanel = null;
  renderOrderList();
}

function previewReturnToFollowUp(orderId, button) {
  const panel = button.closest("[data-return-follow-up-panel]");
  const reason = panel?.querySelector("[data-return-follow-up-reason]")?.value || "";
  const plan = buildReturnToFollowUpPlan(orderId, reason);
  if (!plan.ok) return failOrderUpdate(plan.message);
  returnToFollowUpPanel = { orderId, reason, preview: true };
  renderOrderList();
}

async function confirmReturnToFollowUp(orderId, button) {
  if (!returnToFollowUpPanel?.preview || returnToFollowUpPanel.orderId !== orderId) return failOrderUpdate("Review the before/after preview first.");
  setOrderActionBusy(button, "Returning...");
  const result = await returnOrderToFollowUp(orderId, returnToFollowUpPanel.reason);
  if (result.ok) returnToFollowUpPanel = null;
  renderOrders();
}

function openRecordPaymentPanel(orderId) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order || !isActiveOrderRecord(order)) return showWorkflowMessage("Active Order not found.", "error");
  paymentPanel = {
    orderId,
    preview: false,
    values: { orderId, amount: "", paymentDate: new Date().toISOString().slice(0, 10), type: "Deposit", method: "Bank Transfer", referenceNumber: "", note: "" }
  };
  returnToFollowUpPanel = null;
  paymentReversalPanel = null;
  renderOrderList();
}

function closeRecordPaymentPanel() {
  paymentPanel = null;
  renderOrderList();
}

function readPaymentPanelValues(orderId, button) {
  const panel = button.closest("[data-record-payment-panel]");
  const read = (field) => panel?.querySelector(`[data-payment-field="${field}"]`)?.value || "";
  return {
    orderId,
    paymentId: paymentPanel?.values?.paymentId || uid("payment"),
    amount: read("amount"),
    paymentDate: read("paymentDate"),
    type: read("type"),
    method: read("method"),
    referenceNumber: read("referenceNumber"),
    note: read("note")
  };
}

function previewRecordPayment(orderId, button) {
  const values = readPaymentPanelValues(orderId, button);
  const plan = buildRecordPaymentPlan(values);
  if (!plan.ok) return failOrderUpdate(plan.message);
  paymentPanel = { orderId, values, preview: true };
  renderOrderList();
}

async function confirmRecordPayment(orderId, button) {
  if (!paymentPanel?.preview || paymentPanel.orderId !== orderId) return failOrderUpdate("Review the before/after preview first.");
  const plan = buildRecordPaymentPlan(paymentPanel.values);
  if (!plan.ok) return failOrderUpdate(plan.message);
  let allowOverpayment = false;
  if (plan.requiresOverpaymentConfirmation) {
    allowOverpayment = window.confirm(`This payment exceeds the remaining balance by ${money(plan.payment.amount - plan.before.balance)}. Record the overpayment anyway?`);
    if (!allowOverpayment) return showWorkflowMessage("Payment recording cancelled.", "warning");
  }
  setOrderActionBusy(button, "Saving payment...");
  const result = await recordOrderPayment(paymentPanel.values, { allowOverpayment });
  if (result.ok) paymentPanel = null;
  renderOrders();
}

function openReversePaymentPanel(orderId, paymentId) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  const payment = getOrderPaymentSummary(order || {}).payments.find((entry) => paymentStableId(entry) === paymentId);
  if (!order || !isActiveOrderRecord(order) || !payment || !isActivePaymentRecord(payment)) return showWorkflowMessage("Active payment record not found.", "error");
  paymentReversalPanel = { orderId, paymentId, preview: false, values: { orderId, paymentId, reversalReason: "" } };
  paymentPanel = null;
  returnToFollowUpPanel = null;
  renderOrderList();
}

function closeReversePaymentPanel() {
  paymentReversalPanel = null;
  renderOrderList();
}

function previewReversePayment(orderId, button) {
  const reversalReason = button.closest("[data-reverse-payment-panel]")?.querySelector("[data-reversal-reason]")?.value || "";
  const values = { orderId, paymentId: paymentReversalPanel?.paymentId || "", reversalReason };
  const plan = buildReversePaymentPlan(values);
  if (!plan.ok) return failOrderUpdate(plan.message);
  paymentReversalPanel = { orderId, paymentId: values.paymentId, values, preview: true };
  renderOrderList();
}

async function confirmReversePayment(orderId, button) {
  if (!paymentReversalPanel?.preview || paymentReversalPanel.orderId !== orderId) return failOrderUpdate("Review the before/after preview first.");
  setOrderActionBusy(button, "Reversing...");
  const result = await reverseOrderPayment(paymentReversalPanel.values);
  if (result.ok) paymentReversalPanel = null;
  renderOrders();
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
  const paymentSummary = getOrderPaymentSummary(orderEditorDraft);
  orderEditorDraft.items = orderEditorDraft.items.map((item) => itemWithCalculatedTotals(item));
  const totals = quoteTotals(orderEditorDraft.items, orderEditorDraft.discount, orderEditorDraft.deposit);
  const installationJob = getOrderInstallationJob(orderEditorDraft);
  orderEditorDraft.subtotal = totals.subtotal;
  orderEditorDraft.total = totals.total;
  orderEditorDraft.balance = Math.max(totals.total - paymentSummary.totalPaid - toNumber(installationJob?.amountCollected), 0);
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
  const paymentSummary = getOrderPaymentSummary(original);
  const remainingBalance = Math.max(totals.total - paymentSummary.totalPaid, 0);
  const updatedOrder = {
    ...original,
    items,
    subtotal: totals.subtotal,
    total: totals.total,
    balance: remainingBalance,
    updatedAt: now
  };

  state.orders = state.orders.map((order) => order.id === orderId ? updatedOrder : order);
  state.productionJobs = state.productionJobs.map((job) => !isArchivedProductionJob(job) && isJobForOrder(job, original) ? {
    ...job,
    items: items.map((item) => ({ ...item })),
    updatedAt: now
  } : job);
  state.installationJobs = state.installationJobs.map((job) => isJobForOrder(job, original) ? {
    ...job,
    items: items.map((item) => ({ ...item })),
    balanceToCollect: remainingBalance,
    balance: Math.max(remainingBalance - toNumber(job.amountCollected), 0),
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
  return Boolean(job.orderId && order.id && String(job.orderId) === String(order.id));
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

function handleOrderToolsChange(event) {
  const mainMemberKey = event.target.dataset.duplicateMain;
  const groupId = event.target.dataset.duplicateGroup;
  if (!mainMemberKey || !groupId) return;
  duplicateMainSelections.set(groupId, mainMemberKey);
  renderOrderTools();
  showWorkflowMessage("Main Order selected. Review the summary, then archive the other duplicates.", "info");
  setTimeout(() => document.querySelector?.(`[data-duplicate-group-card="${groupId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 25);
}

function handleOrderToolsClick(event) {
  const filter = event.target.dataset.orderFilter;
  const tool = event.target.dataset.orderTool;
  const archiveGroupId = event.target.dataset.archiveDuplicateGroup;
  const duplicateOrderId = event.target.dataset.duplicateOpenOrder;
  if (filter) {
    setOrderNavigationFilter(filter);
    renderOrders();
  }
  if (tool === "search") renderOrders();
  if (tool === "clear") {
    resetWorkflowNavigationState("orders");
    renderOrders();
  }
  if (tool === "find") quickFindOrder();
  if (tool === "workflow-integrity" || tool === "workflow-integrity-refresh") {
    if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    workflowIntegrityVisible = true;
    workflowIntegrityResult = scanWorkflowIntegrity();
    renderOrderTools();
    showWorkflowMessage("Workflow Integrity Check updated. Preview only; no records changed.", "success");
  }
  if (tool === "workflow-integrity-close") {
    workflowIntegrityVisible = false;
    workflowIntegrityResult = null;
    renderOrderTools();
  }
  if (tool === "workflow-integrity-repair") repairSelectedWorkflowIntegrityIssue(event.target);
  if (tool === "recover-covered-order") openCoveredOrderRecovery();
  if (tool === "recover-covered-order-home") {
    coveredOrderRecovery = { mode: "search" };
    renderOrderTools();
  }
  if (tool === "recover-covered-order-search-so") searchCoveredOrderBySo(event.target);
  if (tool === "recover-covered-order-search-quote") searchCoveredOrderByQuotation(event.target);
  if (tool === "recover-covered-order-refresh") refreshCoveredOrderRecovery();
  if (tool === "recover-covered-order-close") {
    coveredOrderRecovery = null;
    renderOrderTools();
  }
  if (tool === "recover-covered-order-apply") recoverCoveredOrderFromPanel(event.target);
  if (tool === "recover-missing-order-preview") previewMissingConfirmedOrder(event.target);
  if (tool === "recover-missing-order-apply") recoverMissingConfirmedOrderFromPanel(event.target);
  if (tool === "duplicates" || tool === "duplicates-refresh") {
    if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    if (tool === "duplicates-refresh" || !duplicateScanVisible) duplicateMainSelections.clear();
    duplicateScanVisible = true;
    duplicateScanResult = scanDuplicateOrders();
    renderOrderTools();
    showWorkflowMessage("Duplicate Order Check updated.", "success");
    setTimeout(() => document.querySelector?.(".duplicate-order-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 25);
  }
  if (tool === "duplicates-close") {
    duplicateScanVisible = false;
    duplicateScanResult = null;
    duplicateMainSelections.clear();
    renderOrderTools();
    showWorkflowMessage("Duplicate Order Check closed.", "info");
  }
  if (archiveGroupId) archiveDuplicateGroupFromPanel(archiveGroupId, event.target);
  if (duplicateOrderId) highlightOrder(duplicateOrderId);
}

function openCoveredOrderRecovery() {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  coveredOrderRecovery = { mode: "search" };
  renderOrderTools();
  setTimeout(() => document.querySelector?.(".covered-order-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 25);
}

function searchCoveredOrderBySo(button) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const panel = button.closest("[data-covered-order-panel]");
  const orderNo = normalizeCoveredOrderNo(panel?.querySelector("[data-covered-order-so-search]")?.value);
  if (!orderNo) return showWorkflowMessage("Enter an SO number.", "error");
  coveredOrderRecovery = { mode: "so", orderNo, scan: scanCoveredOrderReferences(orderNo) };
  renderOrderTools();
}

function searchCoveredOrderByQuotation(button) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const panel = button.closest("[data-covered-order-panel]");
  const query = String(panel?.querySelector("[data-covered-order-quote-search]")?.value || "").trim();
  if (!query) return showWorkflowMessage("Enter a customer name or ESQ number.", "error");
  coveredOrderRecovery = { mode: "quote", query, scan: searchCoveredOrderQuotations(query), intendedOrderNo: "", selectedQuotationId: "", missingScan: null };
  renderOrderTools();
}

function refreshCoveredOrderRecovery() {
  if (!coveredOrderRecovery) return;
  if (coveredOrderRecovery.mode === "so") {
    coveredOrderRecovery = { mode: "so", orderNo: coveredOrderRecovery.orderNo, scan: scanCoveredOrderReferences(coveredOrderRecovery.orderNo) };
  } else if (coveredOrderRecovery.mode === "quote") {
    const refreshed = searchCoveredOrderQuotations(coveredOrderRecovery.query);
    const selectedQuotationId = coveredOrderRecovery.selectedQuotationId;
    const intendedOrderNo = coveredOrderRecovery.intendedOrderNo;
    coveredOrderRecovery = {
      mode: "quote",
      query: coveredOrderRecovery.query,
      scan: refreshed,
      selectedQuotationId,
      intendedOrderNo,
      missingScan: selectedQuotationId && intendedOrderNo ? scanMissingConfirmedOrderRecovery(selectedQuotationId, intendedOrderNo) : null
    };
  }
  renderOrderTools();
  showWorkflowMessage("Covered Order references refreshed. Preview only; no records changed.", "success");
}

function previewMissingConfirmedOrder(button) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const panel = button.closest("[data-covered-order-panel]");
  const quotationId = panel?.querySelector('input[name="missing-confirmed-quotation"]:checked')?.value || "";
  const intendedOrderNo = normalizeCoveredOrderNo(panel?.querySelector("[data-covered-order-intended-so]")?.value);
  if (!quotationId || !intendedOrderNo) return showWorkflowMessage("Select one confirmed quotation and enter its intended SO number.", "error");
  coveredOrderRecovery = {
    ...coveredOrderRecovery,
    selectedQuotationId: quotationId,
    intendedOrderNo,
    missingScan: scanMissingConfirmedOrderRecovery(quotationId, intendedOrderNo)
  };
  renderOrderTools();
  showWorkflowMessage("Missing Order comparison updated. Preview only; no records changed.", "success");
}

async function recoverMissingConfirmedOrderFromPanel(button) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const panel = button.closest("[data-covered-order-panel]");
  const incorrectQuotationIds = [...(panel?.querySelectorAll('input[name="missing-incorrect-quotation"]:checked') || [])].map((input) => input.value);
  const incorrectOrderIds = [...(panel?.querySelectorAll('input[name="missing-incorrect-order"]:checked') || [])].map((input) => input.value);
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Preparing recovery...";
  const result = await recoverMissingConfirmedOrder({
    confirmedQuotationId: coveredOrderRecovery?.selectedQuotationId || "",
    intendedOrderNo: coveredOrderRecovery?.intendedOrderNo || "",
    incorrectQuotationIds,
    incorrectOrderIds
  });
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (!result?.ok) return;
  coveredOrderRecovery = null;
  renderWorkflowModules();
}

async function recoverCoveredOrderFromPanel(button) {
  if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const panel = button.closest("[data-covered-order-panel]");
  const confirmedOrderId = panel?.querySelector('input[name="covered-confirmed-order"]:checked')?.value || "";
  const unconfirmedQuotationId = panel?.querySelector('input[name="covered-unconfirmed-quotation"]:checked')?.value || "";
  if (!confirmedOrderId || !unconfirmedQuotationId) {
    return showWorkflowMessage("Select exactly one confirmed Order and one quotation to return to Follow Up.", "error");
  }
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Preparing repair...";
  const result = await recoverCoveredOrder({
    orderNo: panel.dataset.coveredOrderNo,
    confirmedOrderId,
    unconfirmedQuotationId
  });
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (!result?.ok) return;
  coveredOrderRecovery = null;
  renderWorkflowModules();
}

async function repairSelectedWorkflowIntegrityIssue(button) {
  const panel = button.closest(".workflow-integrity-panel");
  const selected = panel?.querySelector("[data-workflow-integrity-issue]:checked");
  if (!selected) return showWorkflowMessage("Select one repairable Workflow Integrity issue first.", "error");
  const row = selected.closest("[data-workflow-integrity-row]");
  const targetId = row?.querySelector("[data-workflow-integrity-target]")?.value?.trim() || "";
  const nextStatus = row?.querySelector("[data-workflow-integrity-status]")?.value || "";
  const quotationId = row?.querySelector("[data-order-ownership-quotation-id]")?.value?.trim() || "";
  const orderId = row?.querySelector("[data-order-ownership-order-id]")?.value?.trim() || "";
  const conflicts = [...(row?.querySelectorAll("[data-order-ownership-replacement]") || [])].map((input) => {
    const expectedOrderId = input.dataset.conflictOrderId || "";
    const idInput = [...(row?.querySelectorAll("[data-order-ownership-conflict-id]") || [])]
      .find((candidate) => candidate.dataset.orderOwnershipConflictId === expectedOrderId);
    const enteredOrderId = idInput?.value?.trim() || "";
    return { orderId: enteredOrderId, replacementOrderNo: input.value.trim() };
  });
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Repairing...";
  const result = await repairWorkflowIntegrityIssue(selected.dataset.workflowIntegrityIssue, { targetId, nextStatus, quotationId, orderId, conflicts });
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (!result?.ok) return;
  workflowIntegrityResult = scanWorkflowIntegrity();
  renderWorkflowModules();
}

export async function repairWorkflowIntegrityIssue(issueId, values = {}, options = {}) {
  if (!isBossOrAdmin()) return failWorkflowIntegrityRepair("Permission denied: your role cannot perform this action.");
  const scan = scanWorkflowIntegrity();
  const issue = scan.issues.find((row) => row.id === issueId);
  if (!issue?.repair) return failWorkflowIntegrityRepair("Repairable Workflow Integrity issue not found. Scan again.");
  if (issue.repair.type === "order-ownership") {
    if (String(values.quotationId || "").trim() !== String(issue.repair.quotationId || "")
      || String(values.orderId || "").trim() !== String(issue.repair.orderId || "")) {
      return failWorkflowIntegrityRepair("The typed stable IDs must exactly match the selected Category M comparison.");
    }
    return repairOrderOwnership({
      quotationId: values.quotationId,
      orderId: values.orderId,
      conflicts: values.conflicts
    }, options);
  }
  const targetId = String(values.targetId || issue.repair.targetId || "").trim();
  const nextStatus = String(values.nextStatus || "").trim();
  const exactRecords = workflowIntegrityRecordsForIssue(issue, targetId);

  if (options.downloadBackup !== false && !downloadWorkflowIntegrityBackup(issue, exactRecords)) {
    return failWorkflowIntegrityRepair("Full JSON backup download failed. No workflow records were changed.");
  }
  if (options.confirm !== false) {
    const confirmation = window.prompt([
      `Selected category: ${issue.category}`,
      `Problem: ${issue.problem}`,
      "Exact records involved:",
      JSON.stringify(exactRecords, null, 2),
      "Type REPAIR WORKFLOW to confirm. No record will be permanently deleted."
    ].join("\n"));
    if (confirmation !== "REPAIR WORKFLOW") return { ok: false, cancelled: true, message: "Workflow repair cancelled." };
  }

  if (issue.repair.type === "archive-order") {
    const group = scanDuplicateOrders().confirmedGroups.find((candidate) => candidate.members.length === issue.repair.recordIds.length
      && issue.repair.recordIds.every((id) => candidate.members.some((member) => String(member.order.id || "") === id)));
    const main = group?.members.find((member) => String(member.order.id || "") === targetId);
    if (!group || !main) return failWorkflowIntegrityRepair("These Orders are not a confirmed duplicate group, or the exact Main Order ID is invalid.");
    return archiveDuplicateGroup(group.id, main.key, { confirm: false, downloadBackup: false });
  }
  if (issue.repair.type === "archive-production") {
    const group = scanDuplicateProductionJobs().confirmedGroups.find((candidate) => candidate.members.length === issue.repair.recordIds.length
      && issue.repair.recordIds.every((id) => candidate.members.some((member) => String(member.job.id || "") === id)));
    const main = group?.members.find((member) => String(member.job.id || "") === targetId);
    if (!group || !main) return failWorkflowIntegrityRepair("These Production Jobs are not a confirmed duplicate group, or the exact Main Production ID is invalid.");
    return archiveProductionDuplicateGroup(group.id, main.key, { confirm: false, downloadBackup: false });
  }

  const previousState = snapshotOrderWorkflowState();
  const now = new Date().toISOString();
  let localCommitted = false;
  try {
    if (issue.repair.type === "quote-order") {
      const quote = state.quotations.find((row) => String(row.id || "") === String(issue.repair.recordId || ""));
      const order = state.orders.find((row) => isActiveOrderRecord(row) && String(row.id || "") === targetId);
      if (!quote || !order) return failWorkflowIntegrityRepair("Exact Quotation or active Order stable ID was not found.");
      state.quotations = state.quotations.map((row) => row.id === quote.id ? repairQuotationLinkObject(row, order) : row);
    } else if (issue.repair.type === "order-quote") {
      const order = state.orders.find((row) => String(row.id || "") === String(issue.repair.recordId || ""));
      const quote = state.quotations.find((row) => String(row.id || "") === targetId);
      if (!order || !quote) return failWorkflowIntegrityRepair("Exact Order or Quotation stable ID was not found.");
      const quoteNo = getQuotationDisplayNo(quote);
      state.orders = state.orders.map((row) => row.id === order.id ? {
        ...row,
        quoteId: quote.id,
        quotationId: quote.id,
        quoteNumber: quoteNo,
        quotationNo: quoteNo,
        updatedAt: now
      } : row);
    } else if (issue.repair.type === "order-production") {
      const order = state.orders.find((row) => isActiveOrderRecord(row) && String(row.id || "") === String(issue.repair.recordId || ""));
      const job = state.productionJobs.find((row) => !isArchivedProductionJob(row) && String(row.id || "") === targetId);
      if (!order || !job || String(job.orderId || "") !== String(order.id || "")) return failWorkflowIntegrityRepair("Exact active Order/Production IDs do not form a valid relationship.");
      state.orders = state.orders.map((row) => row.id === order.id ? { ...row, productionJobId: job.id, updatedAt: now } : row);
    } else if (issue.repair.type === "production-order") {
      const job = state.productionJobs.find((row) => !isArchivedProductionJob(row) && String(row.id || "") === String(issue.repair.recordId || ""));
      const order = state.orders.find((row) => isActiveOrderRecord(row) && String(row.id || "") === targetId);
      if (!job || !order) return failWorkflowIntegrityRepair("Exact active Production/Order stable ID was not found.");
      state.productionJobs = state.productionJobs.map((row) => row.id === job.id ? {
        ...row,
        orderId: order.id,
        orderNo: getOrderDisplayNo(order),
        orderNumber: getOrderDisplayNo(order),
        updatedAt: now
      } : row);
    } else if (issue.repair.type === "order-status") {
      if (!orderStatuses.includes(nextStatus)) return failWorkflowIntegrityRepair("Choose a valid Order status before repairing.");
      const order = state.orders.find((row) => String(row.id || "") === String(issue.repair.recordId || ""));
      if (!order || String(order.status || "").toLowerCase() !== "follow_up") return failWorkflowIntegrityRepair("The exact invalid follow_up Order was not found.");
      state.orders = state.orders.map((row) => row.id === order.id ? {
        ...row,
        status: nextStatus,
        isArchived: nextStatus === "Cancelled" ? true : false,
        archivedAt: nextStatus === "Cancelled" ? now : null,
        updatedAt: now
      } : row);
    } else {
      return failWorkflowIntegrityRepair("Unsupported workflow repair action.");
    }

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Failed to save workflow repair locally: ${localSave.reason}`);
    }
    localCommitted = true;
    workflowIntegrityResult = scanWorkflowIntegrity();
    renderWorkflowModules();
    showWorkflowMessage("Workflow repair saved locally. Syncing cloud...", "info");
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Workflow repair saved locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, message };
    }
    showWorkflowMessage("Selected workflow relationship repaired.", "success");
    return { ok: true, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly };
  } catch (error) {
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Workflow repair failed before local commit: ${error.message || "Unknown error"}`);
    }
    const message = `Workflow repair saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, message };
  }
}

export async function repairOrderOwnership(values = {}, options = {}) {
  if (!isBossOrAdmin()) return failWorkflowIntegrityRepair("Permission denied: your role cannot perform this action.");
  const plan = planSafeOrderOwnershipRepair(values);
  if (!plan.ok) return failWorkflowIntegrityRepair(plan.message);

  if (options.downloadBackup !== false && !downloadOrderOwnershipBackup(plan)) {
    return failWorkflowIntegrityRepair("Full JSON backup download failed. No workflow records were changed.");
  }
  if (options.confirm !== false) {
    const confirmation = window.prompt([
      "Safe Order Ownership Repair",
      `Correct Quotation stable ID: ${plan.quotationId}`,
      `Correct Order stable ID: ${plan.orderId}`,
      `Order No retained by the selected Order: ${plan.orderNo}`,
      "Every exact field that will change:",
      JSON.stringify(plan.changes, null, 2),
      "Type REPAIR ORDER OWNERSHIP to confirm. No customer, item or financial data will be copied, merged, archived or deleted."
    ].join("\n"));
    if (confirmation !== "REPAIR ORDER OWNERSHIP") return { ok: false, cancelled: true, message: "Safe Order Ownership Repair cancelled." };
  }

  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    state.quotations = plan.nextState.quotations;
    state.orders = plan.nextState.orders;
    state.productionJobs = plan.nextState.productionJobs;
    state.installationJobs = plan.nextState.installationJobs;
    state.warrantyCards = plan.nextState.warrantyCards;

    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Failed to save Safe Order Ownership Repair locally: ${localSave.reason}`);
    }
    localCommitted = true;
    workflowIntegrityResult = scanWorkflowIntegrity();
    renderWorkflowModules();
    showWorkflowMessage("Order ownership repaired locally. Syncing cloud...", "info");
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Order ownership repaired locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, changes: plan.changes, conflicts: plan.conflicts, message };
    }
    showWorkflowMessage("Safe Order Ownership Repair completed.", "success");
    return {
      ok: true,
      cloudOk: !cloudSync.localOnly,
      localOnly: cloudSync.localOnly,
      changes: plan.changes,
      conflicts: plan.conflicts,
      quotationId: plan.quotationId,
      orderId: plan.orderId
    };
  } catch (error) {
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Safe Order Ownership Repair failed before local commit: ${error.message || "Unknown error"}`);
    }
    const message = `Order ownership repaired locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, changes: plan.changes, conflicts: plan.conflicts, message };
  }
}

export function searchCoveredOrderQuotations(query, source = state) {
  const searchKey = normalizeCoveredSearch(query);
  const quotations = Array.isArray(source.quotations) ? source.quotations : [];
  const rows = coveredOrderCollections(source);
  if (!searchKey) return { ok: false, query: "", records: [], quotationCandidates: [], message: "Enter a customer name or ESQ number." };
  const matches = quotations.filter((quote) => {
    const customer = customerFromQuotation(quote);
    const customerKey = normalizeCoveredSearch(customer.name);
    const aliases = quotationAliasFields(quote).map(normalizeCoveredSearch).filter(Boolean);
    return aliases.includes(searchKey) || customerKey.includes(searchKey);
  });
  const records = matches.map((record) => ({
    collection: "quotations",
    collectionLabel: "Quotation",
    record,
    matchReason: quotationAliasFields(record).map(normalizeCoveredSearch).includes(searchKey) ? "Exact quotation alias" : "Normalized customer search",
    view: coveredOrderRecordView("quotations", record, rows)
  }));
  return {
    ok: records.length > 0,
    query: String(query || "").trim(),
    records,
    quotationCandidates: records.map((entry) => String(entry.record.id || "")).filter(Boolean),
    message: records.length ? `${records.length} quotation candidate(s) found. Select by the displayed exact stable ID.` : "No quotation matches that customer or ESQ search."
  };
}

export function scanMissingConfirmedOrderRecovery(quotationId, intendedOrderNo, source = state) {
  const confirmedQuotationId = String(quotationId || "").trim();
  const orderNo = normalizeCoveredOrderNo(intendedOrderNo);
  const rows = coveredOrderCollections(source);
  const quote = rows.quotations.find((record) => String(record.id || "") === confirmedQuotationId);
  if (!confirmedQuotationId || !orderNo || !quote?.id) {
    return { ok: false, orderNo, confirmedQuotationId, records: [], message: "The selected exact quotation or intended SO number is missing." };
  }

  const quoteAlias = normalizeCoveredSearch(quotationNumberForRecovery(quote));
  const included = new Set([coveredOrderRecordKey("quotations", quote)]);
  const orderIds = new Set([quote.orderId, quote.linkedOrderId].filter(Boolean).map(String));
  const quotationIds = new Set([confirmedQuotationId]);
  const intendedAliasMatch = (record) => coveredOrderNumberFields(record).some((value) => normalizeCoveredOrderNo(value) === orderNo);
  const quotationAliasMatch = (record) => quoteAlias && quotationAliasFields(record).some((value) => normalizeCoveredSearch(value) === quoteAlias);

  ["quotations", "orders", "productionJobs", "installationJobs"].forEach((collection) => {
    rows[collection].filter((record) => intendedAliasMatch(record) || quotationAliasMatch(record)).forEach((record) => {
      included.add(coveredOrderRecordKey(collection, record));
      if (collection === "orders" && record.id) orderIds.add(String(record.id));
      if (collection === "quotations" && record.id) quotationIds.add(String(record.id));
      [record.orderId, record.linkedOrderId].filter(Boolean).forEach((id) => orderIds.add(String(id)));
      [record.quoteId, record.quotationId].filter(Boolean).forEach((id) => quotationIds.add(String(id)));
    });
  });

  for (let pass = 0; pass < 5; pass += 1) {
    rows.orders.filter((record) => orderIds.has(String(record.id || ""))
      || [record.quoteId, record.quotationId].filter(Boolean).some((id) => quotationIds.has(String(id)))).forEach((record) => {
      included.add(coveredOrderRecordKey("orders", record));
      if (record.id) orderIds.add(String(record.id));
      [record.quoteId, record.quotationId].filter(Boolean).forEach((id) => quotationIds.add(String(id)));
    });
    rows.quotations.filter((record) => quotationIds.has(String(record.id || ""))
      || [record.orderId, record.linkedOrderId].filter(Boolean).some((id) => orderIds.has(String(id)))).forEach((record) => {
      included.add(coveredOrderRecordKey("quotations", record));
      if (record.id) quotationIds.add(String(record.id));
      [record.orderId, record.linkedOrderId].filter(Boolean).forEach((id) => orderIds.add(String(id)));
    });
  }
  ["productionJobs", "installationJobs"].forEach((collection) => rows[collection]
    .filter((record) => orderIds.has(String(record.orderId || "")))
    .forEach((record) => included.add(coveredOrderRecordKey(collection, record))));

  const collections = ["quotations", "orders", "productionJobs", "installationJobs"];
  const records = collections.flatMap((collection) => rows[collection]
    .filter((record) => included.has(coveredOrderRecordKey(collection, record)))
    .map((record) => ({
      collection,
      collectionLabel: ({ quotations: "Quotation", orders: "Order", productionJobs: "Production Job", installationJobs: "Installation Job" })[collection],
      record,
      matchReason: collection === "quotations" && String(record.id || "") === confirmedQuotationId
        ? "Selected exact quotation"
        : intendedAliasMatch(record)
          ? `Exact ${orderNo} alias`
          : quotationAliasMatch(record)
            ? "Exact quotation alias"
            : "Exact stable-ID relationship",
      view: coveredOrderRecordView(collection, record, rows)
    })));
  const correctOrderCandidates = rows.orders.filter((order) => isActiveOrderRecord(order)
    && ([quote.orderId, quote.linkedOrderId].filter(Boolean).map(String).includes(String(order.id || ""))
      || [order.quoteId, order.quotationId].filter(Boolean).map(String).includes(confirmedQuotationId))
    && orderPayloadMatchesQuotation(order, quote)).map((order) => String(order.id));
  const activeSoOwnerIds = rows.orders.filter((order) => isActiveOrderRecord(order)
    && [order.orderNo, order.orderNumber].some((value) => normalizeCoveredOrderNo(value) === orderNo))
    .map((order) => String(order.id || ""))
    .filter(Boolean);
  return {
    ok: correctOrderCandidates.length === 0,
    orderNo,
    confirmedQuotationId,
    records,
    correctOrderCandidates,
    activeSoOwnerIds,
    quotationCandidates: records.filter((entry) => entry.collection === "quotations" && String(entry.record.id || "") !== confirmedQuotationId).map((entry) => String(entry.record.id || "")),
    orderCandidates: records.filter((entry) => entry.collection === "orders").map((entry) => String(entry.record.id || "")),
    message: correctOrderCandidates.length
      ? `A matching active Order already exists (${correctOrderCandidates.join(", ")}). Use the existing active Order mode instead.`
      : `${records.length} related or conflicting record(s) found. A new Order will be created only from the selected quotation snapshot.`
  };
}

function coveredOrderCollections(source = state) {
  return Object.fromEntries(["quotations", "orders", "productionJobs", "installationJobs"].map((collection) => [
    collection,
    Array.isArray(source[collection]) ? source[collection] : []
  ]));
}

function normalizeCoveredSearch(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function quotationAliasFields(record = {}) {
  return [record.quotationNo, record.quoteNo, record.quoteNumber, record.number, record.refNo, record.orderNo, record.orderNumber].filter(Boolean);
}

function quotationNumberForRecovery(quote = {}) {
  const esq = quotationAliasFields(quote).find((value) => /^ESQ(?:-|\d)/i.test(String(value).trim()));
  return String(esq || getQuotationDisplayNo(quote)).trim();
}

function orderPayloadMatchesQuotation(order = {}, quote = {}) {
  const orderCustomer = order.customer && typeof order.customer === "object" ? order.customer : {};
  const quoteCustomer = customerFromQuotation(quote);
  const namesMatch = normalizeCoveredSearch(orderCustomer.name ?? order.customerName) === normalizeCoveredSearch(quoteCustomer.name);
  const orderPhone = String(orderCustomer.phone ?? order.phone ?? "").replace(/\D/g, "");
  const quotePhone = String(quoteCustomer.phone ?? "").replace(/\D/g, "");
  const phonesMatch = !orderPhone || !quotePhone || orderPhone === quotePhone;
  const totalFromQuote = quote.total ?? quote.amount ?? quoteTotals(quote.items || [], quote.discount, quote.deposit).total;
  const totalsMatch = Math.abs(toNumber(order.total ?? order.amount) - toNumber(totalFromQuote)) < 0.02;
  return Boolean(namesMatch && phonesMatch && totalsMatch && orderItemRecoverySignature(order.items) === orderItemRecoverySignature(quote.items));
}

function orderItemRecoverySignature(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map((item) => ({
    product: normalizeCoveredSearch(item.productId || item.product || item.productName || item.name),
    width: toNumber(item.width),
    height: toNumber(item.height),
    quantity: toNumber(item.quantity || 1)
  })));
}

export function scanCoveredOrderReferences(orderNo, source = state) {
  const normalizedOrderNo = normalizeCoveredOrderNo(orderNo);
  if (!normalizedOrderNo) return { ok: false, orderNo: "", records: [], message: "Enter an exact SO number." };
  const collections = ["quotations", "orders", "productionJobs", "installationJobs"];
  const rows = Object.fromEntries(collections.map((collection) => [collection, Array.isArray(source[collection]) ? source[collection] : []]));
  const directlyMatches = (record) => coveredOrderNumberFields(record).some((value) => normalizeCoveredOrderNo(value) === normalizedOrderNo);
  const directRecords = collections.flatMap((collection) => rows[collection]
    .filter(directlyMatches)
    .map((record) => ({ collection, record })));
  if (!directRecords.length) {
    return { ok: false, orderNo: normalizedOrderNo, records: [], message: `No record currently references ${normalizedOrderNo}.` };
  }

  const orderIds = new Set();
  const quotationIds = new Set();
  const collectIds = (collection, record) => {
    if (collection === "orders" && record.id) orderIds.add(String(record.id));
    if (collection === "quotations" && record.id) quotationIds.add(String(record.id));
    [record.orderId, record.linkedOrderId].filter(Boolean).forEach((id) => orderIds.add(String(id)));
    [record.quoteId, record.quotationId].filter(Boolean).forEach((id) => quotationIds.add(String(id)));
  };
  directRecords.forEach(({ collection, record }) => collectIds(collection, record));
  for (let pass = 0; pass < 3; pass += 1) {
    rows.orders.filter((record) => orderIds.has(String(record.id || ""))).forEach((record) => collectIds("orders", record));
    rows.quotations.filter((record) => quotationIds.has(String(record.id || ""))
      || orderIds.has(String(record.orderId || ""))
      || orderIds.has(String(record.linkedOrderId || ""))).forEach((record) => collectIds("quotations", record));
  }

  const included = new Set(directRecords.map(({ collection, record }) => coveredOrderRecordKey(collection, record)));
  rows.orders.filter((record) => orderIds.has(String(record.id || ""))).forEach((record) => included.add(coveredOrderRecordKey("orders", record)));
  rows.quotations.filter((record) => quotationIds.has(String(record.id || ""))
    || orderIds.has(String(record.orderId || ""))
    || orderIds.has(String(record.linkedOrderId || ""))).forEach((record) => included.add(coveredOrderRecordKey("quotations", record)));
  ["productionJobs", "installationJobs"].forEach((collection) => rows[collection]
    .filter((record) => orderIds.has(String(record.orderId || "")))
    .forEach((record) => included.add(coveredOrderRecordKey(collection, record))));

  const records = collections.flatMap((collection) => rows[collection]
    .filter((record) => included.has(coveredOrderRecordKey(collection, record)))
    .map((record) => ({
      collection,
      collectionLabel: ({ quotations: "Quotation", orders: "Order", productionJobs: "Production Job", installationJobs: "Installation Job" })[collection],
      record,
      matchReason: directlyMatches(record) ? `Exact ${normalizedOrderNo} reference` : "Exact stable-ID relationship",
      view: coveredOrderRecordView(collection, record, rows)
    })));
  const confirmedOrderCandidates = records.filter((entry) => entry.collection === "orders"
    && entry.record.id
    && isActiveOrderRecord(entry.record)).map((entry) => String(entry.record.id));
  return {
    ok: confirmedOrderCandidates.length > 0,
    orderNo: normalizedOrderNo,
    records,
    confirmedOrderCandidates,
    quotationCandidates: records.filter((entry) => entry.collection === "quotations" && entry.record.id).map((entry) => String(entry.record.id)),
    message: confirmedOrderCandidates.length
      ? `${records.length} exact-number or exact stable-ID-linked record(s) found.`
      : "No exact active Order candidate exists. Recovery is blocked."
  };
}

function coveredOrderNumberFields(record = {}) {
  return [
    record.orderNo,
    record.orderNumber,
    record.orderReference,
    record.orderRef,
    record.order_no,
    record.order_number,
    record.quotationNo,
    record.quoteNo,
    record.quoteNumber
  ];
}

function normalizeCoveredOrderNo(value) {
  return normalizeRefNo(value).replace(/[\s-]+/g, "");
}

function coveredOrderRecordKey(collection, record) {
  return `${collection}:${String(record.id || "missing-id")}`;
}

function coveredOrderRecordView(collection, record, rows) {
  const ownId = String(record.id || "");
  const orderId = collection === "orders" ? ownId : String(record.orderId || record.linkedOrderId || "");
  const order = rows.orders.find((candidate) => String(candidate.id || "") === orderId);
  const quotationId = collection === "quotations"
    ? ownId
    : String(record.quoteId || record.quotationId || order?.quoteId || order?.quotationId || "");
  const quotation = rows.quotations.find((candidate) => String(candidate.id || "") === quotationId);
  const customerSource = record.customer || record.customerName ? record : (order || quotation || record);
  const customer = customerSource.customer && typeof customerSource.customer === "object" ? customerSource.customer : {};
  const exactOrderId = orderId || String(order?.id || "");
  return {
    customer: String(customer.name ?? customerSource.customerName ?? ""),
    phone: String(customer.phone ?? customerSource.phone ?? ""),
    quotationNo: quotationNumberForRecovery(collection === "quotations" ? record : (quotation || record)),
    orderNo: collection === "orders" ? getOrderDisplayNo(record) : String(record.orderNo || record.orderNumber || order?.orderNo || order?.orderNumber || ""),
    quotationStatus: String(quotation?.status || (collection === "quotations" ? record.status : "") || ""),
    orderStatus: String(order?.status || (collection === "orders" ? record.status : "") || ""),
    total: record.total ?? record.amount ?? order?.total ?? quotation?.total ?? "",
    quotationStableId: quotationId,
    orderStableId: exactOrderId,
    productionJobIds: exactOrderId
      ? rows.productionJobs.filter((candidate) => String(candidate.orderId || "") === exactOrderId).map((candidate) => String(candidate.id || ""))
      : collection === "productionJobs" && ownId ? [ownId] : [],
    installationJobIds: exactOrderId
      ? rows.installationJobs.filter((candidate) => String(candidate.orderId || "") === exactOrderId).map((candidate) => String(candidate.id || ""))
      : collection === "installationJobs" && ownId ? [ownId] : [],
    forwardLinks: collection === "quotations" ? {
      orderId: String(record.orderId || ""),
      linkedOrderId: String(record.linkedOrderId || ""),
      orderNo: String(record.orderNo || ""),
      orderNumber: String(record.orderNumber || "")
    } : { orderId: String(record.orderId || "") },
    reverseLinks: collection === "orders" ? {
      quoteId: String(record.quoteId || ""),
      quotationId: String(record.quotationId || ""),
      quoteNumber: String(record.quoteNumber || ""),
      quotationNo: String(record.quotationNo || "")
    } : order ? {
      quoteId: String(order.quoteId || ""),
      quotationId: String(order.quotationId || "")
    } : {}
  };
}

export async function recoverCoveredOrder(values = {}, options = {}) {
  if (!isBossOrAdmin()) return failWorkflowIntegrityRepair("Permission denied: your role cannot perform this action.");
  const plan = planCoveredOrderRecovery(values);
  if (!plan.ok) return failWorkflowIntegrityRepair(plan.message);
  if (options.downloadBackup !== false && !downloadCoveredOrderBackup(plan)) {
    return failWorkflowIntegrityRepair("Full JSON backup download failed. No workflow records were changed.");
  }
  if (options.confirm !== false) {
    const confirmation = window.prompt([
      `Recover Covered Order ${plan.orderNo}`,
      `Keep exact Order ${plan.confirmedOrderId} with exact quotation ${plan.confirmedQuotationId}.`,
      `Return exact quotation ${plan.unconfirmedQuotationId} to Follow Up with no SO number.`,
      `Erroneous Order archived: ${plan.erroneousOrderId || "none"}. No replacement SO number is assigned.`,
      `Exact linked Production archived: ${plan.productionJobIds.join(", ") || "none"}`,
      `Exact linked Installation archived: ${plan.installationJobIds.join(", ") || "none"}`,
      "Exact before/after field changes:",
      JSON.stringify(plan.changes, null, 2),
      "Type REPAIR COVERED ORDER to confirm."
    ].join("\n"));
    if (confirmation !== "REPAIR COVERED ORDER") return { ok: false, cancelled: true, message: "Covered Order recovery cancelled." };
  }

  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    state.quotations = plan.nextState.quotations;
    state.orders = plan.nextState.orders;
    state.productionJobs = plan.nextState.productionJobs;
    state.installationJobs = plan.nextState.installationJobs;
    state.warrantyCards = plan.nextState.warrantyCards;
    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Failed to save Covered Order recovery locally: ${localSave.reason}`);
    }
    localCommitted = true;
    workflowIntegrityResult = scanWorkflowIntegrity();
    renderWorkflowModules();
    showWorkflowMessage("Covered Order recovery saved locally. Syncing cloud...", "info");
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Covered Order recovery saved locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, changes: plan.changes, message };
    }
    showWorkflowMessage(`${plan.orderNo} recovered. The selected unconfirmed quotation was returned to Follow Up.`, "success");
    return {
      ok: true,
      cloudOk: !cloudSync.localOnly,
      localOnly: cloudSync.localOnly,
      changes: plan.changes,
      confirmedQuotationId: plan.confirmedQuotationId,
      confirmedOrderId: plan.confirmedOrderId,
      unconfirmedQuotationId: plan.unconfirmedQuotationId,
      erroneousOrderId: plan.erroneousOrderId,
      productionJobIds: plan.productionJobIds,
      installationJobIds: plan.installationJobIds
    };
  } catch (error) {
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Covered Order recovery failed before local commit: ${error.message || "Unknown error"}`);
    }
    const message = `Covered Order recovery saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, changes: plan.changes, message };
  }
}

export async function recoverMissingConfirmedOrder(values = {}, options = {}) {
  if (!isBossOrAdmin()) return failWorkflowIntegrityRepair("Permission denied: your role cannot perform this action.");
  const plan = planMissingConfirmedOrderRecovery(values);
  if (!plan.ok) return failWorkflowIntegrityRepair(plan.message);
  if (options.downloadBackup !== false && !downloadCoveredOrderBackup(plan)) {
    return failWorkflowIntegrityRepair("Full JSON backup download failed. No workflow records were changed.");
  }
  if (options.confirm !== false) {
    const confirmation = window.prompt([
      `Recover Missing Confirmed Order ${plan.orderNo}`,
      `Create new exact Order ${plan.confirmedOrderId} from quotation ${plan.confirmedQuotationId}.`,
      `Return selected quotations to Follow Up: ${plan.incorrectQuotationIds.join(", ") || "none"}`,
      `Archive selected incorrect Orders: ${plan.incorrectOrderIds.join(", ") || "none"}`,
      `Archive exact linked Production: ${plan.productionJobIds.join(", ") || "none"}`,
      `Archive exact linked Installation: ${plan.installationJobIds.join(", ") || "none"}`,
      `Remaining active SO conflicts: ${plan.remainingActiveSoOwnerIds.join(", ") || "none"}`,
      "Unselected related records remain unchanged.",
      "Exact before/after field changes:",
      JSON.stringify(plan.changes, null, 2),
      "Type RECOVER MISSING ORDER to confirm."
    ].join("\n"));
    if (confirmation !== "RECOVER MISSING ORDER") return { ok: false, cancelled: true, message: "Missing confirmed Order recovery cancelled." };
  }

  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    state.quotations = plan.nextState.quotations;
    state.orders = plan.nextState.orders;
    state.productionJobs = plan.nextState.productionJobs;
    state.installationJobs = plan.nextState.installationJobs;
    state.warrantyCards = plan.nextState.warrantyCards;
    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Failed to save missing Order recovery locally: ${localSave.reason}`);
    }
    localCommitted = true;
    workflowIntegrityResult = scanWorkflowIntegrity();
    renderWorkflowModules();
    showWorkflowMessage("Missing confirmed Order recovered locally. Syncing cloud...", "info");
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Missing confirmed Order recovered locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, changes: plan.changes, confirmedOrderId: plan.confirmedOrderId, message };
    }
    showWorkflowMessage(`${plan.orderNo} recovered from the selected confirmed quotation.`, "success");
    return {
      ok: true,
      cloudOk: !cloudSync.localOnly,
      localOnly: cloudSync.localOnly,
      changes: plan.changes,
      confirmedQuotationId: plan.confirmedQuotationId,
      confirmedOrderId: plan.confirmedOrderId,
      incorrectQuotationIds: plan.incorrectQuotationIds,
      incorrectOrderIds: plan.incorrectOrderIds,
      productionJobIds: plan.productionJobIds,
      installationJobIds: plan.installationJobIds
    };
  } catch (error) {
    if (!localCommitted) {
      restoreConversionState(previousState);
      return failWorkflowIntegrityRepair(`Missing confirmed Order recovery failed before local commit: ${error.message || "Unknown error"}`);
    }
    const message = `Missing confirmed Order recovered locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, changes: plan.changes, confirmedOrderId: plan.confirmedOrderId, message };
  }
}

function planMissingConfirmedOrderRecovery(values = {}) {
  const confirmedQuotationId = String(values.confirmedQuotationId || "").trim();
  const orderNo = normalizeCoveredOrderNo(values.intendedOrderNo);
  const incorrectQuotationIds = uniqueStableIdSelection(values.incorrectQuotationIds);
  const incorrectOrderIds = uniqueStableIdSelection(values.incorrectOrderIds);
  if (!confirmedQuotationId || !orderNo || !/^SO\d+$/.test(orderNo)) {
    return { ok: false, message: "Select one exact confirmed quotation and enter a valid intended SO number." };
  }
  if (!incorrectQuotationIds.ok || !incorrectOrderIds.ok) {
    return { ok: false, message: "Each incorrect record must be selected once by its exact stable ID." };
  }
  const quote = state.quotations.find((record) => String(record.id || "") === confirmedQuotationId);
  if (!quote?.id) return { ok: false, message: "The selected confirmed quotation stable ID no longer exists." };
  const validation = validateQuoteForOrder(quote);
  if (!validation.ok) return { ok: false, message: validation.message };
  if (incorrectQuotationIds.values.includes(confirmedQuotationId)) {
    return { ok: false, message: "The confirmed quotation cannot also be selected as an incorrect quotation." };
  }

  const selectedWrongQuotes = incorrectQuotationIds.values.map((id) => state.quotations.find((record) => String(record.id || "") === id));
  const selectedWrongOrders = incorrectOrderIds.values.map((id) => state.orders.find((record) => String(record.id || "") === id));
  if (selectedWrongQuotes.some((record) => !record?.id) || selectedWrongOrders.some((record) => !record?.id)) {
    return { ok: false, message: "A selected stable ID is missing. No records were changed." };
  }
  const selectedWrongOrderIds = new Set(incorrectOrderIds.values);
  const comparison = scanMissingConfirmedOrderRecovery(confirmedQuotationId, orderNo);
  if (!comparison.ok) return { ok: false, message: comparison.message };
  if (incorrectQuotationIds.values.some((id) => !comparison.quotationCandidates.includes(id))
    || incorrectOrderIds.values.some((id) => !comparison.orderCandidates.includes(id))) {
    return { ok: false, message: "A selected incorrect stable ID is not part of the current comparison. Refresh before recovering." };
  }
  if (selectedWrongOrders.some((record) => !isActiveOrderRecord(record))) {
    return { ok: false, message: "An already archived or cancelled Order does not need to be selected as an incorrect active Order." };
  }

  const orderHasExactQuotationLink = (order, candidateQuote) => (
    [candidateQuote.orderId, candidateQuote.linkedOrderId].filter(Boolean).map(String).includes(String(order.id || ""))
    || [order.quoteId, order.quotationId].filter(Boolean).map(String).includes(String(candidateQuote.id || ""))
  );
  for (const wrongQuote of selectedWrongQuotes) {
    const unplannedLinkedOrder = state.orders.find((order) => isActiveOrderRecord(order)
      && orderHasExactQuotationLink(order, wrongQuote)
      && !selectedWrongOrderIds.has(String(order.id || "")));
    if (unplannedLinkedOrder) {
      return { ok: false, message: `Incorrect quotation ${wrongQuote.id} has active linked Order ${unplannedLinkedOrder.id}. Select that exact Order for archival in the same transaction.` };
    }
  }

  const activeOwners = state.orders.filter((record) => isActiveOrderRecord(record)
    && [record.orderNo, record.orderNumber].some((value) => normalizeCoveredOrderNo(value) === orderNo));
  const unselectedActiveOwner = activeOwners.find((record) => !selectedWrongOrderIds.has(String(record.id || "")));
  if (unselectedActiveOwner) {
    return { ok: false, message: `${orderNo} is owned by active Order ${unselectedActiveOwner.id}. Select that exact incorrect Order or use the existing active Order mode.` };
  }
  const ownerWithoutSelectedIncorrectQuote = activeOwners.find((record) => !selectedWrongQuotes.some((wrongQuote) => orderHasExactQuotationLink(record, wrongQuote)));
  if (ownerWithoutSelectedIncorrectQuote) {
    return { ok: false, message: `${orderNo} active Order ${ownerWithoutSelectedIncorrectQuote.id} is not exact-ID linked to a selected incorrect quotation. Recovery is blocked.` };
  }

  const now = new Date().toISOString();
  const archivedBy = state.currentUser?.username || state.currentUser?.userId || state.role || "Boss/Admin";
  const nextState = snapshotOrderWorkflowState();
  const changes = [];
  const replaceRecord = (collection, recordId, updater) => {
    nextState[collection] = nextState[collection].map((record) => {
      if (String(record.id || "") !== String(recordId)) return record;
      const updated = updater(record);
      recordFieldChanges(changes, collection, record, updated);
      return updated;
    });
  };
  let confirmedOrderId = uid("order");
  while (state.orders.some((record) => String(record.id || "") === confirmedOrderId)) confirmedOrderId = uid("order");
  const conversionQuote = quotationForConversion(quote);
  const quoteNumber = quotationNumberForRecovery(quote);
  const mappedOrder = createOrderFromQuote(conversionQuote, { id: confirmedOrderId, orderNo, quoteNumber, now });
  const confirmedOrder = {
    ...mappedOrder,
    subtotal: quote.subtotal ?? mappedOrder.subtotal,
    total: quote.total ?? quote.amount ?? mappedOrder.total,
    deposit: quote.deposit ?? mappedOrder.deposit,
    balance: quote.balance ?? mappedOrder.balance,
    status: "Confirmed",
    isArchived: false,
    updatedAt: now
  };
  nextState.orders = [confirmedOrder, ...nextState.orders];
  recordFieldChanges(changes, "orders", {}, confirmedOrder);
  replaceRecord("quotations", confirmedQuotationId, (record) => ({
    ...record,
    status: "won",
    workflowStatus: "converted",
    orderId: confirmedOrderId,
    linkedOrderId: confirmedOrderId,
    orderNo,
    orderNumber: orderNo,
    converted: true,
    convertedToOrder: true,
    convertedAt: record.convertedAt || now,
    updatedAt: now
  }));
  selectedWrongQuotes.forEach((wrongQuote) => replaceRecord("quotations", wrongQuote.id, (record) => ({
    ...record,
    status: "follow_up",
    workflowStatus: "follow_up",
    orderId: "",
    linkedOrderId: "",
    orderNo: "",
    orderNumber: "",
    converted: false,
    convertedToOrder: false,
    updatedAt: now
  })));
  selectedWrongOrders.forEach((wrongOrder) => replaceRecord("orders", wrongOrder.id, (record) => ({
    ...record,
    statusBeforeArchive: record.status,
    status: "cancelled_archived",
    isArchived: true,
    archiveReason: "Incorrect Order payload covering confirmed quotation",
    archivedAt: now,
    archivedBy,
    updatedAt: now
  })));

  const productionJobs = state.productionJobs.filter((record) => isActiveWorkflowRecord(record) && selectedWrongOrderIds.has(String(record.orderId || "")));
  const installationJobs = state.installationJobs.filter((record) => isActiveWorkflowRecord(record) && selectedWrongOrderIds.has(String(record.orderId || "")));
  const archiveExactJob = (collection, record) => replaceRecord(collection, record.id, (candidate) => ({
    ...candidate,
    statusBeforeArchive: candidate.status,
    status: "cancelled_archived",
    isArchived: true,
    archiveReason: "Generated from incorrect Order payload covering confirmed quotation",
    archivedAt: now,
    archivedBy,
    updatedAt: now
  }));
  productionJobs.forEach((record) => archiveExactJob("productionJobs", record));
  installationJobs.forEach((record) => archiveExactJob("installationJobs", record));

  if (!protectedOwnershipValuesUnchanged(state, nextState, { addedOrders: 1 })) {
    return { ok: false, message: "Safety check failed: existing customer, item or financial data would change." };
  }
  if (!protectedWorkflowPayloadUnchanged(state, nextState)) {
    return { ok: false, message: "Safety check failed: Production or Installation payload data would change." };
  }
  return {
    ok: true,
    orderNo,
    confirmedQuotationId,
    confirmedOrderId,
    incorrectQuotationIds: incorrectQuotationIds.values,
    incorrectOrderIds: incorrectOrderIds.values,
    productionJobIds: productionJobs.map((record) => String(record.id || "")),
    installationJobIds: installationJobs.map((record) => String(record.id || "")),
    remainingActiveSoOwnerIds: [],
    changes,
    comparison,
    nextState
  };
}

function uniqueStableIdSelection(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) return { ok: false, values: [] };
  const normalized = values.map((value) => value.trim());
  return { ok: new Set(normalized).size === normalized.length, values: normalized };
}

function planCoveredOrderRecovery(values) {
  if (typeof values.orderNo !== "string" || typeof values.confirmedOrderId !== "string" || typeof values.unconfirmedQuotationId !== "string") {
    return { ok: false, message: "Select exactly one confirmed Order and one unconfirmed quotation." };
  }
  const orderNo = normalizeRefNo(values.orderNo);
  const confirmedOrderId = values.confirmedOrderId.trim();
  const unconfirmedQuotationId = values.unconfirmedQuotationId.trim();
  if (!orderNo || !confirmedOrderId || !unconfirmedQuotationId) {
    return { ok: false, message: "The exact selected stable IDs or SO number are missing." };
  }
  const scan = scanCoveredOrderReferences(orderNo);
  if (!scan.ok || !scan.confirmedOrderCandidates.includes(confirmedOrderId)) {
    return { ok: false, message: "The selected exact confirmed Order is not an active candidate for this SO number." };
  }
  if (!scan.quotationCandidates.includes(unconfirmedQuotationId)) {
    return { ok: false, message: "The selected exact unconfirmed quotation is not a candidate for this SO number." };
  }
  const order = state.orders.find((row) => isActiveOrderRecord(row) && String(row.id || "") === confirmedOrderId);
  const wrongQuote = state.quotations.find((row) => String(row.id || "") === unconfirmedQuotationId);
  if (!order?.id || !wrongQuote?.id) return { ok: false, message: "A selected stable ID is missing. No records were changed." };

  const confirmedQuoteCandidates = state.quotations.filter((candidate) => {
    const id = String(candidate.id || "");
    if (!id || id === unconfirmedQuotationId) return false;
    return String(candidate.orderId || "") === confirmedOrderId
      || String(candidate.linkedOrderId || "") === confirmedOrderId
      || [order.quoteId, order.quotationId].filter(Boolean).map(String).includes(id);
  });
  if (confirmedQuoteCandidates.length !== 1) {
    return { ok: false, message: "The confirmed Order does not resolve to exactly one different quotation through stable-ID links." };
  }
  const quote = confirmedQuoteCandidates[0];
  if (!quote.id || String(quote.id) === unconfirmedQuotationId) {
    return { ok: false, message: "The selected unconfirmed record is already the confirmed Order quotation. No records were changed." };
  }
  const unconfirmedPointsToSelectedOrder = [wrongQuote.orderId, wrongQuote.linkedOrderId].filter(Boolean).map(String).includes(confirmedOrderId);
  if (unconfirmedPointsToSelectedOrder) {
    return { ok: false, message: "The selected unconfirmed quotation already points to the selected confirmed Order. Recovery is blocked." };
  }

  const erroneousOrderCandidates = state.orders.filter((candidate) => isActiveOrderRecord(candidate)
    && String(candidate.id || "") !== confirmedOrderId
    && ([wrongQuote.orderId, wrongQuote.linkedOrderId].filter(Boolean).map(String).includes(String(candidate.id || ""))
      || [candidate.quoteId, candidate.quotationId].filter(Boolean).map(String).includes(unconfirmedQuotationId)));
  if (erroneousOrderCandidates.length > 1) {
    return { ok: false, message: "The selected unconfirmed quotation links to more than one active Order. Recovery is blocked." };
  }
  const wrongOrder = erroneousOrderCandidates[0] || null;
  if (wrongOrder && normalizeRefNo(getOrderDisplayNo(wrongOrder)) !== orderNo) {
    return { ok: false, message: "The selected unconfirmed quotation has a different real confirmed Order number. Recovery is blocked." };
  }

  const now = new Date().toISOString();
  const archivedBy = state.currentUser?.username || state.currentUser?.userId || state.role || "Boss/Admin";
  const nextState = snapshotOrderWorkflowState();
  const changes = [];
  const replaceRecord = (collection, recordId, updater) => {
    nextState[collection] = nextState[collection].map((record) => {
      if (String(record.id || "") !== String(recordId)) return record;
      const updated = updater(record);
      recordFieldChanges(changes, collection, record, updated);
      return updated;
    });
  };
  replaceRecord("quotations", quote.id, (record) => ({
    ...record,
    status: "won",
    orderId: confirmedOrderId,
    linkedOrderId: confirmedOrderId,
    orderNo,
    orderNumber: orderNo,
    converted: true,
    convertedToOrder: true,
    convertedAt: record.convertedAt || now,
    updatedAt: now
  }));
  replaceRecord("orders", order.id, (record) => ({
    ...record,
    quoteId: String(quote.id),
    quotationId: String(quote.id),
    quoteNumber: getQuotationDisplayNo(quote),
    quotationNo: getQuotationDisplayNo(quote),
    orderNo,
    orderNumber: orderNo,
    updatedAt: now
  }));
  replaceRecord("quotations", wrongQuote.id, (record) => ({
    ...record,
    status: "follow_up",
    orderId: "",
    linkedOrderId: "",
    orderNo: "",
    orderNumber: "",
    converted: false,
    convertedToOrder: false,
    updatedAt: now
  }));
  if (wrongOrder) {
    replaceRecord("orders", wrongOrder.id, (record) => ({
      ...record,
      statusBeforeArchive: record.status,
      status: "cancelled_archived",
      isArchived: true,
      archiveReason: "Unconfirmed quotation incorrectly created or linked as Order",
      archivedAt: now,
      archivedBy,
      updatedAt: now
    }));
  }

  const archiveExactJob = (collection, record) => replaceRecord(collection, record.id, (candidate) => ({
    ...candidate,
    statusBeforeArchive: candidate.status,
    status: "cancelled_archived",
    isArchived: true,
    archiveReason: "Generated from unconfirmed quotation incorrectly created or linked as Order",
    archivedAt: now,
    archivedBy,
    updatedAt: now
  }));
  const erroneousOrderId = String(wrongOrder?.id || "");
  const productionJobs = state.productionJobs.filter((record) => erroneousOrderId
    && isActiveWorkflowRecord(record)
    && String(record.orderId || "") === erroneousOrderId);
  const installationJobs = state.installationJobs.filter((record) => erroneousOrderId
    && isActiveWorkflowRecord(record)
    && String(record.orderId || "") === erroneousOrderId);
  productionJobs.forEach((record) => archiveExactJob("productionJobs", record));
  installationJobs.forEach((record) => archiveExactJob("installationJobs", record));

  if (!protectedOwnershipValuesUnchanged(state, nextState)) {
    return { ok: false, message: "Safety check failed: customer, item or financial data would change." };
  }
  if (!protectedWorkflowPayloadUnchanged(state, nextState)) {
    return { ok: false, message: "Safety check failed: Production or Installation payload data would change." };
  }
  return {
    ok: true,
    orderNo,
    confirmedQuotationId: String(quote.id),
    confirmedOrderId,
    unconfirmedQuotationId,
    erroneousOrderId,
    productionJobIds: productionJobs.map((record) => String(record.id || "")),
    installationJobIds: installationJobs.map((record) => String(record.id || "")),
    changes,
    nextState
  };
}

function downloadCoveredOrderBackup(plan) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const payload = {
      type: "eco-screen-crm-v2-full-backup-before-covered-order-recovery",
      timestamp: new Date().toISOString(),
      orderNo: plan.orderNo,
      selectedStableIds: {
        confirmedQuotationId: plan.confirmedQuotationId,
        confirmedOrderId: plan.confirmedOrderId,
        unconfirmedQuotationId: plan.unconfirmedQuotationId,
        erroneousOrderId: plan.erroneousOrderId,
        incorrectQuotationIds: plan.incorrectQuotationIds || [],
        incorrectOrderIds: plan.incorrectOrderIds || []
      },
      exactFieldChanges: plan.changes,
      state: structuredCloneSafe(stateSnapshot())
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-full-backup-before-covered-order-recovery-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Covered Order recovery backup failed", error);
    return false;
  }
}

function planSafeOrderOwnershipRepair(values) {
  const quotationId = String(values.quotationId || "").trim();
  const orderId = String(values.orderId || "").trim();
  if (!quotationId || !orderId) return { ok: false, message: "Explicitly type both the correct Quotation stable ID and correct Order stable ID." };
  const comparison = buildSafeOrderOwnershipComparison(quotationId, orderId);
  if (!comparison) return { ok: false, message: "The exact Quotation stable ID or active Order stable ID was not found." };
  const quote = state.quotations.find((row) => String(row.id || "") === quotationId);
  const order = state.orders.find((row) => isActiveOrderRecord(row) && String(row.id || "") === orderId);
  const orderNo = getOrderDisplayNo(order);
  if (!orderNo) return { ok: false, message: "The selected Order has no Order No. Ownership cannot be repaired safely." };

  const expectedConflicts = comparison.conflicts.map((row) => row.id).sort();
  const enteredConflicts = Array.isArray(values.conflicts) ? values.conflicts.map((entry) => ({
    orderId: String(entry?.orderId || "").trim(),
    replacementOrderNo: String(entry?.replacementOrderNo || "").trim().toUpperCase()
  })) : [];
  if (enteredConflicts.length !== expectedConflicts.length
    || enteredConflicts.some((entry) => !expectedConflicts.includes(entry.orderId))
    || new Set(enteredConflicts.map((entry) => entry.orderId)).size !== expectedConflicts.length) {
    return { ok: false, message: expectedConflicts.length
      ? "Type every exact conflicting Order stable ID and a new unused SO number for each one."
      : "Unexpected conflicting Order input. Scan again before repairing." };
  }
  if (enteredConflicts.some((entry) => !entry.replacementOrderNo)) {
    return { ok: false, message: "Enter a new unused SO number for every exact conflicting Order." };
  }

  const replacementNumbers = enteredConflicts.map((entry) => normalizeRefNo(entry.replacementOrderNo));
  if (new Set(replacementNumbers).size !== replacementNumbers.length || replacementNumbers.includes(normalizeRefNo(orderNo))) {
    return { ok: false, message: "Every replacement SO number must be unique and different from the selected Order number." };
  }
  for (const entry of enteredConflicts) {
    const normalized = normalizeRefNo(entry.replacementOrderNo);
    const alreadyUsed = state.orders.some((candidate) => String(candidate.id || "") !== entry.orderId
      && [candidate.orderNo, candidate.orderNumber].some((value) => normalizeRefNo(value) === normalized));
    if (alreadyUsed) return { ok: false, message: `Replacement Order No ${entry.replacementOrderNo} is already in use.` };
  }

  const now = new Date().toISOString();
  const nextState = snapshotOrderWorkflowState();
  const changes = [];
  const replaceRecord = (collection, recordId, updater) => {
    nextState[collection] = nextState[collection].map((record) => {
      if (String(record.id || "") !== String(recordId)) return record;
      const updated = updater(record);
      recordFieldChanges(changes, collection, record, updated);
      return updated;
    });
  };

  enteredConflicts.forEach((entry) => {
    const conflictingOrder = state.orders.find((candidate) => isActiveOrderRecord(candidate) && String(candidate.id || "") === entry.orderId);
    const oldNormalized = normalizeRefNo(getOrderDisplayNo(conflictingOrder));
    replaceRecord("orders", entry.orderId, (record) => updateOrderReferenceFields(record, entry.orderId, oldNormalized, entry.replacementOrderNo, now));
    state.quotations.filter((candidate) => isQuotationLinkedToOrder(candidate, conflictingOrder)).forEach((candidate) => {
      replaceRecord("quotations", candidate.id, (record) => updateOrderReferenceFields(record, entry.orderId, oldNormalized, entry.replacementOrderNo, now));
    });
    ["productionJobs", "installationJobs", "warrantyCards"].forEach((collection) => {
      state[collection].filter((candidate) => isRecordLinkedToOrder(candidate, entry.orderId)).forEach((candidate) => {
        replaceRecord(collection, candidate.id, (record) => updateOrderReferenceFields(record, entry.orderId, oldNormalized, entry.replacementOrderNo, now));
      });
    });
  });

  replaceRecord("quotations", quote.id, (record) => ({
    ...record,
    orderId: order.id,
    linkedOrderId: order.id,
    orderNo,
    orderNumber: orderNo,
    converted: true,
    convertedToOrder: true,
    convertedAt: record.convertedAt || now,
    updatedAt: now
  }));
  const quoteNo = getQuotationDisplayNo(quote);
  replaceRecord("orders", order.id, (record) => ({
    ...record,
    quoteId: quote.id,
    quotationId: quote.id,
    quoteNumber: quoteNo,
    quotationNo: quoteNo,
    updatedAt: now
  }));

  ["productionJobs", "installationJobs"].forEach((collection) => {
    state[collection].filter((record) => isRecordLinkedToOrder(record, order.id)
      && normalizeRefNo(getOrderDisplayNo(record)) !== normalizeRefNo(orderNo)).forEach((record) => {
      replaceRecord(collection, record.id, (candidate) => updateOrderReferenceFields(candidate, order.id, normalizeRefNo(getOrderDisplayNo(candidate)), orderNo, now));
    });
  });

  if (!protectedOwnershipValuesUnchanged(state, nextState)) {
    return { ok: false, message: "Safety check failed: protected customer, item or financial data would change." };
  }
  return {
    ok: true,
    quotationId,
    orderId,
    orderNo,
    comparison,
    changes,
    conflicts: enteredConflicts,
    nextState
  };
}

function recordFieldChanges(changes, collection, before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach((field) => {
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    changes.push({ collection, stableId: String(before?.id || after?.id || ""), field, from: structuredCloneSafe(from), to: structuredCloneSafe(to) });
  });
}

function protectedOwnershipValuesUnchanged(before, after, options = {}) {
  const protectedFields = ["customer", "customerName", "phone", "items", "total", "amount", "deposit", "balance", "remarks", "remark"];
  const addedOrders = Number(options.addedOrders || 0);
  return ["quotations", "orders"].every((collection) => {
    const expectedLength = before[collection].length + (collection === "orders" ? addedOrders : 0);
    return after[collection].length === expectedLength && before[collection].every((record) => {
    const candidate = after[collection].find((row) => String(row.id || "") === String(record.id || ""));
    if (!candidate) return false;
    return protectedFields.every((field) => JSON.stringify(record[field]) === JSON.stringify(candidate[field]));
    });
  });
}

function protectedWorkflowPayloadUnchanged(before, after) {
  const protectedFields = ["customer", "customerName", "phone", "items", "total", "amount", "deposit", "balance", "remarks", "remark", "productionRemarks", "staff", "assignedStaff", "statusHistory", "history"];
  return ["productionJobs", "installationJobs"].every((collection) => before[collection].length === after[collection].length && before[collection].every((record) => {
    const candidate = after[collection].find((row) => String(row.id || "") === String(record.id || ""));
    if (!candidate) return false;
    return protectedFields.every((field) => JSON.stringify(record[field]) === JSON.stringify(candidate[field]));
  }));
}

function downloadOrderOwnershipBackup(plan) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const payload = {
      type: "eco-screen-crm-v2-full-backup-before-order-ownership-repair",
      timestamp: new Date().toISOString(),
      selection: { quotationId: plan.quotationId, orderId: plan.orderId, conflicts: plan.conflicts },
      comparison: plan.comparison,
      exactFieldChanges: plan.changes,
      state: structuredCloneSafe(stateSnapshot())
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-full-backup-before-order-ownership-repair-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Safe Order Ownership Repair backup failed", error);
    return false;
  }
}

function workflowIntegrityRecordsForIssue(issue, targetId) {
  const ids = new Set([issue.repair?.recordId, ...(issue.repair?.recordIds || []), targetId].filter(Boolean).map(String));
  return Object.fromEntries([
    ["quotations", state.quotations],
    ["orders", state.orders],
    ["productionJobs", state.productionJobs],
    ["installationJobs", state.installationJobs]
  ].map(([collection, rows]) => [collection, structuredCloneSafe(rows.filter((row) => ids.has(String(row.id || ""))))]));
}

function downloadWorkflowIntegrityBackup(issue, exactRecords) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const payload = {
      type: "eco-screen-crm-v2-full-backup-before-workflow-repair",
      timestamp: new Date().toISOString(),
      issue,
      exactRecords,
      state: structuredCloneSafe(stateSnapshot())
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-full-backup-before-workflow-repair-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Workflow integrity backup failed", error);
    return false;
  }
}

function failWorkflowIntegrityRepair(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

async function archiveDuplicateGroupFromPanel(groupId, button) {
  const groupCard = button.closest("[data-duplicate-group-card]");
  const selectedMain = duplicateMainSelections.get(groupId)
    || groupCard?.querySelector("[data-duplicate-main]:checked")?.dataset.duplicateMain;
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
    const mainDetails = duplicateOrderDetails(mainMember);
    const archiveDetails = duplicateMembers.map((member) => duplicateOrderDetails(member));
    const confirmation = window.prompt([
      `Main Order: ${getOrderDisplayNo(mainMember.order) || mainMember.order.id}`,
      `Orders to archive: ${duplicateMembers.map((member) => getOrderDisplayNo(member.order) || member.order.id).join(", ")}`,
      `Linked records to relink: Production ${archiveDetails.reduce((total, details) => total + details.productionCount, 0)}, Installation ${archiveDetails.reduce((total, details) => total + details.installationCount, 0)}, Warranty ${archiveDetails.reduce((total, details) => total + details.warrantyCount, 0)}.`,
      `Main linked records remain unchanged: Production ${mainDetails.productionCount}, Installation ${mainDetails.installationCount}, Warranty ${mainDetails.warrantyCount}.`,
      "Type ARCHIVE DUPLICATE to confirm. No order will be permanently deleted."
    ].join("\n"));
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
  const order = findOrderByNumber(value);
  if (!order) {
    showWorkflowMessage("Order not found", "error");
    return;
  }
  orderSearch = { ...orderSearch, orderNumber: value, filter: "all", highlightId: order.id };
  renderOrders();
  setTimeout(() => document.querySelector(`[data-order-id="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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
  setTimeout(() => document.querySelector(`[data-order-id="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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

export function getOrderPaymentSummary(order = {}) {
  const payments = collectOrderPaymentRecords(order);
  const activePayments = payments.filter(isActivePaymentRecord);
  const activePaymentTotal = activePayments.reduce((sum, payment) => sum + positiveNumber(payment.amount), 0);
  const total = positiveNumber(order.total ?? order.amount);
  const explicitLegacyBaseline = finiteNonNegative(order.legacyPaidBaseline);
  const legacyPaid = explicitLegacyBaseline === null
    ? deriveLegacyPaidBaseline(order, activePayments, activePaymentTotal, total)
    : explicitLegacyBaseline;
  const totalPaid = roundMoneyValue(legacyPaid + activePaymentTotal);
  return {
    total,
    legacyPaid: roundMoneyValue(legacyPaid),
    activePaymentTotal: roundMoneyValue(activePaymentTotal),
    totalPaid,
    balance: roundMoneyValue(total - totalPaid),
    payments,
    activePayments
  };
}

function collectOrderPaymentRecords(order = {}) {
  const records = [];
  const seenIds = new Set();
  ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
    if (!Array.isArray(order[field])) return;
    order[field].forEach((payment) => {
      if (!payment || typeof payment !== "object") return;
      const stableId = paymentStableId(payment);
      if (stableId && seenIds.has(stableId)) return;
      if (stableId) seenIds.add(stableId);
      records.push(payment);
    });
  });
  return records;
}

function paymentStableId(payment = {}) {
  return String(payment.id || payment.paymentId || payment.stableId || "").trim();
}

function isActivePaymentRecord(payment = {}) {
  const status = String(payment.status || "active").trim().toLowerCase();
  return !["reversed", "void", "voided", "cancelled", "canceled"].includes(status) && positiveNumber(payment.amount) > 0;
}

function deriveLegacyPaidBaseline(order, activePayments, activePaymentTotal, total) {
  const deposit = positiveNumber(order.deposit);
  const inferredPaid = total > 0 && finiteNonNegative(order.balance) !== null
    ? Math.max(0, total - finiteNonNegative(order.balance))
    : 0;
  const aggregatePaid = Math.max(
    positiveNumber(order.paidAmount),
    positiveNumber(order.amountPaid),
    positiveNumber(order.totalPaid),
    inferredPaid
  );
  if (!activePayments.length) return Math.max(deposit, aggregatePaid);
  const activeDepositTotal = activePayments
    .filter((payment) => normalizeText(payment.type).includes("deposit"))
    .reduce((sum, payment) => sum + positiveNumber(payment.amount), 0);
  const depositBaseline = Math.max(0, deposit - activeDepositTotal);
  const aggregateBaseline = aggregatePaid >= activePaymentTotal
    ? Math.max(0, aggregatePaid - activePaymentTotal)
    : aggregatePaid;
  return Math.max(depositBaseline, aggregateBaseline);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function finiteNonNegative(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roundMoneyValue(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

export function buildReturnToFollowUpPlan(orderId, reason) {
  const exactOrderId = String(orderId || "").trim();
  const selectedReason = String(reason || "").trim();
  if (!exactOrderId) return { ok: false, message: "The exact Order stable ID is missing." };
  if (!returnToFollowUpReasons.includes(selectedReason)) return { ok: false, message: "Select a valid Return to Follow Up reason." };
  const order = state.orders.find((row) => String(row.id || "") === exactOrderId);
  if (!order || !isActiveOrderRecord(order)) return { ok: false, message: "The exact active Order stable ID was not found." };
  const linkedQuotation = resolveExactLinkedQuotation(order);
  if (!linkedQuotation.ok) return linkedQuotation;

  const quote = linkedQuotation.quotation;
  const now = new Date().toISOString();
  const archivedBy = currentActor();
  const changes = [];
  const nextState = structuredCloneSafe({
    quotations: state.quotations,
    orders: state.orders,
    productionJobs: state.productionJobs,
    installationJobs: state.installationJobs,
    warrantyCards: state.warrantyCards
  });
  const replace = (collection, stableId, updater) => {
    const index = nextState[collection].findIndex((row) => String(row.id || "") === String(stableId));
    if (index < 0) return;
    const before = nextState[collection][index];
    const after = updater(before);
    nextState[collection][index] = after;
    recordFieldChanges(changes, collection, before, after);
  };

  replace("quotations", quote.id, (record) => ({
    ...record,
    status: "follow_up",
    workflowStatus: "follow_up",
    orderId: "",
    linkedOrderId: "",
    orderNo: "",
    orderNumber: "",
    converted: false,
    convertedToOrder: false,
    updatedAt: now
  }));
  replace("orders", order.id, (record) => ({
    ...record,
    statusBeforeArchive: record.statusBeforeArchive || record.status,
    status: "cancelled_archived",
    isArchived: true,
    archiveReason: selectedReason,
    archivedAt: now,
    archivedBy,
    updatedAt: now
  }));

  const archiveExactJob = (collection, record) => replace(collection, record.id, (candidate) => ({
    ...candidate,
    statusBeforeArchive: candidate.statusBeforeArchive || candidate.status,
    status: "cancelled_archived",
    isArchived: true,
    archiveReason: `Order returned to Follow Up: ${selectedReason}`,
    archivedAt: now,
    archivedBy,
    updatedAt: now
  }));
  const productionJobs = state.productionJobs.filter((record) => isActiveWorkflowRecord(record) && String(record.orderId || "") === exactOrderId);
  const installationJobs = state.installationJobs.filter((record) => isActiveWorkflowRecord(record) && String(record.orderId || "") === exactOrderId);
  productionJobs.forEach((record) => archiveExactJob("productionJobs", record));
  installationJobs.forEach((record) => archiveExactJob("installationJobs", record));

  if (!returnToFollowUpPayloadPreserved(order, quote, nextState)) {
    return { ok: false, message: "Safety check failed: customer, item, financial or history data would change." };
  }
  const paymentSummary = getOrderPaymentSummary(order);
  return {
    ok: true,
    action: "return-to-follow-up",
    orderId: exactOrderId,
    quotationId: String(quote.id),
    reason: selectedReason,
    totalPaid: paymentSummary.totalPaid,
    changes,
    productionJobIds: productionJobs.map((record) => String(record.id)),
    installationJobIds: installationJobs.map((record) => String(record.id)),
    nextState
  };
}

function resolveExactLinkedQuotation(order) {
  const orderId = String(order.id || "").trim();
  if (!orderId) return { ok: false, message: "The selected Order stable ID is missing." };
  const forwardIds = [...new Set([order.quoteId, order.quotationId].map((value) => String(value || "").trim()).filter(Boolean))];
  if (forwardIds.length > 1) return { ok: false, message: "Multiple quotation stable IDs are stored on this Order. Return to Follow Up is blocked." };
  const candidates = state.quotations.filter((quote) => {
    const quoteId = String(quote.id || "").trim();
    if (!quoteId) return false;
    return forwardIds.includes(quoteId) || [quote.orderId, quote.linkedOrderId].some((value) => String(value || "") === orderId);
  });
  const unique = [...new Map(candidates.map((quote) => [String(quote.id), quote])).values()];
  if (unique.length !== 1) {
    return { ok: false, message: unique.length ? "Multiple quotations are ambiguously linked to this Order." : "The exact linked Quotation could not be identified." };
  }
  if (forwardIds.length && forwardIds[0] !== String(unique[0].id)) {
    return { ok: false, message: "Forward and reverse quotation stable-ID links disagree. Return to Follow Up is blocked." };
  }
  return { ok: true, quotation: unique[0] };
}

function returnToFollowUpPayloadPreserved(order, quote, nextState) {
  const nextOrder = nextState.orders.find((row) => String(row.id) === String(order.id));
  const nextQuote = nextState.quotations.find((row) => String(row.id) === String(quote.id));
  const protectedFields = ["customer", "customerName", "phone", "items", "total", "amount", "deposit", "paidAmount", "amountPaid", "totalPaid", "balance", "payments", "paymentRecords", "collections", "collectionRecords", "remarks", "remark", "followUpHistory", "history"];
  if (!nextOrder || !nextQuote || !protectedFields.every((field) => JSON.stringify(order[field]) === JSON.stringify(nextOrder[field]) && JSON.stringify(quote[field]) === JSON.stringify(nextQuote[field]))) return false;
  return ["productionJobs", "installationJobs"].every((collection) => state[collection].every((record) => {
    const candidate = nextState[collection].find((row) => String(row.id) === String(record.id));
    if (!candidate) return false;
    return ["customer", "customerName", "items", "remarks", "remark", "productionRemarks", "assignedStaff", "staff", "statusHistory", "history"].every((field) => JSON.stringify(record[field]) === JSON.stringify(candidate[field]));
  }));
}

export async function returnOrderToFollowUp(orderId, reason, options = {}) {
  if (!isBossOrAdmin()) return failOrderUpdate("Permission denied: your role cannot perform this action.");
  const plan = buildReturnToFollowUpPlan(orderId, reason);
  if (!plan.ok) return failOrderUpdate(plan.message);
  if (plan.totalPaid > 0 && options.confirmPaid !== false) {
    const confirmed = window.confirm(`${money(plan.totalPaid)} is recorded as paid/deposit. Financial values will be preserved. Return this Order to Follow Up?`);
    if (!confirmed) return { ok: false, cancelled: true, message: "Return to Follow Up cancelled." };
  }
  if (options.downloadBackup !== false && !downloadOrderActionBackup(plan)) return failOrderUpdate("Full JSON backup download failed. No records were changed.");
  return commitOrderActionPlan(plan, {
    local: "Order returned to Follow Up locally. Syncing cloud...",
    success: "Order returned to Follow Up. The archived Order remains available for audit.",
    cloudFailure: "Return to Follow Up saved locally but cloud sync failed"
  });
}

export function buildRecordPaymentPlan(values = {}) {
  const orderId = String(values.orderId || "").trim();
  const order = state.orders.find((row) => String(row.id || "") === orderId);
  if (!orderId || !order || !isActiveOrderRecord(order)) return { ok: false, message: "The exact active Order stable ID was not found." };
  const amount = Number(values.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Payment amount must be more than RM0." };
  const paymentDate = String(values.paymentDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(`${paymentDate}T00:00:00`))) return { ok: false, message: "Enter a valid actual payment date." };
  const type = String(values.type || "").trim();
  const method = String(values.method || "").trim();
  if (!paymentTypes.includes(type) || !paymentMethods.includes(method)) return { ok: false, message: "Select a valid payment type and method." };
  const paymentId = String(values.paymentId || uid("payment")).trim();
  if (!paymentId) return { ok: false, message: "Payment stable ID is missing." };
  if (collectOrderPaymentRecords(order).some((payment) => paymentStableId(payment) === paymentId)) return { ok: false, message: "Payment stable ID is already in use." };

  const before = getOrderPaymentSummary(order);
  const now = new Date().toISOString();
  const payment = {
    id: paymentId,
    amount: roundMoneyValue(amount),
    paymentDate,
    type,
    method,
    referenceNumber: String(values.referenceNumber || "").trim(),
    note: String(values.note || "").trim(),
    createdAt: now,
    createdBy: currentActor(),
    status: "active"
  };
  const updatedOrder = {
    ...order,
    payments: [...(Array.isArray(order.payments) ? order.payments : []), payment],
    legacyPaidBaseline: before.legacyPaid,
    paymentLedgerVersion: 1,
    totalPaid: roundMoneyValue(before.totalPaid + payment.amount),
    balance: roundMoneyValue(before.total - before.totalPaid - payment.amount),
    paymentUpdatedAt: now,
    updatedAt: now
  };
  const after = getOrderPaymentSummary(updatedOrder);
  const changes = [];
  recordFieldChanges(changes, "orders", order, updatedOrder);
  if (!orderIdentityAndPayloadPreserved(order, updatedOrder)) return { ok: false, message: "Safety check failed: Order ownership, items, total or relationships would change." };
  return {
    ok: true,
    action: "record-payment",
    orderId,
    paymentId,
    payment,
    before,
    after,
    requiresOverpaymentConfirmation: payment.amount > before.balance,
    changes,
    nextState: {
      quotations: state.quotations,
      orders: state.orders.map((row) => String(row.id) === orderId ? updatedOrder : row),
      productionJobs: state.productionJobs,
      installationJobs: state.installationJobs,
      warrantyCards: state.warrantyCards
    }
  };
}

export async function recordOrderPayment(values = {}, options = {}) {
  if (!isBossOrAdmin()) return failOrderUpdate("Permission denied: your role cannot perform this action.");
  const plan = buildRecordPaymentPlan(values);
  if (!plan.ok) return failOrderUpdate(plan.message);
  if (plan.requiresOverpaymentConfirmation && options.allowOverpayment !== true) return failOrderUpdate("Payment exceeds the remaining balance. Explicit Boss/Admin overpayment confirmation is required.");
  if (options.downloadBackup !== false && !downloadOrderActionBackup(plan)) return failOrderUpdate("Full JSON backup download failed. Payment was not recorded.");
  return commitOrderActionPlan(plan, {
    local: "Payment recorded locally. Syncing cloud...",
    success: "Payment recorded successfully.",
    cloudFailure: "Payment saved locally but cloud sync failed"
  });
}

export function buildReversePaymentPlan(values = {}) {
  const orderId = String(values.orderId || "").trim();
  const paymentId = String(values.paymentId || "").trim();
  const reversalReason = String(values.reversalReason || "").trim();
  const order = state.orders.find((row) => String(row.id || "") === orderId);
  if (!orderId || !order || !isActiveOrderRecord(order)) return { ok: false, message: "The exact active Order stable ID was not found." };
  if (!paymentId) return { ok: false, message: "The exact Payment stable ID is missing." };
  if (!reversalReason) return { ok: false, message: "Enter a reversal reason." };
  const payment = collectOrderPaymentRecords(order).find((entry) => paymentStableId(entry) === paymentId);
  if (!payment || !isActivePaymentRecord(payment)) return { ok: false, message: "The exact active Payment stable ID was not found." };
  const before = getOrderPaymentSummary(order);
  const now = new Date().toISOString();
  const reversedBy = currentActor();
  const updatedOrder = { ...order };
  let matchCount = 0;
  ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
    if (!Array.isArray(order[field])) return;
    updatedOrder[field] = order[field].map((entry) => {
      if (paymentStableId(entry) !== paymentId) return entry;
      matchCount += 1;
      return { ...entry, status: "reversed", reversedAt: now, reversedBy, reversalReason };
    });
  });
  if (!matchCount) return { ok: false, message: "The exact Payment stable ID could not be updated." };
  const afterReversal = getOrderPaymentSummary(updatedOrder);
  updatedOrder.legacyPaidBaseline = before.legacyPaid;
  updatedOrder.paymentLedgerVersion = 1;
  updatedOrder.totalPaid = afterReversal.totalPaid;
  updatedOrder.balance = afterReversal.balance;
  updatedOrder.paymentUpdatedAt = now;
  updatedOrder.updatedAt = now;
  const after = getOrderPaymentSummary(updatedOrder);
  const changes = [];
  recordFieldChanges(changes, "orders", order, updatedOrder);
  if (!orderIdentityAndPayloadPreserved(order, updatedOrder)) return { ok: false, message: "Safety check failed: Order ownership, items, total or relationships would change." };
  return {
    ok: true,
    action: "reverse-payment",
    orderId,
    paymentId,
    payment,
    before,
    after,
    changes,
    nextState: {
      quotations: state.quotations,
      orders: state.orders.map((row) => String(row.id) === orderId ? updatedOrder : row),
      productionJobs: state.productionJobs,
      installationJobs: state.installationJobs,
      warrantyCards: state.warrantyCards
    }
  };
}

export async function reverseOrderPayment(values = {}, options = {}) {
  if (!isBossOrAdmin()) return failOrderUpdate("Permission denied: your role cannot perform this action.");
  const plan = buildReversePaymentPlan(values);
  if (!plan.ok) return failOrderUpdate(plan.message);
  if (options.downloadBackup !== false && !downloadOrderActionBackup(plan)) return failOrderUpdate("Full JSON backup download failed. Payment was not reversed.");
  return commitOrderActionPlan(plan, {
    local: "Payment reversal saved locally. Syncing cloud...",
    success: "Payment reversed. The original record remains in Payment History.",
    cloudFailure: "Payment reversal saved locally but cloud sync failed"
  });
}

function orderIdentityAndPayloadPreserved(before, after) {
  return ["id", "orderId", "orderNo", "orderNumber", "quoteId", "quotationId", "quoteNumber", "quotationNo", "customer", "customerName", "phone", "items", "total", "amount", "deposit", "paidAmount", "amountPaid", "status", "productionJobId", "installationJobId", "remarks", "remark"].every((field) => JSON.stringify(before[field]) === JSON.stringify(after[field]));
}

function currentActor() {
  return state.currentUser?.name || state.currentUser?.username || state.currentUser?.userId || role() || "Boss/Admin";
}

function downloadOrderActionBackup(plan) {
  try {
    if (typeof document?.createElement !== "function" || typeof URL?.createObjectURL !== "function") return false;
    const payload = {
      type: `eco-screen-crm-v2-full-backup-before-${plan.action}`,
      timestamp: new Date().toISOString(),
      exactSelection: { orderId: plan.orderId, quotationId: plan.quotationId || "", paymentId: plan.paymentId || "" },
      exactFieldChanges: plan.changes,
      state: structuredCloneSafe(stateSnapshot())
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eco-screen-crm-v2-full-backup-before-${plan.action}-${backupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error("Order action backup failed", error);
    return false;
  }
}

async function commitOrderActionPlan(plan, messages) {
  const previousState = snapshotOrderWorkflowState();
  let localCommitted = false;
  try {
    state.quotations = plan.nextState.quotations;
    state.orders = plan.nextState.orders;
    state.productionJobs = plan.nextState.productionJobs;
    state.installationJobs = plan.nextState.installationJobs;
    state.warrantyCards = plan.nextState.warrantyCards;
    const localSave = persistOrderConversionLocally();
    if (!localSave.ok) {
      restoreConversionState(previousState);
      renderWorkflowModules();
      return failOrderUpdate(`Local transaction failed: ${localSave.reason}`);
    }
    localCommitted = true;
    showWorkflowMessage(messages.local, "info");
    const cloudSync = await syncOrderConversionCollections();
    renderWorkflowModules();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `${messages.cloudFailure}: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, cloudOk: false, changes: plan.changes, message, orderId: plan.orderId, paymentId: plan.paymentId };
    }
    showWorkflowMessage(messages.success, "success");
    return { ok: true, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly, changes: plan.changes, orderId: plan.orderId, quotationId: plan.quotationId, paymentId: plan.paymentId };
  } catch (error) {
    if (!localCommitted) {
      restoreConversionState(previousState);
      renderWorkflowModules();
      return failOrderUpdate(`Local transaction failed: ${error.message || "Unknown error"}`);
    }
    renderWorkflowModules();
    const message = `${messages.cloudFailure}: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, cloudOk: false, changes: plan.changes, message, orderId: plan.orderId, paymentId: plan.paymentId };
  }
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
  return state.orders.find((order) => isActiveOrderRecord(order) && [order.orderNo, order.orderNumber].some((number) => normalizeRefNo(number) === normalized)) || null;
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

function isQuotationLinkedToOrder(quote, order) {
  if (quote.orderId || quote.linkedOrderId) return [quote.orderId, quote.linkedOrderId].includes(order.id);
  if (quote.id && [order.quoteId, order.quotationId].includes(quote.id)) return true;
  return false;
}

function isRecordLinkedToOrder(record, orderId) {
  return Boolean(record.orderId && record.orderId === orderId);
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

function updateEmbeddedPaymentReferences(record, orderId, _oldNormalized, nextOrderNumber) {
  const next = { ...record };
  ["payments", "paymentRecords", "collections", "collectionRecords"].forEach((field) => {
    if (!Array.isArray(record[field])) return;
    next[field] = record[field].map((entry) => {
      if (entry.orderId !== orderId) return entry;
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
  return showWorkflowMessage("Follow Up is a Quotation status. Existing Orders are preserved and cannot be moved into Follow Up.", "warning");
}

function moveOrderBackToFollowUpFlow(orderId) {
  if (!findOrder(orderId)) return showWorkflowMessage("Order not found.", "error");
  return showWorkflowMessage("Follow Up is a Quotation status. This Order was not changed or removed.", "warning");
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

export async function sendOrderToProduction(orderId) {
  if (!canSendOrder()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const existing = activeProductionJobForOrder(order);
  const wasAlreadySent = order.sentToProduction === true || ["Sent to Production", "Production Completed"].includes(order.status);
  const previousState = snapshotOrderWorkflowState();
  const now = new Date().toISOString();
  const orderNo = getOrderDisplayNo(order);
  const productionJob = existing
    ? {
      ...existing,
      orderId: order.id,
      orderNo,
      orderNumber: orderNo,
      installationDate: order.installationDate || existing.installationDate || "",
      status: normalizeProductionStatus(existing.status, true),
      updatedAt: now
    }
    : { ...createProductionJobFromOrder(order), status: "not_produced", updatedAt: now };
  const productionStatus = normalizeProductionStatus(productionJob.status, true);
  state.productionJobs = existing
    ? state.productionJobs.map((job) => job.id === existing.id ? productionJob : job)
    : [productionJob, ...state.productionJobs];
  state.orders = state.orders.map((row) => row.id === order.id ? {
    ...row,
    status: "Sent to Production",
    sentToProduction: true,
    productionStatus,
    productionJobId: productionJob.id,
    updatedAt: now
  } : row);

  const localSave = persistOrderConversionLocally();
  if (!localSave.ok) {
    restoreConversionState(previousState);
    renderWorkflowModules();
    return showWorkflowMessage(`Failed to send Order to Production locally: ${localSave.reason}`, "error");
  }
  renderWorkflowModules();
  showWorkflowMessage(wasAlreadySent ? "Production job already exists. Exact link saved locally." : "Order sent to Production locally. Syncing cloud...", wasAlreadySent ? "warning" : "info");
  try {
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Order and Production link saved locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, productionJob, cloudOk: false, message };
    }
    const message = wasAlreadySent ? "Production job already exists" : "Order sent to Production";
    showWorkflowMessage(message, wasAlreadySent ? "warning" : "success");
    return { ok: true, productionJob, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly, message };
  } catch (error) {
    const message = `Order and Production link saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, productionJob, cloudOk: false, message };
  }
}

async function sendOrderToInstaller(orderId) {
  if (!canScheduleInstallation()) return failInstallationAction("Permission denied: only Boss, Admin or Secretary can arrange Installation.");
  const order = findOrder(orderId);
  if (!order || !isActiveOrderRecord(order)) return failInstallationAction("The exact active Order was not found.");
  const existing = state.installationJobs.find((job) => isActiveWorkflowRecord(job) && String(job.orderId || "") === String(order.id));
  if (existing) {
    showWorkflowMessage("Installation job already exists. Open Installation to arrange and explicitly Send to Installer.", "info");
    return { ok: true, existing: true, installationJob: existing };
  }
  const installationJob = createInstallationJobFromOrder(order);
  const changes = [];
  recordFieldChanges(changes, "installationJobs", {}, installationJob);
  const plan = installationMutationPlan("prepare-installation", installationJob.id, changes, { installationJobs: [installationJob, ...state.installationJobs] });
  const result = await commitOrderActionPlan(plan, {
    local: "Installation job created locally. Syncing cloud...",
    success: "Installation job created as Pending Arrangement. It is hidden from Installer users.",
    cloudFailure: "Installation preparation saved locally but cloud sync failed"
  });
  return { ...result, installationJob };
}

function syncJobInstallationDate(orderId, installationDate) {
  state.productionJobs = state.productionJobs.map((job) => !isArchivedProductionJob(job) && job.orderId === orderId ? { ...job, installationDate, updatedAt: new Date().toISOString() } : job);
  state.installationJobs = state.installationJobs.map((job) => {
    if (job.orderId !== orderId) return job;
    const stage = installationDispatchStage(job);
    const status = ["sent_to_installer", "completed"].includes(stage)
      ? job.status
      : installationDate && job.assignedInstallerId ? "ready_to_send" : "pending_arrangement";
    return { ...job, installationDate, status, updatedAt: new Date().toISOString() };
  });
  state.orders = state.orders.map((order) => order.id === orderId ? { ...order, installationStatus: installationDate ? "ready_to_send" : "pending_arrangement", updatedAt: new Date().toISOString() } : order);
  persistProductionJobs();
  persistInstallationJobs();
  renderProductionJobs();
  renderInstallationJobs();
}

function handleProductionSearch(event) {
  if (!event.target.matches("[data-production-search]")) return;
  setProductionNavigationState({ search: event.target.value });
  renderProductionJobs();
  const input = document.querySelector?.("[data-production-search]");
  input?.focus();
  input?.setSelectionRange(productionSearch.length, productionSearch.length);
}

function handleProductionSearchClick(event) {
  if (event.target.matches("[data-production-search-clear]")) {
    setProductionNavigationState({ search: "" });
    renderProductionJobs();
    return;
  }
  const tool = event.target.dataset.productionTool;
  const archiveGroupId = event.target.dataset.archiveProductionDuplicateGroup;
  if (tool === "duplicates" || tool === "duplicates-refresh") {
    if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    if (tool === "duplicates-refresh" || !productionDuplicateScanVisible) productionDuplicateMainSelections.clear();
    productionDuplicateScanVisible = true;
    productionDuplicateScanResult = scanDuplicateProductionJobs();
    renderProductionJobs();
    showWorkflowMessage("Duplicate Production Check updated.", "success");
    setTimeout(() => document.querySelector?.(".production-duplicate-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 25);
  }
  if (tool === "duplicates-close") {
    productionDuplicateScanVisible = false;
    productionDuplicateScanResult = null;
    productionDuplicateMainSelections.clear();
    renderProductionJobs();
  }
  if (tool === "archived") {
    if (!isBossOrAdmin()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
    setProductionNavigationState({ showArchived: !showArchivedProductionDuplicates });
    renderProductionJobs();
  }
  if (archiveGroupId) archiveProductionDuplicateGroupFromPanel(archiveGroupId, event.target);
}

function handleProductionToolsChange(event) {
  const mainKey = event.target.dataset.productionDuplicateMain;
  const groupId = event.target.dataset.productionDuplicateGroup;
  if (!mainKey || !groupId) return;
  productionDuplicateMainSelections.set(groupId, mainKey);
  renderProductionJobs();
  showWorkflowMessage("Main Production Job selected. Review the differences, then archive the other duplicates.", "info");
  setTimeout(() => document.querySelector?.(`[data-production-duplicate-group-card="${groupId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 25);
}

function handleProductionClick(event) {
  const printId = event.target.dataset.printProduction;
  const viewId = event.target.dataset.viewProduction;
  const markId = event.target.dataset.markProductionStatus;
  const restoreId = event.target.dataset.restoreProductionJob;
  if (printId) printProduction(printId);
  if (viewId) viewProductionJob(viewId);
  if (markId) markProductionStatus(markId, event.target.dataset.status);
  if (restoreId) restoreArchivedProductionJob(restoreId);
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

export async function markProductionStatus(jobId, status) {
  if (!canEditProduction()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const job = state.productionJobs.find((row) => row.id === jobId);
  if (!job || !status) return;
  if (isArchivedProductionJob(job)) return showWorkflowMessage("Restore this archived Production Job before changing its status.", "error");
  const normalizedStatus = normalizeProductionStatus(status, true);
  const previousState = snapshotOrderWorkflowState();
  const now = new Date().toISOString();
  state.productionJobs = state.productionJobs.map((row) => row.id === jobId ? { ...row, status: normalizedStatus, updatedAt: now } : row);
  state.orders = state.orders.map((order) => order.id === job.orderId ? {
    ...order,
    status: normalizedStatus === "completed" ? "Production Completed" : normalizedStatus === "in_production" ? "Sent to Production" : "Confirmed",
    sentToProduction: normalizedStatus !== "not_produced",
    productionStatus: normalizedStatus,
    productionJobId: job.id,
    updatedAt: now
  } : order);
  const localSave = persistOrderConversionLocally();
  if (!localSave.ok) {
    restoreConversionState(previousState);
    renderWorkflowModules();
    return showWorkflowMessage(`Failed to save Production status locally: ${localSave.reason}`, "error");
  }
  renderWorkflowModules();
  showWorkflowMessage("Production and Order status saved locally. Syncing cloud...", "info");
  try {
    const cloudSync = await syncOrderConversionCollections();
    if (!cloudSync.ok && !cloudSync.localOnly) {
      const message = `Production and Order status saved locally but cloud sync failed: ${cloudSync.reason}`;
      showWorkflowMessage(message, "warning");
      return { ok: true, status: normalizedStatus, cloudOk: false, message };
    }
    const message = normalizedStatus === "completed" ? "Production marked completed" : normalizedStatus === "in_production" ? "Production marked in progress" : "Production marked not started";
    showWorkflowMessage(message, "success");
    return { ok: true, status: normalizedStatus, cloudOk: !cloudSync.localOnly, localOnly: cloudSync.localOnly, message };
  } catch (error) {
    const message = `Production and Order status saved locally but cloud sync failed: ${error.message || "Unknown cloud error"}`;
    showWorkflowMessage(message, "warning");
    return { ok: true, status: normalizedStatus, cloudOk: false, message };
  }
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
  const viewWarrantyId = event.target.dataset.viewWarranty;
  const regenerateWarrantyId = event.target.dataset.regenerateWarranty;
  const printWarrantyCardId = event.target.dataset.printWarrantyCard;
  const closeWarrantyPreviewId = event.target.dataset.closeWarrantyPreview;
  const saveArrangementId = event.target.dataset.saveInstallationArrangement;
  const previewSendId = event.target.dataset.previewInstallationSend;
  const confirmSendId = event.target.dataset.confirmInstallationSend;
  const closeSendId = event.target.dataset.closeInstallationSend;
  const openRecallId = event.target.dataset.openInstallationRecall;
  const confirmRecallId = event.target.dataset.confirmInstallationRecall;
  const closeRecallId = event.target.dataset.closeInstallationRecall;
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
  if (saveArrangementId) saveInstallationArrangementFromPanel(saveArrangementId, event.target);
  if (previewSendId) previewInstallationDispatch(previewSendId);
  if (confirmSendId) confirmInstallationDispatch(confirmSendId, event.target);
  if (closeSendId) closeInstallationDispatchPreview();
  if (openRecallId) openInstallationRecall(openRecallId);
  if (confirmRecallId) confirmInstallationRecall(confirmRecallId, event.target);
  if (closeRecallId) closeInstallationRecall();
  if (warrantyId) generateWarrantyCard(warrantyId);
  if (viewWarrantyId) viewExistingWarrantyCard(viewWarrantyId);
  if (regenerateWarrantyId) generateWarrantyCard(regenerateWarrantyId, { regenerate: true });
  if (printWarrantyCardId) printWarrantyCardById(printWarrantyCardId);
  if (closeWarrantyPreviewId) closeWarrantyPreview();
}

function saveInstallationArrangementFromPanel(jobId, button) {
  const panel = button.closest("[data-installation-arrangement]");
  if (!panel) return failInstallationAction("Installation arrangement form is unavailable.");
  const read = (field) => panel.querySelector(`[data-arrangement-field="${field}"]`)?.value || "";
  saveInstallationArrangement(jobId, {
    installationDate: read("installationDate"),
    installationTime: read("installationTime"),
    assignedInstallerId: read("assignedInstallerId"),
    contactPerson: read("contactPerson"),
    phone: read("phone"),
    address: read("address"),
    installationRemarks: read("installationRemarks"),
    requiredItems: read("requiredItems")
  });
}

export async function saveInstallationArrangement(jobId, values = {}) {
  if (!canScheduleInstallation()) return failInstallationAction("Permission denied: only Boss, Admin or Secretary can arrange Installation.");
  const exactJobId = String(jobId || "").trim();
  const job = state.installationJobs.find((row) => String(row.id || "") === exactJobId);
  if (!exactJobId || !job || !isActiveWorkflowRecord(job)) return failInstallationAction("The exact active Installation stable ID was not found.");
  const stage = installationDispatchStage(job);
  if (["sent_to_installer", "completed"].includes(stage)) return failInstallationAction("Recall the Installation before changing an active dispatch. Completed records are read-only.");
  const assignedInstallerId = String(values.assignedInstallerId || "").trim();
  const installer = assignedInstallerId ? exactInstallerUser(assignedInstallerId) : null;
  if (assignedInstallerId && !installer) return failInstallationAction("The exact selected Installer staff/user ID was not found or is inactive.");
  const installationDate = String(values.installationDate || "").trim();
  const nextStatus = installationDate && assignedInstallerId ? "ready_to_send" : "pending_arrangement";
  const now = new Date().toISOString();
  const updatedJob = {
    ...job,
    installationDate,
    installationTime: String(values.installationTime || "").trim(),
    assignedInstallerId,
    assignedInstallerName: installer ? installer.name || installer.username || installer.userId : "",
    address: String(values.address || "").trim(),
    contactPerson: String(values.contactPerson || "").trim(),
    phone: String(values.phone || "").trim(),
    installationRemarks: String(values.installationRemarks || "").trim(),
    requiredItems: String(values.requiredItems || "").trim(),
    status: nextStatus,
    dispatchStatus: nextStatus === "ready_to_send" ? "ready" : "pending",
    arrangementUpdatedAt: now,
    arrangementUpdatedBy: currentActor(),
    updatedAt: now
  };
  const changes = [];
  recordFieldChanges(changes, "installationJobs", job, updatedJob);
  const order = state.orders.find((row) => String(row.id || "") === String(job.orderId || "") && isActiveOrderRecord(row));
  if (!order) return failInstallationAction("The exact related active Order could not be identified.");
  const updatedOrder = { ...order, installationDate, installationStatus: nextStatus, updatedAt: now };
  recordFieldChanges(changes, "orders", order, updatedOrder);
  const plan = installationMutationPlan("installation-arrangement", exactJobId, changes, {
    installationJobs: state.installationJobs.map((row) => String(row.id || "") === exactJobId ? updatedJob : row),
    orders: state.orders.map((row) => String(row.id || "") === String(order.id) ? updatedOrder : row)
  });
  const result = await commitOrderActionPlan(plan, {
    local: "Installation arrangement saved locally. Syncing cloud...",
    success: nextStatus === "ready_to_send" ? "Installation is Ready to Send. It is still hidden from Installer users." : "Installation saved as Pending Arrangement.",
    cloudFailure: "Installation arrangement saved locally but cloud sync failed"
  });
  return { ...result, jobId: exactJobId, status: nextStatus };
}

function previewInstallationDispatch(jobId) {
  const validation = validateInstallationDispatch(jobId);
  if (!validation.ok) return failInstallationAction(validation.message);
  installationDispatchPreviewId = String(jobId);
  installationRecallJobId = "";
  renderInstallationJobs();
}

function closeInstallationDispatchPreview() {
  installationDispatchPreviewId = "";
  renderInstallationJobs();
}

async function confirmInstallationDispatch(jobId, button) {
  if (installationDispatchPreviewId !== String(jobId)) return failInstallationAction("Review the Send to Installer summary first.");
  setOrderActionBusy(button, "Sending...");
  const result = await sendInstallationToInstaller(jobId);
  if (result.ok) installationDispatchPreviewId = "";
  renderInstallationJobs();
}

export async function sendInstallationToInstaller(jobId) {
  if (!canScheduleInstallation()) return failInstallationAction("Permission denied: only Boss, Admin or Secretary can send Installation.");
  const validation = validateInstallationDispatch(jobId);
  if (!validation.ok) return failInstallationAction(validation.message);
  const { job, order, installer } = validation;
  const now = new Date().toISOString();
  const actor = currentActor();
  const dispatchEvent = { action: "sent", at: now, by: actor, installerId: installer.userId, installerName: installer.name || installer.username || installer.userId };
  const updatedJob = {
    ...job,
    status: "sent_to_installer",
    dispatchStatus: "sent",
    assignedInstallerId: installer.userId,
    assignedInstallerName: installer.name || installer.username || installer.userId,
    sentAt: now,
    sentBy: actor,
    dispatchHistory: [...(Array.isArray(job.dispatchHistory) ? job.dispatchHistory : []), dispatchEvent],
    updatedAt: now
  };
  const updatedOrder = { ...order, installationDate: job.installationDate, installationStatus: "sent_to_installer", status: "Sent to Installer", updatedAt: now };
  const changes = [];
  recordFieldChanges(changes, "installationJobs", job, updatedJob);
  recordFieldChanges(changes, "orders", order, updatedOrder);
  const plan = installationMutationPlan("send-installation", job.id, changes, {
    installationJobs: state.installationJobs.map((row) => String(row.id) === String(job.id) ? updatedJob : row),
    orders: state.orders.map((row) => String(row.id) === String(order.id) ? updatedOrder : row)
  });
  const result = await commitOrderActionPlan(plan, {
    local: "Installation sent locally. Syncing cloud...",
    success: `Installation sent to ${updatedJob.assignedInstallerName}.`,
    cloudFailure: "Installation dispatch saved locally but cloud sync failed"
  });
  return { ...result, jobId: job.id, assignedInstallerId: installer.userId, status: "sent_to_installer" };
}

function validateInstallationDispatch(jobId) {
  const exactJobId = String(jobId || "").trim();
  const job = state.installationJobs.find((row) => String(row.id || "") === exactJobId);
  if (!exactJobId || !job) return { ok: false, message: "The exact Installation stable ID was not found." };
  if (!isActiveWorkflowRecord(job)) return { ok: false, message: "Archived or cancelled Installation records cannot be sent." };
  if (!String(job.installationDate || "").trim()) return { ok: false, message: "Select an installation date before sending." };
  const installer = exactInstallerUser(job.assignedInstallerId);
  if (!installer) return { ok: false, message: "Select an active Installer by exact staff/user ID before sending." };
  const order = state.orders.find((row) => String(row.id || "") === String(job.orderId || "") && isActiveOrderRecord(row));
  if (!order) return { ok: false, message: "The exact related active Order could not be identified." };
  if (installationDispatchStage(job) === "completed") return { ok: false, message: "Completed Installation records cannot be sent again." };
  return { ok: true, job, order, installer };
}

function openInstallationRecall(jobId) {
  if (!isBossOrAdmin()) return failInstallationAction("Permission denied: only Boss/Admin can recall an Installation.");
  const job = state.installationJobs.find((row) => String(row.id || "") === String(jobId || ""));
  if (!job || !isActiveWorkflowRecord(job) || String(job.status || "").toLowerCase() !== "sent_to_installer") return failInstallationAction("The exact sent Installation stable ID was not found.");
  installationRecallJobId = String(jobId);
  installationDispatchPreviewId = "";
  renderInstallationJobs();
}

function closeInstallationRecall() {
  installationRecallJobId = "";
  renderInstallationJobs();
}

function confirmInstallationRecall(jobId, button) {
  const reason = button.closest("[data-installation-recall-panel]")?.querySelector("[data-installation-recall-reason]")?.value || "";
  recallInstallationFromInstaller(jobId, reason).then((result) => {
    if (result.ok) installationRecallJobId = "";
    renderInstallationJobs();
  });
}

export async function recallInstallationFromInstaller(jobId, recallReason) {
  if (!isBossOrAdmin()) return failInstallationAction("Permission denied: only Boss/Admin can recall an Installation.");
  const exactJobId = String(jobId || "").trim();
  const reason = String(recallReason || "").trim();
  const job = state.installationJobs.find((row) => String(row.id || "") === exactJobId);
  if (!job || !isActiveWorkflowRecord(job) || String(job.status || "").toLowerCase() !== "sent_to_installer") return failInstallationAction("The exact sent Installation stable ID was not found.");
  if (!reason) return failInstallationAction("Enter a recall reason.");
  const now = new Date().toISOString();
  const actor = currentActor();
  const updatedJob = {
    ...job,
    status: "pending_arrangement",
    dispatchStatus: "recalled",
    recalledAt: now,
    recalledBy: actor,
    recallReason: reason,
    dispatchHistory: [...(Array.isArray(job.dispatchHistory) ? job.dispatchHistory : []), { action: "recalled", at: now, by: actor, reason, installerId: job.assignedInstallerId || "", installerName: job.assignedInstallerName || "" }],
    updatedAt: now
  };
  const order = state.orders.find((row) => String(row.id || "") === String(job.orderId || ""));
  const updatedOrder = order ? { ...order, installationStatus: "pending_arrangement", updatedAt: now } : null;
  const changes = [];
  recordFieldChanges(changes, "installationJobs", job, updatedJob);
  if (order) recordFieldChanges(changes, "orders", order, updatedOrder);
  const plan = installationMutationPlan("recall-installation", exactJobId, changes, {
    installationJobs: state.installationJobs.map((row) => String(row.id || "") === exactJobId ? updatedJob : row),
    orders: updatedOrder ? state.orders.map((row) => String(row.id || "") === String(order.id) ? updatedOrder : row) : state.orders
  });
  const result = await commitOrderActionPlan(plan, {
    local: "Installation recall saved locally. Syncing cloud...",
    success: "Installation recalled. It is hidden from Installer users until explicitly sent again.",
    cloudFailure: "Installation recall saved locally but cloud sync failed"
  });
  return { ...result, jobId: exactJobId, status: "pending_arrangement" };
}

function exactInstallerUser(installerId) {
  const exactId = String(installerId || "").trim();
  if (!exactId) return null;
  return state.users.find((user) => user.active !== false && normalizeText(user.role) === "installer" && String(user.userId || "") === exactId) || null;
}

function installationMutationPlan(action, jobId, changes, overrides = {}) {
  return {
    ok: true,
    action,
    jobId,
    orderId: "",
    changes,
    nextState: {
      quotations: state.quotations,
      orders: overrides.orders || state.orders,
      productionJobs: state.productionJobs,
      installationJobs: overrides.installationJobs || state.installationJobs,
      warrantyCards: overrides.warrantyCards || state.warrantyCards
    }
  };
}

function failInstallationAction(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
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

export function markInstallationStatus(jobId, status) {
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
  const job = state.installationJobs.find((row) => String(row.id || "") === String(jobId || ""));
  if (!job || !canCompleteInstallationJob(job)) return showWorkflowMessage("Permission denied or Installation is not assigned to this exact Installer.", "error");
  if (installationDispatchStage(job) !== "sent_to_installer") return showWorkflowMessage("Installation must be sent to the assigned Installer before completion.", "error");
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

async function saveInstallationCompletion(jobId) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job || !canCompleteInstallationJob(job) || installationDispatchStage(job) !== "sent_to_installer") return showWorkflowMessage("Permission denied or Installation is not ready for completion.", "error");
  const panel = document.querySelector(`[data-completion-panel="${jobId}"]`);
  const error = document.querySelector(`[data-completion-error="${jobId}"]`);
  if (!panel) return;

  const completionData = readCompletionForm(panel);
  const draft = {
    ...structuredCloneSafe(job),
    ...completionData.fields,
    checklist: completionData.checklist,
    balanceCollected: completionData.fields.balanceCollected === "true",
    touchUpRequired: completionData.fields.touchUpRequired === "true"
  };

  const signature = signatureDataUrl(jobId);
  const validationError = validateCompletion(draft, completionData, signature);
  if (validationError) {
    if (error) error.textContent = validationError;
    return;
  }

  const now = new Date().toISOString();
  draft.customerSignature = signature;
  draft.completionStatus = "Completed";
  draft.balanceToCollect = parseAmount(draft.balanceToCollect);
  draft.amountCollected = parseAmount(draft.amountCollected);
  if (draft.balanceCollected && draft.amountCollected < draft.balanceToCollect) draft.amountCollected = draft.balanceToCollect;
  draft.balance = Math.max(0, draft.balanceToCollect - draft.amountCollected);
  draft.statusBeforeCompletion = job.status;
  draft.completionOutcome = draft.touchUpRequired ? "touch_up" : draft.balance <= 0 ? "installed" : "pending_collection";
  draft.status = "completed";
  draft.dispatchStatus = "completed";
  draft.completedAt = draft.completionDate || now;
  draft.updatedAt = now;

  const order = findOrder(job.orderId);
  const updatedOrder = order ? {
    ...order,
    installationStatus: draft.completionOutcome,
    status: draft.completionOutcome === "touch_up" ? "Touch Up" : draft.completionOutcome === "installed" ? "Completed" : "Pending Collection",
    balance: draft.balance,
    updatedAt: now
  } : null;
  const changes = [];
  recordFieldChanges(changes, "installationJobs", job, draft);
  if (order) recordFieldChanges(changes, "orders", order, updatedOrder);
  const plan = installationMutationPlan("complete-installation", job.id, changes, {
    installationJobs: state.installationJobs.map((row) => row.id === job.id ? draft : row),
    orders: updatedOrder ? state.orders.map((row) => row.id === order.id ? updatedOrder : row) : state.orders
  });
  const result = await commitOrderActionPlan(plan, {
    local: "Installation completion saved locally. Syncing cloud...",
    success: draft.completionOutcome === "touch_up" ? "Installation completed with touch up required." : draft.completionOutcome === "installed" ? "Installation completed." : "Installation completed with pending collection.",
    cloudFailure: "Installation completion saved locally but cloud sync failed"
  });
  if (result.ok) activeCompletionJobId = null;
  renderWorkflowModules();
  return result;
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

async function markTouchUpCompleted(jobId) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job || !canCompleteInstallationJob(job)) return showWorkflowMessage("Permission denied or Installation is not assigned to this exact Installer.", "error");
  const order = findOrder(job.orderId);
  const remaining = getRemainingBalance(order || {}, job);
  const now = new Date().toISOString();
  const updatedJob = { ...job, touchUpStatus: "Completed", touchUpRequired: false, status: "completed", dispatchStatus: "completed", completionOutcome: remaining <= 0 ? "installed" : "pending_collection", balance: remaining, updatedAt: now };
  const updatedOrder = order ? { ...order, installationStatus: updatedJob.completionOutcome, status: remaining <= 0 ? "Completed" : "Pending Collection", balance: remaining, updatedAt: now } : null;
  const changes = [];
  recordFieldChanges(changes, "installationJobs", job, updatedJob);
  if (order) recordFieldChanges(changes, "orders", order, updatedOrder);
  const plan = installationMutationPlan("complete-installation-touch-up", job.id, changes, {
    installationJobs: state.installationJobs.map((row) => row.id === job.id ? updatedJob : row),
    orders: updatedOrder ? state.orders.map((row) => row.id === order.id ? updatedOrder : row) : state.orders
  });
  return commitOrderActionPlan(plan, { local: "Touch up completion saved locally. Syncing cloud...", success: "Touch up completed.", cloudFailure: "Touch up completion saved locally but cloud sync failed" });
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

export async function generateWarrantyCard(jobId, options = {}) {
  if (!canGenerateWarrantyCard()) return failInstallationAction("Permission denied: only Boss, Admin or Secretary can generate Warranty Cards.");
  const validation = validateWarrantyGeneration(jobId);
  if (!validation.ok) return failInstallationAction(validation.message);
  const { job, order } = validation;
  const existing = existingWarrantyForInstallation(job.id);
  if (existing && options.regenerate !== true) {
    warrantyPreviewCardId = String(existing.id);
    renderInstallationJobs();
    showWorkflowMessage(`Warranty already exists: ${existing.warrantyCardNo || existing.warrantyNo}. Use View Existing or Regenerate.`, "warning");
    return { ok: true, reused: true, card: existing, previewHtml: warrantyCardPreviewHtml(existing) };
  }

  const now = new Date().toISOString();
  const warrantyStartDate = String(job.completionDate || job.completedAt).slice(0, 10);
  const warrantyItems = (job.items || []).map((item) => warrantyItemFromInstallation(item, warrantyStartDate));
  const warrantyCardNo = existing?.warrantyCardNo || existing?.warrantyNo || nextWarrantyCardNumber();
  const card = {
    ...(existing || {}),
    id: existing?.id || uid("warranty"),
    warrantyCardNo,
    warrantyNo: warrantyCardNo,
    orderId: String(order.id),
    installationId: String(job.id),
    installationJobNo: job.installationNumber || "",
    customerName: order.customer?.name || job.customer?.name || "",
    customerPhone: order.customer?.phone || job.customer?.phone || job.phone || "",
    address: job.address || order.customer?.address || job.customer?.address || "",
    orderNo: getOrderDisplayNo(order),
    orderNumber: getOrderDisplayNo(order),
    quotationNo: order.quoteNumber || order.quotationNo || job.quoteNumber || job.quotationNo || "",
    quoteNumber: order.quoteNumber || order.quotationNo || job.quoteNumber || job.quotationNo || "",
    installationCompletedAt: job.completionDate || job.completedAt,
    warrantyStartDate,
    startDate: warrantyStartDate,
    warrantyExpiryDate: latestWarrantyExpiry(warrantyItems),
    warrantyItems,
    products: warrantyItems,
    terms: [...warrantyTerms],
    warrantyTerms: [...warrantyTerms],
    warrantyPeriod: warrantyItems.map((item) => `${item.productName}: ${item.warrantyPeriod}`).join(", "),
    generatedAt: now,
    generatedBy: currentActor(),
    updatedAt: now,
    status: "active",
    auditHistory: existing ? [...(Array.isArray(existing.auditHistory) ? existing.auditHistory : []), { action: "regenerated", at: now, by: currentActor(), previousGeneratedAt: existing.generatedAt || existing.createdAt || "", previousGeneratedBy: existing.generatedBy || "" }] : [],
    createdAt: existing?.createdAt || now
  };
  if (state.warrantyCards.some((row) => String(row.id || "") !== String(card.id) && normalizeRefNo(row.warrantyCardNo || row.warrantyNo) === normalizeRefNo(warrantyCardNo))) {
    return failInstallationAction("Warranty Card number conflict detected. No record was changed.");
  }
  const updatedJob = { ...job, warrantyNo: warrantyCardNo, warrantyCardId: card.id, updatedAt: now };
  const changes = [];
  recordFieldChanges(changes, "warrantyCards", existing || {}, card);
  recordFieldChanges(changes, "installationJobs", job, updatedJob);
  const nextWarranties = existing
    ? state.warrantyCards.map((row) => String(row.id) === String(existing.id) ? card : row)
    : [card, ...state.warrantyCards];
  const plan = installationMutationPlan(existing ? "regenerate-warranty-card" : "generate-warranty-card", job.id, changes, {
    installationJobs: state.installationJobs.map((row) => String(row.id) === String(job.id) ? updatedJob : row),
    warrantyCards: nextWarranties
  });
  const result = await commitOrderActionPlan(plan, {
    local: "Warranty Card saved locally. Syncing cloud...",
    success: `${existing ? "Warranty Card regenerated" : "Warranty Card generated"}: ${warrantyCardNo}`,
    cloudFailure: "Warranty Card saved locally but cloud sync failed"
  });
  if (result.ok) {
    warrantyPreviewCardId = String(card.id);
    renderInstallationJobs();
  }
  return { ...result, card, regenerated: Boolean(existing), previewHtml: warrantyCardPreviewHtml(card) };
}

function validateWarrantyGeneration(jobId) {
  const exactJobId = String(jobId || "").trim();
  const job = state.installationJobs.find((row) => String(row.id || "") === exactJobId);
  if (!exactJobId || !job || !isActiveWorkflowRecord(job)) return { ok: false, message: "The exact active Installation stable ID was not found." };
  if (!isCompletedInstallation(job)) return { ok: false, message: "Complete the Installation before generating a Warranty Card." };
  const order = state.orders.find((row) => String(row.id || "") === String(job.orderId || "") && isActiveOrderRecord(row));
  if (!order) return { ok: false, message: "The exact related active Order could not be identified." };
  if (!String(order.customer?.name || job.customer?.name || "").trim()) return { ok: false, message: "Customer name is required for the Warranty Card." };
  if (!String(job.completionDate || job.completedAt || "").trim()) return { ok: false, message: "Installation completion date is required for the Warranty Card." };
  if (!Array.isArray(job.items) || !job.items.length || job.items.some((item) => !String(item.productName || "").trim())) return { ok: false, message: "Installed product and warranty information is required for the Warranty Card." };
  return { ok: true, job, order };
}

function isCompletedInstallation(job = {}) {
  const status = String(job.status || "").trim().toLowerCase();
  return status === "completed" || (job.completionStatus === "Completed" && ["installed", "pending_collection", "touch_up"].includes(status));
}

function existingWarrantyForInstallation(installationId) {
  const exactId = String(installationId || "").trim();
  if (!exactId) return null;
  return state.warrantyCards.find((card) => card.status !== "deleted" && String(card.installationId || "") === exactId) || null;
}

export function nextWarrantyCardNumber(date = new Date()) {
  const prefix = `WC-${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}-`;
  const used = new Set(state.warrantyCards.map((card) => normalizeRefNo(card.warrantyCardNo || card.warrantyNo)).filter(Boolean));
  const highest = [...used].filter((number) => number.startsWith(prefix)).map((number) => Number(number.slice(prefix.length))).filter(Number.isInteger).reduce((max, number) => Math.max(max, number), 0);
  let sequence = highest + 1;
  let candidate = `${prefix}${String(sequence).padStart(4, "0")}`;
  while (used.has(candidate)) {
    sequence += 1;
    candidate = `${prefix}${String(sequence).padStart(4, "0")}`;
  }
  return candidate;
}

function warrantyItemFromInstallation(item, warrantyStartDate) {
  const configuredProduct = item.productId ? productById(item.productId) : null;
  const warrantyPeriod = String(item.warrantyPeriod || configuredProduct?.warrantyPeriod || warrantyPeriodForProduct(item.productName)).trim();
  return {
    productId: item.productId || "",
    productName: item.productName,
    meshType: meshValue(item),
    quantity: item.quantity || 0,
    warrantyPeriod,
    warrantyStartDate,
    warrantyExpiryDate: warrantyExpiryFromPeriod(warrantyStartDate, warrantyPeriod)
  };
}

function warrantyExpiryFromPeriod(startDate, period) {
  const years = Math.max(1, Number.parseInt(String(period || "1"), 10) || 1);
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function latestWarrantyExpiry(items) {
  return items.map((item) => item.warrantyExpiryDate).filter(Boolean).sort().at(-1) || "";
}

function viewExistingWarrantyCard(cardId) {
  if (!canGenerateWarrantyCard()) return failInstallationAction("Permission denied: only Boss, Admin or Secretary can view Warranty Cards.");
  const card = state.warrantyCards.find((row) => String(row.id || "") === String(cardId || ""));
  if (!card) return failInstallationAction("The exact Warranty Card stable ID was not found.");
  warrantyPreviewCardId = String(card.id);
  renderInstallationJobs();
  showWorkflowMessage(`Warranty Card opened: ${card.warrantyCardNo || card.warrantyNo}`, "success");
}

function closeWarrantyPreview() {
  warrantyPreviewCardId = "";
  renderInstallationJobs();
}

export function warrantyCardPreviewHtml(card = {}) {
  const items = Array.isArray(card.warrantyItems) ? card.warrantyItems : Array.isArray(card.products) ? card.products : [];
  const terms = Array.isArray(card.terms) ? card.terms : Array.isArray(card.warrantyTerms) ? card.warrantyTerms : [];
  return `<section class="warranty-card-preview" data-warranty-preview="${escapeHtml(card.id || "")}">
    <div class="section-head"><div><p class="eyebrow">Eco Screen Warranty</p><h3>${escapeHtml(card.warrantyCardNo || card.warrantyNo || "Warranty Card")}</h3></div><button class="btn" type="button" data-close-warranty-preview="${escapeHtml(card.id || "")}">Close</button></div>
    <div class="warranty-company"><strong>${escapeHtml(state.companySettings.companyName || "Eco Screen")}</strong><span>0195763499</span></div>
    <div class="installation-assigned-summary"><span>Customer<strong>${escapeHtml(card.customerName || card.customer?.name || "-")}</strong></span><span>Phone<strong>${escapeHtml(card.customerPhone || card.customer?.phone || "-")}</strong></span><span>Address<strong>${escapeHtml(card.address || card.customer?.address || "-")}</strong></span><span>Quotation<strong>${escapeHtml(card.quotationNo || card.quoteNumber || "-")}</strong></span><span>SO Number<strong>${escapeHtml(card.orderNo || "-")}</strong></span><span>Completion Date<strong>${escapeHtml(card.installationCompletedAt || "-")}</strong></span><span>Warranty Start<strong>${escapeHtml(card.warrantyStartDate || card.startDate || "-")}</strong></span><span>Warranty Expiry<strong>${escapeHtml(card.warrantyExpiryDate || "-")}</strong></span><span>Generated At<strong>${escapeHtml(card.generatedAt || card.createdAt || "-")}</strong></span><span>Generated By<strong>${escapeHtml(card.generatedBy || "-")}</strong></span></div>
    <div class="table-wrap"><table><thead><tr><th>Installed Product</th><th>Quantity</th><th>Warranty Period</th><th>Start</th><th>Expiry</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.productName || "-")}</td><td>${escapeHtml(item.quantity || "-")}</td><td>${escapeHtml(item.warrantyPeriod || "-")}</td><td>${escapeHtml(item.warrantyStartDate || card.warrantyStartDate || "-")}</td><td>${escapeHtml(item.warrantyExpiryDate || "-")}</td></tr>`).join("")}</tbody></table></div>
    <div class="terms"><h4>Warranty Terms</h4>${terms.map((term) => `<p>${escapeHtml(term)}</p>`).join("")}</div>
    <button class="btn primary" type="button" data-print-warranty-card="${escapeHtml(card.id || "")}">Download / Print Warranty Card</button>
    <p class="muted-text">This inline preview remains available when a mobile browser blocks new tabs.</p>
  </section>`;
}

function printWarrantyCardById(cardId) {
  const card = state.warrantyCards.find((row) => String(row.id || "") === String(cardId || ""));
  if (!card) return failInstallationAction("The exact Warranty Card stable ID was not found.");
  const preview = warrantyCardPreviewHtml(card);
  openPrint(t("Warranty Card"), card.warrantyCardNo || card.warrantyNo, preview);
  showWorkflowMessage(`Warranty Card ready to print/download: ${card.warrantyCardNo || card.warrantyNo}`, "success");
  return { ok: true, cardId: card.id };
}

function warrantyPeriodForProduct(productName = "") {
  const name = productName.toLowerCase();
  if (name.includes("security mesh")) return "10 years";
  if (name.includes("roller") || name.includes("invisible")) return "3 years";
  return "1 year";
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

function viewProductionJob(id) {
  const job = state.productionJobs.find((row) => row.id === id);
  if (!job) return showWorkflowMessage("Production job not found.", "error");
  const order = linkedOrderForProduction(job);
  const orderNumber = productionOrderNumber(job);
  let dialog = document.querySelector("#productionDetailDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "productionDetailDialog";
    dialog.className = "detail-dialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `
    <div class="section-head"><div><p class="eyebrow">${t("View Production Job")}</p><h2>${escapeHtml(orderNumber)}</h2></div><button class="btn" type="button" data-close-production-dialog>${t("Close")}</button></div>
    ${!order && isBossOrAdmin() ? `<p class="warning-text"><strong>Linked Order record is missing.</strong> Production job ID: ${escapeHtml(job.id || "-")}</p>` : ""}
    <p><strong>${t("Customer Name")}:</strong> ${escapeHtml(order?.customer?.name || order?.customerName || job.customerName || "-")}</p>
    <p><strong>${t("Quote")}:</strong> ${escapeHtml(job.quoteNumber || job.quotationNo || "-")}</p>
    <p><strong>${t("Installation Date")}:</strong> ${escapeHtml(job.installationDate || "-")}</p>
    <p><strong>${t("Production Status")}:</strong> ${statusLabel(job.status)}</p>
    <p><strong>${t("Production Remark")}:</strong> ${escapeHtml(job.remark || "-")}</p>
    ${itemsSummary(job.items || [])}
    ${isBossOrAdmin() ? `<details class="internal-details"><summary>Internal Details</summary><p>Production Job ID: ${escapeHtml(job.id || "-")}</p><p>ESP reference: ${escapeHtml(job.productionNumber || "-")}</p></details>` : ""}
  `;
  dialog.querySelector("[data-close-production-dialog]")?.addEventListener("click", () => dialog.close());
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function printProduction(id) {
  const exactJobId = String(id || "");
  const job = state.productionJobs.find((row) => String(row.id || "") === exactJobId);
  if (!job) return;
  const order = linkedOrderForProduction(job);
  if (!order || String(order.id || "") !== String(job.orderId || "")) {
    return showWorkflowMessage("The exact active Order linked to this Production Job was not found. Printing is blocked.", "error");
  }
  openProductionSheetPrint(job, order);
}

export function productionSheetPrintHtml(job = {}, order = {}, company = state.companySettings) {
  const items = Array.isArray(job.items) && job.items.length ? job.items : Array.isArray(order.items) ? order.items : [];
  const orderNumber = getOrderDisplayNo(order) || "-";
  const quotationNumber = job.quoteNumber || job.quotationNo || order.quoteNumber || order.quotationNo || "-";
  const customerName = order.customer?.name || order.customerName || job.customerName || "-";
  const installationDate = job.installationDate || order.installationDate || "-";
  return `
    <article class="production-sheet" data-production-job-id="${escapeHtml(job.id || "")}" data-order-id="${escapeHtml(order.id || "")}">
      <header class="production-sheet-header">
        <div class="production-sheet-company">
          <h1>${escapeHtml(company.companyName || "Eco Screen Sdn Bhd")}</h1>
          <p>24 Jalan Iks Bukit Tengah,<br />Taman Iks Bukit Tengah,<br />14000 Bukit Mertajam</p>
          <p>Tel: ${escapeHtml(company.companyPhone || "0195763499")}</p>
        </div>
        <div class="production-sheet-title">
          <p>打印生产单 / Production Sheet</p>
          <h2>Order No: ${escapeHtml(orderNumber)}</h2>
        </div>
      </header>
      <section class="production-sheet-meta" aria-label="Production details">
        <div><span>顾客名字 / Customer Name</span><strong>${escapeHtml(customerName)}</strong></div>
        <div><span>报价 / Quotation No</span><strong>${escapeHtml(quotationNumber)}</strong></div>
        <div><span>安装日期 / Installation Date</span><strong>${escapeHtml(installationDate)}</strong></div>
        <div><span>生产状态 / Production Status</span><strong>${escapeHtml(statusLabel(job.status))}</strong></div>
      </section>
      <table class="production-sheet-table" aria-label="Production items">
        <colgroup>
          <col class="production-col-product" /><col class="production-col-location" /><col class="production-col-size" />
          <col class="production-col-quantity" /><col class="production-col-color" /><col class="production-col-method" />
          <col class="production-col-opening" /><col class="production-col-track-size" /><col class="production-col-handle-height" />
          <col class="production-col-handle-position" /><col class="production-col-track-type" /><col class="production-col-mesh" />
          <col class="production-col-lock" /><col class="production-col-remark" />
        </colgroup>
        <thead><tr>
          <th>产品 / Product</th><th>安装位置 / Installation Location</th><th>Size</th><th>数量 / Quantity</th>
          <th>颜色 / Color</th><th>安装方式 / Installation Method</th><th>开向 / Opening Direction</th>
          <th>轨道尺寸 / Track Size</th><th>把手高度 / Handle Height</th><th>把手位置 / Handle Position</th>
          <th>Track Type</th><th>网布类型 / Mesh Type</th><th>锁 / Lock</th><th>备注 / Remark</th>
        </tr></thead>
        <tbody>${items.length ? items.map((item) => productionSheetItemRow(item)).join("") : `<tr data-production-item-row><td colspan="14">No product items</td></tr>`}</tbody>
      </table>
      <footer class="production-sheet-footer">
        <div class="production-sheet-remark"><span>生产备注 / Production Remark</span><strong>${escapeHtml(job.remark || "-")}</strong></div>
        <div class="production-sheet-signatures"><span>Prepared by</span><span>Checked by</span></div>
      </footer>
    </article>
  `;
}

function productionSheetItemRow(item = {}) {
  const lock = item.lock || item.lockType || item.lockOption || item.lockRemark || "-";
  return `<tr data-production-item-row>
    <td>${escapeHtml(item.productName || "-")}</td><td>${escapeHtml(item.installationLocation || "-")}</td>
    <td>${escapeHtml(`${item.width || 0} x ${item.height || 0}`)}</td><td>${escapeHtml(item.quantity || 0)}</td>
    <td>${escapeHtml(item.color || "-")}</td><td>${escapeHtml(item.installType || "-")}</td>
    <td>${escapeHtml(item.openingDirection || "-")}</td><td>${escapeHtml(item.trackSize || "-")}</td>
    <td>${escapeHtml(item.handleHeight || "-")}</td><td>${escapeHtml(item.handlePosition || "-")}</td>
    <td>${escapeHtml(item.trackType || item.trackOpening || "-")}</td><td>${escapeHtml(meshValue(item) || "-")}</td>
    <td>${escapeHtml(lock)}</td><td>${escapeHtml(item.remark || "-")}</td>
  </tr>`;
}

function openProductionSheetPrint(job, order) {
  const area = document.querySelector("#workflowPrintArea");
  if (!area) return showWorkflowMessage("Production Sheet print area is unavailable.", "error");
  area.className = "print-area workflow-print-area production-sheet-print-area";
  area.innerHTML = productionSheetPrintHtml(job, order);
  document.body.classList.add("workflow-print-mode", "production-sheet-print-mode");
  const cleanup = () => {
    document.body.classList.remove("workflow-print-mode", "production-sheet-print-mode");
    area.className = "print-area workflow-print-area";
    window.removeEventListener?.("afterprint", cleanup);
  };
  window.addEventListener?.("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 2000);
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
  const paymentSummary = getOrderPaymentSummary(order);
  return `<div class="print-totals">
    <div><span>${t("Subtotal")}</span><strong>${money(order.subtotal)}</strong></div>
    <div><span>${t("Discount")}</span><strong>${money(order.discount)}</strong></div>
    <div><span>${t("Total")}</span><strong>${money(order.total)}</strong></div>
    <div><span>${t("Deposit")}</span><strong>${money(order.deposit)}</strong></div>
    <div><span>Total Paid</span><strong>${money(paymentSummary.totalPaid)}</strong></div>
    <div><span>${t("Balance")}</span><strong>${money(paymentSummary.balance)}</strong></div>
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
