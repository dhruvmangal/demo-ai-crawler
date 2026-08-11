import { UserProfile } from './models/user-profile.model';

export interface OnboardingInput {
  gender?: string | null;
  industry?: string | null;
  roleTitle?: string | null;
  usageIntent?: string | null;
  defaultTargetAudience?: string | null;
}

export class UserProfileRepository {
  static findByUserId(userId: string): Promise<UserProfile | null> {
    return UserProfile.findOne({ where: { userId } });
  }

  /** Creates the profile row on first call, updates it on subsequent calls (re-onboarding is allowed). */
  static async upsert(userId: string, input: OnboardingInput): Promise<UserProfile> {
    const existing = await UserProfile.findOne({ where: { userId } });
    if (existing) {
      await existing.update({ ...input, onboardingCompletedAt: existing.onboardingCompletedAt ?? new Date() });
      return existing;
    }
    return UserProfile.create({ userId, ...input, onboardingCompletedAt: new Date() });
  }
}
