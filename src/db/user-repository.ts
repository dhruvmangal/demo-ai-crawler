import { query } from '../config/database';
import { User, NewUser, UserAuthLog, NewAuthLog, UserAuthStats, AuthProvider, AuthEventType } from './schema';
import { v4 as uuidv4 } from 'uuid';

export interface UpsertUserResult {
  user: User;
  isNewUser: boolean;
  logId: string;
}

export class UserRepository {
  /**
   * Upserts a user from Google, GitHub, or Demo OAuth.
   * Automatically records a SIGNUP event if the user is newly registered,
   * or a LOGIN event if the user already existed.
   */
  public static async upsertUser(
    userData: NewUser,
    eventMeta?: { ipAddress?: string | null; userAgent?: string | null; metadata?: Record<string, any> | null }
  ): Promise<UpsertUserResult> {
    const existingRes = await query(`SELECT * FROM users WHERE email = $1`, [userData.email]);
    const now = new Date();
    let user: User;
    let isNewUser = false;
    let eventType: AuthEventType = 'LOGIN';

    if (existingRes.rowCount === 0) {
      isNewUser = true;
      eventType = 'SIGNUP';
      const newId = userData.id || uuidv4();

      const insertRes = await query(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_user_id, role, last_login_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING *`,
        [
          newId,
          userData.email,
          userData.name,
          userData.avatarUrl || null,
          userData.provider,
          userData.providerUserId || null,
          userData.role || 'user',
          now,
          now
        ]
      );
      user = this.mapUser(insertRes.rows[0]);
    } else {
      const existingUser = existingRes.rows[0];
      const updateRes = await query(
        `UPDATE users
         SET name = COALESCE($1, name),
             avatar_url = COALESCE($2, avatar_url),
             provider = $3,
             provider_user_id = COALESCE($4, provider_user_id),
             last_login_at = $5,
             updated_at = $5
         WHERE id = $6
         RETURNING *`,
        [
          userData.name,
          userData.avatarUrl || null,
          userData.provider,
          userData.providerUserId || null,
          now,
          existingUser.id
        ]
      );
      user = this.mapUser(updateRes.rows[0]);
    }

    // Record authentication audit log entry
    const logId = uuidv4();
    await query(
      `INSERT INTO user_auth_logs (id, user_id, event_type, provider, ip_address, user_agent, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        logId,
        user.id,
        eventType,
        user.provider,
        eventMeta?.ipAddress || null,
        eventMeta?.userAgent || null,
        eventMeta?.metadata ? JSON.stringify(eventMeta.metadata) : null,
        now
      ]
    );

    return { user, isNewUser, logId };
  }

  /**
   * Retrieves a user by their unique email.
   */
  public static async getUserByEmail(email: string): Promise<User | null> {
    const res = await query(`SELECT * FROM users WHERE email = $1`, [email]);
    return res.rowCount && res.rowCount > 0 ? this.mapUser(res.rows[0]) : null;
  }

  /**
   * Retrieves a user by their UUID.
   */
  public static async getUserById(id: string): Promise<User | null> {
    const res = await query(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rowCount && res.rowCount > 0 ? this.mapUser(res.rows[0]) : null;
  }

  /**
   * Lists all users sorted by most recent login.
   */
  public static async getUsers(limit = 50, offset = 0): Promise<{ users: User[]; total: number }> {
    const countRes = await query(`SELECT COUNT(*) FROM users`);
    const total = parseInt(countRes.rows[0].count, 10);

    const rowsRes = await query(
      `SELECT * FROM users ORDER BY last_login_at DESC NULLS LAST, created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const users = rowsRes.rows.map(r => this.mapUser(r));
    return { users, total };
  }

  /**
   * Retrieves recent authentication audit logs joined with user details.
   */
  public static async getAuthLogs(limit = 100): Promise<Array<UserAuthLog & { userEmail: string; userName: string }>> {
    const res = await query(
      `SELECT l.*, u.email as user_email, u.name as user_name
       FROM user_auth_logs l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      eventType: r.event_type as AuthEventType,
      provider: r.provider as AuthProvider,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      metadata: r.metadata,
      createdAt: new Date(r.created_at),
      userEmail: r.user_email,
      userName: r.user_name
    }));
  }

  /**
   * Computes high-level user and authentication analytics.
   */
  public static async getStats(): Promise<UserAuthStats> {
    const userCountRes = await query(`SELECT COUNT(*) FROM users`);
    const totalUsers = parseInt(userCountRes.rows[0].count, 10);

    const signupCountRes = await query(
      `SELECT COUNT(*) FROM user_auth_logs WHERE event_type = 'SIGNUP'`
    );
    const totalSignups = parseInt(signupCountRes.rows[0].count, 10);

    const loginCountRes = await query(
      `SELECT COUNT(*) FROM user_auth_logs WHERE event_type = 'LOGIN'`
    );
    const totalLogins = parseInt(loginCountRes.rows[0].count, 10);

    const providerRes = await query(
      `SELECT provider, COUNT(*) as count FROM users GROUP BY provider`
    );
    const providerBreakdown: Record<AuthProvider, number> = {
      google: 0,
      github: 0,
      demo: 0
    };
    for (const r of providerRes.rows) {
      if (r.provider in providerBreakdown) {
        providerBreakdown[r.provider as AuthProvider] = parseInt(r.count, 10);
      }
    }

    const recentLogs = await this.getAuthLogs(10);

    return {
      totalUsers,
      totalSignups,
      totalLogins,
      providerBreakdown,
      recentLogins: recentLogs
    };
  }

  private static mapUser(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      provider: row.provider as AuthProvider,
      providerUserId: row.provider_user_id,
      role: row.role,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
