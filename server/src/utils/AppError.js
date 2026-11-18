/**
 * Operational error: something we expect can go wrong (bad input, no access,
 * upstream outage). The error middleware turns these into clean JSON responses.
 * Anything that is NOT an AppError is treated as a bug and returns a generic 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, code = 'BAD_REQUEST', details) {
    return new AppError(400, code, message, details);
  }

  static validation(details, message = 'Request validation failed') {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'You do not have access to this resource', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }

  static conflict(message, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }

  static unprocessable(message, code = 'UNPROCESSABLE') {
    return new AppError(422, code, message);
  }
}
