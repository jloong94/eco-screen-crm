import { runtimeEnv } from "./env.js";

export const cloudCollections = [
  "users",
  "customers",
  "products",
  "quotations",
  "orders",
  "productionJobs",
  "installationJobs",
  "warrantyCards"
];

const tableName = "eco_screen_v2_collections";

export function isCloudConfigured() {
  return Boolean(runtimeEnv.VITE_SUPABASE_URL && runtimeEnv.VITE_SUPABASE_ANON_KEY);
}

export async function loadData(collection) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured." };
  try {
    const response = await fetch(`${runtimeEnv.VITE_SUPABASE_URL}/rest/v1/${tableName}?collection=eq.${encodeURIComponent(collection)}&select=collection,data,updated_at`, {
      headers: supabaseHeaders()
    });
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    return { ok: true, data: rows[0]?.data || null, updatedAt: rows[0]?.updated_at || "" };
  } catch (error) {
    return { ok: false, reason: error.message || "Cloud load failed." };
  }
}

export async function saveData(collection, data) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured." };
  try {
    const response = await fetch(`${runtimeEnv.VITE_SUPABASE_URL}/rest/v1/${tableName}`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        collection,
        data,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(await response.text());
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message || "Cloud save failed." };
  }
}

export async function syncFromCloud() {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured.", data: null };
  const result = {};
  const failures = [];
  for (const collection of cloudCollections) {
    const row = await loadData(collection);
    if (row.ok && row.data) result[collection] = row.data;
    if (!row.ok) failures.push(`${collection}: ${row.reason}`);
  }
  return failures.length ? { ok: false, reason: failures.join("; "), data: result } : { ok: true, data: result };
}

export async function syncToCloud(snapshot) {
  if (!isCloudConfigured()) return { ok: false, reason: "Supabase is not configured." };
  const failures = [];
  for (const collection of cloudCollections) {
    const result = await saveData(collection, snapshot[collection] || []);
    if (!result.ok) failures.push(`${collection}: ${result.reason}`);
  }
  return failures.length ? { ok: false, reason: failures.join("; ") } : { ok: true };
}

function supabaseHeaders() {
  return {
    apikey: runtimeEnv.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${runtimeEnv.VITE_SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}
