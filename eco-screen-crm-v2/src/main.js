import { attachLoginEvents, attachUserManagementEvents, logout, renderLoginCard, renderUserManagement } from "./auth.js";
import { adsPageHtml, attachAdsEvents, renderAdsDashboard } from "./ads.js";
import { renderAddProductForm, renderProducts, attachProductEvents } from "./products.js";
import { attachQuotationEvents, renderQuotationForm } from "./quotations.js";
import {
  applyCloudSnapshot,
  persistCompanySettings,
  persistInstallationJobs,
  persistOrders,
  persistProductionJobs,
  persistQuotations,
  persistWarrantyCards,
  replaceStateFromBackup,
  setLanguage,
  setPage,
  state,
  stateSnapshot,
  updateCloudStatus
} from "./state.js";
import { money, toNumber } from "./calculations.js";
import { attachWorkflowEvents, renderWorkflowModules } from "./workflow.js";
import { t } from "./i18n.js";
import { canAccessPage, defaultPageForRole, isBossOrAdmin, pageDefinitions, role } from "./permissions.js";
import { isCloudConfigured, safeSyncWithCloud, syncToCloud } from "./cloudSync.js";

let cloudHydrated = false;
let monthlySummaryMonth = currentMonthValue();

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
          <span class="version-label">${escapeHtml(state.companySettings.companyPhone)}</span>
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
          <h1>${escapeHtml(state.companySettings.companyName)}</h1>
          <p>${escapeHtml(state.companySettings.companyAddress)}</p>
          <p>Tel: ${escapeHtml(state.companySettings.companyPhone)}</p>
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
      ${monthlySummaryHtml()}
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
      ${companySettingsHtml()}
      ${orderResetToolsHtml()}
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
    attachCompanySettingsEvents();
    attachOrderResetToolsEvents();
    renderAddProductForm();
    renderProducts();
  }
  if (["dashboard", "orders", "production", "installation"].includes(state.currentPage)) {
    attachWorkflowEvents();
    renderWorkflowModules();
  }
  if (isCurrentPage("dashboard")) attachMonthlySummaryEvents();
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

function companySettingsHtml() {
  if (!isBossOrAdmin()) return "";
  const settings = state.companySettings;
  return `
    <section class="panel company-settings-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Company Settings</p>
          <h2>Company Settings</h2>
        </div>
      </div>
      <div class="form-grid">
        <label>Company Name<input data-company-field="companyName" value="${escapeHtml(settings.companyName)}" /></label>
        <label>Company Phone<input data-company-field="companyPhone" value="${escapeHtml(settings.companyPhone)}" /></label>
        <label class="wide">Company Address<textarea rows="2" data-company-field="companyAddress">${escapeHtml(settings.companyAddress)}</textarea></label>
        <label>Company Email<input data-company-field="companyEmail" value="${escapeHtml(settings.companyEmail)}" /></label>
        <label>Bank Name<input data-company-field="bankName" value="${escapeHtml(settings.bankName)}" /></label>
        <label>Bank Account Name<input data-company-field="bankAccountName" value="${escapeHtml(settings.bankAccountName)}" /></label>
        <label>Bank Account Number<input data-company-field="bankAccountNumber" value="${escapeHtml(settings.bankAccountNumber)}" /></label>
      </div>
      <div class="actions">
        <button class="btn primary" id="saveCompanySettingsButton" type="button">Save Company Settings</button>
        <span class="muted-text" id="companySettingsStatus"></span>
      </div>
    </section>
  `;
}

function attachCompanySettingsEvents() {
  document.querySelector("#saveCompanySettingsButton")?.addEventListener("click", () => {
    document.querySelectorAll("[data-company-field]").forEach((input) => {
      state.companySettings[input.dataset.companyField] = input.value;
    });
    persistCompanySettings().then((result) => {
      const status = document.querySelector("#companySettingsStatus");
      if (status) status.textContent = result.ok ? "Company settings saved and synced." : "Company settings saved locally.";
    });
  });
}

function orderResetToolsHtml() {
  if (!isBossOrAdmin()) return "";
  return `
    <section class="panel danger-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Admin Tools</p>
          <h2>Reset Orders and Reconversion Data</h2>
        </div>
      </div>
      <p class="muted-text">
        This will delete Orders, Production Jobs, Installation Jobs and Warranty Cards.
        Quotations will be kept. Customers will be kept. Products will be kept.
        Company Settings will be kept. This action is for fixing order conversion records.
      </p>
      <div class="form-grid compact">
        <label class="wide">Confirmation Text
          <input id="resetOrdersConfirmation" placeholder="Type RESET ORDERS" autocomplete="off" />
        </label>
      </div>
      <div class="actions">
        <button class="btn" id="backupBeforeOrderResetButton" type="button">Backup Data First</button>
        <button class="btn danger" id="resetOrdersOnlyButton" type="button">Reset Orders Only</button>
        <span class="muted-text" id="orderResetStatus"></span>
      </div>
    </section>
  `;
}

