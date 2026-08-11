import { Router, Request, Response } from 'express';
import { UserRepository, RequestMeta } from '../db/user-repository';
import { RefreshTokenRepository } from '../db/refresh-token-repository';
import { EmailVerificationTokenRepository, PasswordResetTokenRepository } from '../db/verification-token-repository';
import { hashPassword, verifyPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';
import { verifyGoogleIdToken } from '../auth/google-oauth';
import { exchangeGitHubCode } from '../auth/github-oauth';
import { sendEmail } from '../email/mailer';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { authStrict } from '../middleware/rate-limiters';
import { ok } from '../utils/response-envelope';
import { BadRequestError, UnauthorizedError } from '../errors/api-error';
import { env } from '../config/env';
import { User } from '../db/models/user.model';
import {
  signupBodySchema,
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  passwordResetRequestBodySchema,
  passwordResetConfirmBodySchema,
  verifyEmailQuerySchema,
  resendVerificationBodySchema,
  googleAuthBodySchema,
  githubAuthBodySchema
} from '../validation/schemas/auth.schemas';

export const authRouter = Router();
authRouter.use(authStrict);

function requestMeta(req: Request): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.socket.remoteAddress || req.ip || null;
  const userAgent = (req.headers['user-agent'] as string) || null;
  return { ipAddress, userAgent };
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
    userType: user.userType,
    emailVerifiedAt: user.emailVerifiedAt
  };
}

async function issueTokenPair(user: User, meta: RequestMeta) {
  const accessToken = signAccessToken({ sub: user.id, subjectType: 'user', email: user.email, userType: user.userType });
  const { rawToken: refreshToken } = await RefreshTokenRepository.issue('user', user.id, meta);
  return { accessToken, refreshToken };
}

async function sendVerificationEmail(user: User): Promise<void> {
  const token = await EmailVerificationTokenRepository.issue(user.id);
  const link = `${env.appBaseUrl}/api/auth/verify-email?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your email',
    text: `Hi ${user.name},\n\nVerify your email by visiting:\n${link}\n\nThis link expires in 24 hours.`
  });
}

/**
 * POST /api/auth/signup
 * Email+password signup. Logs the user in immediately (per product decision -- email
 * verification doesn't gate login, it's tracked via users.email_verified_at for future
 * feature gating).
 */
authRouter.post(
  '/signup',
  validate({ body: signupBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name } = req.body as { email: string; password: string; name: string };
    const meta = requestMeta(req);

    const passwordHash = await hashPassword(password);
    const user = await UserRepository.createLocalUser({ email, name, passwordHash }, meta);
    await sendVerificationEmail(user).catch(err => console.error('[Auth] Failed to send verification email:', err));

    const tokens = await issueTokenPair(user, meta);
    return ok(res, { user: publicUser(user), ...tokens }, 201);
  })
);

/** POST /api/auth/login -- email+password. */
authRouter.post(
  '/login',
  validate({ body: loginBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    const meta = requestMeta(req);

    const user = await UserRepository.findByEmail(email);
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password.');
    }
    if (!user.isActive) {
      throw new UnauthorizedError('This account has been deactivated.');
    }

    await UserRepository.recordLocalLogin(user, meta);
    const tokens = await issueTokenPair(user, meta);
    return ok(res, { user: publicUser(user), ...tokens });
  })
);

/**
 * POST /api/auth/refresh
 * Rotates a refresh token. Presenting a token that was already rotated away (revoked) is
 * treated as a theft signal -- the whole rotation family is revoked, forcing re-login.
 */
authRouter.post(
  '/refresh',
  validate({ body: refreshBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const meta = requestMeta(req);

    const record = await RefreshTokenRepository.findAny(refreshToken);
    if (!record) {
      throw new UnauthorizedError('Invalid refresh token.');
    }
    if (record.revokedAt) {
      await RefreshTokenRepository.revokeFamily(record.familyId);
      throw new UnauthorizedError('This session has been revoked. Please log in again.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }
    if (record.subjectType !== 'user' || !record.userId) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const user = await UserRepository.findById(record.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account is no longer available.');
    }

    const { rawToken: newRefreshToken } = await RefreshTokenRepository.rotate(record, meta);
    const accessToken = signAccessToken({ sub: user.id, subjectType: 'user', email: user.email, userType: user.userType });
    return ok(res, { accessToken, refreshToken: newRefreshToken });
  })
);

/** POST /api/auth/logout -- revokes one session, or every session for that account with ?all=true. */
authRouter.post(
  '/logout',
  validate({ body: logoutBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const record = await RefreshTokenRepository.findAny(refreshToken);

    if (record) {
      const revokeEverywhere = req.query.all === 'true';
      if (revokeEverywhere && record.userId) {
        await RefreshTokenRepository.revokeAllForSubject('user', record.userId);
      } else {
        await RefreshTokenRepository.revoke(record);
      }
    }

    return ok(res, { message: 'Logged out.' });
  })
);

/** POST /api/auth/password/reset-request -- always 200, never reveals whether the email exists. */
authRouter.post(
  '/password/reset-request',
  validate({ body: passwordResetRequestBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body as { email: string };
    const user = await UserRepository.findByEmail(email);

    if (user) {
      const token = await PasswordResetTokenRepository.issue(user.id);
      const link = `${env.appBaseUrl}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        text: `Hi ${user.name},\n\nReset your password by visiting:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`
      }).catch(err => console.error('[Auth] Failed to send password reset email:', err));
    }

    return ok(res, { message: 'If that email is registered, a reset link has been sent.' });
  })
);

