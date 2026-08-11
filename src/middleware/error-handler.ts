import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors/api-error';
import { errorEnvelope } from '../utils/response-envelope';

// Must be registered last, after every router, in both server.ts and admin-server.ts.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(errorEnvelope(err.code, err.message, err.details));
    return;
  }

  console.error(`[Unhandled error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json(errorEnvelope('INTERNAL_ERROR', 'Something went wrong.'));
}
