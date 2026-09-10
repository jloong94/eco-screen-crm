import { identity, supabase, signOut, loginWithPin, staffRequest, initializeSession } from './session.js';
import { roles } from "./data.js";
import { t } from "./i18n.js";
import { canManageUsers, defaultPageForRole } from "./permissions.js";
import { persistUsers, setCurrentUser, setLanguage, setPage, state, uid } from "./state.js";

export async function login(username, pin) {
  try { await loginWithPin(username, pin); return { ok: true }; }
  catch (error) { return { ok: false, message: error.message }; }
}
export async function loginOwner(email, password) {
  if (!supabase) return { ok: false, message: 'Supabase configuration is missing.' };
  const { error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) return { ok: false, message: '邮箱或密码不正确，或账号尚未确认。' };
  await staffRequest('/api/staff-session', { method: 'DELETE' });
  await initializeSession();
  if (!identity.user || identity.mode !== 'email') {
    const message = identity.error || '邮箱登录仅供 Owner/Admin。';
    await supabase.auth.signOut({ scope: 'local' });
    return { ok: false, message };
  }
  location.reload();
  return { ok: true };
}
export function logout() { setCurrentUser(null); return signOut(); }

export function renderLoginCard() {
  return `
    <main class="login-page">
      <section class="panel login-card">
        <div class="brand login-brand">
          <div class="logo">ES</div>
          <div>
            <p>Eco Screen CRM V2</p>
            <h1>${t("Staff Login")}</h1>
          </div>
        </div>
        <div class="language-inline">
          <label>${t("Select Language")}
            <select id="loginLanguage">
              <option value="en" ${state.language === "en" ? "selected" : ""}>English</option>
              <option value="zh" ${state.language === "zh" ? "selected" : ""}>中文</option>
            </select>
          </label>
        </div>
        <form id="loginForm" class="stack">
          <label>${t("Username")}<input id="loginUsername" required autocomplete="username" /></label>
          <label>${t("PIN / Password")}<input id="loginPin" type="password" autocomplete="current-password" required /></label>
          <button class="btn primary" type="submit">${t("Login")}</button>
          <p id="loginMessage" class="muted-text">${escapeHtml(identity.error || "员工继续使用原账号和 PIN 登录。") }</p>
        </form>
        <details><summary>Owner/Admin 邮箱登录</summary>
          <form id="ownerLoginForm" class="stack">
            <label>Email<input id="ownerEmail" type="email" required autocomplete="username" /></label>
            <label>Password<input id="ownerPassword" type="password" required autocomplete="current-password" /></label>
            <button class="btn primary" type="submit">Owner/Admin 登录</button>
            <p id="ownerLoginMessage" role="status"></p>
          </form>
        </details>
      </section>
    </main>
  `;
}

export function renderUserManagement() {
  if (!canManageUsers()) {
    return `<p class="muted-text">${t("Permission denied: your role cannot perform this action.")}</p>`;
  }
  return `
    <section class="staff-form">
      <div class="form-grid compact">
        <label>${t("Name")}<input id="staffName" placeholder="${t("Staff name")}" /></label>
        <label>${t("Username")}<input id="staffUsername" placeholder="username" /></label>
        <label>${t("PIN / Password")}<input id="staffPin" type="password" placeholder="1234" /></label>
        <label>${t("Role")}<select id="staffRole">${roles.map((role) => `<option value="${role}">${t(role)}</option>`).join("")}</select></label>
      </div>
      <button class="btn primary" id="addStaffButton" type="button">${t("Add Staff")}</button>
      <p id="staffSaveStatus" class="muted-text"></p>
    </section>
    <div class="product-list staff-list">
      ${state.users.map((user) => staffCardHtml(user)).join("")}
    </div>
  `;
}

function staffCardHtml(user) {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <p class="muted-text">${escapeHtml(user.username)} | ${escapeHtml(t(user.role))}</p>
        </div>
        <span class="pill ${user.active === false ? "muted" : ""}">${user.active === false ? t("Inactive") : t("Active")}</span>
      </div>
      <div class="form-grid compact">
        <label>${t("Name")}<input data-user-id="${user.userId}" data-user-field="name" value="${escapeHtml(user.name)}" /></label>
        <label>${t("Username")}<input data-user-id="${user.userId}" data-user-field="username" value="${escapeHtml(user.username)}" /></label>
        <label>${t("Role")}<select data-user-id="${user.userId}" data-user-field="role">
          ${roles.map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${t(role)}</option>`).join("")}
        </select></label>
        <label>${t("PIN / Password")}<input type="password" data-user-id="${user.userId}" data-user-field="pin" placeholder="${t("Leave blank to keep current PIN")}" /></label>
        <label>${t("Status")}<select data-user-id="${user.userId}" data-user-field="active">
          <option value="true" ${user.active !== false ? "selected" : ""}>${t("Active")}</option>
          <option value="false" ${user.active === false ? "selected" : ""}>${t("Inactive")}</option>
        </select></label>
      </div>
    </article>
  `;
}

export function attachLoginEvents(renderShell) {
  document.querySelector('#ownerLoginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await loginOwner(document.querySelector('#ownerEmail').value, document.querySelector('#ownerPassword').value);
      if (!result.ok) document.querySelector('#ownerLoginMessage').textContent = result.message;
    } catch { document.querySelector('#ownerLoginMessage').textContent = '登录服务暂时无法连接，请重试。'; }
    finally { button.disabled = false; }
  });
  document.querySelector("#loginLanguage")?.addEventListener("change", (event) => {
    setLanguage(event.target.value);
    renderShell();
  });
  document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await login(document.querySelector("#loginUsername").value, document.querySelector("#loginPin").value);
      if (!result.ok) document.querySelector("#loginMessage").textContent = result.message;
    } catch {
      document.querySelector("#loginMessage").textContent = '登录服务暂时无法连接，请重试。';
    } finally { button.disabled = false; }
  });
}

export function attachUserManagementEvents(renderShell) {
  document.querySelector("#userManagementPanel")?.addEventListener("input", handleUserEdit);
  document.querySelector("#userManagementPanel")?.addEventListener("change", handleUserEdit);
  document.querySelector("#addStaffButton")?.addEventListener("click", () => addStaff(renderShell));
}

function handleUserEdit(event) {
  if (!canManageUsers()) return;
  const userId = event.target.dataset.userId;
  const field = event.target.dataset.userField;
  if (!userId || !field) return;
  state.users = state.users.map((user) => {
    if (user.userId !== userId) return user;
    if (field === "pin" && !event.target.value) return user;
    const value = field === "active" ? event.target.value === "true" : event.target.value;
    return { ...user, [field]: value };
  });
  persistUsers();
  document.querySelector("#staffSaveStatus").textContent = t("User saved.");
}

function addStaff(renderShell) {
  if (!canManageUsers()) return;
  const name = document.querySelector("#staffName").value.trim();
  const username = document.querySelector("#staffUsername").value.trim();
  const pin = document.querySelector("#staffPin").value.trim();
  const role = document.querySelector("#staffRole").value;
  if (!name || !username || !pin) {
    document.querySelector("#staffSaveStatus").textContent = t("Please fill name, username and PIN.");
    return;
  }
  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    document.querySelector("#staffSaveStatus").textContent = t("Username already exists.");
    return;
  }
  state.users = [{ userId: uid("user"), name, username, pin, role, active: true }, ...state.users];
  persistUsers();
  renderShell();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
