import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;

function assertRequiredEnv(): void {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
    );
  }
}

assertRequiredEnv();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 3000,
  adminPort: Number(process.env.ADMIN_PORT) || Number(process.env.PORT) || 3001,

  databaseUrl: process.env.DATABASE_URL as string,

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET as string,
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30,
  bcryptCost: Number(process.env.BCRYPT_COST) || 12,

  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
  githubOAuthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@example.com'
  },

  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  adminAppBaseUrl: process.env.ADMIN_APP_BASE_URL || 'http://localhost:3001',

  superadminEmail: process.env.SUPERADMIN_EMAIL || '',
  superadminPassword: process.env.SUPERADMIN_PASSWORD || '',

  // Must stay false in production -- disables the SSRF private-IP check for local/dev
  // targets like the built-in mock-crm-server. See src/security/ssrf-guard.ts.
  allowPrivateCrawlTargets: process.env.ALLOW_PRIVATE_CRAWL_TARGETS === 'true'
};