function attachOrderResetToolsEvents() {
  document.querySelector("#backupBeforeOrderResetButton")?.addEventListener("click", exportOrderResetBackup);
  document.querySelector("#resetOrdersOnlyButton")?.addEventListener("click", resetOrdersOnly);
}

function exportOrderResetBackup() {
  if (!isBossOrAdmin()) return;
  downloadJsonBackup(orderResetBackupPayload(), orderResetBackupFilename());
  setOrderResetStatus("Backup downloaded. You can reset after checking the backup file.", "success");
}

function resetOrdersOnly() {
  if (!isBossOrAdmin()) return;
  const status = document.querySelector("#orderResetStatus");
  const confirmation = document.querySelector("#resetOrdersConfirmation")?.value || "";
  if (confirmation !== "RESET ORDERS") {
    setOrderResetStatus("Type RESET ORDERS to confirm reset.", "error");
    return;
  }
  const proceed = window.confirm("This will delete Orders, Production Jobs, Installation Jobs and Warranty Cards. Quotations will be kept. Continue?");
  if (!proceed) return;

  downloadJsonBackup(orderResetBackupPayload(), orderResetBackupFilename());

  state.orders = [];
  state.productionJobs = [];
  state.installationJobs = [];
  state.warrantyCards = [];
  state.quotations = state.quotations.map((quote) => {
    const next = { ...quote };
    next.convertedToOrder = false;
    next.converted = false;
    next.orderId = null;
    next.orderNo = null;
    next.orderNumber = null;
    next.convertedAt = null;
    if (next.workflowStatus && !["quoted", "follow_up"].includes(next.workflowStatus)) next.workflowStatus = "quoted";
    if (["won", "converted", "ordered"].includes(String(next.status || "").toLowerCase())) next.status = "quoted";
    return next;
  });

  const syncs = [
    persistOrders(),
    persistProductionJobs(),
    persistInstallationJobs(),
    persistWarrantyCards(),
    persistQuotations()
  ];
  Promise.all(syncs).then((results) => {
    const failed = results.find((result) => result && !result.ok && result.reason !== "Local Mode Only");
    updateCloudStatus(failed
      ? { status: "Cloud Sync Failed", connected: false, lastError: failed.reason || "Cloud sync failed." }
      : { status: isCloudConfigured() ? "Cloud Connected" : "Local Mode Only", connected: isCloudConfigured(), lastSyncAt: new Date().toISOString(), lastError: "" });
    renderShell();
    setOrderResetStatus(failed
      ? "Reset saved locally but cloud sync failed. Please click Sync Now."
      : "Orders reset completed. You can now reconvert quotations.",
    failed ? "warning" : "success");
  }).catch((error) => {
    console.error("Reset orders sync failed", error);
    updateCloudStatus({ status: "Cloud Sync Failed", connected: false, lastError: error.message || "Cloud sync failed." });
    renderShell();
    setOrderResetStatus("Reset saved locally but cloud sync failed. Please click Sync Now.", "warning");
  });

  if (status) status.textContent = "Resetting orders and syncing cloud...";
}

function orderResetBackupPayload() {
  return {
    timestamp: new Date().toISOString(),
    customers: state.customers,
    quotations: state.quotations,
    orders: state.orders,
    productionJobs: state.productionJobs,
    installationJobs: state.installationJobs,
    warrantyCards: state.warrantyCards,
    products: state.products,
    users: state.users,
    companySettings: state.companySettings
  };
}

function orderResetBackupFilename() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
  return `eco-screen-crm-v2-backup-before-order-reset-${stamp}.json`;
}

