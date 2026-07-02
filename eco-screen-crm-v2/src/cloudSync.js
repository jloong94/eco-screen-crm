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
  "warrantyCards"
];

const tableName = "crm_v2_sync";

export function isCloudConfigured() {
  return Boolean(runtimeEnv.VITE_SUPABASE_URL && runtimeEnv.VITE_SUPABASE_ANON_KEY);
}

export async function loadData(collection) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured.", data: null };
  try {
    const response = await fetch(`${runtimeEnv.VITE_SUPABASE_URL}/rest/v1/${tableName}?collection=eq.${encodeURIComponent(collection)}&select=collection,data,updated_at`, {
      headers: supabaseHeaders()
    });
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    return {
      ok: true,
      data: Array.isArray(rows[0]?.data) ? rows[0].data : null,
      updatedAt: rows[0]?.updated_at || ""
    };
  } catch (error) {
    return { ok: false, reason: error.message || "Cloud load failed.", data: null };
  }
}

export async function saveData(collection, data) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured." };
  try {
    const response = await fetch(`${runtimeEnv.VITE_SUPABASE_URL}/rest/v1/${tableName}?on_conflict=collection`, {
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
    if (!response.ok) throw new Error(await response.text());
    return { ok: true, syncedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, reason: error.message || "Cloud save failed." };
  }
}

export async function syncFromCloud() {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured.", data: null, meta: {} };
  const data = {};
  const meta = {};
  const failures = [];
  for (const collection of cloudCollections) {
    const row = await loadData(collection);
    if (row.ok) {
      data[collection] = Array.isArray(row.data) ? row.data : [];
      meta[collection] = { updatedAt: row.updatedAt, count: data[collection].length };
    } else {
      failures.push(`${collection}: ${row.reason}`);
    }
  }
  return failures.length ? { ok: false, reason: failures.join("; "), data, meta } : { ok: true, data, meta };
}

export async function syncToCloud(snapshot) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured." };
  const failures = [];
  for (const collection of cloudCollections) {
    const result = await saveData(collection, snapshot[collection] || []);
    if (!result.ok) failures.push(`${collection}: ${result.reason}`);
  }
  return failures.length ? { ok: false, reason: failures.join("; ") } : { ok: true, syncedAt: new Date().toISOString() };
}

export async function safeSyncWithCloud(localSnapshot) {
  if (!isCloudConfigured()) return {
    ok: false,
    reason: "Supabase is not configured.",
    snapshot: localSnapshot,
    summary: emptySummary()
  };

  const cloud = await syncFromCloud();
  const summary = emptySummary();
  const nextSnapshot = { ...localSnapshot };

  for (const collection of cloudCollections) {
    const localRows = Array.isArray(localSnapshot[collection]) ? localSnapshot[collection] : [];
    const cloudRows = Array.isArray(cloud.data?.[collection]) ? cloud.data[collection] : [];
    const localCount = localRows.length;
    const cloudCount = cloudRows.length;
    summary.localCounts[collection] = localCount;
    summary.cloudCounts[collection] = cloudCount;

    if (localCount > 0 && cloudCount === 0) {
      const upload = await saveData(collection, localRows);
      if (upload.ok) summary.uploaded[collection] = localCount;
      else summary.errors.push(`${collection}: ${upload.reason}`);
      nextSnapshot[collection] = localRows;
      continue;
    }

    if (localCount === 0 && cloudCount > 0) {
      nextSnapshot[collection] = cloudRows;
      summary.downloaded[collection] = cloudCount;
      continue;
    }

    if (localCount > 0 && cloudCount > 0) {
      const merged = mergeRows(localRows, cloudRows);
      nextSnapshot[collection] = merged;
      summary.merged[collection] = merged.length;
      if (merged.length !== cloudCount) {
        const upload = await saveData(collection, merged);
        if (!upload.ok) summary.errors.push(`${collection}: ${upload.reason}`);
      }
      continue;
    }

    nextSnapshot[collection] = localRows;
  }

  return {
    ok: cloud.ok && summary.errors.length === 0,
    reason: summary.errors.join("; ") || cloud.reason || "",
    snapshot: nextSnapshot,
    summary
  };
}

export async function getCloudCounts() {
  const result = await syncFromCloud();
  return result.meta || {};
}

function mergeRows(localRows, cloudRows) {
  const map = new Map();
  [...cloudRows, ...localRows].forEach((row) => {
    const key = rowKey(row);
    const existing = map.get(key);
    if (!existing || isNewer(row, existing)) map.set(key, row);
  });
  return [...map.values()];
}

function rowKey(row) {
  return row?.id || row?.userId || row?.quoteNumber || row?.orderNumber || row?.productionNumber || row?.installationNumber || row?.warrantyNo || JSON.stringify(row);
}

function isNewer(next, current) {
  const nextDate = Date.parse(next?.updatedAt || next?.createdAt || next?.created_at || 0);
  const currentDate = Date.parse(current?.updatedAt || current?.createdAt || current?.created_at || 0);
  return Number.isFinite(nextDate) && nextDate >= currentDate;
}

function emptySummary() {
  return {
    uploaded: {},
    downloaded: {},
    merged: {},
    localCounts: {},
    cloudCounts: {},
    errors: []
  };
}

function supabaseHeaders() {
  return {
    apikey: runtimeEnv.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${runtimeEnv.VITE_SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}
