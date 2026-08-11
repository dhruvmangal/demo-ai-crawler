import { Router, Request, Response } from 'express';
import { AdminRepository } from '../db/admin-repository';
import { RefreshTokenRepository } from '../db/refresh-token-repository';
import { RequestMeta } from '../db/user-repository';
import { verifyPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { authStrict } from '../middleware/rate-limiters';
import { ok } from '../utils/response-envelope';
import { UnauthorizedError } from '../errors/api-error';
import { Admin } from '../db/models/admin.model';
import { adminLoginBodySchema, refreshBodySchema, logoutBodySchema } from '../validation/schemas/auth.schemas';

/**
 * Admin-only login/refresh/logout, mirroring src/api/auth-routes.ts but issuing
 * subjectType='admin' tokens. No OAuth here -- admin login is always password-based.
 * Mounted in admin-server.ts BEFORE the blanket authenticateAdmin/authorizeAdmin guard on
 * the rest of /api/admin/* -- see admin-server.ts for why the ordering matters.
 */
export const adminAuthRouter = Router();
adminAuthRouter.use(authStrict);

function requestMeta(req: Request): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.socket.remoteAddress || req.ip || null;
  const userAgent = (req.headers['user-agent'] as string) || null;
  return { ipAddress, userAgent };
}

function publicAdmin(admin: Admin) {
  return { id: admin.id, email: admin.email, name: admin.name, isSuperadmin: admin.isSuperadmin };
}

async function issueTokenPair(admin: Admin, meta: RequestMeta) {
  const accessToken = signAccessToken({ sub: admin.id, subjectType: 'admin', email: admin.email, isSuperadmin: admin.isSuperadmin });
  const { rawToken: refreshToken } = await RefreshTokenRepository.issue('admin', admin.id, meta);
  return { accessToken, refreshToken };
}

adminAuthRouter.post(
  '/login',
  validate({ body: adminLoginBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    const meta = requestMeta(req);

    const admin = await AdminRepository.findByEmail(email);
    if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password.');
    }
    if (!admin.isActive) {
      throw new UnauthorizedError('This admin account has been deactivated.');
    }

    await AdminRepository.recordLogin(admin);
    const tokens = await issueTokenPair(admin, meta);
    return ok(res, { admin: publicAdmin(admin), ...tokens });
  })
);

adminAuthRouter.post(
  '/refresh',
  validate({ body: refreshBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const meta = requestMeta(req);

    const record = await RefreshTokenRepository.findAny(refreshToken);
    if (!record) {
      throw new UnauthorizedError('Invalid refresh token.');
    }
    if (record.revokedAt) {
      await RefreshTokenRepository.revokeFamily(record.familyId);
      throw new UnauthorizedError('This session has been revoked. Please log in again.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }
    if (record.subjectType !== 'admin' || !record.adminId) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const admin = await AdminRepository.findById(record.adminId);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedError('Admin account is no longer available.');
    }

    const { rawToken: newRefreshToken } = await RefreshTokenRepository.rotate(record, meta);
    const accessToken = signAccessToken({ sub: admin.id, subjectType: 'admin', email: admin.email, isSuperadmin: admin.isSuperadmin });
    return ok(res, { accessToken, refreshToken: newRefreshToken });
  })
);

adminAuthRouter.post(
  '/logout',
  validate({ body: logoutBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const record = await RefreshTokenRepository.findAny(refreshToken);
    if (record) {
      await RefreshTokenRepository.revoke(record);
    }
    return ok(res, { message: 'Logged out.' });
  })
);
