export const supabaseConfig = {
  url: "",
  anonKey: ""
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}
