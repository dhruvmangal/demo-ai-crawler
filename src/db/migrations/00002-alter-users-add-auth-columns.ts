import { MigrationParams } from '../migration-types';

// `role` (user/admin) becomes dead weight once `admins` is a separate table (migration
// 00003) -- left in place, unused, rather than dropped here to avoid a breaking change
// mid-rollout. Drop it in a dedicated cleanup migration once nothing references it.
export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(30) NOT NULL DEFAULT 'loggedin';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id VARCHAR(255);

    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT chk_users_user_type
        CHECK (user_type IN ('anonymous', 'loggedin', 'subscribed', 'premium_subscribed'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    DROP INDEX IF EXISTS idx_users_google_id;
    DROP INDEX IF EXISTS idx_users_github_id;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_user_type;
    ALTER TABLE users DROP COLUMN IF EXISTS github_id;
    ALTER TABLE users DROP COLUMN IF EXISTS google_id;
    ALTER TABLE users DROP COLUMN IF EXISTS is_active;
    ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
    ALTER TABLE users DROP COLUMN IF EXISTS user_type;
    ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
  `);
}
