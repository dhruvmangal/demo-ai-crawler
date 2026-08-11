import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

const jsonHandler = (req: Request) => {
  return {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later.' }
  };
};

// Signup/login/refresh/password-reset/OAuth -- keyed by IP since the caller isn't
// authenticated yet at this point.
export const authStrict = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonHandler
});

// POST /api/crawl, /api/crawl/:id/credentials, /api/workflows/:id/run -- resource-heavy
// (Playwright), keyed by authenticated user rather than IP once auth is enforced.
export const crawlHeavy = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.id || ipKeyGenerator(req.ip || ''),
  message: jsonHandler
});

// GET status/graph/summary endpoints.
export const readLoose = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonHandler
});

// Rest of admin-server.ts's /api/admin/* (excluding /api/admin/auth, which uses authStrict).
export const adminTier = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.id || ipKeyGenerator(req.ip || ''),
  message: jsonHandler
});
