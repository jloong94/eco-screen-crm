import { roles } from "./data.js";
import { renderAddProductForm, renderProducts, attachProductEvents } from "./products.js";
import { attachQuotationEvents, renderQuotationForm } from "./quotations.js";
import { setPage, setRole, state } from "./state.js";
import { money } from "./calculations.js";
import { attachWorkflowEvents, renderWorkflowModules } from "./workflow.js";

const pages = [
  { id: "dashboard", label: "Dashboard", title: "Dashboard" },
  { id: "quotation", label: "Quotation", title: "Quotation" },
  { id: "customers", label: "Customers", title: "Customers" },
  { id: "orders", label: "Orders", title: "Orders" },
  { id: "production", label: "Production", title: "Production Jobs" },
  { id: "installation", label: "Installation", title: "Installation Jobs" },
  { id: "products", label: "Product Management / Settings", title: "Product Management" }
];

const rolePages = {
  Admin: pages.map((page) => page.id),
  Secretary: ["orders", "quotation", "customers"],
  Sales: ["quotation", "customers", "orders"],
  Production: ["production"],
  Installer: ["installation"]
};

const defaultPages = {
  Admin: "dashboard",
  Secretary: "orders",
  Sales: "quotation",
  Production: "production",
  Installer: "installation"
};

function canAccessPage(role, page) {
  return (rolePages[role] || []).includes(page);
}

function defaultPageForRole(role) {
  return defaultPages[role] || "quotation";
}

