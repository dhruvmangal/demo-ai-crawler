import { MigrationParams } from '../migration-types';

// Separate from `users`: onboarding is a post-signup step, a user is fully functional
// before completing it, and this keeps the hot `users` row narrow.
export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      gender VARCHAR(30),
      industry VARCHAR(120),
      role_title VARCHAR(120),
      usage_intent TEXT,
      default_target_audience TEXT,
      onboarding_completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS user_profiles;`);
}