function downloadJsonBackup(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setOrderResetStatus(message, type = "info") {
  const status = document.querySelector("#orderResetStatus");
  if (!status) {
    window.alert(message);
    return;
  }
  status.textContent = message;
  status.dataset.type = type;
}

function attachMonthlySummaryEvents() {
  document.querySelector("[data-month-preset='this']")?.addEventListener("click", () => {
    monthlySummaryMonth = currentMonthValue();
    renderShell();
  });
  document.querySelector("[data-month-preset='last']")?.addEventListener("click", () => {
    monthlySummaryMonth = monthOffsetValue(-1);
    renderShell();
  });
  document.querySelector("#monthlySummaryMonth")?.addEventListener("change", (event) => {
    monthlySummaryMonth = event.target.value || currentMonthValue();
    renderShell();
  });
}

function monthlySummary(monthValue) {
  const rows = state.orders.filter((order) => isOrderInMonth(order, monthValue) && !order.isArchived && order.status !== "Cancelled");
  return rows.reduce((summary, order) => {
    const total = toNumber(order.total);
    const collected = totalCollectedForOrder(order);
    const remaining = Math.max(total - collected, 0);
    const completed = remaining <= 0 && isOrderCompleted(order);
    summary.totalSales += total;
    summary.totalDeposit += toNumber(order.deposit);
    summary.totalCollected += collected;
    summary.outstanding += remaining;
    summary.newOrdersCount += 1;
    if (remaining > 0 && isOrderReadyForCollection(order)) {
      summary.pendingCollection += remaining;
      summary.pendingCollectionCount += 1;
    }
    if (completed) {
      summary.completedAmount += total;
      summary.completedCount += 1;
    }
    if (remaining > 0 || !completed) summary.activeOrdersCount += 1;
    return summary;
  }, {
    totalSales: 0,
    totalDeposit: 0,
    totalCollected: 0,
    outstanding: 0,
    pendingCollection: 0,
    completedAmount: 0,
    newOrdersCount: 0,
    activeOrdersCount: 0,
    pendingCollectionCount: 0,
    completedCount: 0
  });
}

function totalCollectedForOrder(order) {
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || job.orderNumber === order.orderNumber);
  return toNumber(order.deposit) + toNumber(installationJob?.amountCollected);
}

function isOrderCompleted(order) {
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || job.orderNumber === order.orderNumber);
  return ["Completed", "Serviced"].includes(order.status) || ["installed", "Completed"].includes(installationJob?.status);
}

function isOrderReadyForCollection(order) {
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || job.orderNumber === order.orderNumber);
  return ["Pending Collection", "Completed", "Serviced"].includes(order.status)
    || ["installed", "pending_collection", "Completed", "Pending Collection"].includes(installationJob?.status)
    || installationJob?.completionStatus === "Completed";
}

function isOrderInMonth(order, monthValue) {
  return String(order.createdAt || "").slice(0, 7) === monthValue;
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function monthOffsetValue(offset) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthlySummaryHtml() {
  if (!["Boss", "Admin", "Secretary"].includes(role())) return "";
  const summary = monthlySummary(monthlySummaryMonth);
  return `
    <section class="panel monthly-summary-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${uiLabel("Monthly Summary", "每月总结")}</p>
          <h2>${uiLabel("Monthly Summary", "每月总结")}</h2>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-month-preset="this">${uiLabel("This Month", "这个月")}</button>
          <button class="btn" type="button" data-month-preset="last">${uiLabel("Last Month", "上个月")}</button>
          <label>${uiLabel("Select Month", "选择月份")}<input id="monthlySummaryMonth" type="month" value="${monthlySummaryMonth}" /></label>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="metric-card"><span>${uiLabel("New Orders Total", "新单总额")}</span><strong>${money(summary.totalSales)}</strong><small>${summary.newOrdersCount} ${uiLabel("new orders", "新单")}</small></div>
        <div class="metric-card"><span>${uiLabel("Total Collected", "已收总额")}</span><strong>${money(summary.totalCollected)}</strong><small>${uiLabel("Deposit", "订金")}: ${money(summary.totalDeposit)}</small></div>
        <div class="metric-card"><span>${uiLabel("Outstanding Balance", "未收余额")}</span><strong>${money(summary.outstanding)}</strong><small>${summary.activeOrdersCount} ${uiLabel("active orders", "进行中订单")}</small></div>
        <div class="metric-card"><span>${uiLabel("Pending Collection", "等待收款")}</span><strong>${money(summary.pendingCollection)}</strong><small>${summary.pendingCollectionCount} ${uiLabel("pending", "等待")}</small></div>
        <div class="metric-card"><span>${uiLabel("Completed Orders", "已完成订单")}</span><strong>${money(summary.completedAmount)}</strong><small>${summary.completedCount} ${uiLabel("completed", "已完成")}</small></div>
      </div>
    </section>
  `;
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

function uiLabel(en, zh) {
  return state.language === "zh" ? zh : en;
}

renderShell();
