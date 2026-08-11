import { MigrationParams } from '../migration-types';

// Superadmin bypasses this table entirely (admins.is_superadmin short-circuits
// authorizeAdmin()) -- granting every row here to a superadmin would mean a newly added
// permission doesn't automatically apply until a data migration grants it too.
export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (admin_id, permission_id)
    );
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS admin_permissions;`);
}
