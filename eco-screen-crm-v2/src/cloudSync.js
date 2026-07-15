import { runtimeEnv } from "./env.js";

export const cloudCollections = [
  "users",
  "customers",
  "products",
  "quotations",
  "orders",
  "adsEntries",
  "productionJobs",
  "installationJobs",
  "warrantyCards",
  "companySettings"
];

const tableName = "crm_v2_sync";
const firstWriteBackupKey = "ecoScreenV2.preCloudWriteBackup.v1";
let backupInProgress = null;

export function cloudConfigurationIssue() {
  const missing = [];
  if (!String(runtimeEnv.VITE_SUPABASE_URL || "").trim()) missing.push("VITE_SUPABASE_URL");
  if (!String(runtimeEnv.VITE_SUPABASE_ANON_KEY || "").trim()) missing.push("VITE_SUPABASE_ANON_KEY");
  return missing.length ? `Missing Vercel environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` : "";
}

export function isCloudConfigured() {
  return !cloudConfigurationIssue();
}

export async function loadData(collection) {
  const configurationIssue = cloudConfigurationIssue();
  if (configurationIssue) return { ok: false, reason: configurationIssue, data: null, found: false };
  try {
    const response = await fetch(`${normalizedSupabaseUrl()}/rest/v1/${tableName}?collection=eq.${encodeURIComponent(collection)}&select=collection,data,updated_at`, {
      headers: supabaseHeaders()
    });
    if (!response.ok) return httpFailure(response, "load");
    const rows = await response.json();
    return {
      ok: true,
      found: Boolean(rows[0]),
      data: Array.isArray(rows[0]?.data) ? rows[0].data : [],
      updatedAt: rows[0]?.updated_at || ""
    };
  } catch (error) {
    return { ok: false, reason: safeRequestFailure(error, "load"), data: null, found: false };
  }
}

export async function saveData(collection, data, options = {}) {
  const configurationIssue = cloudConfigurationIssue();
  if (configurationIssue) return { ok: false, reason: configurationIssue, data: Array.isArray(data) ? data : [] };

  const localRows = Array.isArray(data) ? data : [];
  const cloudRow = await loadData(collection);
  if (!cloudRow.ok) return { ok: false, reason: cloudRow.reason, data: localRows, wrote: false };

  let cloudRows = cloudRow.data;
  let cloudSnapshot = options.cloudSnapshot;
  let cloudMeta = options.cloudMeta;
  const initialMerge = mergeRows(localRows, cloudRows);
  const initialNeedsWrite = !sameRows(initialMerge, cloudRows);

  if (initialNeedsWrite && !firstWriteBackupCreated()) {
    const fullCloud = await syncFromCloud();
    if (!fullCloud.ok) {
      return {
        ok: false,
        reason: `Cloud write blocked because the full cloud backup check failed: ${fullCloud.reason}`,
        data: localRows,
        wrote: false
      };
    }
    cloudSnapshot = fullCloud.data;
    cloudMeta = fullCloud.meta;
    cloudRows = Array.isArray(fullCloud.data[collection]) ? fullCloud.data[collection] : [];
  }

  const merged = mergeRows(localRows, cloudRows);
  if (sameRows(merged, cloudRows)) {
    return {
      ok: true,
      data: merged,
      wrote: false,
      syncedAt: new Date().toISOString(),
      localCount: localRows.length,
      cloudCount: cloudRows.length
    };
  }

  const backup = await ensureFirstCloudWriteBackup({
    localSnapshot: options.localSnapshot || { [collection]: localRows },
    cloudSnapshot: cloudSnapshot || { [collection]: cloudRows },
    cloudMeta: cloudMeta || { [collection]: { count: cloudRows.length, updatedAt: cloudRow.updatedAt || "" } },
    backupWriter: options.backupWriter
  });
  if (!backup.ok) return { ok: false, reason: backup.reason, data: localRows, wrote: false };

  const write = await writeCollection(collection, merged);
  return write.ok
    ? {
      ...write,
      data: merged,
      wrote: true,
      localCount: localRows.length,
      cloudCount: cloudRows.length,
      backupCreated: backup.created
    }
    : { ...write, data: localRows, wrote: false };
}

