import { t } from "./i18n.js";
import { isBossOrAdmin } from "./permissions.js";
import { normalizeSocialPlatform, socialProvider, socialProviderPlatforms } from "./socialProviders.js";
import { persistSocialLeads, state, uid } from "./state.js";

const supportedPlatforms = new Set(socialProviderPlatforms());
const eligibleContactReasons = new Set(["direct_brand_interaction", "user_consented"]);
const activeLevels = new Set(["HOT", "WARM"]);
const statuses = new Set(["New", "Queued", "Contacted", "Rejected"]);

const highIntent = [
  "berapa harga", "price please", "pm price", "how much", "nak buat", "interested",
  "boleh pasang", "can install", "where is your shop", "ada penang", "quotation",
  "多少钱", "价格", "可以安装", "想安装", "有兴趣", "怎么联系"
];
const mediumIntent = ["mosquito", "nyamuk", "security", "screen", "sliding door", "roller screen", "pintu", "tingkap", "防蚊", "纱窗", "防盗", "推拉门", "卷帘"];
const productRules = [
  [/sliding|pintu sliding|推拉门/i, "Sliding Screen"],
  [/roller|卷帘/i, "Roller Screen"],
  [/security door|security screen|secure mesh|pintu keselamatan|防盗/i, "Security Screen / Door"],
  [/mosquito|nyamuk|insect|防蚊/i, "Mosquito Screen"],
  [/window|tingkap|窗|纱窗/i, "Window Screen"]
];
const locationRules = [
  [/\bBM\b|bukit mertajam/i, "Bukit Mertajam"],
  [/batu kawan/i, "Batu Kawan"],
  [/penang|pulau pinang/i, "Penang"],
  [/kulim/i, "Kulim"],
  [/seberang perai|butterworth/i, "Seberang Perai"]
];

let filters = { query: "", platform: "", level: "", status: "", location: "", need: "" };
let activeScanController = null;

export function renderSocialLeadMinerPage() {
  const leads = socialLeadRows();
  const stats = leadStats(leads);
  return `
    <section class="panel page-panel social-lead-miner" data-page-panel="social-lead-miner">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${t("Acquisition")}</p>
          <h2>${t("Social Lead Miner")}</h2>
          <p class="muted-text">${t("Import lawful public social comments, score buying intent, remove duplicates and move qualified people into a manual contact queue.")}</p>
        </div>
        <button class="btn" id="socialExportButton" type="button">${t("Export CSV")}</button>
      </div>

      <div class="social-metrics">
        ${metricHtml(t("Total Comments"), stats.total)}
        ${metricHtml(t("Qualified Leads"), stats.qualified)}
        ${metricHtml(t("HOT Leads"), stats.hot)}
        ${metricHtml(t("WARM Leads"), stats.warm)}
        ${metricHtml(t("Rejected Leads"), stats.rejected)}
        ${metricHtml(t("Duplicate Leads"), Number(state.socialLeadDuplicateCount || 0))}
      </div>

      <section class="card social-scan-card">
        <div class="form-grid compact">
          <label>${t("Platform")}<select id="socialPlatform"><option value="tiktok">TikTok</option><option value="facebook">Facebook</option><option value="rednote">${t("Xiaohongshu / RedNote")}</option></select></label>
          <label class="wide">${t("Post / Video URL")}<input id="socialSourceUrl" type="url" placeholder="${t("Paste a public post or video URL")}" /></label>
          <label>${t("Maximum Leads")}<select id="socialMaximumLeads"><option>50</option><option>100</option><option>200</option></select></label>
        </div>
        <details class="social-advanced">
          <summary>${t("Advanced Settings")}</summary>
          <div class="form-grid compact">
            <label>${t("Trigger Keywords")}<input id="socialTriggerKeywords" placeholder="berapa harga, interested" /></label>
            <label>${t("Exclude Keywords")}<input id="socialExcludeKeywords" placeholder="spam, giveaway" /></label>
          </div>
        </details>
        <div class="actions">
          <button class="btn primary" id="socialStartScanButton" type="button">${t("Start Scan")}</button>
          <button class="btn danger" id="socialStopScanButton" type="button" hidden>${t("Stop Scan")}</button>
          <span class="pill">TikTok · Facebook · ${t("RedNote")}</span>
        </div>
        <p id="socialScanStatus" class="muted-text">${t("Direct platform scanning needs an approved connector. No mock comments will be returned. You can use the lawful CSV import below.")}</p>
      </section>

      <section class="card social-import-card">
        <div class="section-head">
          <div><h3>${t("Lawful CSV Import")}</h3><p class="muted-text">${t("Use one public post or video per CSV and set platform to tiktok, facebook or rednote. The file stays inside this CRM and is scored after import.")}</p></div>
          <button class="btn" id="socialTemplateButton" type="button">${t("Download Template")}</button>
        </div>
        <div class="form-grid compact">
          <label>${t("Maximum Leads")}<select id="socialImportLimit"><option>50</option><option>100</option><option>200</option></select></label>
          <label class="wide social-confirmation"><input id="socialLawfulConfirm" type="checkbox" /> ${t("I confirm that this CSV contains lawfully obtained public comments and no private sensitive data.")}</label>
          <label class="wide">${t("Choose CSV File")}<input id="socialCsvFile" type="file" accept=".csv,text/csv" /></label>
        </div>
        <p id="socialImportStatus" class="muted-text"></p>
      </section>

      <section class="card social-filter-card">
        <div class="form-grid compact social-filters">
          <label>${t("Search")}<input id="socialFilterQuery" value="${escapeHtml(filters.query)}" placeholder="${t("User or comment")}" /></label>
          <label>${t("Platform")}<select id="socialFilterPlatform"><option value="">${t("All Platforms")}</option>${option("tiktok", filters.platform, "TikTok")}${option("facebook", filters.platform, "Facebook")}${option("rednote", filters.platform, t("RedNote"))}</select></label>
          <label>${t("Intent Level")}<select id="socialFilterLevel"><option value="">${t("All")}</option>${option("HOT", filters.level)}${option("WARM", filters.level)}${option("COLD", filters.level)}${option("NOT_LEAD", filters.level)}</select></label>
          <label>${t("Status")}<select id="socialFilterStatus"><option value="">${t("All")}</option>${["New", "Queued", "Contacted", "Rejected"].map((value) => option(value, filters.status, t(value))).join("")}</select></label>
          <label>${t("Location")}<input id="socialFilterLocation" value="${escapeHtml(filters.location)}" /></label>
          <label>${t("Need")}<input id="socialFilterNeed" value="${escapeHtml(filters.need)}" /></label>
        </div>
      </section>

      <div id="socialLeadResults">${socialLeadResultsHtml()}</div>
    </section>
  `;
}

