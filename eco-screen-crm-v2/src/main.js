import { attachLoginEvents, attachUserManagementEvents, logout, renderLoginCard, renderUserManagement } from "./auth.js";
import { adsPageHtml, attachAdsEvents, renderAdsDashboard } from "./ads.js";
import { renderAddProductForm, renderProducts, attachProductEvents } from "./products.js";
import { attachQuotationEvents, renderQuotationForm } from "./quotations.js";
import { applyCloudSnapshot, replaceStateFromBackup, setLanguage, setPage, state, stateSnapshot, updateCloudStatus } from "./state.js";
import { money } from "./calculations.js";
import { attachWorkflowEvents, renderWorkflowModules } from "./workflow.js";
import { t } from "./i18n.js";
import { canAccessPage, defaultPageForRole, isBossOrAdmin, pageDefinitions, role } from "./permissions.js";
import { isCloudConfigured, safeSyncWithCloud, syncToCloud } from "./cloudSync.js";

let cloudHydrated = false;

function appHtml() {
  if (!state.currentUser) return renderLoginCard();
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo">ES</div>
        <div>
          <p>${t("Eco Screen CRM V2")}</p>
          <h1>${t(currentPageTitle())}</h1>
          <span class="version-label">Eco Screen CRM V2 - Mobile Production</span>
        </div>
      </div>
      <div class="user-toolbar">
        <label class="language-select">${t("Select Language")}
          <select id="languageSwitcher">
            <option value="en" ${state.language === "en" ? "selected" : ""}>English</option>
            <option value="zh" ${state.language === "zh" ? "selected" : ""}>中文</option>
          </select>
        </label>
        ${cloudStatusHtml()}
        ${cloudActionButtonsHtml()}
        <span class="pill">${t("Current User")}: ${state.currentUser.name} / ${state.currentUser.role}</span>
        <button class="btn" id="logoutButton" type="button">${t("Logout")}</button>
        <input id="backupImportFile" type="file" accept="application/json" hidden />
      </div>
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
          <p>${t("Quotation")}</p>
          <h2 id="printQuoteNumber"></h2>
        </div>
      </div>
      <div class="print-customer" id="printCustomer"></div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>${t("Product")}</th><th>Size</th><th>${t("Quantity")}</th><th>${t("Color")}</th><th>${t("Handle Position")}</th><th>${t("Mesh / Net Type")}</th><th>${t("Remark")}</th><th class="right">${t("Unit Price")}</th><th class="right">${t("Total")}</th>
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
  return pageDefinitions
    .filter((page) => canAccessPage(role(), page.id))
    .map((page) => `<button class="module-tab ${state.currentPage === page.id ? "active" : ""}" data-page="${page.id}" type="button">${t(page.label)}</button>`)
    .join("");
}

function currentPageHtml() {
  if (!canAccessPage(role(), state.currentPage)) {
    return `<section class="panel page-panel"><p class="muted-text">${t("You do not have permission to access this page.")}</p></section>`;
  }
  if (state.currentPage === "dashboard") return dashboardPageHtml();
  if (state.currentPage === "quotation") return quotationPageHtml();
  if (state.currentPage === "customers") return customersPageHtml();
  if (state.currentPage === "orders") return ordersPageHtml();
  if (state.currentPage === "ads") return adsPageHtml();
  if (state.currentPage === "production") return productionPageHtml();
  if (state.currentPage === "installation") return installationPageHtml();
  if (state.currentPage === "products") return productManagementPageHtml();
  if (state.currentPage === "users") return usersPageHtml();
  return `<section class="panel page-panel"><p class="muted-text">${t("You do not have permission to access this page.")}</p></section>`;
}

function isCurrentPage(page) {
  return state.currentPage === page;
}

