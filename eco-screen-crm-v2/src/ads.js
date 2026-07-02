import { money, toNumber } from "./calculations.js";
import { t } from "./i18n.js";
import { persistAdsEntries, state, today, uid } from "./state.js";

export const adPlatforms = ["Facebook", "Google", "TikTok", "Xiaohongshu", "Other"];

const adNumberFields = [
  "spend",
  "clicks",
  "whatsappLeads",
  "appointments",
  "quotations",
  "closedOrders",
  "revenue"
];

export function adsPageHtml() {
  const platforms = adPlatforms.map((platform) => `<option value="${platform}">${platform}</option>`).join("");
  return `
    <section class="page-panel ads-page-grid" data-page-panel="ads">
      <section class="panel ads-entry-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">${t("Marketing")}</p>
            <h2>${t("Ads Tracker")}</h2>
          </div>
        </div>

        <form id="adsEntryForm" class="stack" onsubmit="return false">
          <div class="form-grid">
            <label>${t("Date")}<input id="adsDate" type="date" value="${today()}" /></label>
            <label>${t("Platform")}<select id="adsPlatform">${platforms}</select></label>
            <label>${t("Campaign Name")}<input id="campaignName" /></label>
            <label>${t("Ad Set Name")}<input id="adSetName" /></label>
            <label>${t("Ad Name")}<input id="adName" /></label>
            <label>${t("Spend")}<input id="spend" inputmode="decimal" placeholder="0.00" /></label>
            <label>${t("Clicks")}<input id="clicks" inputmode="numeric" placeholder="0" /></label>
            <label>${t("WhatsApp Leads")}<input id="whatsappLeads" inputmode="numeric" placeholder="0" /></label>
            <label>${t("Appointments")}<input id="appointments" inputmode="numeric" placeholder="0" /></label>
            <label>${t("Quotations")}<input id="quotations" inputmode="numeric" placeholder="0" /></label>
            <label>${t("Closed Orders")}<input id="closedOrders" inputmode="numeric" placeholder="0" /></label>
            <label>${t("Revenue")}<input id="revenue" inputmode="decimal" placeholder="0.00" /></label>
            <label class="wide">${t("Remark")}<textarea id="adsRemark" rows="3"></textarea></label>
          </div>
          <div class="ads-live-preview" id="adsLivePreview"></div>
          <div class="actions">
            <button class="btn" id="clearAdsFormButton" type="button">${t("Clear")}</button>
            <button class="btn primary" id="saveAdsButton" type="button">${t("Save Ads Entry")}</button>
          </div>
          <p id="adsSaveStatus" class="muted-text">${t("Ready.")}</p>
        </form>
      </section>

      <section class="panel ads-dashboard-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">${t("Performance")}</p>
            <h2>${t("Ads Dashboard")}</h2>
          </div>
        </div>
        <div id="adsSummary" class="dashboard-grid ads-summary-grid"></div>
        <div class="order-tools ads-filter-tools">
          <div class="form-grid compact">
            <label>${t("Platform")}
              <select id="adsPlatformFilter">
                <option value="All">${t("All Platforms")}</option>
                ${platforms}
              </select>
            </label>
            <label>${t("From Date")}<input id="adsFromDate" type="date" /></label>
            <label>${t("To Date")}<input id="adsToDate" type="date" /></label>
            <label>${t("Search")}<input id="adsSearch" placeholder="${t("Campaign, ad set, ad name")}" /></label>
          </div>
          <button class="btn" id="clearAdsFilterButton" type="button">${t("Clear Filter")}</button>
        </div>
        <div id="adsTable"></div>
      </section>
    </section>
  `;
}

export function attachAdsEvents() {
  document.querySelector("#saveAdsButton")?.addEventListener("click", saveAdsEntry);
  document.querySelector("#clearAdsFormButton")?.addEventListener("click", resetAdsForm);
  document.querySelector("#adsEntryForm")?.addEventListener("input", renderAdsLivePreview);
  document.querySelector("#adsEntryForm")?.addEventListener("change", renderAdsLivePreview);
  ["#adsPlatformFilter", "#adsFromDate", "#adsToDate", "#adsSearch"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", renderAdsDashboard);
    document.querySelector(selector)?.addEventListener("change", renderAdsDashboard);
  });
  document.querySelector("#clearAdsFilterButton")?.addEventListener("click", clearAdsFilters);
  document.querySelector("#adsTable")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-ad]");
    if (!button) return;
    state.adsEntries = state.adsEntries.filter((entry) => entry.id !== button.dataset.deleteAd);
    persistAdsEntries();
    renderAdsDashboard();
  });
  renderAdsLivePreview();
}

