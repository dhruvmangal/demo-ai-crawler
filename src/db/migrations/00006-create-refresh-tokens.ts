import { MigrationParams } from '../migration-types';

// Supports both user and admin subjects via discriminated nullable FKs (not true
// polymorphism, so FK integrity is preserved). Refresh tokens are opaque strings, hashed
// at rest (token_hash) -- the raw token is never stored. `family_id` groups a chain of
// rotations; if a token that was already rotated away gets presented again, that's a
// theft signal and the whole family gets revoked (see src/auth/tokens.ts, Phase 2).
export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      subject_type VARCHAR(10) NOT NULL CHECK (subject_type IN ('user', 'admin')),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      replaced_by_token_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
      revoked_at TIMESTAMP WITH TIME ZONE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ip_address VARCHAR(100),
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_refresh_tokens_subject CHECK (
        (subject_type = 'user'  AND user_id  IS NOT NULL AND admin_id IS NULL) OR
        (subject_type = 'admin' AND admin_id IS NOT NULL AND user_id  IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens(admin_id);
  `);
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(`DROP TABLE IF EXISTS refresh_tokens;`);
}