function dashboardPageHtml() {
  return `
    <section class="panel page-panel" data-page-panel="dashboard">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${t("Overview")}</p>
          <h2>${t("Order Progress Board")}</h2>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="metric-card"><span>${t("Quotations")}</span><strong>${state.quotations.length}</strong></div>
        <div class="metric-card"><span>${t("Orders")}</span><strong>${state.orders.length}</strong></div>
        <div class="metric-card"><span>${t("Production Jobs")}</span><strong>${state.productionJobs.length}</strong></div>
        <div class="metric-card"><span>${t("Installation Jobs")}</span><strong>${state.installationJobs.length}</strong></div>
      </div>
      ${cloudDebugPanelHtml()}
      <div id="orderProgressBoard" class="dashboard-progress"></div>
      <span class="pill" id="workflowStatus">${t("Ready")}</span>
    </section>
  `;
}

function quotationPageHtml() {
  return `
    <section class="page-panel quotation-page-grid" data-page-panel="quotation">
      <section class="panel quotation-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">${t("Sales")}</p>
            <h2>${t("Quotation")}</h2>
          </div>
          <div class="actions">
            <button class="btn" id="newQuoteButton" type="button">${t("New Quote")}</button>
            <button class="btn" id="printQuoteButton" type="button">${t("Print Quote")}</button>
            <button class="btn" id="pdfQuoteButton" type="button">${t("PDF Quote")}</button>
            <button class="btn primary" id="saveQuoteButton" type="button">${t("Save Quote")}</button>
          </div>
        </div>

        <form id="quotationForm" class="stack" onsubmit="return false">
          <div class="form-grid">
            <label>${t("Quotation Number")}<input id="quoteNumber" /></label>
            <label>${t("Quotation Status")}<select id="quoteStatus"></select></label>
            <label>${t("Customer Name")}<input id="customerName" placeholder="TEST CUSTOMER" /></label>
            <label>${t("Phone")}<input id="customerPhone" placeholder="0123456789" /></label>
            <label>${t("Area")}<input id="customerArea" placeholder="Bukit Tengah" /></label>
            <label>${t("Appointment Date")}<input id="appointmentDate" type="date" /></label>
            <label class="wide">${t("Address")}<textarea id="customerAddress" rows="3"></textarea></label>
            <label class="wide">${t("Customer Remark")}<textarea id="customerRemark" rows="2"></textarea></label>
            <label class="wide">${t("Quotation Remark")}<textarea id="quoteRemark" rows="2"></textarea></label>
          </div>

          <section class="products-editor">
            <div class="section-head">
              <div>
                <h3>${t("Products")}</h3>
                <span id="itemsCount" class="pill">${t("Items count")}: 0</span>
              </div>
              <button class="btn primary" id="addItemButton" type="button">${t("Add Item")}</button>
            </div>
            <div id="quoteItems" class="quote-items"></div>
          </section>

          <aside class="summary-box">
            <label>${t("Discount")}<input id="discount" inputmode="decimal" placeholder="0.00" /></label>
            <label>${t("Deposit")}<input id="deposit" inputmode="decimal" placeholder="0.00" /></label>
            <div class="summary-row"><span>${t("Subtotal")}</span><strong id="subtotalValue">RM 0.00</strong></div>
            <div class="summary-row"><span>${t("Total")}</span><strong id="totalValue">RM 0.00</strong></div>
            <div class="summary-row balance"><span>${t("Balance")}</span><strong id="balanceValue">RM 0.00</strong></div>
            <p id="saveStatus" class="muted-text">${t("Ready.")}</p>
          </aside>
        </form>
      </section>

      <aside class="side-column">
        <section class="panel">
          <div class="panel-head"><h2>${t("Saved Quotations")}</h2></div>
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
          <p class="eyebrow">${t("Customer Records")}</p>
          <h2>${t("Customers")}</h2>
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
          <p class="eyebrow">${t("Confirmed Jobs")}</p>
          <h2>${t("Orders")}</h2>
        </div>
        <span class="pill" id="workflowStatus">${t("Ready")}</span>
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
          <p class="eyebrow">${t("Factory")}</p>
          <h2>${t("Production Jobs")}</h2>
        </div>
        <span class="pill" id="workflowStatus">${t("Ready")}</span>
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
          <p class="eyebrow">${t("Installer")}</p>
          <h2>${t("Installation Jobs")}</h2>
        </div>
        <span class="pill" id="workflowStatus">${t("Ready")}</span>
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
          <p class="eyebrow">${t("Settings")}</p>
          <h2>${t("Product Management")}</h2>
        </div>
      </div>
      <div id="addProductPanel"></div>
      <p id="productSaveStatus" class="muted-text"></p>
      <div id="productList" class="product-list"></div>
    </section>
  `;
}

