import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, AccessTokenSubjectType } from '../auth/jwt';
import { UnauthorizedError } from '../errors/api-error';

export interface AuthContext {
  subjectType: AccessTokenSubjectType;
  id: string;
  email: string;
  userType?: string;
  isSuperadmin?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header.');
  }
  return header.slice('Bearer '.length).trim();
}

// Verifies the JWT and sets req.auth. Trusts the token's claims for the duration of its
// short TTL (no DB hit per request) -- an admin's live permissions are still re-checked
// per-request by authorizeAdmin(), since those aren't embedded in the token.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  const claims = verifyAccessToken(token);
  req.auth = {
    subjectType: claims.subjectType,
    id: claims.sub,
    email: claims.email,
    userType: claims.userType,
    isSuperadmin: claims.isSuperadmin
  };
  next();
}

// Same as authenticate(), but only accepts admin-subject tokens -- used to gate
// admin-server.ts routes so a user access token can't be replayed there.
export function authenticateAdmin(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  const claims = verifyAccessToken(token);
  if (claims.subjectType !== 'admin') {
    throw new UnauthorizedError('Admin authentication required.');
  }
  req.auth = {
    subjectType: 'admin',
    id: claims.sub,
    email: claims.email,
    isSuperadmin: claims.isSuperadmin
  };
  next();
}
