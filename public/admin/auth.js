/**
 * Admin-panel auth: login/refresh/logout against /api/admin/auth/*, tokens kept in
 * localStorage (same pattern the Chrome extension uses for its own tokens), with a
 * silent refresh-and-retry on 401 so a live session doesn't get kicked out mid-use.
 *
 * This is the actual mechanism that gates the admin backoffice: admin-server.ts's static
 * mount for /admin has no server-side auth of its own (there's nothing secret in the
 * HTML/JS bundle) -- every real permission check happens API-side via authenticateAdmin/
 * authorizeAdmin, and this file is what makes the *client* redirect to login.html and
 * attach a token whenever it calls one of those APIs.
 */

const AdminAuth = (() => {
  const STORAGE_KEY = 'narreto_admin_session';

  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeSession(session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isLoggedIn() {
    const session = readSession();
    return Boolean(session && session.accessToken && session.refreshToken);
  }

  function currentAdmin() {
    const session = readSession();
    return session ? session.admin : null;
  }

  async function parseErrorMessage(res) {
    try {
      const body = await res.json();
      return (body && body.error && body.error.message) || `${res.status} ${res.statusText}`;
    } catch (_) {
      return `${res.status} ${res.statusText}`;
    }
  }

  async function login(email, password) {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    const { data } = await res.json();
    writeSession({ admin: data.admin, accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data.admin;
  }

  async function refresh() {
    const session = readSession();
    if (!session || !session.refreshToken) {
      return false;
    }
    const res = await fetch('/api/admin/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!res.ok) {
      clearSession();
      return false;
    }
    const { data } = await res.json();
    writeSession({ admin: session.admin, accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  }

  async function logout() {
    const session = readSession();
    if (session && session.refreshToken) {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken })
      }).catch(() => {});
    }
    clearSession();
    window.location.href = 'login.html';
  }

  /** fetch() wrapper that attaches the access token and retries once after a silent refresh on 401. */
  async function authorizedFetch(url, options = {}) {
    const session = readSession();
    if (!session) {
      window.location.href = 'login.html';
      throw new Error('Not logged in.');
    }

    const withAuth = token => ({
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });

    let res = await fetch(url, withAuth(session.accessToken));
    if (res.status === 401) {
      const refreshed = await refresh();
      if (!refreshed) {
        clearSession();
        window.location.href = 'login.html';
        throw new Error('Session expired. Please log in again.');
      }
      res = await fetch(url, withAuth(readSession().accessToken));
    }
    return res;
  }

  /** Call at the top of any page that requires a logged-in admin. */
  function requireLogin() {
    if (!isLoggedIn()) {
      window.location.href = 'login.html';
    }
  }

  return { login, logout, refresh, authorizedFetch, requireLogin, isLoggedIn, currentAdmin, parseErrorMessage };
})();