function usersPageHtml() {
  return `
    <section class="panel page-panel" data-page-panel="users" id="userManagementPanel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${t("Settings")}</p>
          <h2>${t("User Account Management")}</h2>
        </div>
      </div>
      ${renderUserManagement()}
    </section>
  `;
}

function renderShell() {
  if (state.currentUser && !canAccessPage(role(), state.currentPage)) setPage(defaultPageForRole(role()));
  document.querySelector("#app").innerHTML = appHtml();
  if (!state.currentUser) {
    attachLoginEvents(renderShell);
    return;
  }
  syncCloudOnFirstLogin();
  attachHeaderEvents();
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
  if (["dashboard", "orders", "production", "installation"].includes(state.currentPage)) {
    attachWorkflowEvents();
    renderWorkflowModules();
  }
  if (isCurrentPage("ads")) {
    attachAdsEvents();
    renderAdsDashboard();
  }
  if (isCurrentPage("customers")) renderCustomers();
  if (isCurrentPage("users")) attachUserManagementEvents(renderShell);
}

function syncCloudOnFirstLogin() {
  if (cloudHydrated || !isCloudConfigured()) return;
  cloudHydrated = true;
  updateCloudStatus({ status: "Checking cloud...", connected: false });
  safeSyncWithCloud(stateSnapshot()).then((result) => {
    applyCloudSnapshot(result.snapshot || {});
    updateCloudStatus({
      status: result.ok ? "Cloud Connected" : "Cloud Sync Failed",
      connected: result.ok,
      lastSyncAt: result.ok ? new Date().toISOString() : state.cloud.lastSyncAt,
      lastError: result.ok ? "" : result.reason || "Cloud sync failed.",
      counts: result.summary?.cloudCounts || {}
    });
    renderShell();
  }).catch((error) => {
    updateCloudStatus({
      status: "Cloud Sync Failed",
      connected: false,
      lastError: error.message || "Cloud sync failed."
    });
    renderShell();
  });
}

function cloudStatusHtml() {
  const status = isCloudConfigured() ? state.cloud.status : "Local Mode Only";
  const lastSync = state.cloud.lastSyncAt ? new Date(state.cloud.lastSyncAt).toLocaleString("en-MY") : "-";
  const statusClass = status === "Cloud Connected" ? "success" : status === "Cloud Sync Failed" ? "danger" : "";
  return `<span class="pill ${statusClass}" title="${escapeHtml(state.cloud.lastError || "")}">${escapeHtml(status)} | Last Sync: ${escapeHtml(lastSync)}</span>`;
}

function cloudActionButtonsHtml() {
  if (!isBossOrAdmin()) return "";
  return `
    <button class="btn" id="syncNowButton" type="button">Sync Now</button>
    <button class="btn" id="exportBackupButton" type="button">Export Backup / 导出备份</button>
    <button class="btn" id="importBackupButton" type="button">Import Backup</button>
  `;
}

function cloudDebugPanelHtml() {
  if (!isBossOrAdmin()) return "";
  return `
    <section class="panel cloud-debug-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Cloud Debug</p>
          <h2>Sync Safety Check</h2>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="metric-card"><span>Local quotations count</span><strong>${state.quotations.length}</strong></div>
        <div class="metric-card"><span>Cloud quotations count</span><strong>${state.cloud.counts.quotations ?? "-"}</strong></div>
        <div class="metric-card"><span>Local orders count</span><strong>${state.orders.length}</strong></div>
        <div class="metric-card"><span>Cloud orders count</span><strong>${state.cloud.counts.orders ?? "-"}</strong></div>
      </div>
      <p class="muted-text">Last cloud sync error: ${escapeHtml(state.cloud.lastError || "-")}</p>
    </section>
  `;
}

