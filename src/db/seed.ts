import { UserRepository } from './user-repository';
import { runMigrations } from './migrate';
import { hashPassword } from '../auth/password';
import { ConflictError } from '../errors/api-error';

const DEMO_EMAIL = 'demo-analyst@narreto.io';

export async function seedDatabase(): Promise<void> {
  console.log('--- SEEDING DATABASE ---');
  await runMigrations();

  // The superadmin bootstrap account is seeded by migration 00009 from
  // SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD, not here -- see src/db/migrations.
  const meta = { ipAddress: '127.0.0.1', userAgent: 'seed-script' };
  try {
    const passwordHash = await hashPassword('Demo1234!');
    const demoUser = await UserRepository.createLocalUser({ email: DEMO_EMAIL, name: 'Narreto Demo Analyst', passwordHash }, meta);
    console.log(`[Seed] Created demo user: ${demoUser.email} (password: Demo1234!)`);
  } catch (err) {
    if (err instanceof ConflictError) {
      console.log(`[Seed] Demo user ${DEMO_EMAIL} already exists, skipping.`);
    } else {
      throw err;
    }
  }

  const stats = await UserRepository.getStats();
  console.log('\n--- SEEDING COMPLETED ---');
  console.log(`Total Users in DB: ${stats.totalUsers}`);
  console.log(`Total Signups Recorded: ${stats.totalSignups}`);
  console.log(`Total Logins Recorded: ${stats.totalLogins}`);
  console.log('Provider Breakdown:', JSON.stringify(stats.providerBreakdown, null, 2));
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
