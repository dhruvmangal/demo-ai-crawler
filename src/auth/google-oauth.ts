import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/api-error';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

// Server-side verification of the id_token the extension gets from
// chrome.identity.launchWebAuthFlow -- replaces the old /api/auth/sync, which trusted
// whatever profile the client claimed with no verification at all.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.googleOAuthClientId) {
    throw new UnauthorizedError('Google sign-in is not configured on this server.');
  }

  const client = new OAuth2Client(env.googleOAuthClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleOAuthClientId });
    payload = ticket.getPayload();
  } catch {
    throw new UnauthorizedError('Invalid Google ID token.');
  }

  if (!payload || !payload.sub || !payload.email) {
    throw new UnauthorizedError('Google ID token is missing required claims.');
  }
  if (!payload.email_verified) {
    throw new UnauthorizedError('Google account email is not verified.');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    avatarUrl: payload.picture || null
  };
}
