import { Router, Request, Response } from 'express';
import { UserRepository } from '../db/user-repository';
import { asyncHandler } from '../middleware/async-handler';
import { authorizeAdmin } from '../middleware/authorize-admin';
import { ok } from '../utils/response-envelope';

/**
 * Formerly public (GET /api/auth/users|logs|stats) -- relocated here because they leak
 * every registered user's PII with zero auth. Mounted only in admin-server.ts, behind
 * authenticateAdmin + authorizeAdmin('users.view').
 */
export const adminUsersRouter = Router();

adminUsersRouter.get(
  '/users',
  authorizeAdmin('users.view'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const { total, users } = await UserRepository.getUsers(limit, offset);
    return ok(res, { total, users });
  })
);

adminUsersRouter.get(
  '/logs',
  authorizeAdmin('users.view'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const logs = await UserRepository.getAuthLogs(limit);
    return ok(res, { logs, count: logs.length });
  })
);

adminUsersRouter.get(
  '/stats',
  authorizeAdmin('users.view'),
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await UserRepository.getStats();
    return ok(res, stats);
  })
);
