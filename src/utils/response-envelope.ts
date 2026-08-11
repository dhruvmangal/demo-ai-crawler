import { Response } from 'express';

export function ok(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>): Response {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function errorEnvelope(code: string, message: string, details?: unknown) {
  return { success: false, error: details !== undefined ? { code, message, details } : { code, message } };
}