export function attachSocialLeadMinerEvents(renderShell) {
  if (!isBossOrAdmin()) return;
  document.querySelector("#socialStartScanButton")?.addEventListener("click", () => startDirectScan(renderShell));
  document.querySelector("#socialStopScanButton")?.addEventListener("click", stopDirectScan);
  document.querySelector("#socialTemplateButton")?.addEventListener("click", downloadTemplate);
  document.querySelector("#socialCsvFile")?.addEventListener("change", (event) => importSelectedFile(event, renderShell));
  document.querySelector("#socialExportButton")?.addEventListener("click", exportFilteredLeads);
  ["Query", "Platform", "Level", "Status", "Location", "Need"].forEach((name) => {
    const element = document.querySelector(`#socialFilter${name}`);
    element?.addEventListener(element.tagName === "SELECT" ? "change" : "input", updateFilters);
  });
  document.querySelector("#socialLeadResults")?.addEventListener("click", (event) => handleLeadAction(event, renderShell));
}

export function parseSocialLeadCsv(text, options = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { leads: [], duplicates: 0, errors: ["CSV contains no data rows."] };
  const maximum = Math.min(200, Math.max(1, Number(options.maximum || 50)));
  const existing = new Set((options.existing || []).map(leadDuplicateKey));
  const imported = [];
  const errors = [];
  let duplicates = 0;
  for (const [index, row] of rows.entries()) {
    if (imported.length >= maximum) break;
    const candidate = normalizeImportedRow(row, options);
    if (!candidate.username || !candidate.comment || !candidate.sourceUrl) {
      errors.push(`Row ${index + 2}: username, comment and source_url are required.`);
      continue;
    }
    if (!supportedPlatforms.has(candidate.platform)) {
      errors.push(`Row ${index + 2}: platform must be tiktok, facebook or rednote.`);
      continue;
    }
    const key = leadDuplicateKey(candidate);
    if (existing.has(key)) { duplicates += 1; continue; }
    existing.add(key);
    imported.push(scoreSocialLead(candidate, options));
  }
  return { leads: imported, duplicates, errors };
}

