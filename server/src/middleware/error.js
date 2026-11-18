import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

/**
 * Maps any thrown value to an AppError. Library errors (Zod, Mongoose, Multer,
 * body-parser, JWT) are translated into the same { code, message } contract the
 * client already understands. Unknown errors become a generic 500 so internals never leak.
 */
export function normalizeError(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation(
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  // body-parser (express.json)
  if (err?.type === 'entity.parse.failed') {
    return AppError.badRequest('Request body is not valid JSON', 'INVALID_JSON');
  }
  if (err?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  // multer
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file is too large');
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return AppError.badRequest('Unexpected upload field. Send the file as "file".', 'UPLOAD_ERROR');
    }
    return AppError.badRequest(err.message, 'UPLOAD_ERROR');
  }

  // mongoose
  if (err?.name === 'CastError') {
    return AppError.badRequest(`Invalid value for "${err.path}"`, 'INVALID_ID');
  }
  if (err?.name === 'ValidationError' && err.errors) {
    return AppError.validation(
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0] ?? 'field';
    return AppError.conflict(`A record with this ${field} already exists`, 'DUPLICATE_KEY');
  }

  // jsonwebtoken
  if (err?.name === 'TokenExpiredError') {
    return AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
  }
  if (err?.name === 'JsonWebTokenError' || err?.name === 'NotBeforeError') {
    return AppError.unauthorized('Invalid access token', 'INVALID_TOKEN');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side');
}

export function createErrorHandler({ logger }) {
  // Express identifies error middleware by its 4-argument signature.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const normalized = normalizeError(err);
    const log = req.log ?? logger;

    if (normalized.status >= 500) {
      log.error({ err, code: normalized.code }, 'request failed');
    } else {
      log.warn({ code: normalized.code, status: normalized.status }, normalized.message);
    }

    if (res.headersSent) return next(err);

    const body = {
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId: req.id,
      },
    };
    if (normalized.details !== undefined) body.error.details = normalized.details;

    return res.status(normalized.status).json(body);
  };
}
