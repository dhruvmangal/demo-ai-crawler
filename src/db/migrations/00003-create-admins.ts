import { MigrationParams } from '../migration-types';

// Separate from `users` entirely -- admin identity/authz has nothing to do with the
// consumer-facing user model, and keeping them apart means the admin surface can be
// reasoned about (and locked down) independently.
export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      is_superadmin BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS admins;`);
}
