import { randomBytes, createHash } from 'crypto';

// Opaque tokens (refresh / email-verification / password-reset) are never stored raw --
// only their SHA-256 hash is persisted, so a DB read alone can't be used to authenticate.
export function generateOpaqueToken(): string {
  return randomBytes(64).toString('hex');
}

export function hashOpaqueToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
