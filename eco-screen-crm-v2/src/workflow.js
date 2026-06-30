import {
  nextInstallationNumber,
  nextOrderNumber,
  nextProductionNumber,
  persistQuotations,
  persistInstallationJobs,
  persistOrders,
  persistProductionJobs,
  state,
  uid
} from "./state.js";
import { lineTotal, money, quoteTotals } from "./calculations.js";

const orderStatuses = ["Confirmed", "In Progress", "Completed", "Cancelled"];
const productionStatuses = ["Pending", "In Production", "Completed"];
const installationStatuses = ["Pending", "Scheduled", "Installed", "Completed"];

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
    items: quote.items.map((item) => ({ ...item })),
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
    items: order.items.map((item) => ({ ...item })),
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
    items: order.items.map((item) => ({ ...item })),
    installationDate: order.installationDate,
    balance: order.balance,
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
  document.querySelector("#orderList").addEventListener("click", handleOrderClick);
  document.querySelector("#orderList").addEventListener("change", handleOrderChange);
  document.querySelector("#productionList").addEventListener("click", handleProductionClick);
  document.querySelector("#productionList").addEventListener("change", handleProductionChange);
  document.querySelector("#installationList").addEventListener("click", handleInstallationClick);
  document.querySelector("#installationList").addEventListener("change", handleInstallationChange);
}

export function renderOrders() {
  const list = document.querySelector("#orderList");
  if (!list) return;
  list.innerHTML = state.orders.length ? state.orders.map((order) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${order.orderNumber}</strong>
          <p class="muted-text">Quote: ${order.quoteNumber} | ${order.customer.name || "-"}</p>
        </div>
        <span class="pill">${money(order.balance)} balance</span>
      </div>
      <div class="form-grid compact">
        <label>Status<select data-order-id="${order.id}" data-order-field="status">${orderStatuses.map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label>Installation Date<input type="date" data-order-id="${order.id}" data-order-field="installationDate" value="${order.installationDate || ""}" /></label>
        <label class="wide">Remark<textarea rows="2" data-order-id="${order.id}" data-order-field="remark">${order.remark || ""}</textarea></label>
      </div>
      ${itemsSummary(order.items)}
      <div class="actions">
        <button class="btn" type="button" data-view-order="${order.id}">View Order</button>
        <button class="btn primary" type="button" data-print-order="${order.id}">Print Order</button>
      </div>
    </article>
  `).join("") : `<p class="muted-text">No orders yet. Convert a saved quote to create an order.</p>`;
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
        </div>
        <span class="pill">${job.status}</span>
      </div>
      <label>Production Status<select data-production-id="${job.id}" data-production-field="status">${productionStatuses.map((status) => `<option value="${status}" ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      <label>Production Remark<textarea rows="2" data-production-id="${job.id}" data-production-field="remark">${job.remark || ""}</textarea></label>
      ${itemsSummary(job.items)}
      <div class="actions"><button class="btn primary" type="button" data-print-production="${job.id}">Print Production Sheet</button></div>
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
        </div>
        <span class="pill">${money(job.balance)} to collect</span>
      </div>
      <div class="form-grid compact">
        <label>Installation Date<input type="date" data-installation-id="${job.id}" data-installation-field="installationDate" value="${job.installationDate || ""}" /></label>
        <label>Status<select data-installation-id="${job.id}" data-installation-field="status">${installationStatuses.map((status) => `<option value="${status}" ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="wide">Installer Remark<textarea rows="2" data-installation-id="${job.id}" data-installation-field="installerRemark">${job.installerRemark || ""}</textarea></label>
      </div>
      ${itemsSummary(job.items)}
      <div class="actions"><button class="btn primary" type="button" data-print-installation="${job.id}">Print Installation Sheet</button></div>
    </article>
  `).join("") : `<p class="muted-text">No installation jobs yet.</p>`;
}

function itemsSummary(items) {
  return `<div class="mini-table">${items.map((item) => `
    <div>
      <strong>${item.productName}</strong>
      <span>${item.width || 0} x ${item.height || 0} | Qty ${item.quantity || 0} | ${item.color || "-"} | ${item.handlePosition || "-"} | ${item.trackOpening || "-"} | ${item.meshMaterial || "-"} | ${item.remark || "-"}</span>
    </div>
  `).join("")}</div>`;
}

function handleOrderClick(event) {
  const printId = event.target.dataset.printOrder;
  const viewId = event.target.dataset.viewOrder;
  if (printId) printOrder(printId);
  if (viewId) printOrder(viewId);
}

function handleOrderChange(event) {
  const id = event.target.dataset.orderId;
  const field = event.target.dataset.orderField;
  if (!id || !field) return;
  state.orders = state.orders.map((order) => order.id === id ? { ...order, [field]: event.target.value, updatedAt: new Date().toISOString() } : order);
  persistOrders();
}

function handleProductionClick(event) {
  const id = event.target.dataset.printProduction;
  if (id) printProduction(id);
}

function handleProductionChange(event) {
  const id = event.target.dataset.productionId;
  const field = event.target.dataset.productionField;
  if (!id || !field) return;
  state.productionJobs = state.productionJobs.map((job) => job.id === id ? { ...job, [field]: event.target.value, updatedAt: new Date().toISOString() } : job);
  persistProductionJobs();
  renderProductionJobs();
}

function handleInstallationClick(event) {
  const id = event.target.dataset.printInstallation;
  if (id) printInstallation(id);
}

function handleInstallationChange(event) {
  const id = event.target.dataset.installationId;
  const field = event.target.dataset.installationField;
  if (!id || !field) return;
  state.installationJobs = state.installationJobs.map((job) => job.id === id ? { ...job, [field]: event.target.value, updatedAt: new Date().toISOString() } : job);
  persistInstallationJobs();
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
  `);
}

function customerBlock(customer) {
  return `<div class="print-box"><strong>${customer.name || "-"}</strong><br>${customer.phone || "-"}<br>${customer.area || "-"}<br>${customer.address || "-"}</div>`;
}

function printItemsTable(items, showPrice) {
  return `<table><thead><tr><th>Product</th><th>Size</th><th>Qty</th><th>Color</th><th>Handle</th><th>Track / Opening</th><th>Mesh / Material</th><th>Remark</th>${showPrice ? "<th>Unit</th><th>Amount</th>" : ""}</tr></thead><tbody>
    ${items.map((item) => `<tr><td>${item.productName}</td><td>${item.width || 0} x ${item.height || 0}</td><td>${item.quantity || 0}</td><td>${item.color || "-"}</td><td>${item.handlePosition || "-"}</td><td>${item.trackOpening || "-"}</td><td>${item.meshMaterial || "-"}</td><td>${item.remark || "-"}</td>${showPrice ? `<td>${money(item.unitPrice)}</td><td>${money(lineTotal(item))}</td>` : ""}</tr>`).join("")}
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
