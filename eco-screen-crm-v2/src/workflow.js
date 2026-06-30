import {
  nextInstallationNumber,
  nextOrderNumber,
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
import { itemWithCalculatedTotals, lineTotal, money, powdercoatAmount, quoteTotals } from "./calculations.js";

const orderStatuses = [
  "Confirmed",
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
const productionStatuses = ["Pending", "In Production", "Completed", "Cancelled"];
const installationStatuses = ["Pending", "Scheduled", "Installing", "Installed", "Pending Collection", "Completed", "Cancelled"];
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
  { id: "archived", title: "Cancelled / Archived", shortTitle: "Cancelled / Archived" }
];

let activeCompletionJobId = null;
let orderActionRunning = false;
let orderSearch = {
  orderNumber: "",
  customerName: "",
  phone: "",
  filter: "active",
  highlightId: ""
};

export function convertQuoteToOrder(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) return failConversion("Quote not found.");
  if (!quote.items || !quote.items.length) return failConversion("Quote has no items.");
  const existing = state.orders.find((order) => order.quoteId === quote.id);
  if (existing) {
    showWorkflowMessage(`Order already exists: ${existing.orderNumber}`, "warning");
    renderWorkflowModules();
    scrollToOrders();
    return { ok: false, message: "Order already exists.", order: existing };
  }

  const order = createOrderFromQuote(quote);
  if (!order) return failConversion("Failed to create order.");
  const productionJob = createProductionJobFromOrder(order);
  if (!productionJob) return failConversion("Failed to create production job.");
  const installationJob = createInstallationJobFromOrder(order);
  if (!installationJob) return failConversion("Failed to create installation job.");

  try {
    state.orders = [order, ...state.orders];
    state.productionJobs = [productionJob, ...state.productionJobs];
    state.installationJobs = [installationJob, ...state.installationJobs];
    quote.status = "Ordered";
    quote.orderNumber = order.orderNumber;
    quote.updatedAt = new Date().toISOString();
    saveOrders();
    persistProductionJobs();
    persistInstallationJobs();
    persistQuotations();
  } catch {
    return failConversion("Failed to save order.");
  }

  showWorkflowMessage(`Order created successfully: ${order.orderNumber}`, "success");
  renderWorkflowModules();
  scrollToOrders();
  return { ok: true, message: "Order created successfully", order };
}

export function getQuoteById(quoteId) {
  return state.quotations.find((row) => row.id === quoteId || row.quoteNumber === quoteId) || null;
}

