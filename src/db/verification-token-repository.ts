import { EmailVerificationToken } from './models/email-verification-token.model';
import { PasswordResetToken } from './models/password-reset-token.model';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/tokens';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export class EmailVerificationTokenRepository {
  static async issue(userId: string): Promise<string> {
    const rawToken = generateOpaqueToken();
    await EmailVerificationToken.create({
      userId,
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
    });
    return rawToken;
  }

  /** Consumes the token if valid, returning the userId it was issued for, or null. */
  static async consume(rawToken: string): Promise<string | null> {
    const record = await EmailVerificationToken.findOne({ where: { tokenHash: hashOpaqueToken(rawToken) } });
    if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    await record.update({ consumedAt: new Date() });
    return record.userId;
  }
}

export class PasswordResetTokenRepository {
  static async issue(userId: string): Promise<string> {
    const rawToken = generateOpaqueToken();
    await PasswordResetToken.create({
      userId,
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    });
    return rawToken;
  }

  /** Consumes the token if valid, returning the userId it was issued for, or null. */
  static async consume(rawToken: string): Promise<string | null> {
    const record = await PasswordResetToken.findOne({ where: { tokenHash: hashOpaqueToken(rawToken) } });
    if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    await record.update({ consumedAt: new Date() });
    return record.userId;
  }
}
