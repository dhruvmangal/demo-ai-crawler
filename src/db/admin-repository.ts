import { Admin } from './models/admin.model';
import { Permission } from './models/permission.model';
import './models/index';

export class AdminRepository {
  static findByEmail(email: string): Promise<Admin | null> {
    return Admin.findOne({ where: { email } });
  }

  static findById(id: string): Promise<Admin | null> {
    return Admin.findByPk(id);
  }

  static async recordLogin(admin: Admin): Promise<void> {
    // Admin login/logout audit trail is deferred (v1 relies on application logs) --
    // see the implementation plan's "Admin audit log" decision.
    await admin.update({ lastLoginAt: new Date() });
  }

  /** Superadmin bypasses the permissions table entirely -- see admin_permissions migration comment. */
  static async hasPermission(admin: Admin, permissionKey: string): Promise<boolean> {
    if (admin.isSuperadmin) {
      return true;
    }
    const count = await Permission.count({
      where: { key: permissionKey },
      include: [{ model: Admin, as: 'admins', where: { id: admin.id }, attributes: [] }]
    });
    return count > 0;
  }
}