function manualSyncNow() {
  if (!isBossOrAdmin()) return;
  updateCloudStatus({ status: "Checking cloud..." });
  renderShell();
  safeSyncWithCloud(stateSnapshot()).then((result) => {
    applyCloudSnapshot(result.snapshot || {});
    updateCloudStatus({
      status: result.ok ? "Cloud Connected" : "Cloud Sync Failed",
      connected: result.ok,
      lastSyncAt: result.ok ? new Date().toISOString() : state.cloud.lastSyncAt,
      lastError: result.ok ? "" : result.reason || "Cloud sync failed.",
      counts: result.summary?.cloudCounts || {}
    });
    window.alert(syncSummaryText(result.summary));
    renderShell();
  }).catch((error) => {
    updateCloudStatus({
      status: "Cloud Sync Failed",
      connected: false,
      lastError: error.message || "Cloud sync failed."
    });
    window.alert(`Cloud Sync Failed: ${state.cloud.lastError}`);
    renderShell();
  });
}

function syncSummaryText(summary = {}) {
  const errors = summary.errors?.length ? `\nErrors: ${summary.errors.join("; ")}` : "";
  return [
    "Sync completed.",
    `Quotations uploaded: ${summary.uploaded?.quotations || 0}`,
    `Quotations downloaded: ${summary.downloaded?.quotations || 0}`,
    `Orders uploaded: ${summary.uploaded?.orders || 0}`,
    `Orders downloaded: ${summary.downloaded?.orders || 0}`
  ].join("\n") + errors;
}

function exportBackup() {
  if (!isBossOrAdmin()) return;
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    app: "Eco Screen CRM V2",
    data: stateSnapshot()
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `eco-screen-crm-v2-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBackupFile(file) {
  if (!isBossOrAdmin() || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const backupData = parsed.data || parsed;
      const confirmation = window.prompt("Type RESTORE to confirm backup import. This replaces local CRM data.");
      if (confirmation !== "RESTORE") return;
      replaceStateFromBackup(backupData);
      syncToCloud(stateSnapshot()).then((result) => {
        updateCloudStatus(result.ok
          ? {
            status: "Cloud Connected",
            connected: true,
            lastSyncAt: result.syncedAt || new Date().toISOString(),
            lastError: ""
          }
          : {
            status: "Cloud Sync Failed",
            connected: false,
            lastError: result.reason || "Cloud sync failed."
          });
        window.alert(result.ok ? "Backup imported and synced to cloud." : `Backup imported locally. Cloud sync failed: ${state.cloud.lastError}`);
        renderShell();
      });
    } catch (error) {
      window.alert(`Import failed: ${error.message || "Invalid backup file."}`);
    }
  };
  reader.readAsText(file);
}

function attachHeaderEvents() {
  document.querySelector("#languageSwitcher")?.addEventListener("change", (event) => {
    setLanguage(event.target.value);
    renderShell();
  });
  document.querySelector("#logoutButton")?.addEventListener("click", () => {
    logout();
    renderShell();
  });
  document.querySelector("#syncNowButton")?.addEventListener("click", manualSyncNow);
  document.querySelector("#exportBackupButton")?.addEventListener("click", exportBackup);
  document.querySelector("#importBackupButton")?.addEventListener("click", () => document.querySelector("#backupImportFile")?.click());
  document.querySelector("#backupImportFile")?.addEventListener("change", (event) => importBackupFile(event.target.files?.[0]));
}

function attachNavigationEvents() {
  document.querySelector("#moduleNavigation").addEventListener("click", (event) => {
    const page = event.target.dataset.page;
    if (!page || !canAccessPage(role(), page)) return;
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
        <span class="pill">${t(customer.status)}</span>
      </div>
      <p class="muted-text">${customer.address}</p>
      <p class="muted-text">${t("Order")}: ${customer.orderNumber} | ${t("Quote")}: ${customer.quoteNumber} | ${t("Total")}: ${money(customer.total)}</p>
    </article>
  `).join("") : `<p class="muted-text">${t("No confirmed order customers yet. Convert a quotation to create a customer record here.")}</p>`;
}

function currentPageTitle() {
  return pageDefinitions.find((page) => page.id === state.currentPage)?.title || "Quotation CRM";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

renderShell();