/** POST /api/auth/password/reset-confirm -- also revokes every existing session for that user. */
authRouter.post(
  '/password/reset-confirm',
  validate({ body: passwordResetConfirmBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };

    const userId = await PasswordResetTokenRepository.consume(token);
    if (!userId) {
      throw new BadRequestError('Invalid or expired reset token.');
    }

    const passwordHash = await hashPassword(newPassword);
    await UserRepository.updatePasswordHash(userId, passwordHash);
    await RefreshTokenRepository.revokeAllForSubject('user', userId);

    return ok(res, { message: 'Password updated. Please log in again.' });
  })
);

/** GET /api/auth/verify-email?token= */
authRouter.get(
  '/verify-email',
  validate({ query: verifyEmailQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.query as { token: string };
    const userId = await EmailVerificationTokenRepository.consume(token);
    if (!userId) {
      throw new BadRequestError('Invalid or expired verification token.');
    }
    await UserRepository.markEmailVerified(userId);
    return ok(res, { message: 'Email verified.' });
  })
);

/** POST /api/auth/verify-email/resend */
authRouter.post(
  '/verify-email/resend',
  validate({ body: resendVerificationBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body as { email: string };
    const user = await UserRepository.findByEmail(email);
    if (user && !user.emailVerifiedAt) {
      await sendVerificationEmail(user).catch(err => console.error('[Auth] Failed to resend verification email:', err));
    }
    return ok(res, { message: 'If that email needs verification, a new link has been sent.' });
  })
);

/**
 * POST /api/auth/google
 * Verifies the Google id_token server-side via google-auth-library -- replaces the old
 * POST /api/auth/sync, which trusted whatever profile the client claimed with zero
 * verification.
 */
authRouter.post(
  '/google',
  validate({ body: googleAuthBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { idToken } = req.body as { idToken: string };
    const profile = await verifyGoogleIdToken(idToken);
    const meta = requestMeta(req);

    const { user } = await UserRepository.loginOrSignupOAuthUser(
      { provider: 'google', providerId: profile.googleId, email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
      meta
    );
    const tokens = await issueTokenPair(user, meta);
    return ok(res, { user: publicUser(user), ...tokens });
  })
);

/**
 * POST /api/auth/github
 * Exchanges the authorization code server-side (needs the client secret) -- replaces the
 * old non-functional GitHub stub that never exchanged the code at all.
 */
authRouter.post(
  '/github',
  validate({ body: githubAuthBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { code, redirectUri } = req.body as { code: string; redirectUri: string };
    const profile = await exchangeGitHubCode(code, redirectUri);
    const meta = requestMeta(req);

    const { user } = await UserRepository.loginOrSignupOAuthUser(
      { provider: 'github', providerId: profile.githubId, email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
      meta
    );
    const tokens = await issueTokenPair(user, meta);
    return ok(res, { user: publicUser(user), ...tokens });
  })
);
