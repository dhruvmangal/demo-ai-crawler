import bcrypt from 'bcryptjs';
import { MigrationParams } from '../migration-types';
import { env } from '../../config/env';

// Self-contained on purpose (hashes inline via bcryptjs rather than importing
// src/auth/password.ts) -- migrations are a snapshot in time and shouldn't depend on
// application code that's free to change later.
const BASELINE_PERMISSIONS: Array<{ key: string; description: string }> = [
  { key: 'crawl.view', description: 'View crawl requests and their results' },
  { key: 'crawl.manage', description: 'Trigger, cancel, or delete crawl requests' },
  { key: 'users.view', description: 'View registered users and auth logs' },
  { key: 'users.manage', description: 'Modify or deactivate user accounts' },
  { key: 'admins.manage', description: 'Create, modify, or deactivate admin accounts and their permissions' },
  { key: 'workflows.run', description: 'Trigger workflow recording runs' },
  { key: 'recordings.view', description: 'View and download workflow recordings' }
];

export async function up({ context: sequelize }: MigrationParams): Promise<void> {
  for (const perm of BASELINE_PERMISSIONS) {
    await sequelize.query(
      `INSERT INTO permissions (key, description) VALUES (:key, :description)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
      { replacements: perm }
    );
  }

  if (!env.superadminEmail || !env.superadminPassword) {
    console.warn(
      '[Migration 00009] SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD not set -- skipping superadmin seed. ' +
      'Set both and re-run `npm run db:migrate` to create the bootstrap superadmin.'
    );
    return;
  }

  const passwordHash = await bcrypt.hash(env.superadminPassword, env.bcryptCost);
  await sequelize.query(
    `INSERT INTO admins (email, name, password_hash, is_superadmin)
     VALUES (:email, 'Superadmin', :passwordHash, true)
     ON CONFLICT (email) DO NOTHING`,
    { replacements: { email: env.superadminEmail, passwordHash } }
  );
}

export async function down({ context: sequelize }: MigrationParams): Promise<void> {
  await sequelize.query(
    `DELETE FROM permissions WHERE key = ANY(:keys)`,
    { replacements: { keys: BASELINE_PERMISSIONS.map(p => p.key) } }
  );
}
