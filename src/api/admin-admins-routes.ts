import { Router, Request, Response } from 'express';
import { AdminRepository } from '../db/admin-repository';
import { authorizeAdmin } from '../middleware/authorize-admin';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { ok } from '../utils/response-envelope';
import { BadRequestError } from '../errors/api-error';
import { createAdminBodySchema, updateAdminBodySchema, grantPermissionBodySchema } from '../validation/schemas/admin.schemas';

/**
 * Admin-account management: list/create admins and grant/revoke their permissions. Mounted
 * only in admin-server.ts, behind authenticateAdmin + authorizeAdmin('admins.manage') --
 * the most sensitive surface of the backoffice, since it controls who else can reach it.
 */
export const adminAdminsRouter = Router();

adminAdminsRouter.get(
  '/admins',
  authorizeAdmin('admins.manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const admins = await AdminRepository.listAdmins();
    return ok(res, { admins });
  })
);

adminAdminsRouter.get(
  '/permissions',
  authorizeAdmin('admins.manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const permissions = await AdminRepository.listPermissions();
    return ok(res, { permissions });
  })
);

adminAdminsRouter.post(
  '/admins',
  authorizeAdmin('admins.manage'),
  validate({ body: createAdminBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, name, password } = req.body as { email: string; name: string; password: string };
    const admin = await AdminRepository.createAdmin({ email, name, password });
    return ok(res, { admin }, 201);
  })
);

adminAdminsRouter.patch(
  '/admins/:id',
  authorizeAdmin('admins.manage'),
  validate({ body: updateAdminBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isActive } = req.body as { isActive: boolean };
    if (!isActive && req.auth!.id === id) {
      throw new BadRequestError('You cannot deactivate your own admin account.');
    }
    const admin = await AdminRepository.setActive(id, isActive);
    return ok(res, { admin });
  })
);

adminAdminsRouter.post(
  '/admins/:id/permissions',
  authorizeAdmin('admins.manage'),
  validate({ body: grantPermissionBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { key } = req.body as { key: string };
    await AdminRepository.grantPermission(id, key);
    return ok(res, { message: 'Permission granted.' });
  })
);

adminAdminsRouter.delete(
  '/admins/:id/permissions/:key',
  authorizeAdmin('admins.manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, key } = req.params;
    await AdminRepository.revokePermission(id, key);
    return ok(res, { message: 'Permission revoked.' });
  })
);
