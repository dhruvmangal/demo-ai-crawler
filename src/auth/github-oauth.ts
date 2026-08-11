import { env } from '../config/env';
import { UnauthorizedError } from '../errors/api-error';

export interface GitHubProfile {
  githubId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

interface GitHubTokenResponse {
  access_token?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GitHubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

// Exchanges the authorization `code` the extension captured via
// chrome.identity.launchWebAuthFlow for an access token, server-side, using the client
// secret -- this can't happen in the extension itself since a secret embedded in a Chrome
// extension isn't actually secret. Replaces the old non-functional GitHub stub, which
// never exchanged the code and fabricated a fake profile.
export async function exchangeGitHubCode(code: string, redirectUri: string): Promise<GitHubProfile> {
  if (!env.githubOAuthClientId || !env.githubOAuthClientSecret) {
    throw new UnauthorizedError('GitHub sign-in is not configured on this server.');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.githubOAuthClientId,
      client_secret: env.githubOAuthClientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  const tokenData = (await tokenRes.json().catch(() => null)) as GitHubTokenResponse | null;
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new UnauthorizedError('Failed to exchange GitHub authorization code.');
  }
  const accessToken = tokenData.access_token;
  const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'crawler-app', Accept: 'application/vnd.github+json' };

  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers })
  ]);
  if (!userRes.ok) {
    throw new UnauthorizedError('Failed to fetch GitHub profile.');
  }
  const user = (await userRes.json()) as GitHubUserResponse;

  let email = user.email;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as GitHubEmailResponse[];
    const verifiedPrimary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
    if (verifiedPrimary) {
      email = verifiedPrimary.email;
    }
  }
  if (!email) {
    throw new UnauthorizedError('GitHub account has no verified email available.');
  }

  return {
    githubId: String(user.id),
    email,
    name: user.name || user.login,
    avatarUrl: user.avatar_url
  };
}