export function ingestProviderComments(comments, options = {}) {
  const maximum = Math.min(200, Math.max(1, Number(options.maximum || 50)));
  const existing = new Set((options.existing || []).map(leadDuplicateKey));
  const leads = [];
  const errors = [];
  let duplicates = 0;
  for (const [index, row] of (Array.isArray(comments) ? comments : []).entries()) {
    if (leads.length >= maximum) break;
    const candidate = normalizeProviderComment(row, options);
    if (!candidate.username || !candidate.comment || !candidate.sourceUrl) {
      errors.push(`Comment ${index + 1}: username, comment and source URL are required.`);
      continue;
    }
    const key = leadDuplicateKey(candidate);
    if (existing.has(key)) { duplicates += 1; continue; }
    existing.add(key);
    leads.push(scoreSocialLead(candidate, options));
  }
  return { leads, duplicates, errors };
}

export function scoreSocialLead(lead, options = {}) {
  const comment = String(lead.comment || "");
  const normalized = normalize(comment);
  const triggers = keywordList(options.triggerKeywords);
  const excludes = keywordList(options.excludeKeywords);
  const highMatches = highIntent.filter((term) => normalized.includes(normalize(term)));
  const mediumMatches = mediumIntent.filter((term) => normalized.includes(normalize(term)));
  const triggerMatches = triggers.filter((term) => normalized.includes(normalize(term)));
  const excluded = excludes.some((term) => normalized.includes(normalize(term)));
  const hasQuestion = /\?|？|harga|price|how much|berapa|boleh|can |多少|价格|可以|安装/i.test(comment);
  const hasArea = locationRules.some(([expression]) => expression.test(comment));
  let score = 10 + highMatches.length * 42 + mediumMatches.length * 9 + triggerMatches.length * 16 + (hasQuestion ? 12 : 0) + (hasArea ? 10 : 0);
  if (excluded) score = 0;
  score = Math.max(0, Math.min(100, score));
  const level = excluded || score < 25 ? "NOT_LEAD" : score >= 80 ? "HOT" : score >= 55 ? "WARM" : "COLD";
  const need = firstRuleValue(comment, productRules) || "Eco Screen enquiry";
  const location = lead.region || firstRuleValue(comment, locationRules) || "Not stated";
  const reason = excluded
    ? "Excluded by administrator keyword."
    : highMatches.length
      ? `Explicit buying-intent phrase: ${highMatches[0]}.`
      : mediumMatches.length
        ? `Product or problem interest detected: ${mediumMatches[0]}.`
        : "No strong buying-intent phrase detected.";
  const now = new Date().toISOString();
  return {
    ...lead,
    id: lead.id || uid("social-lead"),
    intentScore: score,
    intentLevel: level,
    intentReason: reason,
    estimatedNeed: need,
    estimatedLocation: location,
    suggestedNextAction: activeLevels.has(level) ? "Review the public profile and request permission before contacting." : "Keep for analysis only.",
    suggestedMessages: outreachMessages({ need, location }),
    status: statuses.has(lead.status) ? lead.status : "New",
    createdAt: lead.createdAt || now,
    updatedAt: now
  };
}

export function canQueueSocialLead(lead) {
  return activeLevels.has(lead?.intentLevel)
    && eligibleContactReasons.has(lead?.contactEligibility)
    && Boolean(safePublicUrl(lead?.profileUrl));
}

function normalizeImportedRow(row, options) {
  const value = (name) => String(row[name] || "").trim();
  const platform = normalizeSocialPlatform(value("platform") || "tiktok");
  return {
    platform,
    username: value("username").replace(/^@/, ""),
    displayName: value("display_name"),
    profileUrl: safePublicUrl(value("profile_url")),
    avatarUrl: safePublicUrl(value("avatar_url")),
    comment: value("comment"),
    commentedAt: safeIso(value("comment_time")),
    sourceUrl: safePublicUrl(value("source_url") || options.sourceUrl),
    sourceAuthor: value("source_author"),
    region: value("region"),
    contactEligibility: value("contact_eligibility") || "not_eligible",
    acquisitionSource: "lawful_csv_import",
    importedBy: state.currentUser?.userId || "",
    importedAt: new Date().toISOString()
  };
}

