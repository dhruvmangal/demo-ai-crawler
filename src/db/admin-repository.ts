import { sequelize } from '../config/sequelize';
import { hashPassword } from '../auth/password';
import { ConflictError, NotFoundError } from '../errors/api-error';
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

  /** Every admin with their granted permissions eager-loaded, for the admin-management page. */
  static listAdmins(): Promise<Admin[]> {
    return Admin.findAll({
      attributes: { exclude: ['passwordHash'] },
      include: [{ model: Permission, as: 'permissions', through: { attributes: [] } }],
      order: [['createdAt', 'ASC']]
    });
  }

  static listPermissions(): Promise<Permission[]> {
    return Permission.findAll({ order: [['key', 'ASC']] });
  }

  /** isSuperadmin is deliberately not settable here -- only the migration seed grants it. */
  static async createAdmin(input: { email: string; name: string; password: string }): Promise<Admin> {
    const created = await sequelize.transaction(async t => {
      const existing = await Admin.findOne({ where: { email: input.email }, transaction: t });
      if (existing) {
        throw new ConflictError('An admin with this email already exists.');
      }
      const passwordHash = await hashPassword(input.password);
      return Admin.create({ email: input.email, name: input.name, passwordHash }, { transaction: t });
    });
    return (await Admin.findByPk(created.id, { attributes: { exclude: ['passwordHash'] } }))!;
  }

  static async setActive(id: string, isActive: boolean): Promise<Admin> {
    const admin = await Admin.findByPk(id);
    if (!admin) {
      throw new NotFoundError('Admin not found');
    }
    await admin.update({ isActive });
    return (await Admin.findByPk(id, { attributes: { exclude: ['passwordHash'] } }))!;
  }

  static async grantPermission(adminId: string, permissionKey: string): Promise<void> {
    const [admin, permission] = await Promise.all([
      Admin.findByPk(adminId),
      Permission.findOne({ where: { key: permissionKey } })
    ]);
    if (!admin) {
      throw new NotFoundError('Admin not found');
    }
    if (!permission) {
      throw new NotFoundError(`Unknown permission: ${permissionKey}`);
    }
    await (admin as Admin & { addPermission(p: Permission): Promise<void> }).addPermission(permission);
  }

  static async revokePermission(adminId: string, permissionKey: string): Promise<void> {
    const [admin, permission] = await Promise.all([
      Admin.findByPk(adminId),
      Permission.findOne({ where: { key: permissionKey } })
    ]);
    if (!admin) {
      throw new NotFoundError('Admin not found');
    }
    if (!permission) {
      throw new NotFoundError(`Unknown permission: ${permissionKey}`);
    }
    await (admin as Admin & { removePermission(p: Permission): Promise<void> }).removePermission(permission);
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
