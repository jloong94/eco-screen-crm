import { createClient } from '@supabase/supabase-js';
import { runtimeEnv } from './env.js';

export const supabase = runtimeEnv.VITE_SUPABASE_URL && runtimeEnv.VITE_SUPABASE_ANON_KEY
  ? createClient(runtimeEnv.VITE_SUPABASE_URL, runtimeEnv.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }) : null;
export const identity = { user: null, companyId: '', error: '', mode: '' };

export async function staffRequest(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: {
    'Content-Type': 'application/json', 'X-CRM-Request': '1', ...options.headers
  } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Staff request failed.');
  return data;
}

export async function loginWithPin(username, pin) {
  await staffRequest('/api/staff-session', { method: 'POST', body: JSON.stringify({ username, pin }) });
  // A previous owner email session must never override a staff PIN session.
  if (supabase) await supabase.auth.signOut({ scope: 'local' });
  location.reload();
}

export async function initializeSession() {
  identity.user = null;
  identity.companyId = '';
  identity.error = '';
  identity.mode = '';
  if (typeof window !== 'undefined') {
    const response = await fetch('/api/staff-session', { credentials: 'same-origin', cache: 'no-store' });
    if (response.ok) {
      const session = await response.json();
      identity.user = session.user;
      identity.companyId = session.companyId;
      identity.mode = 'pin';
      return;
    }
    if (response.status !== 401 && response.status !== 503) throw new Error('Unable to verify staff session.');
  }
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
  if (!['Boss', 'Admin'].includes(member.role)) {
    identity.error = '邮箱登录仅供 Owner/Admin；员工请使用原账号和 PIN。';
    return;
  }
  identity.mode = 'email';
  identity.companyId = member.company_id;
  identity.user = { userId: member.staff_user_id || user.id, authUserId: user.id,
    name: member.display_name || user.email, username: user.email, role: member.role, active: true };
}

export async function authenticatedHeaders() {
  if (identity.mode === 'pin' && identity.user && identity.companyId) return { 'Content-Type': 'application/json', 'X-CRM-Request': '1' };
  if (!supabase || !identity.companyId || !identity.user) throw new Error('Please sign in to your company.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Session expired. Please sign in again.');
  return { apikey: runtimeEnv.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

export async function signOut() {
  await staffRequest('/api/staff-session', { method: 'DELETE' });
  identity.user = null;
  identity.companyId = '';
  // Reload discards all in-memory company records even if the server is offline.
  try { if (supabase) await supabase.auth.signOut({ scope: 'local' }); }
  finally { location.reload(); }
}