export function createOrderFromQuote(quote) {
  const totals = quoteTotals(quote.items, quote.discount, quote.deposit);
  return {
    id: uid("order"),
    orderNumber: nextOrderNumber(),
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    customer: { ...quote.customer },
    items: quote.items.map((item) => itemWithCalculatedTotals(item)),
    subtotal: totals.subtotal,
    discount: Number(quote.discount || 0),
    total: totals.total,
    deposit: Number(quote.deposit || 0),
    balance: totals.balance,
    status: "Confirmed",
    installationDate: quote.appointmentDate || "",
    remark: quote.remark || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createProductionJobFromOrder(order) {
  return {
    id: uid("production"),
    productionNumber: nextProductionNumber(),
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer.name,
    items: order.items.map((item) => itemWithCalculatedTotals(item)),
    installationDate: order.installationDate || "",
    status: "Pending",
    remark: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createInstallationJobFromOrder(order) {
  return {
    id: uid("installation"),
    installationNumber: nextInstallationNumber(),
    orderId: order.id,
    orderNumber: order.orderNumber,
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
    installerName: "",
    completionDate: "",
    installationRemark: "",
    checklist: {},
    customerSignature: "",
    completionStatus: "Open",
    warrantyNo: "",
    installerRemark: "",
    status: "Pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function saveOrders() {
  persistOrders();
}

export function loadOrders() {
  return state.orders;
}

function failConversion(message) {
  showWorkflowMessage(message, "error");
  return { ok: false, message };
}

function showWorkflowMessage(message, type = "info") {
  const status = document.querySelector("#workflowStatus");
  if (!status) return;
  status.textContent = message;
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
  const orders = filteredOrders();
  list.innerHTML = orders.length ? orders.map((order) => `
    <article class="card ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      <div class="card-head">
        <div>
          <strong>${order.orderNumber}</strong>
          <p class="muted-text">Quote: ${order.quoteNumber} | ${order.customer.name || "-"} | ${order.customer.phone || "-"}</p>
        </div>
        <span class="pill">${order.status}${order.isArchived ? " / Archived" : ""}</span>
      </div>
      <div class="order-facts">
        <span>Total: <strong>${money(order.total || 0)}</strong></span>
        <span>Deposit: <strong>${money(order.deposit || 0)}</strong></span>
        <span>Balance: <strong>${money(order.balance || 0)}</strong></span>
      </div>
      <div class="form-grid compact">
        <label>Status<select data-order-id="${order.id}" data-order-field="status" ${state.role === "Admin" ? "" : "disabled"}>${orderStatuses.map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label>Installation Date<input type="date" data-order-id="${order.id}" data-order-field="installationDate" value="${order.installationDate || ""}" ${state.role === "Admin" ? "" : "readonly"} /></label>
        <label class="wide">Remark<textarea rows="2" data-order-id="${order.id}" data-order-field="remark" ${state.role === "Admin" ? "" : "readonly"}>${order.remark || ""}</textarea></label>
      </div>
      ${itemsSummary(order.items)}
      ${orderActionsHtml(order)}
    </article>
  `).join("") : `<p class="muted-text">${state.orders.length ? "No order found" : "No orders yet. Convert a saved quote to create an order."}</p>`;
}

function renderOrderProgressBoard() {
  const board = document.querySelector("#orderProgressBoard");
  if (!board) return;
  if (!["Admin", "Secretary"].includes(state.role)) {
    board.innerHTML = "";
    return;
  }
  const activeCategories = progressCategories.filter((category) => {
    if (orderSearch.filter === "all") return true;
    return orderSearch.filter === "archived" ? category.id === "archived" : category.id !== "archived";
  });
  const filtered = state.orders.filter((order) => matchesOrderSearch(order) && matchesBoardDateFilter(order));
  board.innerHTML = `
    <section class="progress-board">
      <div class="section-head">
        <div>
          <h3>Order Progress Board</h3>
          <p class="muted-text">Production and installation progress for every order.</p>
        </div>
      </div>
      <div class="progress-columns">
        ${activeCategories.map((category) => {
          const rows = filtered.filter((order) => getOrderProgressCategory(order) === category.id && matchesProgressFilter(category.id, order));
          return `
            <section class="progress-column">
              <h3>${category.shortTitle} <span>${rows.length}</span></h3>
              <div class="progress-card-list">
                ${rows.length ? rows.map((order) => renderOrderProgressCard(order)).join("") : `<p class="muted-text">No orders.</p>`}
              </div>
            </section>
          `;
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
        <label>Search Order Number<input data-order-search="orderNumber" value="${orderSearch.orderNumber}" placeholder="ESO-2026-0001 or 0001" /></label>
        <label>Search Customer Name<input data-order-search="customerName" value="${orderSearch.customerName}" placeholder="Customer name" /></label>
        <label>Search Phone Number<input data-order-search="phone" value="${orderSearch.phone}" placeholder="0123456789" /></label>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" data-order-tool="search">Search</button>
        <button class="btn" type="button" data-order-tool="clear">Clear Search</button>
        <button class="btn" type="button" data-order-tool="find">Find Order</button>
      </div>
      <div class="filter-tabs">
        ${orderFilters.map((filter) => `<button class="filter-tab ${orderSearch.filter === filter.id ? "active" : ""}" type="button" data-order-filter="${filter.id}">${filter.label}</button>`).join("")}
      </div>
    </section>
  `;
}

function orderActionsHtml(order) {
  if (state.role === "Admin") {
    return `
      <div class="actions">
        <button class="btn" type="button" data-view-order="${order.id}">View Order</button>
        <button class="btn primary" type="button" data-print-order="${order.id}">Print Order</button>
        <button class="btn" type="button" data-send-production="${order.id}">Send to Production</button>
        <button class="btn" type="button" data-send-installer="${order.id}">Send to Installer</button>
        <button class="btn" type="button" data-update-order-status="${order.id}">Update Status</button>
        <button class="btn danger" type="button" data-delete-order="${order.id}">Delete Order</button>
      </div>
    `;
  }
  return `
    <div class="actions">
      <button class="btn" type="button" data-view-order="${order.id}">View Order</button>
      <button class="btn primary" type="button" data-print-order="${order.id}">Print Order</button>
      <button class="btn" type="button" data-whatsapp-order="${order.id}">WhatsApp Customer</button>
      <button class="btn" type="button" data-highlight-order="${order.id}">Search / Open Customer</button>
    </div>
  `;
}

function renderOrderProgressCard(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  return `
    <article class="progress-card ${orderSearch.highlightId === order.id ? "highlight-card" : ""}" data-order-card="${order.id}">
      <strong>${order.orderNumber}</strong>
      <p class="muted-text">Quote: ${order.quoteNumber || "-"}</p>
      <p>${order.customer?.name || "-"} | ${order.customer?.phone || "-"}</p>
      <p class="muted-text">${order.customer?.area || "-"} | ${order.customer?.address || "-"}</p>
      <p class="muted-text">${productSummary(order.items)}</p>
      <div class="progress-meta">
        <span>Install: ${order.installationDate || installationJob?.installationDate || "-"}</span>
        <span>Order: ${order.status || "-"}</span>
        <span>Production: ${productionJob?.status || "Not sent"}</span>
        <span>Installation: ${installationJob?.status || "Not sent"}</span>
        <span>Balance: ${money(getOrderBalance(order))}</span>
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
  return (!orderSearch.orderNumber || orderNumber.includes(normalizeText(orderSearch.orderNumber)))
    && (!orderSearch.customerName || customerName.includes(normalizeText(orderSearch.customerName)))
    && (!orderSearch.phone || phone.includes(normalizeText(orderSearch.phone)));
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
  return Number(installationJob?.balance ?? order.balance ?? 0);
}

function getOrderProgressCategory(order) {
  const productionJob = getOrderProductionJob(order);
  const installationJob = getOrderInstallationJob(order);
  const balance = getOrderBalance(order);
  if (order.isArchived || order.status === "Cancelled") return "archived";
  if ((installationJob?.status === "Completed" || ["Completed", "Serviced"].includes(order.status)) && balance <= 0) return "completed";
  if ((installationJob?.status === "Completed" || ["Pending Collection", "Serviced"].includes(order.status)) && balance > 0) return "pending-collection";
  if (productionJob?.status === "Completed" && installationJob?.status !== "Completed") return "waiting-installation";
  if (["Sent to Production", "In Production"].includes(order.status) || ["Pending", "In Production"].includes(productionJob?.status)) return "in-production";
  return "new";
}

function matchesBoardDateFilter(order) {
  const installationJob = getOrderInstallationJob(order);
  const dateValue = installationJob?.installationDate || order.installationDate;
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
          <p class="muted-text">Order: ${job.orderNumber} | ${job.customerName || "-"}</p>
          <p class="muted-text">Installation date: ${job.installationDate || "-"}</p>
        </div>
        <span class="pill">${job.status}</span>
      </div>
      <label>Production Status<select data-production-id="${job.id}" data-production-field="status">${productionStatuses.map((status) => `<option value="${status}" ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      <label>Production Remark<textarea rows="2" data-production-id="${job.id}" data-production-field="remark">${job.remark || ""}</textarea></label>
      ${itemsSummary(job.items)}
      <div class="actions">
        <button class="btn" type="button" data-view-production="${job.id}">View Production Job</button>
        <button class="btn primary" type="button" data-print-production="${job.id}">Print Production Sheet</button>
        <button class="btn" type="button" data-mark-production-status="${job.id}" data-status="In Production">Mark In Production</button>
        <button class="btn" type="button" data-mark-production-status="${job.id}" data-status="Completed">Mark Production Completed</button>
      </div>
    </article>
  `).join("") : `<p class="muted-text">No production jobs yet.</p>`;
}

function renderInstallationJobs() {
  const list = document.querySelector("#installationList");
  if (!list) return;
  list.innerHTML = state.installationJobs.length ? state.installationJobs.map((job) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${job.installationNumber}</strong>
          <p class="muted-text">Order: ${job.orderNumber} | ${job.customer.name || "-"}</p>
          <p class="muted-text">${job.customer.phone || "-"} | ${job.customer.address || "-"}</p>
        </div>
        <span class="pill">${money(job.balance)} to collect</span>
      </div>
      <div class="form-grid compact">
        <label>Installation Date<input type="date" data-installation-id="${job.id}" data-installation-field="installationDate" value="${job.installationDate || ""}" /></label>
        <label>Status<select data-installation-id="${job.id}" data-installation-field="status">${installationStatuses.map((status) => `<option value="${status}" ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="wide">Installer Remark<textarea rows="2" data-installation-id="${job.id}" data-installation-field="installerRemark">${job.installerRemark || ""}</textarea></label>
      </div>
      ${itemsSummary(job.items)}
      ${completionSummaryHtml(job)}
      <div class="actions">
        <button class="btn" type="button" data-view-installation="${job.id}">View Installation Job</button>
        <button class="btn primary" type="button" data-print-installation="${job.id}">Print Installation Sheet</button>
        <button class="btn" type="button" data-whatsapp-installation="${job.id}">WhatsApp Customer</button>
        <button class="btn" type="button" data-mark-installation-status="${job.id}" data-status="Scheduled">Mark Scheduled</button>
        <button class="btn" type="button" data-mark-installation-status="${job.id}" data-status="Installing">Mark Installing</button>
        <button class="btn" type="button" data-complete-installation="${job.id}">Complete Installation</button>
        <button class="btn" type="button" data-generate-warranty="${job.id}">Generate Warranty Card</button>
        <button class="btn" type="button" data-print-warranty="${job.id}">Print Warranty Card</button>
        <button class="btn" type="button" data-print-warranty="${job.id}">PDF Warranty Card</button>
      </div>
      ${activeCompletionJobId === job.id ? completionFormHtml(job) : ""}
    </article>
  `).join("") : `<p class="muted-text">No installation jobs yet.</p>`;
  if (activeCompletionJobId) setupSignatureCanvas(activeCompletionJobId);
}

function completionSummaryHtml(job) {
  if (!job.completionDate && !job.afterPhoto && !job.customerSignature) return "";
  return `
    <div class="completion-summary">
      <strong>Completion Record</strong>
      <span>Installer: ${job.installerName || "-"}</span>
      <span>Completion: ${job.completionDate || "-"}</span>
      <span>Collected: ${money(job.amountCollected || 0)} / ${money(job.balanceToCollect ?? job.balance ?? 0)}</span>
      <span>Warranty: ${job.warrantyNo || "-"}</span>
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
          <h3>Complete Installation</h3>
          <p class="muted-text">Photo, checklist, collection and customer signature are required.</p>
        </div>
        <button class="btn" type="button" data-close-completion="${job.id}">Close</button>
      </div>
      <div class="form-grid">
        <label>Installer Name<input data-completion-field="installerName" value="${job.installerName || ""}" placeholder="Installer name" /></label>
        <label>Completion Date / Time<input type="datetime-local" data-completion-field="completionDate" value="${job.completionDate || currentDateTimeLocal()}" /></label>
        <label class="wide">Installation Remark<textarea rows="2" data-completion-field="installationRemark" placeholder="Installation remark">${job.installationRemark || job.installerRemark || ""}</textarea></label>
      </div>

      <div class="photo-grid">
        ${photoUploadHtml(job, "beforePhoto", "Before installation photo")}
        ${photoUploadHtml(job, "afterPhoto", "After installation photo")}
        ${photoUploadHtml(job, "defectPhoto", "Problem / defect photo")}
      </div>

      <div class="checklist-box">
        <h3>Customer Inspection Checklist</h3>
        <div class="checklist-grid">
          ${checklistLabels.map((label) => `
            <label class="checkbox-row"><input type="checkbox" data-checklist="${label}" ${checklist[label] ? "checked" : ""} /> ${label}</label>
          `).join("")}
        </div>
      </div>

      <div class="form-grid">
        <label>Balance to collect<input inputmode="decimal" data-completion-field="balanceToCollect" value="${balance}" /></label>
        <label>Amount collected<input inputmode="decimal" data-completion-field="amountCollected" value="${job.amountCollected || ""}" placeholder="0.00" /></label>
        <label>Payment Method<select data-completion-field="paymentMethod">
          ${["Cash", "Bank Transfer", "DuitNow", "TNG", "Other"].map((method) => `<option value="${method}" ${job.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
        </select></label>
        <label>Balance collected?<select data-completion-field="balanceCollected">
          <option value="false" ${job.balanceCollected ? "" : "selected"}>No</option>
          <option value="true" ${job.balanceCollected ? "selected" : ""}>Yes</option>
        </select></label>
        <label class="wide">Payment Reference / Remark<textarea rows="2" data-completion-field="paymentReference" placeholder="Transfer ref, cash note, collection remark">${job.paymentReference || ""}</textarea></label>
      </div>

      <div class="signature-box">
        <div class="section-head">
          <div>
            <h3>Customer Signature</h3>
            <p class="muted-text">Customer signs here with finger or mouse.</p>
          </div>
          <button class="btn" type="button" data-clear-signature="${job.id}">Clear Signature</button>
        </div>
        <canvas class="signature-canvas" width="720" height="220" data-signature-canvas="${job.id}"></canvas>
      </div>

      <p class="muted-text" data-completion-error="${job.id}"></p>
      <div class="actions">
        <button class="btn primary" type="button" data-save-completion="${job.id}">Save Completion</button>
      </div>
    </section>
  `;
}

function photoUploadHtml(job, field, label) {
  return `
    <div class="photo-box">
      <label>${label}<input type="file" accept="image/*" data-photo-field="${field}" data-installation-photo-id="${job.id}" /></label>
      ${job[field] ? `<img src="${job[field]}" alt="${label}" />` : `<p class="muted-text">No photo uploaded.</p>`}
    </div>
  `;
}

function itemsSummary(items) {
  return `<div class="mini-table">${items.map((item) => `
    <div>
      <strong>${item.productName}</strong>
      <span>${item.width || 0} x ${item.height || 0} | Qty ${item.quantity || 0} | ${item.color || "-"} | ${item.installType || "-"} | ${item.installationLocation || "-"} | ${item.openingDirection || "-"} | ${item.trackSize || "-"} | ${item.handleHeight || "-"} | ${item.handlePosition || "-"} | ${item.trackOpening || "-"} | ${item.meshMaterial || "-"} | Powdercoat: ${item.powdercoat ? `Yes ${money(powdercoatAmount(item))}` : "No"} | ${item.remark || "-"}</span>
    </div>
  `).join("")}</div>`;
}

function handleOrderClick(event) {
  const printId = event.target.dataset.printOrder;
  const viewId = event.target.dataset.viewOrder;
  const sendProductionId = event.target.dataset.sendProduction;
  const sendInstallerId = event.target.dataset.sendInstaller;
  const updateStatusId = event.target.dataset.updateOrderStatus;
  const deleteId = event.target.dataset.deleteOrder;
  const whatsappId = event.target.dataset.whatsappOrder;
  const highlightId = event.target.dataset.highlightOrder;
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
  orderSearch = { ...orderSearch, [field]: event.target.value, highlightId: "" };
  renderOrderProgressBoard();
  renderOrderList();
}

function handleOrderToolsClick(event) {
  const filter = event.target.dataset.orderFilter;
  const tool = event.target.dataset.orderTool;
  if (filter) {
    orderSearch = { ...orderSearch, filter, highlightId: "" };
    renderOrders();
  }
  if (tool === "search") renderOrders();
  if (tool === "clear") {
    orderSearch = { orderNumber: "", customerName: "", phone: "", filter: "active", highlightId: "" };
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
  if (state.role !== "Admin") return showWorkflowMessage("Only Admin can delete orders.", "error");
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
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const existing = state.productionJobs.find((job) => job.orderId === order.id);
  const wasAlreadySent = ["Sent to Production", "Production Completed"].includes(order.status);
  order.status = "Sent to Production";
  order.updatedAt = new Date().toISOString();

  if (existing) {
    existing.installationDate = order.installationDate || existing.installationDate || "";
    existing.updatedAt = new Date().toISOString();
    persistOrders();
    persistProductionJobs();
    renderWorkflowModules();
    showWorkflowMessage(wasAlreadySent ? "Production job already exists" : "Order sent to Production", wasAlreadySent ? "warning" : "success");
    return;
  }

  state.productionJobs = [createProductionJobFromOrder(order), ...state.productionJobs];
  persistOrders();
  persistProductionJobs();
  renderWorkflowModules();
  showWorkflowMessage("Order sent to Production", "success");
}

function sendOrderToInstaller(orderId) {
  const order = findOrder(orderId);
  if (!order) return showWorkflowMessage("Order not found.", "error");
  const existing = state.installationJobs.find((job) => job.orderId === order.id);
  const wasAlreadySent = ["Sent to Installer", "Installation Scheduled", "Installing", "Installation Completed", "Pending Collection", "Completed"].includes(order.status);
  order.status = "Sent to Installer";
  order.updatedAt = new Date().toISOString();

  if (existing) {
    existing.installationDate = order.installationDate || existing.installationDate || "";
    existing.balance = order.balance;
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
  state.installationJobs = state.installationJobs.map((job) => job.orderId === orderId ? { ...job, installationDate, updatedAt: new Date().toISOString() } : job);
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
  const job = state.productionJobs.find((row) => row.id === jobId);
  if (!job || !status) return;
  job.status = status;
  job.updatedAt = new Date().toISOString();
  const order = findOrder(job.orderId);
  if (order) {
    order.status = status === "Completed" ? "Production Completed" : "Sent to Production";
    order.updatedAt = new Date().toISOString();
  }
  persistProductionJobs();
  persistOrders();
  renderWorkflowModules();
  showWorkflowMessage(status === "Completed" ? "Production marked completed" : "Production marked in progress", "success");
}

function handleInstallationClick(event) {
  const printId = event.target.dataset.printInstallation;
  const viewId = event.target.dataset.viewInstallation;
  const whatsappId = event.target.dataset.whatsappInstallation;
  const markId = event.target.dataset.markInstallationStatus;
  const completeId = event.target.dataset.completeInstallation;
  const closeId = event.target.dataset.closeCompletion;
  const saveId = event.target.dataset.saveCompletion;
  const clearSignatureId = event.target.dataset.clearSignature;
  const warrantyId = event.target.dataset.generateWarranty;
  const printWarrantyId = event.target.dataset.printWarranty;
  if (printId) printInstallation(printId);
  if (viewId) printInstallation(viewId);
  if (whatsappId) whatsappInstallationCustomer(whatsappId);
  if (markId) markInstallationStatus(markId, event.target.dataset.status);
  if (completeId) openCompletionForm(completeId);
  if (closeId) closeCompletionForm();
  if (saveId) saveInstallationCompletion(saveId);
  if (clearSignatureId) clearSignature(clearSignatureId);
  if (warrantyId) generateWarrantyCard(warrantyId);
  if (printWarrantyId) printWarrantyCard(printWarrantyId);
}

function handleInstallationChange(event) {
  const photoJobId = event.target.dataset.installationPhotoId;
  const photoField = event.target.dataset.photoField;
  if (photoJobId && photoField) {
    handlePhotoUpload(photoJobId, photoField, event.target.files?.[0]);
    return;
  }
  const id = event.target.dataset.installationId;
  const field = event.target.dataset.installationField;
  if (!id || !field) return;
  if (field === "status") {
    markInstallationStatus(id, event.target.value);
    return;
  }
  state.installationJobs = state.installationJobs.map((job) => job.id === id ? { ...job, [field]: event.target.value, updatedAt: new Date().toISOString() } : job);
  persistInstallationJobs();
}

function markInstallationStatus(jobId, status) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job || !status) return;
  if (status === "Completed" && job.completionStatus !== "Completed") {
    activeCompletionJobId = jobId;
    renderInstallationJobs();
    showWorkflowMessage("Please complete the installation form before marking completed.", "warning");
    return;
  }
  job.status = status;
  job.updatedAt = new Date().toISOString();
  const order = findOrder(job.orderId);
  if (order) {
    if (status === "Scheduled") order.status = "Installation Scheduled";
    if (status === "Installing") order.status = "Installing";
    if (status === "Completed") order.status = Number(order.balance || 0) > 0 ? "Pending Collection" : "Completed";
    order.updatedAt = new Date().toISOString();
  }
  persistInstallationJobs();
  persistOrders();
  renderWorkflowModules();
  showWorkflowMessage(status === "Completed" ? "Installation marked completed" : `Installation marked ${status}`, "success");
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
  activeCompletionJobId = jobId;
  renderInstallationJobs();
}

function closeCompletionForm() {
  activeCompletionJobId = null;
  renderInstallationJobs();
}

async function handlePhotoUpload(jobId, field, file) {
  if (!file) return;
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  try {
    job[field] = await imageFileToDataUrl(file);
    job.updatedAt = new Date().toISOString();
    persistInstallationJobs();
    renderInstallationJobs();
  } catch (error) {
    showWorkflowMessage(error.message || "Photo upload failed.", "error");
  }
}

function saveInstallationCompletion(jobId) {
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return;
  const panel = document.querySelector(`[data-completion-panel="${jobId}"]`);
  const error = document.querySelector(`[data-completion-error="${jobId}"]`);
  if (!panel) return;

  const completionData = readCompletionForm(panel);
  Object.assign(job, completionData.fields);
  job.checklist = completionData.checklist;
  job.balanceCollected = completionData.fields.balanceCollected === "true";

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
  job.status = job.amountCollected >= job.balanceToCollect ? "Completed" : "Pending Collection";
  job.balance = Math.max(0, job.balanceToCollect - job.amountCollected);
  job.updatedAt = new Date().toISOString();

  const order = findOrder(job.orderId);
  if (order) {
    order.status = job.status === "Completed" ? "Completed" : "Pending Collection";
    order.balance = job.balance;
    order.updatedAt = new Date().toISOString();
    persistOrders();
  }

  persistInstallationJobs();
  activeCompletionJobId = null;
  renderWorkflowModules();
  showWorkflowMessage(job.status === "Completed" ? "Installation completed" : "Installation completed with pending collection", "success");
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
  if (!job.afterPhoto) return "Please upload after installation photo";
  if (!completionData.fields.completionDate) return "Please fill completion date";
  if (completionData.fields.amountCollected === "") return "Please fill collection amount";
  if (!checklistLabels.every((label) => completionData.checklist[label])) return "Please complete customer inspection checklist";
  if (!signature) return "Please get customer signature";
  return "";
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
  const job = state.installationJobs.find((row) => row.id === jobId);
  if (!job) return showWorkflowMessage("Installation job not found.", "error");
  if (!["Completed", "Pending Collection"].includes(job.status)) {
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
    products: job.items.map((item) => ({ productName: item.productName, warrantyPeriod: warrantyPeriodForProduct(item.productName) })),
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
  openPrint("Warranty Card", card.warrantyNo, `
    <div class="print-box"><strong>${card.customer.name || "-"}</strong><br>${card.customer.phone || "-"}<br>${card.customer.address || "-"}</div>
    <p><strong>Order:</strong> ${card.orderNo}</p>
    <p><strong>Installation Job:</strong> ${card.installationJobNo}</p>
    <p><strong>Start Date:</strong> ${card.startDate}</p>
    <p><strong>Warranty Period:</strong> ${card.warrantyPeriod}</p>
    <table><thead><tr><th>Product</th><th>Warranty</th></tr></thead><tbody>
      ${card.products.map((product) => `<tr><td>${product.productName}</td><td>${product.warrantyPeriod}</td></tr>`).join("")}
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
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function printOrder(id) {
  const order = state.orders.find((row) => row.id === id);
  if (!order) return;
  openPrint("Order", order.orderNumber, `
    ${customerBlock(order.customer)}
    <p><strong>Quote:</strong> ${order.quoteNumber}</p>
    <p><strong>Status:</strong> ${order.status}</p>
    <p><strong>Installation Date:</strong> ${order.installationDate || "-"}</p>
    ${printItemsTable(order.items, true)}
    ${totalsBlock(order)}
    <p><strong>Remark:</strong> ${order.remark || "-"}</p>
  `);
}

function printProduction(id) {
  const job = state.productionJobs.find((row) => row.id === id);
  if (!job) return;
  openPrint("Production Job Sheet", job.productionNumber, `
    <p><strong>Order:</strong> ${job.orderNumber}</p>
    <p><strong>Customer:</strong> ${job.customerName || "-"}</p>
    <p><strong>Status:</strong> ${job.status}</p>
    ${printItemsTable(job.items, false)}
    <p><strong>Production Remark:</strong> ${job.remark || "-"}</p>
    <div class="print-sign"><span>Prepared by</span><span>Checked by</span></div>
  `);
}

function printInstallation(id) {
  const job = state.installationJobs.find((row) => row.id === id);
  if (!job) return;
  openPrint("Installation Job Sheet", job.installationNumber, `
    ${customerBlock(job.customer)}
    <p><strong>Order:</strong> ${job.orderNumber}</p>
    <p><strong>Installation Date:</strong> ${job.installationDate || "-"}</p>
    <p><strong>Status:</strong> ${job.status}</p>
    <p><strong>Balance to Collect:</strong> ${money(job.balance)}</p>
    ${printItemsTable(job.items, false)}
    <p><strong>Installer Remark:</strong> ${job.installerRemark || "-"}</p>
    ${installationCompletionPrintHtml(job)}
  `);
}

function installationCompletionPrintHtml(job) {
  const checklist = job.checklist || {};
  return `
    <div class="print-box">
      <h3>Installation Completion</h3>
      <p><strong>Installer:</strong> ${job.installerName || "-"}</p>
      <p><strong>Completion Date:</strong> ${job.completionDate || "-"}</p>
      <p><strong>Installation Remark:</strong> ${job.installationRemark || "-"}</p>
      <p><strong>Amount Collected:</strong> ${money(job.amountCollected || 0)}</p>
      <p><strong>Payment Method:</strong> ${job.paymentMethod || "-"}</p>
      <p><strong>Payment Reference:</strong> ${job.paymentReference || "-"}</p>
    </div>
    <table><thead><tr><th>Checklist</th><th>Status</th></tr></thead><tbody>
      ${checklistLabels.map((label) => `<tr><td>${label}</td><td>${checklist[label] ? "Done" : "Pending"}</td></tr>`).join("")}
    </tbody></table>
    <div class="print-photo-grid">
      ${printImageBox("Before photo", job.beforePhoto)}
      ${printImageBox("After photo", job.afterPhoto)}
      ${printImageBox("Problem / defect photo", job.defectPhoto)}
      ${printImageBox("Customer signature", job.customerSignature)}
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
  return `<table><thead><tr><th>Product</th><th>Location</th><th>Size</th><th>Qty</th><th>Color</th><th>Install Type</th><th>Opening</th><th>Track Size</th><th>Handle Height</th><th>Handle Position</th><th>Track / Opening</th><th>Mesh / Material</th><th>Powdercoat</th><th>Remark</th>${showPrice ? "<th>Unit</th><th>Amount</th>" : ""}</tr></thead><tbody>
    ${items.map((item) => `<tr><td>${item.productName}</td><td>${item.installationLocation || "-"}</td><td>${item.width || 0} x ${item.height || 0}</td><td>${item.quantity || 0}</td><td>${item.color || "-"}</td><td>${item.installType || "-"}</td><td>${item.openingDirection || "-"}</td><td>${item.trackSize || "-"}</td><td>${item.handleHeight || "-"}</td><td>${item.handlePosition || "-"}</td><td>${item.trackOpening || "-"}</td><td>${item.meshMaterial || "-"}</td><td>${item.powdercoat ? `Yes ${money(powdercoatAmount(item))}` : "No"}</td><td>${item.remark || "-"}</td>${showPrice ? `<td>${money(item.unitPrice)}</td><td>${money(lineTotal(item))}</td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}

function totalsBlock(order) {
  return `<div class="print-totals">
    <div><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
    <div><span>Discount</span><strong>${money(order.discount)}</strong></div>
    <div><span>Total</span><strong>${money(order.total)}</strong></div>
    <div><span>Deposit</span><strong>${money(order.deposit)}</strong></div>
    <div><span>Balance</span><strong>${money(order.balance)}</strong></div>
  </div>`;
}

function openPrint(title, number, body) {
  const area = document.querySelector("#workflowPrintArea");
  area.innerHTML = `
    <div class="print-head">
      <div><h1>Eco Screen Sdn Bhd</h1><p>24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM</p><p>Tel: 0197563499</p></div>
      <div><p>${title}</p><h2>${number}</h2></div>
    </div>
    ${body}
  `;
  document.body.classList.add("workflow-print-mode");
  window.print();
  setTimeout(() => document.body.classList.remove("workflow-print-mode"), 300);
}