function appHtml() {
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo">ES</div>
        <div>
          <p>Eco Screen CRM V2</p>
          <h1>${currentPageTitle()}</h1>
        </div>
      </div>
      <nav id="roleSelector" class="role-selector" aria-label="Role selector">
        ${roles.map((role) => `<button class="role-btn ${state.role === role ? "active" : ""}" data-role="${role}" type="button">${role}</button>`).join("")}
      </nav>
    </header>

    <nav id="moduleNavigation" class="module-tabs" aria-label="Module navigation">
      ${renderNavigation()}
    </nav>

    <main class="layout page-layout">
      ${currentPageHtml()}
    </main>

    <section id="printArea" class="print-area">
      <div class="print-head">
        <div>
          <h1>Eco Screen Sdn Bhd</h1>
          <p>24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM</p>
          <p>Tel: 0197563499</p>
        </div>
        <div>
          <p>Quotation</p>
          <h2 id="printQuoteNumber"></h2>
        </div>
      </div>
      <div class="print-customer" id="printCustomer"></div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Product</th><th>Size</th><th>Qty</th><th>Color</th><th>Handle</th><th>Material</th><th>Remark</th><th class="right">Unit</th><th class="right">Amount</th>
          </tr>
        </thead>
        <tbody id="printItems"></tbody>
      </table>
      <div id="printTotals" class="print-totals"></div>
      <div class="terms">
        <p>Prices quoted are valid for two (2) weeks from the quotation date.</p>
        <p>50% deposit is required upon confirmation. Deposit paid is not refundable.</p>
      </div>
    </section>
    <section id="workflowPrintArea" class="print-area workflow-print-area"></section>
  `;
}

function renderNavigation() {
  return pages
    .filter((page) => canAccessPage(state.role, page.id))
    .map((page) => `<button class="module-tab ${state.currentPage === page.id ? "active" : ""}" data-page="${page.id}" type="button">${page.label}</button>`)
    .join("");
}

function currentPageHtml() {
  if (state.currentPage === "dashboard") return dashboardPageHtml();
  if (state.currentPage === "quotation") return quotationPageHtml();
  if (state.currentPage === "customers") return customersPageHtml();
  if (state.currentPage === "orders") return ordersPageHtml();
  if (state.currentPage === "production") return productionPageHtml();
  if (state.currentPage === "installation") return installationPageHtml();
  if (state.currentPage === "products") return productManagementPageHtml();
  return quotationPageHtml();
}

function isCurrentPage(page) {
  return state.currentPage === page;
}

function dashboardPageHtml() {
  return `
    <section class="panel page-panel" data-page-panel="dashboard">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Overview</p>
          <h2>Dashboard</h2>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="metric-card"><span>Quotations</span><strong>${state.quotations.length}</strong></div>
        <div class="metric-card"><span>Orders</span><strong>${state.orders.length}</strong></div>
        <div class="metric-card"><span>Production Jobs</span><strong>${state.productionJobs.length}</strong></div>
        <div class="metric-card"><span>Installation Jobs</span><strong>${state.installationJobs.length}</strong></div>
      </div>
    </section>
  `;
}

function quotationPageHtml() {
  return `
    <section class="page-panel quotation-page-grid" data-page-panel="quotation">
      <section class="panel quotation-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Sales</p>
            <h2>Quotation</h2>
          </div>
          <div class="actions">
            <button class="btn" id="newQuoteButton" type="button">New Quote</button>
            <button class="btn" id="printQuoteButton" type="button">Print Quote</button>
            <button class="btn" id="pdfQuoteButton" type="button">PDF Quote</button>
            <button class="btn primary" id="saveQuoteButton" type="button">Save Quote</button>
          </div>
        </div>

        <form id="quotationForm" class="stack" onsubmit="return false">
          <div class="form-grid">
            <label>Quotation Number<input id="quoteNumber" /></label>
            <label>Quotation Status<select id="quoteStatus"></select></label>
            <label>Customer Name<input id="customerName" placeholder="TEST CUSTOMER" /></label>
            <label>Phone<input id="customerPhone" placeholder="0123456789" /></label>
            <label>Area<input id="customerArea" placeholder="Bukit Tengah" /></label>
            <label>Appointment Date<input id="appointmentDate" type="date" /></label>
            <label class="wide">Address<textarea id="customerAddress" rows="3"></textarea></label>
            <label class="wide">Customer Remark<textarea id="customerRemark" rows="2"></textarea></label>
            <label class="wide">Quotation Remark<textarea id="quoteRemark" rows="2"></textarea></label>
          </div>

          <section class="products-editor">
            <div class="section-head">
              <div>
                <h3>Products</h3>
                <span id="itemsCount" class="pill">Items count: 0</span>
              </div>
              <button class="btn primary" id="addItemButton" type="button">Add Item</button>
            </div>
            <div id="quoteItems" class="quote-items"></div>
          </section>

          <aside class="summary-box">
            <label>Discount<input id="discount" inputmode="decimal" placeholder="0.00" /></label>
            <label>Deposit<input id="deposit" inputmode="decimal" placeholder="0.00" /></label>
            <div class="summary-row"><span>Subtotal</span><strong id="subtotalValue">RM 0.00</strong></div>
            <div class="summary-row"><span>Total</span><strong id="totalValue">RM 0.00</strong></div>
            <div class="summary-row balance"><span>Balance</span><strong id="balanceValue">RM 0.00</strong></div>
            <p id="saveStatus" class="muted-text">Ready.</p>
          </aside>
        </form>
      </section>

      <aside class="side-column">
        <section class="panel">
          <div class="panel-head"><h2>Saved Quotations</h2></div>
          <div id="quotationList" class="quote-list"></div>
        </section>
      </aside>
    </section>
  `;
}

function customersPageHtml() {
  return `
    <section class="panel page-panel" data-page-panel="customers">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Customer Records</p>
          <h2>Customers</h2>
        </div>
      </div>
      <div id="customerList" class="workflow-list"></div>
    </section>
  `;
}

function ordersPageHtml() {
  return `
    <section class="panel page-panel workflow-panel" id="ordersPanel" data-page-panel="orders">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Confirmed Jobs</p>
          <h2>Orders</h2>
        </div>
        <span class="pill" id="workflowStatus">Ready</span>
      </div>
      <div id="orderTools"></div>
      <div id="orderProgressBoard"></div>
      <div id="orderList" class="workflow-list"></div>
    </section>
  `;
}

function productionPageHtml() {
  return `
    <section class="panel page-panel workflow-panel" data-page-panel="production">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Factory</p>
          <h2>Production Jobs</h2>
        </div>
        <span class="pill" id="workflowStatus">Ready</span>
      </div>
      <div id="productionList" class="workflow-list"></div>
    </section>
  `;
}

function installationPageHtml() {
  return `
    <section class="panel page-panel workflow-panel" data-page-panel="installation">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Installer</p>
          <h2>Installation Jobs</h2>
        </div>
        <span class="pill" id="workflowStatus">Ready</span>
      </div>
      <div id="installationList" class="workflow-list"></div>
    </section>
  `;
}

function productManagementPageHtml() {
  return `
    <section class="panel page-panel" data-page-panel="products">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Settings</p>
          <h2>Product Management</h2>
        </div>
      </div>
      <div id="addProductPanel"></div>
      <p id="productSaveStatus" class="muted-text"></p>
      <div id="productList" class="product-list"></div>
    </section>
  `;
}

function renderShell() {
  if (!canAccessPage(state.role, state.currentPage)) setPage(defaultPageForRole(state.role));
  document.querySelector("#app").innerHTML = appHtml();
  attachRoleEvents();
  attachNavigationEvents();
  if (isCurrentPage("quotation")) {
    attachQuotationEvents();
    renderQuotationForm();
  }
  if (isCurrentPage("products")) {
    attachProductEvents();
    renderAddProductForm();
    renderProducts();
  }
  if (["orders", "production", "installation"].includes(state.currentPage)) {
    attachWorkflowEvents();
    renderWorkflowModules();
  }
  if (isCurrentPage("customers")) renderCustomers();
  applyRoleAccess();
}

function attachRoleEvents() {
  document.querySelector("#roleSelector").addEventListener("click", (event) => {
    const role = event.target.dataset.role;
    if (!role) return;
    setRole(role);
    setPage(defaultPageForRole(role));
    renderShell();
  });
}

function attachNavigationEvents() {
  document.querySelector("#moduleNavigation").addEventListener("click", (event) => {
    const page = event.target.dataset.page;
    if (!page || !canAccessPage(state.role, page)) return;
    setPage(page);
    renderShell();
  });
}

function renderCustomers() {
  const list = document.querySelector("#customerList");
  if (!list) return;
  const customers = state.orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    quoteNumber: order.quoteNumber,
    name: order.customer?.name || "-",
    phone: order.customer?.phone || "-",
    area: order.customer?.area || "-",
    address: order.customer?.address || "-",
    total: order.total || 0,
    status: order.status || "-"
  }));
  list.innerHTML = customers.length ? customers.map((customer) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${customer.name}</strong>
          <p class="muted-text">${customer.phone} | ${customer.area}</p>
        </div>
        <span class="pill">${customer.status}</span>
      </div>
      <p class="muted-text">${customer.address}</p>
      <p class="muted-text">Order: ${customer.orderNumber} | Quote: ${customer.quoteNumber} | Total: ${money(customer.total)}</p>
    </article>
  `).join("") : `<p class="muted-text">No confirmed order customers yet. Convert a quotation to create a customer record here.</p>`;
}

function applyRoleAccess() {
  const isAdmin = state.role === "Admin";
  document.querySelector("#addProductPanel")?.classList.toggle("disabled-block", !isAdmin);
  document.querySelectorAll("[data-product-field]").forEach((field) => {
    if (field.tagName === "SELECT") field.disabled = !isAdmin;
    else field.readOnly = !isAdmin;
  });
}

function currentPageTitle() {
  return pages.find((page) => page.id === state.currentPage)?.title || "Quotation CRM";
}

renderShell();
