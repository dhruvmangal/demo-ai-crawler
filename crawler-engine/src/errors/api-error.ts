// Deliberately a subset of the main app's src/errors/api-error.ts (which also has
// Unauthorized/Forbidden/NotFound/Conflict/TooManyRequests) -- crawler-engine only needs
// BadRequestError, for ssrf-guard.ts's SsrfBlockedError. Kept as its own copy rather than a
// shared import so this service has no dependency on the main app's package.
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}
