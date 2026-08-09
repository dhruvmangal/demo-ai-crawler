import { query } from '../config/database';
import fs from 'fs';
import path from 'path';

export async function runMigrations(): Promise<void> {
  console.log('--- RUNNING DATABASE MIGRATIONS ---');

  // 1. Read init.sql
  const initSqlPath = path.join(__dirname, '../../init.sql');
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, 'utf-8');
    await query(sql);
    console.log('[Migration] init.sql applied successfully.');
  }

  // 2. Ensure users table exists
  await query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      provider VARCHAR(50) NOT NULL,
      provider_user_id VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_auth_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      provider VARCHAR(50) NOT NULL,
      ip_address VARCHAR(100),
      user_agent TEXT,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider);
    CREATE INDEX IF NOT EXISTS idx_auth_logs_user_id ON user_auth_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON user_auth_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auth_logs_event_type ON user_auth_logs(event_type);
  `);

  console.log('[Migration] users and user_auth_logs verified.');
  console.log('--- MIGRATIONS COMPLETED ---');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
