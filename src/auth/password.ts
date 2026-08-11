import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptCost);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
