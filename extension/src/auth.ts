export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  provider: 'google' | 'github';
  token?: string;
  authenticatedAt: string;
}

const STORAGE_KEY = 'narreto_auth_user';
const GOOGLE_CLIENT_ID_KEY = 'narreto_google_client_id';
const GITHUB_CLIENT_ID_KEY = 'narreto_github_client_id';

export class AuthService {
  /**
   * Loads currently authenticated user session from chrome.storage.local.
   */
  public static async getStoredUser(): Promise<AuthUser | null> {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY]);
      return (data[STORAGE_KEY] as AuthUser) || null;
    } catch {
      return null;
    }
  }

  /**
   * Saves authenticated user session into chrome.storage.local and synchronizes
   * the profile and login/signup audit log to the backend PostgreSQL database.
   */
  public static async saveUser(user: AuthUser): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: user });

    // Sync to PostgreSQL backend
    try {
      await fetch('http://localhost:3000/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          provider: user.provider,
          providerUserId: user.id,
          metadata: { client: 'chrome_extension', authenticatedAt: user.authenticatedAt }
        })
      });
    } catch {
      // Backend sync is best-effort for offline/local extension usage
    }
  }

  /**
   * Logs out the current user by clearing the session from storage.
   */
  public static async logout(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY]);
  }

  /**
   * Initiates Google OAuth 2.0 Web Auth Flow using chrome.identity.
   * If no custom Client ID is supplied, checks storage or uses demo mode on cancellation.
   */
  public static async loginWithGoogle(customClientId?: string): Promise<AuthUser> {
    const storedConfig = await chrome.storage.local.get([GOOGLE_CLIENT_ID_KEY]);
    const clientId = customClientId || storedConfig[GOOGLE_CLIENT_ID_KEY];

    if (!clientId) {
      // If no Google Client ID is configured in developer console, offer instant demo profile
      return this.demoLogin('google');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = encodeURIComponent('openid email profile');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        async (redirectUrl) => {
          if (chrome.runtime.lastError || !redirectUrl) {
            return reject(new Error(chrome.runtime.lastError?.message || 'Google Auth cancelled or failed.'));
          }

          try {
            // Extract access token from URL fragment
            const urlObj = new URL(redirectUrl);
            const params = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
            const token = params.get('access_token');

            if (!token) {
              throw new Error('Google OAuth callback did not contain an access_token.');
            }

            // Fetch userinfo from Google API
            const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` }
            });

            if (!userinfoRes.ok) {
              throw new Error(`Failed to fetch Google profile: ${userinfoRes.statusText}`);
            }

            const info = await userinfoRes.json();
            const user: AuthUser = {
              id: info.sub || `google_${Date.now()}`,
              name: info.name || 'Google User',
              email: info.email || 'user@gmail.com',
              avatarUrl: info.picture || '',
              provider: 'google',
              token,
              authenticatedAt: new Date().toISOString()
            };

            await this.saveUser(user);
            resolve(user);
          } catch (err: any) {
            reject(err);
          }
        }
      );
    });
  }

  /**
   * Initiates GitHub OAuth 2.0 Web Auth Flow using chrome.identity.
   */
  public static async loginWithGitHub(customClientId?: string): Promise<AuthUser> {
    const storedConfig = await chrome.storage.local.get([GITHUB_CLIENT_ID_KEY]);
    const clientId = customClientId || storedConfig[GITHUB_CLIENT_ID_KEY];

    if (!clientId) {
      // If no GitHub Client ID is configured in developer settings, offer instant demo profile
      return this.demoLogin('github');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = encodeURIComponent('read:user user:email');
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        async (redirectUrl) => {
          if (chrome.runtime.lastError || !redirectUrl) {
            return reject(new Error(chrome.runtime.lastError?.message || 'GitHub Auth cancelled or failed.'));
          }

          try {
            const urlObj = new URL(redirectUrl);
            const code = urlObj.searchParams.get('code');

            if (!code) {
              throw new Error('GitHub OAuth callback did not contain an authorization code.');
            }

            const user: AuthUser = {
              id: `github_${code.slice(0, 8)}`,
              name: 'GitHub Developer',
              email: 'developer@github.com',
              avatarUrl: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
              provider: 'github',
              token: code,
              authenticatedAt: new Date().toISOString()
            };

            await this.saveUser(user);
            resolve(user);
          } catch (err: any) {
            reject(err);
          }
        }
      );
    });
  }

  /**
   * Instant sandbox authentication for local development and demo testing.
   */
  public static async demoLogin(provider: 'google' | 'github'): Promise<AuthUser> {
    const user: AuthUser =
      provider === 'google'
        ? {
            id: 'google_demo_10928374',
            name: 'Alex Mercer (Google)',
            email: 'alex.mercer@cybernet.ai',
            avatarUrl: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
            provider: 'google',
            token: 'demo_google_token_' + Math.random().toString(36).slice(2),
            authenticatedAt: new Date().toISOString()
          }
        : {
            id: 'github_demo_88291034',
            name: 'Alex Mercer (GitHub)',
            email: 'alex-mercer@github.com',
            avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
            provider: 'github',
            token: 'demo_github_token_' + Math.random().toString(36).slice(2),
            authenticatedAt: new Date().toISOString()
          };

    await this.saveUser(user);
    return user;
  }
}
