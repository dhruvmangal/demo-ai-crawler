import { NextFunction, Request, Response } from 'express';
import { AdminRepository } from '../db/admin-repository';
import { ForbiddenError, UnauthorizedError } from '../errors/api-error';
import { asyncHandler } from './async-handler';

// Must run after authenticateAdmin(). If `permissionKey` is omitted, any authenticated
// active admin passes; otherwise the admin needs that permission or is_superadmin.
export function authorizeAdmin(permissionKey?: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.subjectType !== 'admin') {
      throw new UnauthorizedError('Admin authentication required.');
    }

    const admin = await AdminRepository.findById(req.auth.id);
    if (!admin || !admin.isActive) {
      throw new ForbiddenError('Admin account is inactive or no longer exists.');
    }

    if (permissionKey) {
      const allowed = await AdminRepository.hasPermission(admin, permissionKey);
      if (!allowed) {
        throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
      }
    }

    next();
  });
}