export async function syncFromCloud() {
  const configurationIssue = cloudConfigurationIssue();
  if (configurationIssue) return { ok: false, reason: configurationIssue, data: {}, meta: {} };
  const data = {};
  const meta = {};
  const failures = [];
  for (const collection of cloudCollections) {
    const row = await loadData(collection);
    if (row.ok) {
      data[collection] = row.data;
      meta[collection] = { updatedAt: row.updatedAt, count: row.data.length, found: row.found };
    } else {
      failures.push(row.reason);
    }
  }
  const reasons = [...new Set(failures)];
  return reasons.length ? { ok: false, reason: reasons.join("; "), data, meta } : { ok: true, data, meta };
}

export async function syncToCloud(snapshot, options = {}) {
  return safeSyncWithCloud(snapshot, options);
}

export async function safeSyncWithCloud(localSnapshot, options = {}) {
  const configurationIssue = cloudConfigurationIssue();
  if (configurationIssue) return {
    ok: false,
    reason: configurationIssue,
    snapshot: localSnapshot,
    summary: emptySummary()
  };

  const cloud = await syncFromCloud();
  const summary = emptySummary();
  if (!cloud.ok) {
    summary.errors.push(cloud.reason);
    return { ok: false, reason: cloud.reason, snapshot: localSnapshot, summary };
  }

  const nextSnapshot = { ...localSnapshot };
  const pendingWrites = [];
  for (const collection of cloudCollections) {
    const localRows = Array.isArray(localSnapshot[collection]) ? localSnapshot[collection] : [];
    const cloudRows = Array.isArray(cloud.data[collection]) ? cloud.data[collection] : [];
    const merged = mergeRows(localRows, cloudRows);
    summary.localCounts[collection] = localRows.length;
    summary.cloudCounts[collection] = cloudRows.length;
    summary.cloudUpdatedAt[collection] = cloud.meta[collection]?.updatedAt || "";
    nextSnapshot[collection] = merged;

    const cloudOnlyCount = merged.filter((row) => !localRows.some((local) => rowKey(local) === rowKey(row))).length;
    const localOnlyCount = merged.filter((row) => !cloudRows.some((cloudRow) => rowKey(cloudRow) === rowKey(row))).length;
    const writeCount = merged.filter((row) => {
      const cloudRow = cloudRows.find((candidate) => rowKey(candidate) === rowKey(row));
      return !cloudRow || JSON.stringify(cloudRow) !== JSON.stringify(row);
    }).length;
    if (cloudOnlyCount) summary.downloaded[collection] = cloudOnlyCount;
    if (localRows.length && cloudRows.length) summary.merged[collection] = merged.length;
    if (!sameRows(merged, cloudRows)) pendingWrites.push({ collection, rows: merged, localOnlyCount, writeCount });
  }

  if (options.allowWrites === false) {
    summary.pendingWrites = Object.fromEntries(pendingWrites.map((pending) => [pending.collection, pending.writeCount]));
    summary.collectionsSynced = [...cloudCollections];
    return {
      ok: true,
      reason: "Cloud data checked in read-only mode. Review the local and cloud counts, then use Sync Now to authorize writes.",
      snapshot: nextSnapshot,
      summary,
      readOnly: true
    };
  }

  if (pendingWrites.length) {
    const backup = await ensureFirstCloudWriteBackup({
      localSnapshot,
      cloudSnapshot: cloud.data,
      cloudMeta: cloud.meta,
      backupWriter: options.backupWriter
    });
    if (!backup.ok) {
      summary.errors.push(backup.reason);
      return { ok: false, reason: backup.reason, snapshot: localSnapshot, summary };
    }
    summary.backupCreated = backup.created;
  }

  for (const pending of pendingWrites) {
    const write = await writeCollection(pending.collection, pending.rows);
    if (write.ok) summary.uploaded[pending.collection] = pending.writeCount;
    else summary.errors.push(`${pending.collection}: ${write.reason}`);
  }

  summary.collectionsSynced = cloudCollections.filter((collection) => !summary.errors.some((error) => error.startsWith(`${collection}:`)));
  return {
    ok: summary.errors.length === 0,
    reason: summary.errors.join("; "),
    snapshot: summary.errors.length ? localSnapshot : nextSnapshot,
    summary
  };
}

export async function getCloudCounts() {
  const result = await syncFromCloud();
  return result.meta || {};
}

export function mergeRows(localRows, cloudRows) {
  const map = new Map();
  [...cloudRows, ...localRows].forEach((row) => {
    const key = rowKey(row);
    const existing = map.get(key);
    if (!existing || isNewer(row, existing)) map.set(key, row);
  });
  return [...map.values()];
}