export function renderAdsDashboard() {
  renderAdsSummary();
  renderAdsTable();
}

function saveAdsEntry() {
  const entry = entryFromForm();
  state.adsEntries = [entry, ...state.adsEntries];
  persistAdsEntries();
  resetAdsForm();
  renderAdsDashboard();
  const status = document.querySelector("#adsSaveStatus");
  if (status) status.textContent = t("Ads entry saved.");
}

function resetAdsForm() {
  const form = document.querySelector("#adsEntryForm");
  form?.reset();
  const date = document.querySelector("#adsDate");
  if (date) date.value = today();
  renderAdsLivePreview();
}

function clearAdsFilters() {
  ["#adsFromDate", "#adsToDate", "#adsSearch"].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.value = "";
  });
  const platform = document.querySelector("#adsPlatformFilter");
  if (platform) platform.value = "All";
  renderAdsDashboard();
}

function entryFromForm() {
  const entry = {
    id: uid("ads"),
    date: document.querySelector("#adsDate")?.value || today(),
    platform: document.querySelector("#adsPlatform")?.value || "Other",
    campaignName: document.querySelector("#campaignName")?.value.trim() || "",
    adSetName: document.querySelector("#adSetName")?.value.trim() || "",
    adName: document.querySelector("#adName")?.value.trim() || "",
    remark: document.querySelector("#adsRemark")?.value.trim() || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  adNumberFields.forEach((field) => {
    entry[field] = toNumber(document.querySelector(`#${field}`)?.value);
  });
  return entry;
}

function renderAdsLivePreview() {
  const preview = document.querySelector("#adsLivePreview");
  if (!preview) return;
  const metrics = calculatedAdMetrics(entryFromForm());
  preview.innerHTML = `
    <div><span>${t("Cost / WhatsApp")}</span><strong>${formatMoneyMetric(metrics.costPerWhatsapp)}</strong></div>
    <div><span>${t("Appointment Rate")}</span><strong>${formatPercent(metrics.appointmentRate)}</strong></div>
    <div><span>${t("Quotation Rate")}</span><strong>${formatPercent(metrics.quotationRate)}</strong></div>
    <div><span>${t("Closing Rate")}</span><strong>${formatPercent(metrics.closingRate)}</strong></div>
    <div><span>${t("Cost / Sale")}</span><strong>${formatMoneyMetric(metrics.costPerSale)}</strong></div>
    <div><span>${t("ROAS")}</span><strong>${formatNumberMetric(metrics.roas)}x</strong></div>
    <div class="ads-decision-preview"><span>${t("Decision")}</span>${decisionPill(metrics.decision)}</div>
  `;
}

function renderAdsSummary() {
  const summary = document.querySelector("#adsSummary");
  if (!summary) return;
  const rows = filteredAdsEntries();
  const totals = rows.reduce((acc, row) => {
    acc.spend += toNumber(row.spend);
    acc.whatsappLeads += toNumber(row.whatsappLeads);
    acc.appointments += toNumber(row.appointments);
    acc.closedOrders += toNumber(row.closedOrders);
    acc.revenue += toNumber(row.revenue);
    return acc;
  }, { spend: 0, whatsappLeads: 0, appointments: 0, closedOrders: 0, revenue: 0 });
  const averageCostPerWhatsapp = safeDivide(totals.spend, totals.whatsappLeads);
  const overallRoas = safeDivide(totals.revenue, totals.spend);
  summary.innerHTML = [
    summaryCard("Total Spend", money(totals.spend)),
    summaryCard("Total WhatsApp Leads", totals.whatsappLeads),
    summaryCard("Average Cost per WhatsApp", formatMoneyMetric(averageCostPerWhatsapp)),
    summaryCard("Total Appointments", totals.appointments),
    summaryCard("Total Closed Orders", totals.closedOrders),
    summaryCard("Total Revenue", money(totals.revenue)),
    summaryCard("Overall ROAS", `${formatNumberMetric(overallRoas)}x`)
  ].join("");
}

function renderAdsTable() {
  const table = document.querySelector("#adsTable");
  if (!table) return;
  const rows = filteredAdsEntries();
  table.innerHTML = rows.length ? `
    <div class="ads-table-wrap">
      <table class="ads-table">
        <thead>
          <tr>
            <th>${t("Date")}</th>
            <th>${t("Platform")}</th>
            <th>${t("Campaign")}</th>
            <th>${t("Spend")}</th>
            <th>${t("Clicks")}</th>
            <th>${t("WhatsApp")}</th>
            <th>${t("Cost / WhatsApp")}</th>
            <th>${t("Appointment Rate")}</th>
            <th>${t("Quotation Rate")}</th>
            <th>${t("Closing Rate")}</th>
            <th>${t("Cost / Sale")}</th>
            <th>${t("ROAS")}</th>
            <th>${t("Decision")}</th>
            <th>${t("Remark")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderAdsRow).join("")}
        </tbody>
      </table>
    </div>
  ` : `<p class="empty-state">${t("No ads entries found.")}</p>`;
}

function renderAdsRow(entry) {
  const metrics = calculatedAdMetrics(entry);
  return `
    <tr>
      <td>${entry.date || "-"}</td>
      <td>${entry.platform || "-"}</td>
      <td>
        <strong>${entry.campaignName || "-"}</strong>
        <small>${entry.adSetName || "-"} / ${entry.adName || "-"}</small>
      </td>
      <td>${money(entry.spend)}</td>
      <td>${toNumber(entry.clicks)}</td>
      <td>${toNumber(entry.whatsappLeads)}</td>
      <td>${formatMoneyMetric(metrics.costPerWhatsapp)}</td>
      <td>${formatPercent(metrics.appointmentRate)}</td>
      <td>${formatPercent(metrics.quotationRate)}</td>
      <td>${formatPercent(metrics.closingRate)}</td>
      <td>${formatMoneyMetric(metrics.costPerSale)}</td>
      <td>${formatNumberMetric(metrics.roas)}x</td>
      <td>${decisionPill(metrics.decision)}</td>
      <td>${entry.remark || "-"}</td>
      <td><button class="btn danger compact-btn" data-delete-ad="${entry.id}" type="button">${t("Delete")}</button></td>
    </tr>
  `;
}

function filteredAdsEntries() {
  const platform = document.querySelector("#adsPlatformFilter")?.value || "All";
  const fromDate = document.querySelector("#adsFromDate")?.value || "";
  const toDate = document.querySelector("#adsToDate")?.value || "";
  const search = (document.querySelector("#adsSearch")?.value || "").trim().toLowerCase();
  return state.adsEntries.filter((entry) => {
    const entryDate = entry.date || "";
    const matchesPlatform = platform === "All" || entry.platform === platform;
    const matchesFrom = !fromDate || entryDate >= fromDate;
    const matchesTo = !toDate || entryDate <= toDate;
    const haystack = `${entry.campaignName || ""} ${entry.adSetName || ""} ${entry.adName || ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesPlatform && matchesFrom && matchesTo && matchesSearch;
  });
}

export function calculatedAdMetrics(entry) {
  const spend = toNumber(entry.spend);
  const whatsappLeads = toNumber(entry.whatsappLeads);
  const appointments = toNumber(entry.appointments);
  const quotations = toNumber(entry.quotations);
  const closedOrders = toNumber(entry.closedOrders);
  const revenue = toNumber(entry.revenue);
  const metrics = {
    costPerWhatsapp: safeDivide(spend, whatsappLeads),
    appointmentRate: safeDivide(appointments, whatsappLeads),
    quotationRate: safeDivide(quotations, appointments),
    closingRate: safeDivide(closedOrders, whatsappLeads),
    costPerSale: safeDivide(spend, closedOrders),
    roas: safeDivide(revenue, spend)
  };
  return {
    ...metrics,
    decision: adDecision({ spend, whatsappLeads, ...metrics })
  };
}

function adDecision(metrics) {
  if (metrics.roas >= 10) return "Scale";
  if (metrics.roas >= 5) return "Good";
  if (metrics.whatsappLeads === 0 && metrics.spend > 50) return "Pause / Review";
  if (metrics.costPerWhatsapp > 50) return "Too Expensive";
  if (metrics.whatsappLeads > 0 && metrics.appointmentRate < 0.2) return "Low Quality Leads";
  return "Monitor";
}

function summaryCard(label, value) {
  return `<div class="metric-card"><span>${t(label)}</span><strong>${value}</strong></div>`;
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatMoneyMetric(value) {
  return value > 0 ? money(value) : "-";
}

function formatNumberMetric(value) {
  return Number(value || 0).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toLocaleString("en-MY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })}%`;
}

function decisionPill(decision) {
  const typeMap = {
    Scale: "success",
    Good: "success",
    "Pause / Review": "error",
    "Too Expensive": "warning",
    "Low Quality Leads": "warning",
    Monitor: "muted"
  };
  return `<span class="pill" data-type="${typeMap[decision] || "muted"}">${t(decision)}</span>`;
}