function normalizeProviderComment(row = {}, options = {}) {
  const value = (...names) => {
    const name = names.find((key) => row[key] !== undefined && row[key] !== null);
    return String(name ? row[name] : "").trim();
  };
  return {
    platform: normalizeSocialPlatform(options.platform || value("platform") || "tiktok"),
    username: value("username", "userName").replace(/^@/, ""),
    displayName: value("displayName", "display_name"),
    profileUrl: safePublicUrl(value("profileUrl", "profile_url")),
    avatarUrl: safePublicUrl(value("avatarUrl", "avatar_url")),
    comment: value("comment", "text"),
    commentedAt: safeIso(value("commentedAt", "comment_time", "createdAt")),
    sourceUrl: safePublicUrl(value("sourceUrl", "source_url") || options.sourceUrl),
    sourceAuthor: value("sourceAuthor", "source_author"),
    region: value("region"),
    contactEligibility: value("contactEligibility", "contact_eligibility") || "not_eligible",
    acquisitionSource: "approved_social_provider",
    importedBy: state.currentUser?.userId || "",
    importedAt: new Date().toISOString()
  };
}

function socialLeadResultsHtml() {
  const rows = filteredLeads();
  if (!rows.length) return `<section class="card social-empty"><p class="muted-text">${t("No social leads match the current filters.")}</p></section>`;
  return `<div class="social-lead-table-wrap"><table class="social-lead-table"><thead><tr>
    <th>${t("Score")}</th><th>${t("User")}</th><th>${t("Comment")}</th><th>${t("Location")}</th><th>${t("Need")}</th><th>${t("Source")}</th><th>${t("Date")}</th><th>${t("Status")}</th><th>${t("Actions")}</th>
  </tr></thead><tbody>${rows.map(leadRowHtml).join("")}</tbody></table></div>`;
}

function leadRowHtml(lead) {
  const canQueue = canQueueSocialLead(lead) && lead.status === "New";
  return `<tr>
    <td><strong>${Number(lead.intentScore || 0)}</strong><span class="pill intent-${String(lead.intentLevel || "").toLowerCase()}">${escapeHtml(lead.intentLevel || "-")}</span></td>
    <td><strong>${escapeHtml(lead.displayName || lead.username)}</strong><small>@${escapeHtml(lead.username)}</small></td>
    <td><p>${escapeHtml(lead.comment)}</p><small>${escapeHtml(lead.intentReason)}</small></td>
    <td>${escapeHtml(lead.estimatedLocation || "-")}</td>
    <td>${escapeHtml(lead.estimatedNeed || "-")}</td>
    <td><a href="${escapeHtml(lead.sourceUrl)}" target="_blank" rel="noreferrer">${t("View Source")}</a><small>${escapeHtml(platformLabel(lead.platform))}${lead.sourceAuthor ? ` · ${escapeHtml(lead.sourceAuthor)}` : ""}</small></td>
    <td>${escapeHtml(formatDate(lead.commentedAt || lead.importedAt))}</td>
    <td><span class="pill">${t(lead.status || "New")}</span><small>${escapeHtml(contactEligibilityLabel(lead.contactEligibility))}</small></td>
    <td><div class="social-row-actions">
      ${lead.profileUrl ? `<a class="btn" href="${escapeHtml(lead.profileUrl)}" target="_blank" rel="noreferrer">${t("View Profile")}</a>` : ""}
      <button class="btn primary" type="button" data-social-action="queue" data-lead-id="${escapeHtml(lead.id)}" ${canQueue ? "" : "disabled"}>${t("Add to Contact Queue")}</button>
      ${lead.status === "Queued" ? `<button class="btn" type="button" data-social-action="contacted" data-lead-id="${escapeHtml(lead.id)}">${t("Mark Contacted")}</button>` : ""}
      <button class="btn" type="button" data-social-action="copy" data-language="English" data-lead-id="${escapeHtml(lead.id)}">${t("Copy EN")}</button>
      <button class="btn" type="button" data-social-action="copy" data-language="中文" data-lead-id="${escapeHtml(lead.id)}">${t("Copy ZH")}</button>
      <button class="btn" type="button" data-social-action="copy" data-language="Bahasa Melayu" data-lead-id="${escapeHtml(lead.id)}">${t("Copy BM")}</button>
      ${lead.status !== "Rejected" ? `<button class="btn danger" type="button" data-social-action="reject" data-lead-id="${escapeHtml(lead.id)}">${t("Reject")}</button>` : ""}
    </div></td>
  </tr>`;
}

