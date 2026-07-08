import {
  nextInstallationNumber,
  nextProductionNumber,
  nextWarrantyNumber,
  persistQuotations,
  persistInstallationJobs,
  persistOrders,
  persistProductionJobs,
  persistWarrantyCards,
  state,
  uid
} from "./state.js";
import {
  autoCalculatedPrice,
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
  canDeleteOrders,
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
let orderActionRunning = false;
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

export function convertQuoteToOrder(quoteId) {
  try {
    const quote = getQuoteById(quoteId);
    const validation = validateQuoteForOrder(quote);
    if (!validation.ok) return failConversion(validation.message);
    const quoteDisplayNo = ensureQuotationDisplayNo(quote);

    const existing = findExistingOrderForQuote(quote);
    const order = existing ? updateOrderFromQuote(existing, quote) : createOrderFromQuote(quote);
    if (!order) return failConversion("Failed to save order.");

    state.orders = existing
      ? state.orders.map((row) => row.id === existing.id ? order : row)
      : [order, ...state.orders];

    upsertWorkflowJobsForOrder(order);
    updateWarrantyOrderNumbers(order);

    quote.status = "won";
    quote.quoteNumber = quoteDisplayNo;
    quote.quotationNo = quoteDisplayNo;
    quote.quoteNo = quoteDisplayNo;
    quote.orderId = order.id;
    quote.orderNo = getOrderDisplayNo(order);
    quote.orderNumber = getOrderDisplayNo(order);
    quote.converted = true;
    quote.convertedToOrder = true;
    quote.convertedAt = new Date().toISOString();
    quote.updatedAt = new Date().toISOString();

    const cloudSaves = [
      persistOrders(),
      persistProductionJobs(),
      persistInstallationJobs(),
      persistWarrantyCards(),
      persistQuotations()
    ];
    Promise.all(cloudSaves).then((results) => {
      const failed = results.find((result) => result && !result.ok && result.reason !== "Local Mode Only");
      if (failed) showWorkflowMessage("Order saved locally but cloud sync failed", "warning");
    }).catch((error) => {
      console.error("Convert to Order cloud sync failed", error);
      showWorkflowMessage("Order saved locally but cloud sync failed", "warning");
    });

    const message = existing
      ? `Order updated successfully. Order No: ${getOrderDisplayNo(order)}`
      : `Order created successfully. Order No: ${getOrderDisplayNo(order)}`;
    showWorkflowMessage(message, "success");
    orderSearch = { ...orderSearch, orderNumber: getOrderDisplayNo(order), filter: "all", highlightId: order.id };
    renderWorkflowModules();
    scrollToOrders();
    return { ok: true, message, order, updated: Boolean(existing) };
  } catch (error) {
    console.error("Convert to Order failed", error);
    return failConversion(`Unknown error: ${error.message || "Failed to save order."}`);
  }
}

export function getQuoteById(quoteId) {
  return state.quotations.find((row) => row.id === quoteId || getQuotationDisplayNo(row) === quoteId) || null;
}

export function createOrderFromQuote(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const displayNo = ensureQuotationDisplayNo(quote);
  return {
    id: uid("order"),
    orderNo: displayNo,
    orderNumber: displayNo,
    quoteId: quote.id,
    quotationId: quote.id,
    quoteNumber: displayNo,
    quotationNo: displayNo,
    customer: { ...quote.customer },
    items: quote.items.map((item) => ({ ...itemWithCalculatedTotals(item) })),
    subtotal: totals.subtotal,
    discount: Number(quote.discount || 0),
    total: totals.total,
    deposit: Number(quote.deposit || 0),
    balance: totals.balance,
    status: "Confirmed",
    sentToProduction: false,
    productionStatus: "not_produced",
    installationStatus: "not_scheduled",
    installationDate: quote.appointmentDate || "",
    remark: quote.remark || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function updateOrderFromQuote(existingOrder, quote) {
  const latest = createOrderFromQuote(quote);
  const existingSentToProduction = existingOrder.sentToProduction === true
    || ["Sent to Production", "In Production", "Production Completed"].includes(existingOrder.status)
    || !["not_produced", "", undefined, null].includes(existingOrder.productionStatus);
  const existingInstallationStarted = !["not_scheduled", "", undefined, null].includes(existingOrder.installationStatus)
    || ["Sent to Installer", "Installation Scheduled", "Installing", "Installation Completed", "Pending Collection", "Completed", "Serviced"].includes(existingOrder.status);
  return {
    ...existingOrder,
    ...latest,
    id: existingOrder.id,
    quoteId: quote.id,
    quotationId: quote.id,
    orderNo: latest.orderNo,
    orderNumber: latest.orderNumber,
    quoteNumber: latest.quoteNumber,
    createdAt: existingOrder.createdAt || latest.createdAt,
    status: existingInstallationStarted || existingSentToProduction ? existingOrder.status : "Confirmed",
    sentToProduction: existingSentToProduction ? true : latest.sentToProduction,
    productionStatus: existingSentToProduction ? existingOrder.productionStatus : latest.productionStatus,
    installationStatus: existingInstallationStarted ? existingOrder.installationStatus : latest.installationStatus,
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
    customerName: order.customer.name,
    items: order.items.map((item) => itemWithCalculatedTotals(item)),
    installationDate: order.installationDate || "",
    status: order.sentToProduction ? "in_production" : "not_produced",
    remark: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function upsertWorkflowJobsForOrder(order) {
  const orderNo = getOrderDisplayNo(order);
  const productionJob = state.productionJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo));
  if (productionJob) {
    productionJob.orderId = order.id;
    productionJob.orderNo = orderNo;
    productionJob.orderNumber = orderNo;
    productionJob.customerName = order.customer.name;
    productionJob.items = order.items.map((item) => itemWithCalculatedTotals(item));
    productionJob.installationDate = order.installationDate || productionJob.installationDate || "";
    productionJob.updatedAt = new Date().toISOString();
  } else {
    state.productionJobs = [createProductionJobFromOrder(order), ...state.productionJobs];
  }

  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || normalizeRefNo(job.orderNumber || job.orderNo) === normalizeRefNo(orderNo));
  if (installationJob) {
    installationJob.orderId = order.id;
    installationJob.orderNo = orderNo;
    installationJob.orderNumber = orderNo;
    installationJob.customer = { ...order.customer };
    installationJob.items = order.items.map((item) => itemWithCalculatedTotals(item));
    installationJob.installationDate = order.installationDate || installationJob.installationDate || "";
    installationJob.balance = order.balance;
    installationJob.balanceToCollect = order.balance;
    installationJob.updatedAt = new Date().toISOString();
  } else {
    state.installationJobs = [createInstallationJobFromOrder(order), ...state.installationJobs];
  }
}

function updateWarrantyOrderNumbers(order) {
  const orderNo = getOrderDisplayNo(order);
  state.warrantyCards = state.warrantyCards.map((card) => {
    const sameOrder = card.orderId === order.id || normalizeRefNo(card.orderNo || card.orderNumber) === normalizeRefNo(orderNo);
    if (!sameOrder) return card;
    return {
      ...card,
      orderId: order.id,
      orderNo,
      orderNumber: orderNo,
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

function failConversion(message) {
  console.error("Convert to Order:", message);
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

function validateQuoteForOrder(quote) {
  if (!quote) return { ok: false, message: "Please save quotation first" };
  if (!String(quote.customer?.name || "").trim()) return { ok: false, message: "Missing customer name" };
  if (!String(quote.customer?.phone || "").trim()) return { ok: false, message: "Missing phone number" };
  if (!Array.isArray(quote.items) || !quote.items.length) return { ok: false, message: "Missing quotation items" };
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  const total = toNumber(quote.total || totals.total);
  if (total <= 0) return { ok: false, message: "Quote total must be more than 0" };
  quote.status = normalizeStatus(quote.status);
  return { ok: true };
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

function findExistingOrderForQuote(quote) {
  const quoteNo = normalizeRefNo(getQuotationDisplayNo(quote));
  return state.orders.find((order) => {
    const sameQuoteId = quote.id && (order.quoteId === quote.id || order.quotationId === quote.id);
    const orderNo = normalizeRefNo(order.orderNo || order.orderNumber);
    const orderQuoteNo = normalizeRefNo(order.quoteNumber || order.quotationNo || order.quoteNo);
    const sameDisplayNo = quoteNo && ((orderNo && orderNo === quoteNo) || (orderQuoteNo && orderQuoteNo === quoteNo));
    return sameQuoteId || sameDisplayNo;
  }) || null;
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
  tools.innerHTML = `
    <section class="order-tools">
      <div class="form-grid compact">
        <label>${t("Search Order Number")}<input data-order-search="orderNumber" value="${orderSearch.orderNumber}" placeholder="ESO-2026-0001 or 0001" /></label>
        <label>${t("Search Customer Name")}<input data-order-search="customerName" value="${orderSearch.customerName}" placeholder="Customer name" /></label>
        <label>${t("Search Phone Number")}<input data-order-search="phone" value="${orderSearch.phone}" placeholder="0123456789" /></label>
        <label>${t("Status")}<select data-order-search="status"><option value="">All status</option>${orderFilters.map((filter) => `<option value="${filter.id}" ${orderSearch.status === filter.id ? "selected" : ""}>${t(filter.label)}</option>`).join("")}</select></label>
        <label>${t("Installation Date")}<input type="date" data-order-search="installationDate" value="${orderSearch.installationDate}" /></label>
        <label>Sort by<select data-order-search="sort">
          ${[["updated", "Latest Updated"], ["installationDate", "Installation Date"], ["orderNumber", "Order Number"]].map(([value, label]) => `<option value="${value}" ${orderSearch.sort === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" data-order-tool="search">${t("Search")}</button>
        <button class="btn" type="button" data-order-tool="clear">${t("Clear Search")}</button>
        <button class="btn" type="button" data-order-tool="find">${t("Find Order")}</button>
      </div>
      <div class="filter-tabs">
        ${orderFilters.map((filter) => `<button class="filter-tab ${orderSearch.filter === filter.id ? "active" : ""}" type="button" data-order-filter="${filter.id}">${t(filter.label)}</button>`).join("")}
      </div>
    </section>
  `;
}

function renderCompactOrderRow(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="compact-order-row ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      <div><strong>${order.orderNumber}</strong><span>${order.customer?.name || "-"} | ${order.customer?.phone || "-"}</span></div>
      <div><span>${order.customer?.area || "-"}</span><span>${order.installationDate || installationJob?.installationDate || "-"}</span></div>
      <div><span>${t("Production")}: ${statusLabel(getOrderProductionStatus(order, productionJob))}</span><span>${t("Installation")}: ${statusLabel(getOrderInstallationStatus(order, installationJob))}</span></div>
      <div><span>${t("Remaining Balance")}: ${money(getRemainingBalance(order, installationJob))}</span><span>Updated: ${formatShortDate(order.updatedAt || order.createdAt)}</span></div>
      ${orderActionsHtml(order)}
    </article>
  `;
}

function orderActionsHtml(order) {
  return `
    <div class="actions">
      <button class="btn" type="button" data-view-order="${order.id}">${t("View Order")}</button>
      <button class="btn primary" type="button" data-print-order="${order.id}">${t("Print Order")}</button>
      ${canSendOrder() ? `<button class="btn" type="button" data-send-production="${order.id}">${t("Send to Production")}</button><button class="btn" type="button" data-send-installer="${order.id}">${t("Send to Installer")}</button><button class="btn" type="button" data-update-order-status="${order.id}">${t("Update Status")}</button>` : ""}
      <button class="btn" type="button" data-whatsapp-order="${order.id}">${t("WhatsApp Customer")}</button>
      <button class="btn" type="button" data-highlight-order="${order.id}">${t("Search / Open Customer")}</button>
      ${canDeleteOrders() ? `<button class="btn danger" type="button" data-delete-order="${order.id}">${t("Delete Order")}</button>` : ""}
    </div>
  `;
}

function renderOrderProgressCard(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="progress-card ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      <strong>${order.orderNumber}</strong>
      <p class="muted-text">${t("Quote")}: ${order.quoteNumber || "-"}</p>
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
  const orderNumber = normalizeText(order.orderNumber);
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
  if (["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return matchesBoardDateFilter(order);
  if (orderSearch.filter === "active") return !["archived", "completed"].includes(getOrderProgressCategory(order));
  return getOrderProgressCategory(order) === orderSearch.filter;
}

function matchesProgressFilter(categoryId, order) {
  if (orderSearch.filter === "all") return true;
  if (["today-installation", "week-installation", "overdue-installation"].includes(orderSearch.filter)) return matchesBoardDateFilter(order);
  if (orderSearch.filter === "active") return categoryId !== "archived" && categoryId !== "completed";
  return categoryId === orderSearch.filter;
}

function sortedOrders(rows) {
  return [...rows].sort((a, b) => {
    if (orderSearch.sort === "installationDate") return String(a.installationDate || "").localeCompare(String(b.installationDate || ""));
    if (orderSearch.sort === "orderNumber") return String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""));
    return Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0);
  });
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function getOrderProductionJob(order) {
  return state.productionJobs.find((job) => job.orderId === order.id || job.orderNumber === order.orderNumber) || null;
}

function getOrderInstallationJob(order) {
  return state.installationJobs.find((job) => job.orderId === order.id || job.orderNumber === order.orderNumber) || null;
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
          <p class="muted-text">${t("Order")}: ${job.orderNumber} | ${job.customerName || "-"}</p>
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
          <p class="muted-text">${t("Order")}: ${job.orderNumber} | ${job.customer.name || "-"}</p>
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
  const deleteId = event.target.dataset.deleteOrder;
  const whatsappId = event.target.dataset.whatsappOrder;
  const highlightId = event.target.dataset.highlightOrder;
  if (page) {
    orderSearch = { ...orderSearch, page: Number(page) || 1 };
    renderOrderList();
  }
  if (printId) printOrder(printId);
  if (viewId) printOrder(viewId);
  if (sendProductionId) sendOrderToProduction(sendProductionId);
  if (sendInstallerId) sendOrderToInstaller(sendInstallerId);
  if (updateStatusId) updateOrderStatus(updateStatusId);
  if (deleteId) deleteOrderFlow(deleteId);
  if (whatsappId) whatsappOrderCustomer(whatsappId);
  if (highlightId) highlightOrder(highlightId);
}

function handleOrderChange(event) {
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
}

function quickFindOrder() {
  const value = window.prompt("Enter order number");
  if (value === null) return;
  const order = state.orders.find((row) => normalizeText(row.orderNumber).includes(normalizeText(value)));
  if (!order) {
    showWorkflowMessage("Order not found", "error");
    return;
  }
  orderSearch = { ...orderSearch, orderNumber: value, filter: "all", highlightId: order.id };
  renderOrders();
  setTimeout(() => document.querySelector(`[data-order-card="${order.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  showWorkflowMessage(`Order found: ${order.orderNumber}`, "success");
}

function highlightOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return;
  orderSearch = {
    ...orderSearch,
    orderNumber: order.orderNumber,
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
  const text = encodeURIComponent(`Hi ${order.customer?.name || ""}, this is Eco Screen. Your order ${order.orderNumber} is currently ${order.status || "in progress"}. Thank you.`);
  window.open(`https://wa.me/6${phone.replace(/^6/, "")}?text=${text}`, "_blank", "noopener");
}

function updateOrderStatus(orderId) {
  const order = findOrder(orderId);
  if (!order) return;
  persistOrders();
  renderOrders();
  showWorkflowMessage(`Order status updated: ${order.status}`, "success");
}

function deleteOrderFlow(orderId) {
  if (orderActionRunning) return showWorkflowMessage("Another order action is running. Please wait.", "warning");
  if (!canDeleteOrders()) return showWorkflowMessage("Permission denied: your role cannot perform this action.", "error");
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const confirmed = window.confirm("Are you sure you want to delete this order? This will also affect related production and installation jobs.");
  if (!confirmed) return;
  const action = window.prompt("Type ARCHIVE to archive/cancel this order, or DELETE for permanent delete.");
  if (action === null) return;
  const normalized = action.trim().toUpperCase();
  if (normalized === "ARCHIVE") archiveOrder(orderId);
  else if (normalized === "DELETE") permanentDeleteOrder(orderId);
  else showWorkflowMessage("Delete cancelled. Type ARCHIVE or DELETE.", "warning");
}

function archiveOrder(orderId) {
  orderActionRunning = true;
  try {
    const order = findOrder(orderId);
    if (!order) return;
    const reason = window.prompt("Cancel reason / archive note", "") || "";
    const now = new Date().toISOString();
    Object.assign(order, {
      status: "Cancelled",
      isArchived: true,
      archivedAt: now,
      cancelReason: reason,
      updatedAt: now
    });
    state.productionJobs = state.productionJobs.map((job) => job.orderId === order.id && job.status !== "Completed" ? { ...job, status: "Cancelled", updatedAt: now } : job);
    state.installationJobs = state.installationJobs.map((job) => job.orderId === order.id && job.status !== "Completed" ? { ...job, status: "Cancelled", updatedAt: now } : job);
    persistOrders();
    persistProductionJobs();
    persistInstallationJobs();
    orderSearch = { ...orderSearch, filter: "archived", highlightId: order.id };
    renderWorkflowModules();
    showWorkflowMessage("Order archived / cancelled", "success");
  } finally {
    orderActionRunning = false;
  }
}

function permanentDeleteOrder(orderId) {
  const confirmation = window.prompt("Type DELETE to confirm permanent deletion");
  if (confirmation !== "DELETE") {
    showWorkflowMessage("Permanent delete cancelled.", "warning");
    return;
  }
  orderActionRunning = true;
  try {
    const order = findOrder(orderId);
    if (!order) return;
    state.orders = state.orders.filter((row) => row.id !== order.id);
    state.productionJobs = state.productionJobs.filter((job) => job.orderId !== order.id);
    state.installationJobs = state.installationJobs.filter((job) => job.orderId !== order.id);
    persistOrders();
    persistProductionJobs();
    persistInstallationJobs();
    orderSearch = { ...orderSearch, highlightId: "" };
    renderWorkflowModules();
    showWorkflowMessage("Order permanently deleted", "success");
  } finally {
    orderActionRunning = false;
  }
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
    orderNo: job.orderNumber,
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
  openPrint(t("Order"), order.orderNumber, `
    ${customerBlock(order.customer)}
    <p><strong>${t("Quote")}:</strong> ${order.quoteNumber}</p>
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
    <p><strong>${t("Order")}:</strong> ${job.orderNumber}</p>
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
    <p><strong>${t("Order")}:</strong> ${job.orderNumber}</p>
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
