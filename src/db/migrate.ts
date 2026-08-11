import fs from 'fs';
import path from 'path';
import { Umzug, SequelizeStorage } from 'umzug';
import { query } from '../config/database';
import { sequelize } from '../config/sequelize';

// init.sql is the frozen baseline (idempotent CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
// NOT EXISTS) -- it's re-applied on every run for continuity with existing deployments,
// but no new schema changes go into it. Everything from here on is a numbered migration
// in src/db/migrations/, tracked via Umzug's SequelizeStorage (a `SequelizeMeta` table).
export async function runMigrations(): Promise<void> {
  console.log('--- RUNNING DATABASE MIGRATIONS ---');

  const initSqlPath = path.join(__dirname, '..', '..', 'init.sql');
  if (fs.existsSync(initSqlPath)) {
    await query(fs.readFileSync(initSqlPath, 'utf-8'));
    console.log('[Migration] init.sql applied successfully.');
  }

  const umzug = new Umzug({
    migrations: { glob: path.join(__dirname, 'migrations', '*.js') },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize }),
    logger: console
  });

  const applied = await umzug.up();
  console.log(`[Migration] Applied ${applied.length} migration(s): ${applied.map(m => m.name).join(', ') || '(none pending)'}`);
  console.log('--- MIGRATIONS COMPLETED ---');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