async function startDirectScan(renderShell) {
  const status = document.querySelector("#socialScanStatus");
  const startButton = document.querySelector("#socialStartScanButton");
  const stopButton = document.querySelector("#socialStopScanButton");
  if (activeScanController) return;
  activeScanController = new AbortController();
  if (startButton) startButton.disabled = true;
  if (stopButton) stopButton.hidden = false;
  const platform = normalizeSocialPlatform(document.querySelector("#socialPlatform")?.value || "tiktok");
  const provider = socialProvider(platform);
  if (status) status.textContent = `${t("Scanning")} ${provider.label} ${t("comments...")}`;
  try {
    const sourceUrl = document.querySelector("#socialSourceUrl")?.value || "";
    const maximum = document.querySelector("#socialMaximumLeads")?.value || 50;
    const triggerKeywords = document.querySelector("#socialTriggerKeywords")?.value || "";
    const excludeKeywords = document.querySelector("#socialExcludeKeywords")?.value || "";
    const result = await provider.scan({
      sourceUrl,
      maximum,
      triggerKeywords,
      excludeKeywords,
      signal: activeScanController.signal
    });
    const imported = ingestProviderComments(result.comments, {
      platform,
      sourceUrl,
      maximum,
      triggerKeywords,
      excludeKeywords,
      existing: socialLeadRows()
    });
    state.socialLeads = [...imported.leads, ...socialLeadRows()];
    state.socialLeadDuplicateCount = Number(state.socialLeadDuplicateCount || 0) + imported.duplicates;
    await persistSocialLeads();
    if (status) status.textContent = `${t("Comments Found")}: ${result.comments.length}. ${t("Qualified Leads")}: ${imported.leads.filter((lead) => activeLevels.has(lead.intentLevel)).length}.`;
    renderShell();
  } catch (error) {
    if (status) status.textContent = t(error?.message || "Social provider could not be reached.");
  } finally {
    activeScanController = null;
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.hidden = true;
  }
}

function stopDirectScan() {
  activeScanController?.abort();
}

async function importSelectedFile(event, renderShell) {
  const status = document.querySelector("#socialImportStatus");
  const file = event.target.files?.[0];
  if (!file) return;
  if (!document.querySelector("#socialLawfulConfirm")?.checked) {
    if (status) status.textContent = t("Confirm the lawful-source declaration before importing.");
    event.target.value = "";
    return;
  }
  const result = parseSocialLeadCsv(await file.text(), {
    maximum: document.querySelector("#socialImportLimit")?.value,
    triggerKeywords: document.querySelector("#socialTriggerKeywords")?.value,
    excludeKeywords: document.querySelector("#socialExcludeKeywords")?.value,
    existing: socialLeadRows()
  });
  state.socialLeads = [...result.leads, ...socialLeadRows()];
  state.socialLeadDuplicateCount = Number(state.socialLeadDuplicateCount || 0) + result.duplicates;
  await persistSocialLeads();
  if (status) status.textContent = `${t("Imported")}: ${result.leads.length}. ${t("Duplicates")}: ${result.duplicates}. ${t("Errors")}: ${result.errors.length}.`;
  event.target.value = "";
  renderShell();
}

function handleLeadAction(event, renderShell) {
  const button = event.target.closest("[data-social-action]");
  if (!button) return;
  const lead = socialLeadRows().find((row) => row.id === button.dataset.leadId);
  if (!lead) return;
  const action = button.dataset.socialAction;
  if (action === "copy") {
    navigator.clipboard?.writeText(lead.suggestedMessages?.[button.dataset.language] || "");
    button.textContent = t("Copied");
    return;
  }
  if (action === "queue" && canQueueSocialLead(lead)) {
    lead.status = "Queued";
    lead.approvedBy = state.currentUser?.userId || "";
    lead.approvedAt = new Date().toISOString();
  } else if (action === "contacted" && lead.status === "Queued") {
    lead.status = "Contacted";
    lead.contactedAt = new Date().toISOString();
  } else if (action === "reject") {
    lead.status = "Rejected";
  } else return;
  lead.updatedAt = new Date().toISOString();
  void persistSocialLeads();
  renderShell();
}

function updateFilters() {
  filters = {
    query: document.querySelector("#socialFilterQuery")?.value || "",
    platform: document.querySelector("#socialFilterPlatform")?.value || "",
    level: document.querySelector("#socialFilterLevel")?.value || "",
    status: document.querySelector("#socialFilterStatus")?.value || "",
    location: document.querySelector("#socialFilterLocation")?.value || "",
    need: document.querySelector("#socialFilterNeed")?.value || ""
  };
  const results = document.querySelector("#socialLeadResults");
  if (results) results.innerHTML = socialLeadResultsHtml();
}

