import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Deliberately NOT the main app's src/config/env.ts (which requires DATABASE_URL and
// JWT_ACCESS_SECRET to even load, plus SMTP/OAuth/superadmin config crawler-engine has no
// use for). This service only ever needs the two vars ssrf-guard.ts reads -- keeping it to
// just those means crawler-engine can be deployed/scaled without ever touching DB or auth
// secrets, which is the whole point of pulling it into its own service.
export const env = {
  // Must stay false in production -- disables the SSRF private-IP check for local/dev
  // targets like the built-in mock-crm-server. See src/security/ssrf-guard.ts.
  allowPrivateCrawlTargets: process.env.ALLOW_PRIVATE_CRAWL_TARGETS === 'true',

  // Hostnames (or IPs) a crawl is allowed to attach to over CDP (Playwright's
  // chromium.connectOverCDP) when CrawlOptions.connectCdpUrl is set. Empty by default, i.e.
  // the feature is off until an operator opts a specific host in. See ssrf-guard.ts.
  cdpAllowedHosts: (process.env.CDP_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
};
