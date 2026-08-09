export type AuthProvider = 'google' | 'github' | 'demo';
export type AuthEventType = 'SIGNUP' | 'LOGIN' | 'LOGOUT' | 'TOKEN_REFRESH';
export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  provider: AuthProvider;
  providerUserId?: string | null;
  role: UserRole;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  id?: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  provider: AuthProvider;
  providerUserId?: string | null;
  role?: UserRole;
  lastLoginAt?: Date | null;
}

export interface UserAuthLog {
  id: string;
  userId: string;
  eventType: AuthEventType;
  provider: AuthProvider;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: Date;
}

export interface NewAuthLog {
  id?: string;
  userId: string;
  eventType: AuthEventType;
  provider: AuthProvider;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
}

export interface UserAuthStats {
  totalUsers: number;
  totalSignups: number;
  totalLogins: number;
  providerBreakdown: Record<AuthProvider, number>;
  recentLogins: UserAuthLog[];
}