function filteredLeads() {
  const query = normalize(filters.query);
  return socialLeadRows().filter((lead) => {
    const haystack = normalize([lead.username, lead.displayName, lead.comment].join(" "));
    return (!query || haystack.includes(query))
      && (!filters.platform || lead.platform === filters.platform)
      && (!filters.level || lead.intentLevel === filters.level)
      && (!filters.status || lead.status === filters.status)
      && (!filters.location || normalize(lead.estimatedLocation).includes(normalize(filters.location)))
      && (!filters.need || normalize(lead.estimatedNeed).includes(normalize(filters.need)));
  });
}

function exportFilteredLeads() {
  const columns = ["platform", "intent_score", "intent_level", "intent_reason", "username", "display_name", "profile_url", "avatar_url", "comment", "estimated_location", "estimated_need", "suggested_next_action", "contact_eligibility", "status", "source_url", "source_author", "comment_time"];
  const rows = filteredLeads().map((lead) => [lead.platform, lead.intentScore, lead.intentLevel, lead.intentReason, lead.username, lead.displayName, lead.profileUrl, lead.avatarUrl, lead.comment, lead.estimatedLocation, lead.estimatedNeed, lead.suggestedNextAction, lead.contactEligibility, lead.status, lead.sourceUrl, lead.sourceAuthor, lead.commentedAt]);
  downloadCsv("social-leads.csv", [columns, ...rows]);
}

function downloadTemplate() {
  downloadCsv("social-lead-miner-template.csv", [["platform", "username", "display_name", "profile_url", "avatar_url", "comment", "comment_time", "source_url", "source_author", "region", "contact_eligibility"]]);
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsv(text) {
  const matrix = [];
  let row = []; let cell = ""; let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell); if (row.some((value) => String(value).trim())) matrix.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => String(value).trim())) matrix.push(row);
  if (matrix.length < 2) return [];
  const headers = matrix[0].map((value) => normalize(value).replace(/\s+/g, "_"));
  return matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function leadStats(leads) {
  return {
    total: leads.length,
    qualified: leads.filter((lead) => activeLevels.has(lead.intentLevel)).length,
    hot: leads.filter((lead) => lead.intentLevel === "HOT").length,
    warm: leads.filter((lead) => lead.intentLevel === "WARM").length,
    rejected: leads.filter((lead) => lead.status === "Rejected" || lead.intentLevel === "NOT_LEAD").length
  };
}

function socialLeadRows() { return Array.isArray(state.socialLeads) ? state.socialLeads : []; }
function metricHtml(label, value) { return `<div class="metric-card"><span>${label}</span><strong>${Number(value || 0)}</strong></div>`; }
function option(value, selected, label = value) { return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`; }
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function keywordList(value) { return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean); }
function firstRuleValue(value, rules) { return rules.find(([expression]) => expression.test(value))?.[1] || ""; }
function leadDuplicateKey(lead) { return [lead.platform, lead.username, lead.comment, lead.sourceUrl].map(normalize).join("|"); }
function safeIso(value) { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ""; }
function formatDate(value) { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(timestamp) : "-"; }
function safePublicUrl(value) { try { const url = new URL(String(value || "")); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
function csvCell(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function contactEligibilityLabel(value) { return ({ direct_brand_interaction: t("Direct brand interaction"), user_consented: t("User consented"), not_eligible: t("Not eligible for contact") })[value] || t("Not eligible for contact"); }
function platformLabel(value) { return ({ tiktok: "TikTok", facebook: "Facebook", rednote: t("Xiaohongshu / RedNote") })[normalizeSocialPlatform(value)] || value || "-"; }
function outreachMessages({ need, location }) {
  const area = location && location !== "Not stated" ? ` in ${location}` : "";
  return {
    English: `Hi, thanks for asking about ${need}${area}. May we share the available options and arrange a measurement?`,
    中文: `您好，感谢您询问${location && location !== "Not stated" ? `${location}的` : ""}${need}。方便让我们发送选择和安排测量吗？`,
    "Bahasa Melayu": `Hai, terima kasih kerana bertanya tentang ${need}${area}. Boleh kami kongsikan pilihan dan aturkan ukuran?`
  };
}
