// Auth client for the crawler-app REST API's real auth system (JWT access+refresh,
// email/password + server-verified Google/GitHub OAuth). Replaces the old flow that
// self-reported an unverified profile to /api/auth/sync.
const API_BASE = 'http://localhost:3000/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  provider: 'local' | 'google' | 'github';
  userType: string;
  emailVerifiedAt?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'narreto_auth_session';
const GOOGLE_CLIENT_ID_KEY = 'narreto_google_client_id';
const GITHUB_CLIENT_ID_KEY = 'narreto_github_client_id';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Envelope<unknown>;
    return body?.error?.message || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const envelope = (await res.json()) as Envelope<T>;
  if (!envelope.success || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Request failed.');
  }
  return envelope.data;
}

export class AuthService {
  /**
   * Loads the currently stored session (user + token pair) from chrome.storage.local.
   */
  public static async getStoredSession(): Promise<AuthSession | null> {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY]);
      return (data[STORAGE_KEY] as AuthSession) || null;
    } catch {
      return null;
    }
  }

  /**
   * Convenience accessor mirroring the old getStoredUser() call sites.
   */
  public static async getStoredUser(): Promise<AuthUser | null> {
    const session = await this.getStoredSession();
    return session?.user || null;
  }

  public static async getAccessToken(): Promise<string | null> {
    const session = await this.getStoredSession();
    return session?.accessToken || null;
  }

  private static async saveSession(session: AuthSession): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: session });
  }

  /**
   * Returns the currently stored access token. There's no client-side expiry tracking
   * for the short-lived (~15min) JWT -- callers (api.ts) should attempt the request and
   * fall back to refreshSession() + retry on a 401 instead of predicting expiry here.
   */
  public static async getValidAccessToken(): Promise<string | null> {
    return this.getAccessToken();
  }

  /**
   * Calls /api/auth/refresh with the stored refresh token and persists the rotated pair.
   * Refresh tokens rotate on every use -- the old one becomes invalid immediately.
   */
  public static async refreshSession(): Promise<boolean> {
    const session = await this.getStoredSession();
    if (!session?.refreshToken) return false;

    try {
      const data = await postJson<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        refreshToken: session.refreshToken
      });
      await this.saveSession({ user: session.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      await this.clearSession();
      return false;
    }
  }

  /**
   * Logs out the current user: best-effort revoke on the backend, then clears local
   * storage regardless of whether that call succeeded.
   */
  public static async logout(): Promise<void> {
    const session = await this.getStoredSession();
    if (session?.refreshToken) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken })
        });
      } catch {
        // best-effort
      }
    }
    await this.clearSession();
  }

  private static async clearSession(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY]);
  }

  /** Email/password login against /api/auth/login. */
  public static async loginWithPassword(email: string, password: string): Promise<AuthUser> {
    const data = await postJson<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password
    });
    await this.saveSession(data);
    return data.user;
  }

  /** Email/password signup against /api/auth/signup. Logs the user in immediately. */
  public static async signup(email: string, password: string, name: string): Promise<AuthUser> {
    const data = await postJson<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/signup', {
      email,
      password,
      name
    });
    await this.saveSession(data);
    return data.user;
  }

  /**
   * Initiates Google OAuth using chrome.identity with response_type=id_token, so the
   * backend can verify the id_token server-side via google-auth-library. Throws a
   * distinguishable "not configured" error when no client ID is set up so the caller can
   * surface that state instead of faking a login.
   */
  public static async loginWithGoogle(customClientId?: string): Promise<AuthUser> {
    const storedConfig = await chrome.storage.local.get([GOOGLE_CLIENT_ID_KEY]);
    const clientId = customClientId || storedConfig[GOOGLE_CLIENT_ID_KEY];

    if (!clientId) {
      throw new Error('NOT_CONFIGURED: Google sign-in is not configured. Use email/password instead.');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const scopes = encodeURIComponent('openid email profile');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&response_type=id_token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&nonce=${encodeURIComponent(
      nonce
    )}`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          return reject(new Error(chrome.runtime.lastError?.message || 'Google Auth cancelled or failed.'));
        }

        try {
          const urlObj = new URL(redirectUrl);
          const params = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
          const idToken = params.get('id_token');

          if (!idToken) {
            throw new Error('Google OAuth callback did not contain an id_token.');
          }

          const data = await postJson<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/google', {
            idToken
          });
          await this.saveSession(data);
          resolve(data.user);
        } catch (err: any) {
          reject(err);
        }
      });
    });
  }

  /**
   * Initiates GitHub OAuth using chrome.identity, capturing the authorization `code` and
   * exchanging it server-side (the client secret can't live in the extension).
   */
  public static async loginWithGitHub(customClientId?: string): Promise<AuthUser> {
    const storedConfig = await chrome.storage.local.get([GITHUB_CLIENT_ID_KEY]);
    const clientId = customClientId || storedConfig[GITHUB_CLIENT_ID_KEY];

    if (!clientId) {
      throw new Error('NOT_CONFIGURED: GitHub sign-in is not configured. Use email/password instead.');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = encodeURIComponent('read:user user:email');
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          return reject(new Error(chrome.runtime.lastError?.message || 'GitHub Auth cancelled or failed.'));
        }

        try {
          const urlObj = new URL(redirectUrl);
          const code = urlObj.searchParams.get('code');

          if (!code) {
            throw new Error('GitHub OAuth callback did not contain an authorization code.');
          }

          const data = await postJson<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/github', {
            code,
            redirectUri
          });
          await this.saveSession(data);
          resolve(data.user);
        } catch (err: any) {
          reject(err);
        }
      });
    });
  }
}