function rowKey(row) {
  return row?.id || row?.userId || row?.quoteNumber || row?.quotationNo || row?.orderNumber || row?.orderNo || row?.productionNumber || row?.installationNumber || row?.warrantyNo || JSON.stringify(row);
}

function isNewer(next, current) {
  const nextDate = rowTime(next);
  const currentDate = rowTime(current);
  if (Number.isFinite(nextDate) && Number.isFinite(currentDate)) return nextDate >= currentDate;
  if (Number.isFinite(nextDate)) return true;
  if (Number.isFinite(currentDate)) return false;
  return true;
}

function rowTime(row = {}) {
  const value = Date.parse(row.updatedAt || row.createdAt || row.updated_at || row.created_at || "");
  return Number.isFinite(value) ? value : NaN;
}

function sameRows(left, right) {
  if (left.length !== right.length) return false;
  const signature = (rows) => rows
    .map((row) => `${rowKey(row)}:${JSON.stringify(row)}`)
    .sort()
    .join("|");
  return signature(left) === signature(right);
}

async function writeCollection(collection, data) {
  try {
    const response = await fetch(`${normalizedSupabaseUrl()}/rest/v1/${tableName}?on_conflict=collection`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        collection,
        data: Array.isArray(data) ? data : [],
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) return httpFailure(response, "write");
    return { ok: true, syncedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, reason: safeRequestFailure(error, "write") };
  }
}

async function httpFailure(response, operation) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.message || body.details || body.hint || body.code || "";
  } catch {
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
  }
  const safeDetail = String(detail || "").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
  if (response.status === 404) return { ok: false, reason: `Supabase table public.${tableName} was not found. ${safeDetail}`.trim() };
  if (response.status === 401) return { ok: false, reason: `Supabase rejected the public anon key (HTTP 401). ${safeDetail}`.trim() };
  if (response.status === 403) return { ok: false, reason: `Supabase RLS blocked the ${operation} request (HTTP 403). ${safeDetail}`.trim() };
  return { ok: false, reason: `Supabase ${operation} failed (HTTP ${response.status}). ${safeDetail}`.trim() };
}

function safeRequestFailure(error, operation) {
  const host = supabaseHost();
  const message = String(error?.message || "Network request failed.");
  if (/failed to fetch|network|resolve|dns|enotfound|offline/i.test(message)) {
    return `Cannot reach Supabase host ${host || "from VITE_SUPABASE_URL"}. Verify VITE_SUPABASE_URL and that the Supabase project is active.`;
  }
  return `Supabase ${operation} failed: ${message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300)}`;
}

async function ensureFirstCloudWriteBackup({ localSnapshot, cloudSnapshot, cloudMeta, backupWriter }) {
  if (firstWriteBackupCreated()) return { ok: true, created: false };
  if (backupInProgress) return backupInProgress;
  backupInProgress = (async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Eco Screen CRM V2",
      reason: "Automatic backup before first repaired cloud write",
      localData: localSnapshot,
      cloudData: cloudSnapshot,
      cloudMeta
    };
    try {
      const writer = backupWriter || downloadBackupPayload;
      const written = await writer(payload);
      if (written === false) throw new Error("The browser did not create the backup download.");
      try {
        localStorage.setItem(firstWriteBackupKey, payload.exportedAt);
      } catch {
        // Download is the durable backup; the marker only prevents repeated downloads.
      }
      return { ok: true, created: true };
    } catch (error) {
      return { ok: false, created: false, reason: `Cloud write blocked: full JSON backup could not be created. ${error.message || "Unknown backup error"}` };
    } finally {
      backupInProgress = null;
    }
  })();
  return backupInProgress;
}

function firstWriteBackupCreated() {
  try {
    return Boolean(localStorage.getItem(firstWriteBackupKey));
  } catch {
    return false;
  }
}

function downloadBackupPayload(payload) {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") return true;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `eco-screen-crm-v2-pre-cloud-write-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function emptySummary() {
  return {
    uploaded: {},
    downloaded: {},
    merged: {},
    localCounts: {},
    cloudCounts: {},
    cloudUpdatedAt: {},
    pendingWrites: {},
    collectionsSynced: [],
    errors: [],
    backupCreated: false
  };
}

function normalizedSupabaseUrl() {
  return String(runtimeEnv.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

function supabaseHost() {
  try {
    return new URL(normalizedSupabaseUrl()).host;
  } catch {
    return "";
  }
}

function supabaseHeaders() {
  return {
    apikey: runtimeEnv.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${runtimeEnv.VITE_SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}
