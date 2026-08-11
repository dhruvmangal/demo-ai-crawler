import { MigrationParams } from '../migration-types';

export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      consumed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS email_verification_tokens;`);
}
