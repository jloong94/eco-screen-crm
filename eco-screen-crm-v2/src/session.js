import { createClient } from '@supabase/supabase-js';
import { runtimeEnv } from './env.js';

export const supabase = runtimeEnv.VITE_SUPABASE_URL && runtimeEnv.VITE_SUPABASE_ANON_KEY
  ? createClient(runtimeEnv.VITE_SUPABASE_URL, runtimeEnv.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }) : null;
export const identity = { user: null, companyId: '', error: '' };

export async function initializeSession() {
  identity.user = null;
  identity.companyId = '';
  identity.error = '';
  if (!supabase) { identity.error = 'Supabase configuration is missing.'; return; }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) return;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const { data: member, error: memberError } = await supabase.from('crm_v2_memberships')
    .select('company_id,role,display_name,staff_user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (memberError) throw memberError;
  if (!member) { identity.error = 'Your account has no active company membership. Contact your administrator.'; return; }
  identity.companyId = member.company_id;
  identity.user = { userId: member.staff_user_id || user.id, authUserId: user.id,
    name: member.display_name || user.email, username: user.email, role: member.role, active: true };
}

export async function authenticatedHeaders() {
  if (!supabase || !identity.companyId || !identity.user) throw new Error('Please sign in to your company.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Session expired. Please sign in again.');
  return { apikey: runtimeEnv.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

export async function signOut() {
  identity.user = null;
  identity.companyId = '';
  // Reload discards all in-memory company records even if the server is offline.
  try { if (supabase) await supabase.auth.signOut({ scope: 'local' }); }
  finally { location.reload(); }
}
