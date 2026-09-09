import { identity, initializeSession, supabase } from './session.js';

document.querySelector('#app').textContent = '正在验证登录…';
try { await initializeSession(); }
catch { identity.error = 'Unable to verify your login or company. Please sign in again.'; }
await import('./main.js');
supabase?.auth.onAuthStateChange((event, session) => {
  if (identity.user && (event === 'SIGNED_OUT' || (session && session.user.id !== identity.user.authUserId))) {
    location.reload();
  }
});
