import { UserRepository } from './user-repository';
import { runMigrations } from './migrate';

export async function seedDatabase(): Promise<void> {
  console.log('--- SEEDING DATABASE WITH AUTH USERS & LOGS ---');

  // Ensure migrations are run first
  await runMigrations();

  // Seed Google User
  const googleUser = await UserRepository.upsertUser(
    {
      email: 'alex.mercer@cybernet.ai',
      name: 'Alex Mercer (Google)',
      avatarUrl: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
      provider: 'google',
      providerUserId: 'google_oauth_sub_10928374',
      role: 'admin'
    },
    {
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36',
      metadata: { scope: 'openid email profile', authMethod: 'chrome.identity' }
    }
  );
  console.log(`[Seed] Seeded Google user: ${googleUser.user.email} (isNew: ${googleUser.isNewUser})`);

  // Seed GitHub User
  const githubUser = await UserRepository.upsertUser(
    {
      email: 'alex-mercer@github.com',
      name: 'Alex Mercer (GitHub)',
      avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
      provider: 'github',
      providerUserId: 'github_oauth_id_88291034',
      role: 'user'
    },
    {
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36',
      metadata: { scope: 'read:user user:email', authMethod: 'chrome.identity' }
    }
  );
  console.log(`[Seed] Seeded GitHub user: ${githubUser.user.email} (isNew: ${githubUser.isNewUser})`);

  // Seed Demo User
  const demoUser = await UserRepository.upsertUser(
    {
      email: 'demo-analyst@narreto.io',
      name: 'Narreto Demo Analyst',
      avatarUrl: null,
      provider: 'demo',
      providerUserId: 'demo_user_001',
      role: 'user'
    },
    {
      ipAddress: '127.0.0.1',
      userAgent: 'NarretoExtension/1.0.0',
      metadata: { source: 'local_sandbox' }
    }
  );
  console.log(`[Seed] Seeded Demo user: ${demoUser.user.email} (isNew: ${demoUser.isNewUser})`);

  // Print summary statistics
  const stats = await UserRepository.getStats();
  console.log('\n--- SEEDING COMPLETED SUCCESSFULLY ---');
  console.log(`Total Users in DB: ${stats.totalUsers}`);
  console.log(`Total Signups Recorded: ${stats.totalSignups}`);
  console.log(`Total Logins Recorded: ${stats.totalLogins}`);
  console.log('Provider Breakdown:', JSON.stringify(stats.providerBreakdown, null, 2));
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
