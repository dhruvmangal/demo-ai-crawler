import { MigrationParams } from '../migration-types';

export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      key VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS permissions;`);
}
