import { attachLoginEvents, attachUserManagementEvents, logout, renderLoginCard, renderUserManagement } from "./auth.js";
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
  uid,
  updateCloudStatus
} from "./state.js";
import { itemWithCalculatedTotals, money, quoteTotals, toNumber } from "./calculations.js";
import { attachWorkflowEvents, getQuotationDisplayNo, nextSalesOrderNumber, renderWorkflowModules } from "./workflow.js";
import { t } from "./i18n.js";
import { canAccessPage, defaultPageForRole, isBossOrAdmin, pageDefinitions, role } from "./permissions.js";
import { cloudCollections, cloudConfigurationIssue, isCloudConfigured, safeSyncWithCloud, syncFromCloud, syncToCloud } from "./cloudSync.js";

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
      ${orderExportToolsHtml()}
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
      <div id="productionTools"></div>
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
  if (isCurrentPage("orders")) attachOrderExportEvents();
  if (isCurrentPage("dashboard")) attachMonthlySummaryEvents();
  if (isCurrentPage("customers")) renderCustomers();
  if (isCurrentPage("users")) attachUserManagementEvents(renderShell);
}

function syncCloudOnFirstLogin() {
  if (cloudHydrated || !isCloudConfigured()) return;
  cloudHydrated = true;
  updateCloudStatus({ status: "Syncing...", connected: false });
  safeSyncWithCloud(stateSnapshot(), { allowWrites: false }).then((result) => {
    applyCloudSnapshot(result.snapshot || {});
    updateCloudStatus({
      status: result.ok ? "Cloud Checked (read-only)" : "Cloud Sync Failed",
      connected: result.ok,
      lastSyncAt: state.cloud.lastSyncAt,
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
  const configurationIssue = cloudConfigurationIssue();
  const baseStatus = isCloudConfigured() ? state.cloud.status : "Local Mode";
  const status = configurationIssue
    ? `Local Mode: ${configurationIssue}`
    : state.cloud.connected
      ? baseStatus
      : baseStatus === "Cloud Sync Failed"
        ? `Cloud Sync Failed: ${state.cloud.lastError || "Unknown error"}`
        : baseStatus === "Checking cloud..."
          ? "Syncing..."
          : baseStatus;
  const lastSync = state.cloud.lastSyncAt ? new Date(state.cloud.lastSyncAt).toLocaleString("en-MY") : "-";
  const statusClass = state.cloud.connected ? "success" : status.startsWith("Cloud Sync Failed") ? "danger" : "";
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
  const local = stateSnapshot();
  const collectionRows = cloudCollections.map((collection) => `
    <tr><td>${escapeHtml(collection)}</td><td>${Array.isArray(local[collection]) ? local[collection].length : 0}</td><td>${state.cloud.counts[collection] ?? "-"}</td></tr>
  `).join("");
  return `
    <section class="panel cloud-debug-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Cloud Debug</p>
          <h2>Sync Safety Check</h2>
        </div>
      </div>
      <p class="muted-text">Last successful sync: ${escapeHtml(state.cloud.lastSyncAt ? new Date(state.cloud.lastSyncAt).toLocaleString("en-MY") : "-")}</p>
      <p class="muted-text">Last cloud sync error: ${escapeHtml(state.cloud.lastError || "-")}</p>
      <p class="muted-text">Collections synced: ${escapeHtml(cloudCollections.join(", "))}</p>
      <div class="table-wrap"><table><thead><tr><th>Collection</th><th>Local</th><th>Cloud</th></tr></thead><tbody>${collectionRows}</tbody></table></div>
    </section>
  `;
}

function manualSyncNow() {
  if (!isBossOrAdmin()) return;
  updateCloudStatus({ status: "Syncing...", connected: false });
  renderShell();
  safeSyncWithCloud(stateSnapshot()).then((result) => {
    applyCloudSnapshot(result.snapshot || {});
    updateCloudStatus({
      status: result.ok ? "Cloud Synced" : "Cloud Sync Failed",
      connected: result.ok,
      lastSyncAt: result.ok ? new Date().toISOString() : state.cloud.lastSyncAt,
      lastError: result.ok ? "" : result.reason || "Cloud sync failed.",
      counts: result.summary?.cloudCounts || {}
    });
    window.alert(syncSummaryText(result));
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

function syncSummaryText(result = {}) {
  const summary = result.summary || {};
  const errors = summary.errors?.length ? `\nErrors: ${summary.errors.join("; ")}` : "";
  return [
    result.ok ? "Cloud sync completed." : `Cloud Sync Failed: ${result.reason || "Unknown error"}`,
    `Quotations uploaded: ${summary.uploaded?.quotations || 0}`,
    `Quotations downloaded: ${summary.downloaded?.quotations || 0}`,
    `Orders uploaded: ${summary.uploaded?.orders || 0}`,
    `Orders downloaded: ${summary.downloaded?.orders || 0}`,
    summary.backupCreated ? "Full JSON backup downloaded before the first cloud write." : "No cloud write backup was needed for this sync."
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

function orderExportToolsHtml() {
  if (!isBossOrAdmin()) return "";
  return `
    <section class="panel order-export-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Backup / Export</p>
          <h2>Export Old V2 Orders</h2>
        </div>
      </div>
      <p class="muted-text">Read-only export. This only downloads data and will not delete, reset, migrate, import or change anything.</p>
      <div class="actions">
        <button class="btn" type="button" data-export-v2="orders-json">Export All Orders JSON</button>
        <button class="btn" type="button" data-export-v2="orders-csv">Export All Orders CSV</button>
        <button class="btn" type="button" data-export-v2="quotations-json">Export All Quotations JSON</button>
        <button class="btn" type="button" data-export-v2="quotations-csv">Export All Quotations CSV</button>
        <span class="muted-text" id="orderExportStatus"></span>
      </div>
    </section>
  `;
}

function attachOrderExportEvents() {
  document.querySelectorAll("[data-export-v2]").forEach((button) => {
    button.addEventListener("click", () => exportV2Data(button.dataset.exportV2));
  });
}

async function exportV2Data(type) {
  if (!isBossOrAdmin()) return;
  const confirmed = window.confirm("This will only download data. It will not delete or change anything.");
  if (!confirmed) return;
  setOrderExportStatus("Preparing export. Loading cloud data if available...", "info");
  const snapshot = await exportSnapshot();
  const stamp = exportTimestamp();
  if (type === "orders-json") {
    downloadJsonBackup(snapshot.orders, `eco-screen-crm-v2-orders-full-${stamp}.json`);
    setOrderExportStatus(`Orders JSON downloaded: ${snapshot.orders.length} orders.`, "success");
  }
  if (type === "orders-csv") {
    downloadTextFile(ordersSummaryCsv(snapshot), `eco-screen-crm-v2-orders-summary-${stamp}.csv`, "text/csv;charset=utf-8");
    downloadTextFile(ordersItemsCsv(snapshot), `eco-screen-crm-v2-orders-items-${stamp}.csv`, "text/csv;charset=utf-8");
    setOrderExportStatus(`Orders CSV downloaded: ${snapshot.orders.length} orders, ${countItems(snapshot.orders)} item rows.`, "success");
  }
  if (type === "quotations-json") {
    downloadJsonBackup(snapshot.quotations, `eco-screen-crm-v2-quotations-full-${stamp}.json`);
    setOrderExportStatus(`Quotations JSON downloaded: ${snapshot.quotations.length} quotations.`, "success");
  }
  if (type === "quotations-csv") {
    downloadTextFile(quotationsSummaryCsv(snapshot), `eco-screen-crm-v2-quotations-summary-${stamp}.csv`, "text/csv;charset=utf-8");
    setOrderExportStatus(`Quotations CSV downloaded: ${snapshot.quotations.length} quotations.`, "success");
  }
  if (snapshot.warning) setOrderExportStatus(`${document.querySelector("#orderExportStatus")?.textContent || "Export ready."} ${snapshot.warning}`, "warning");
}

async function exportSnapshot() {
  const local = stateSnapshot();
  if (!isCloudConfigured()) return { ...local, warning: "Local export only. Supabase is not configured." };
  const cloud = await syncFromCloud();
  if (!cloud.ok) return { ...local, warning: `Cloud load failed. Exported local data only: ${cloud.reason}` };
  return {
    ...local,
    customers: Array.isArray(cloud.data?.customers) && cloud.data.customers.length ? cloud.data.customers : local.customers,
    products: Array.isArray(cloud.data?.products) && cloud.data.products.length ? cloud.data.products : local.products,
    quotations: Array.isArray(cloud.data?.quotations) && cloud.data.quotations.length ? cloud.data.quotations : local.quotations,
    orders: Array.isArray(cloud.data?.orders) && cloud.data.orders.length ? cloud.data.orders : local.orders,
    productionJobs: Array.isArray(cloud.data?.productionJobs) && cloud.data.productionJobs.length ? cloud.data.productionJobs : local.productionJobs,
    installationJobs: Array.isArray(cloud.data?.installationJobs) && cloud.data.installationJobs.length ? cloud.data.installationJobs : local.installationJobs,
    warrantyCards: Array.isArray(cloud.data?.warrantyCards) && cloud.data.warrantyCards.length ? cloud.data.warrantyCards : local.warrantyCards
  };
}

function ordersSummaryCsv(snapshot) {
  const headers = [
    "Order No",
    "Quotation No / Old Ref No",
    "Customer Name",
    "Phone",
    "Area",
    "Address",
    "Appointment Date",
    "Status",
    "Order Date",
    "Discount",
    "Deposit",
    "Balance",
    "Total",
    "Payment Status",
    "Production Status",
    "Installation Status",
    "Installer",
    "Install Date",
    "Warranty Info",
    "Created At",
    "Updated At"
  ];
  const rows = snapshot.orders.map((order) => {
    const production = findExportProduction(order, snapshot);
    const installation = findExportInstallation(order, snapshot);
    const warranty = findExportWarranty(order, snapshot, installation);
    return [
      exportOrderNo(order),
      exportQuoteNo(order),
      order.customer?.name,
      order.customer?.phone,
      order.customer?.area,
      order.customer?.address,
      order.appointmentDate || order.appointment_date,
      order.status,
      order.orderDate || order.order_date || order.createdAt,
      order.discount,
      order.deposit,
      order.balance,
      order.total,
      order.paymentStatus || order.payment_status,
      order.productionStatus || production?.status,
      order.installationStatus || installation?.status,
      installation?.installerName || installation?.installer,
      installation?.installationDate || order.installationDate,
      warrantySummaryText(warranty),
      order.createdAt,
      order.updatedAt
    ];
  });
  return csvFromRows(headers, rows);
}

function ordersItemsCsv(snapshot) {
  const headers = [
    "Order No",
    "Quotation No / Old Ref No",
    "Customer Name",
    "Phone",
    "Status",
    "Item No",
    "Product Name",
    "Width",
    "Height",
    "Sqft",
    "Quantity",
    "Color",
    "Location",
    "Unit Price",
    "Manual Final Price",
    "Line Total",
    "Remark",
    "Production Status",
    "Installation Status",
    "Installer",
    "Install Date",
    "Created At",
    "Updated At"
  ];
  const rows = snapshot.orders.flatMap((order) => {
    const production = findExportProduction(order, snapshot);
    const installation = findExportInstallation(order, snapshot);
    const items = Array.isArray(order.items) ? order.items : [];
    return items.map((item, index) => [
      exportOrderNo(order),
      exportQuoteNo(order),
      order.customer?.name,
      order.customer?.phone,
      order.status,
      index + 1,
      item.productName,
      item.width,
      item.height,
      item.sqft || item.area || item.chargeableSqft || item.actualSqft,
      item.quantity,
      item.color,
      item.installationLocation || item.location,
      item.unitPrice,
      item.manualFinalPrice,
      item.lineTotal,
      item.remark,
      order.productionStatus || production?.status,
      order.installationStatus || installation?.status,
      installation?.installerName || installation?.installer,
      installation?.installationDate || order.installationDate,
      order.createdAt,
      order.updatedAt
    ]);
  });
  return csvFromRows(headers, rows);
}

function quotationsSummaryCsv(snapshot) {
  const headers = [
    "Quotation No / Old Ref No",
    "Customer Name",
    "Phone",
    "Area",
    "Address",
    "Appointment Date",
    "Status",
    "Discount",
    "Deposit",
    "Balance",
    "Total",
    "Created At",
    "Updated At"
  ];
  const rows = snapshot.quotations.map((quote) => [
    getQuotationDisplayNo(quote),
    quote.customer?.name || quote.customerName,
    quote.customer?.phone || quote.phone,
    quote.customer?.area || quote.area,
    quote.customer?.address || quote.address,
    quote.appointmentDate || quote.appointment_date,
    quote.status,
    quote.discount,
    quote.deposit,
    quote.balance,
    quote.total,
    quote.createdAt,
    quote.updatedAt
  ]);
  return csvFromRows(headers, rows);
}

function findExportProduction(order, snapshot) {
  const orderNo = exportOrderNo(order);
  return snapshot.productionJobs.find((job) => job.orderId === order.id || sameRef(job.orderNo || job.orderNumber, orderNo)) || null;
}

function findExportInstallation(order, snapshot) {
  const orderNo = exportOrderNo(order);
  return snapshot.installationJobs.find((job) => job.orderId === order.id || sameRef(job.orderNo || job.orderNumber, orderNo)) || null;
}

function findExportWarranty(order, snapshot, installation) {
  const orderNo = exportOrderNo(order);
  return snapshot.warrantyCards.find((card) => card.orderId === order.id || sameRef(card.orderNo || card.orderNumber, orderNo) || (installation?.installationNumber && card.installationJobNo === installation.installationNumber)) || null;
}

function warrantySummaryText(warranty) {
  if (!warranty) return "";
  return [warranty.warrantyNo, warranty.warrantyPeriod, warranty.startDate].filter(Boolean).join(" | ");
}

function exportOrderNo(order) {
  return order.orderNo || order.orderNumber || "";
}

function exportQuoteNo(order) {
  return order.quoteNumber || order.quotationNo || order.quoteNo || order.refNo || "";
}

function sameRef(left, right) {
  return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
}

function countItems(orders) {
  return orders.reduce((sum, order) => sum + (Array.isArray(order.items) ? order.items.length : 0), 0);
}

function csvFromRows(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function downloadTextFile(content, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportTimestamp() {
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
}

function setOrderExportStatus(message, type = "info") {
  const status = document.querySelector("#orderExportStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.type = type;
}

function orderResetToolsHtml() {
  if (!isBossOrAdmin()) return "";
  return `
    <section class="panel danger-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Admin Tools</p>
          <h2>Emergency Rebuild Orders From Quotations</h2>
        </div>
      </div>
      <p class="muted-text">
        This tool backs up all CRM data, clears workflow records, and rebuilds one Order from each Quotation that has items.
        Old converted flags are ignored. Production, Installation and Warranty records stay empty until you send orders later.
      </p>
      <div class="form-grid compact">
        <label class="wide">Confirmation Text
          <input id="rebuildOrdersConfirmation" placeholder="Type REBUILD ORDERS" autocomplete="off" />
        </label>
      </div>
      <div class="actions">
        <button class="btn" id="backupBeforeRebuildOrdersButton" type="button">Backup First</button>
        <button class="btn danger" id="rebuildOrdersFromQuotationsButton" type="button">Rebuild Orders From Quotations</button>
        <span class="muted-text" id="rebuildOrdersStatus"></span>
      </div>
    </section>
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
  document.querySelector("#backupBeforeRebuildOrdersButton")?.addEventListener("click", exportRebuildOrdersBackup);
  document.querySelector("#rebuildOrdersFromQuotationsButton")?.addEventListener("click", rebuildOrdersFromQuotations);
}

function exportRebuildOrdersBackup() {
  if (!isBossOrAdmin()) return;
  downloadJsonBackup(orderResetBackupPayload(), rebuildOrdersBackupFilename());
  setRebuildOrdersStatus("Backup downloaded. You can rebuild after checking the backup file.", "success");
}

function rebuildOrdersFromQuotations() {
  if (!isBossOrAdmin()) return;
  const confirmation = document.querySelector("#rebuildOrdersConfirmation")?.value || "";
  if (confirmation !== "REBUILD ORDERS") {
    setRebuildOrdersStatus("Type REBUILD ORDERS to confirm rebuild.", "error");
    return;
  }
  const proceed = window.confirm("This will clear Orders, Production Jobs, Installation Jobs and Warranty Cards, then rebuild Orders from Quotations. Continue?");
  if (!proceed) return;

  downloadJsonBackup(orderResetBackupPayload(), rebuildOrdersBackupFilename());

  const now = new Date().toISOString();
  const errors = [];
  let skipped = 0;
  state.orders = [];
  const orders = [];
  const orderByQuoteId = new Map();
  const sortedQuotations = [...state.quotations].sort((a, b) => Date.parse(a.createdAt || a.updatedAt || 0) - Date.parse(b.createdAt || b.updatedAt || 0));
  sortedQuotations.forEach((quote) => {
    if (!Array.isArray(quote.items) || !quote.items.length) {
      skipped += 1;
      errors.push(`${getQuotationDisplayNo(quote) || quote.id || "Unknown quotation"} skipped: no items`);
      return;
    }
    const order = buildOrderFromQuotationForRebuild(quote, now);
    orders.push(order);
    state.orders = orders;
    orderByQuoteId.set(quote.id, order);
  });
  const updatedQuotations = state.quotations.map((quote) => {
    const order = orderByQuoteId.get(quote.id);
    if (!order) return quote;
    return {
      ...quote,
      convertedToOrder: true,
      converted: true,
      orderId: order.id,
      orderNo: order.orderNo,
      orderNumber: order.orderNumber,
      convertedAt: now,
      updatedAt: now
    };
  });

  state.orders = orders;
  state.productionJobs = [];
  state.installationJobs = [];
  state.warrantyCards = [];
  state.quotations = updatedQuotations;

  const syncs = [
    persistOrders(),
    persistQuotations(),
    persistProductionJobs(),
    persistInstallationJobs(),
    persistWarrantyCards()
  ];
  Promise.all(syncs).then((results) => {
    const failed = results.find((result) => result && !result.ok && result.reason !== "Local Mode Only");
    updateCloudStatus(failed
      ? { status: "Cloud Sync Failed", connected: false, lastError: failed.reason || "Cloud sync failed." }
      : { status: isCloudConfigured() ? "Cloud Connected" : "Local Mode Only", connected: isCloudConfigured(), lastSyncAt: new Date().toISOString(), lastError: "" });
    renderShell();
    setRebuildOrdersStatus(rebuildOrdersResultMessage(orders.length, skipped, errors, failed), failed ? "warning" : "success");
  }).catch((error) => {
    console.error("Rebuild orders sync failed", error);
    updateCloudStatus({ status: "Cloud Sync Failed", connected: false, lastError: error.message || "Cloud sync failed." });
    renderShell();
    setRebuildOrdersStatus(rebuildOrdersResultMessage(orders.length, skipped, errors, { reason: "Cloud sync failed" }), "warning");
  });

  setRebuildOrdersStatus("Rebuilding orders and syncing cloud...", "info");
}

function buildOrderFromQuotationForRebuild(quote, now) {
  const quoteNo = getQuotationDisplayNo(quote) || `Q-${String(quote.id || Date.now()).replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase()}`;
  const orderNo = nextSalesOrderNumber(new Date(now));
  const items = Array.isArray(quote.items) ? quote.items.map((item) => itemWithCalculatedTotals(item)) : [];
  const totals = quoteTotals(items, quote.discount, quote.deposit);
  const total = toNumber(quote.total || totals.total);
  const deposit = toNumber(quote.deposit);
  const balance = Math.max(toNumber(quote.balance ?? totals.balance), 0);
  return {
    id: quote.orderId || uid("order"),
    quoteId: quote.id,
    quotationId: quote.id,
    orderNo,
    orderNumber: orderNo,
    quoteNumber: quoteNo,
    quotationNo: quoteNo,
    customer: normalizeQuoteCustomer(quote),
    items,
    subtotal: toNumber(quote.subtotal || totals.subtotal),
    discount: toNumber(quote.discount),
    total,
    deposit,
    balance: total > 0 ? Math.max(total - deposit, 0) : balance,
    status: total > 0 ? "Confirmed" : "Confirmed - Need Review",
    sentToProduction: false,
    productionStatus: "not_produced",
    installationStatus: "not_scheduled",
    installationDate: quote.appointmentDate || "",
    remark: quote.remark || "",
    createdAt: quote.createdAt || now,
    updatedAt: now
  };
}

function normalizeQuoteCustomer(quote) {
  const customer = quote.customer || {};
  return {
    name: customer.name || quote.customerName || quote.name || "Unknown Customer",
    phone: customer.phone || quote.phone || quote.customerPhone || "",
    area: customer.area || quote.area || "",
    address: customer.address || quote.address || "",
    remark: customer.remark || quote.customerRemark || ""
  };
}

function rebuildOrdersResultMessage(created, skipped, errors, failed) {
  const lines = [
    failed ? "Rebuild saved locally but cloud sync failed. Please click Sync Now." : "Rebuild completed.",
    `Orders created: ${created}`,
    `Skipped: ${skipped}`
  ];
  if (errors.length) lines.push(`Errors: ${errors.slice(0, 10).join(" | ")}`);
  return lines.join("\n");
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

function rebuildOrdersBackupFilename() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
  return `eco-screen-crm-v2-backup-before-order-rebuild-${stamp}.json`;
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

function setRebuildOrdersStatus(message, type = "info") {
  const status = document.querySelector("#rebuildOrdersStatus");
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
  const orderNo = order.orderNo || order.orderNumber || "";
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || (orderNo && (job.orderNumber === orderNo || job.orderNo === orderNo)));
  return toNumber(order.deposit) + toNumber(installationJob?.amountCollected);
}

function isOrderCompleted(order) {
  const orderNo = order.orderNo || order.orderNumber || "";
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || (orderNo && (job.orderNumber === orderNo || job.orderNo === orderNo)));
  return ["Completed", "Serviced"].includes(order.status) || ["installed", "Completed"].includes(installationJob?.status);
}

function isOrderReadyForCollection(order) {
  const orderNo = order.orderNo || order.orderNumber || "";
  const installationJob = state.installationJobs.find((job) => job.orderId === order.id || (orderNo && (job.orderNumber === orderNo || job.orderNo === orderNo)));
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
  document.querySelectorAll("#moduleNavigation [data-page]").forEach((button) => button.addEventListener("click", (event) => {
    const page = event.currentTarget.dataset.page;
    if (!page || !canAccessPage(role(), page)) return;
    setPage(page);
    renderShell();
  }));
}

function renderCustomers() {
  const list = document.querySelector("#customerList");
  if (!list) return;
  const customers = state.orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNo || order.orderNumber,
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
