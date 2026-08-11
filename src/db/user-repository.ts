import { fn, col } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { User, UserProvider } from './models/user.model';
import { UserAuthLog, AuthEventType } from './models/user-auth-log.model';
import { ConflictError } from '../errors/api-error';
import './models/index';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface OAuthProfile {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface UserAuthStats {
  totalUsers: number;
  totalSignups: number;
  totalLogins: number;
  providerBreakdown: Record<string, number>;
  recentLogins: UserAuthLog[];
}

export class UserRepository {
  static findByEmail(email: string): Promise<User | null> {
    return User.findOne({ where: { email } });
  }

  static findById(id: string): Promise<User | null> {
    return User.findByPk(id);
  }

  /** Signup via email+password. Atomically creates the user row and its SIGNUP audit log. */
  static async createLocalUser(input: { email: string; name: string; passwordHash: string }, meta: RequestMeta): Promise<User> {
    return sequelize.transaction(async t => {
      const existing = await User.findOne({ where: { email: input.email }, transaction: t });
      if (existing) {
        throw new ConflictError('An account with this email already exists.');
      }

      const user = await User.create(
        {
          email: input.email,
          name: input.name,
          avatarUrl: null,
          provider: 'local' as UserProvider,
          providerUserId: null,
          passwordHash: input.passwordHash,
          userType: 'loggedin',
          emailVerifiedAt: null,
          lastLoginAt: new Date()
        },
        { transaction: t }
      );

      await UserAuthLog.create(
        { userId: user.id, eventType: 'SIGNUP', provider: 'local', ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: null },
        { transaction: t }
      );

      return user;
    });
  }

  /** Records a successful email+password login. Atomically updates last_login_at and logs it. */
  static async recordLocalLogin(user: User, meta: RequestMeta): Promise<void> {
    await sequelize.transaction(async t => {
      await user.update({ lastLoginAt: new Date() }, { transaction: t });
      await UserAuthLog.create(
        { userId: user.id, eventType: 'LOGIN', provider: 'local', ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: null },
        { transaction: t }
      );
    });
  }

  /**
   * Finds-or-creates a user from a server-verified Google/GitHub profile, linking to an
   * existing account with the same email if one exists (e.g. it was created via password
   * signup first). Atomically updates/creates the user and writes the SIGNUP/LOGIN audit
   * log in one transaction, replacing the old unverified upsertUser/sync flow.
   */
  static async loginOrSignupOAuthUser(profile: OAuthProfile, meta: RequestMeta): Promise<{ user: User; isNewUser: boolean }> {
    return sequelize.transaction(async t => {
      const idWhere = profile.provider === 'google' ? { googleId: profile.providerId } : { githubId: profile.providerId };
      let user = await User.findOne({ where: idWhere, transaction: t });
      let isNewUser = false;

      if (!user) {
        user = await User.findOne({ where: { email: profile.email }, transaction: t });
      }

      if (user) {
        const linkUpdate = profile.provider === 'google' ? { googleId: profile.providerId } : { githubId: profile.providerId };
        await user.update(
          { ...linkUpdate, lastLoginAt: new Date(), avatarUrl: profile.avatarUrl ?? user.avatarUrl },
          { transaction: t }
        );
      } else {
        isNewUser = true;
        user = await User.create(
          {
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            provider: profile.provider,
            providerUserId: profile.providerId,
            googleId: profile.provider === 'google' ? profile.providerId : null,
            githubId: profile.provider === 'github' ? profile.providerId : null,
            userType: 'loggedin',
            emailVerifiedAt: new Date(),
            lastLoginAt: new Date()
          },
          { transaction: t }
        );
      }

      await UserAuthLog.create(
        {
          userId: user.id,
          eventType: isNewUser ? 'SIGNUP' : 'LOGIN',
          provider: profile.provider,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: null
        },
        { transaction: t }
      );

      return { user, isNewUser };
    });
  }

  static async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await User.update({ passwordHash }, { where: { id: userId } });
  }

  static async markEmailVerified(userId: string): Promise<void> {
    await User.update({ emailVerifiedAt: new Date() }, { where: { id: userId } });
  }

  static async logEvent(userId: string, eventType: AuthEventType, provider: string, meta: RequestMeta): Promise<void> {
    await UserAuthLog.create({ userId, eventType, provider, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: null });
  }

  static async getUsers(limit: number, offset: number): Promise<{ total: number; users: User[] }> {
    const { count, rows } = await User.findAndCountAll({
      limit,
      offset,
      order: [['lastLoginAt', 'DESC']]
    });
    return { total: count, users: rows };
  }

  static getAuthLogs(limit: number): Promise<UserAuthLog[]> {
    return UserAuthLog.findAll({
      include: [{ model: User, as: 'user', attributes: ['email', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit
    });
  }

  static async getStats(): Promise<UserAuthStats> {
    const [totalUsers, totalSignups, totalLogins, providerRows, recentLogins] = await Promise.all([
      User.count(),
      UserAuthLog.count({ where: { eventType: 'SIGNUP' } }),
      UserAuthLog.count({ where: { eventType: 'LOGIN' } }),
      User.findAll({ attributes: ['provider', [fn('COUNT', col('id')), 'count']], group: ['provider'], raw: true }),
      UserRepository.getAuthLogs(10)
    ]);

    const providerBreakdown: Record<string, number> = {};
    for (const row of providerRows as unknown as Array<{ provider: string; count: string }>) {
      providerBreakdown[row.provider] = Number(row.count);
    }

    return { totalUsers, totalSignups, totalLogins, providerBreakdown, recentLogins };
  }
}
