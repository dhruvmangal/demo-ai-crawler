import { randomUUID } from 'crypto';
import { sequelize } from '../config/sequelize';
import { RefreshToken, RefreshTokenSubjectType } from './models/refresh-token.model';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/tokens';
import { env } from '../config/env';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface IssuedToken {
  rawToken: string;
  record: RefreshToken;
}

function expiryDate(): Date {
  return new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

export class RefreshTokenRepository {
  /** Starts a brand-new rotation family -- used on login/signup, not on refresh. */
  static async issue(
    subjectType: RefreshTokenSubjectType,
    subjectId: string,
    meta: RequestMeta
  ): Promise<IssuedToken> {
    const rawToken = generateOpaqueToken();
    const record = await RefreshToken.create({
      subjectType,
      userId: subjectType === 'user' ? subjectId : null,
      adminId: subjectType === 'admin' ? subjectId : null,
      tokenHash: hashOpaqueToken(rawToken),
      familyId: randomUUID(),
      expiresAt: expiryDate(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    });
    return { rawToken, record };
  }

  /** Returns the live (not revoked/expired) row for a raw token, or null. */
  static async findValid(rawToken: string): Promise<RefreshToken | null> {
    const record = await RefreshToken.findOne({ where: { tokenHash: hashOpaqueToken(rawToken) } });
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return record;
  }

  /** Returns the row for a raw token regardless of revoked/expired state -- used to detect reuse. */
  static async findAny(rawToken: string): Promise<RefreshToken | null> {
    return RefreshToken.findOne({ where: { tokenHash: hashOpaqueToken(rawToken) } });
  }

  /**
   * Rotates a valid token: revokes it and issues a new one in the same family, atomically.
   * Presenting an already-rotated (revoked) token again is a theft signal handled by the
   * caller via revokeFamily(), not here -- this method assumes `current` is still valid.
   */
  static async rotate(current: RefreshToken, meta: RequestMeta): Promise<IssuedToken> {
    return sequelize.transaction(async t => {
      const rawToken = generateOpaqueToken();
      const next = await RefreshToken.create(
        {
          subjectType: current.subjectType,
          userId: current.userId,
          adminId: current.adminId,
          tokenHash: hashOpaqueToken(rawToken),
          familyId: current.familyId,
          expiresAt: expiryDate(),
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent
        },
        { transaction: t }
      );
      await current.update({ revokedAt: new Date(), replacedByTokenId: next.id }, { transaction: t });
      return { rawToken, record: next };
    });
  }

  static async revoke(record: RefreshToken): Promise<void> {
    if (!record.revokedAt) {
      await record.update({ revokedAt: new Date() });
    }
  }

  static async revokeFamily(familyId: string): Promise<void> {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { familyId, revokedAt: null } });
  }

  static async revokeAllForSubject(subjectType: RefreshTokenSubjectType, subjectId: string): Promise<void> {
    const where = subjectType === 'user' ? { userId: subjectId, revokedAt: null } : { adminId: subjectId, revokedAt: null };
    await RefreshToken.update({ revokedAt: new Date() }, { where });
  }
}
