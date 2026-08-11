import { Router, Request, Response } from 'express';
import { UserRepository } from '../db/user-repository';
import { UserProfileRepository, OnboardingInput } from '../db/user-profile-repository';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { ok } from '../utils/response-envelope';
import { UnauthorizedError, NotFoundError } from '../errors/api-error';
import { onboardingBodySchema } from '../validation/schemas/user.schemas';

/**
 * The logged-in user's own profile/onboarding endpoints. Mounted under /api (see
 * routes.ts), so they inherit the blanket `authenticate` middleware applied there --
 * always operates on req.auth.id (the token's subject), never a client-supplied id.
 */
export const userRouter = Router();

function requireUserId(req: Request): string {
  if (!req.auth || req.auth.subjectType !== 'user') {
    throw new UnauthorizedError('User authentication required.');
  }
  return req.auth.id;
}

function publicProfile(profile: Awaited<ReturnType<typeof UserProfileRepository.findByUserId>>) {
  if (!profile) return null;
  return {
    gender: profile.gender,
    industry: profile.industry,
    roleTitle: profile.roleTitle,
    usageIntent: profile.usageIntent,
    defaultTargetAudience: profile.defaultTargetAudience,
    onboardingCompletedAt: profile.onboardingCompletedAt
  };
}

/** GET /api/users/me -- the logged-in user's identity plus onboarding profile (null if not yet onboarded). */
userRouter.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found.');
    }
    const profile = await UserProfileRepository.findByUserId(userId);

    return ok(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
        userType: user.userType,
        emailVerifiedAt: user.emailVerifiedAt
      },
      profile: publicProfile(profile)
    });
  })
);

/**
 * POST /api/users/me/onboarding
 * Post-signup step collecting gender/industry/role/usage-intent/target-audience. Safe to
 * call again later (re-onboarding updates the existing row rather than erroring).
 */
userRouter.post(
  '/me/onboarding',
  validate({ body: onboardingBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const input = req.body as OnboardingInput;
    const profile = await UserProfileRepository.upsert(userId, input);
    return ok(res, publicProfile(profile));
  })
);
