import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/api-error';

export type AccessTokenSubjectType = 'user' | 'admin';

export interface AccessTokenPayload {
  sub: string;
  subjectType: AccessTokenSubjectType;
  email: string;
  // Set for user tokens only.
  userType?: string;
  // Set for admin tokens only. Deliberately just a flag, not the full permission set --
  // authorizeAdmin() checks admin_permissions live on every request so a permission
  // revocation takes effect immediately instead of waiting out the token's TTL.
  isSuperadmin?: boolean;
}

export interface AccessTokenClaims extends AccessTokenPayload {
  iat: number;
  exp: number;
  jti: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessTtl as jwt.SignOptions['expiresIn'],
    jwtid: randomUUID()
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as AccessTokenClaims;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token.');
  }
}
