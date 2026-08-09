import { Router, Request, Response } from 'express';
import { UserRepository } from '../db/user-repository';
import { AuthProvider } from '../db/schema';

export const authRouter = Router();

/**
 * POST /api/auth/sync
 * Synchronizes an authenticated Google, GitHub, or Demo user profile with PostgreSQL.
 * Upserts the user record and automatically inserts a SIGNUP (if first-time) or LOGIN audit log.
 */
authRouter.post('/sync', async (req: Request, res: Response) => {
  const { email, name, avatarUrl, provider, providerUserId, role, metadata } = req.body;

  if (!email || !name || !provider) {
    return res.status(400).json({ error: 'email, name, and provider are required fields' });
  }

  const validProviders: AuthProvider[] = ['google', 'github', 'demo'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
  }

  try {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || req.ip;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await UserRepository.upsertUser(
      {
        email,
        name,
        avatarUrl,
        provider,
        providerUserId,
        role: role || 'user'
      },
      {
        ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : ipAddress,
        userAgent,
        metadata: metadata || null
      }
    );

    return res.status(result.isNewUser ? 201 : 200).json({
      success: true,
      user: result.user,
      isNewUser: result.isNewUser,
      logId: result.logId,
      message: result.isNewUser ? 'User registered and signup logged.' : 'User session updated and login logged.'
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to synchronize user profile.' });
  }
});

/**
 * GET /api/auth/users
 * Returns list of registered users and their last login status.
 */
authRouter.get('/users', async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

  try {
    const data = await UserRepository.getUsers(limit, offset);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to list users.' });
  }
});

/**
 * GET /api/auth/logs
 * Returns recent authentication audit trails (signups, logins, logouts).
 */
authRouter.get('/logs', async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

  try {
    const logs = await UserRepository.getAuthLogs(limit);
    return res.json({ logs, count: logs.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch auth logs.' });
  }
});

/**
 * GET /api/auth/stats
 * Returns aggregated authentication statistics and provider breakdowns.
 */
authRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await UserRepository.getStats();
    return res.json(stats);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to aggregate auth statistics.' });
  }
});
