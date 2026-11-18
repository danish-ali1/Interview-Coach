import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

/**
 * Builds a limiter that answers with the API's normal error shape.
 * `keyGenerator` lets expensive AI endpoints be limited per user instead of per IP.
 */
export function createLimiter({ enabled = true, windowMs, limit, keyGenerator, message }) {
  if (!enabled) return (_req, _res, next) => next();

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', message ?? 'Too many requests, please try again later.')),
  });
}

export function createLimiters({ enabled }) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const byUser = (req) => req.user.id;

  return {
    global: createLimiter({ enabled, windowMs: 15 * minute, limit: 600 }),
    login: createLimiter({
      enabled,
      windowMs: 15 * minute,
      limit: 20,
      message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
    }),
    refresh: createLimiter({ enabled, windowMs: 15 * minute, limit: 120 }),
    // Each of these calls the (paid, quota-limited) AI API, so cap them per user.
    ai: createLimiter({
      enabled,
      windowMs: hour,
      limit: 120,
      keyGenerator: byUser,
      message: 'You have reached the hourly limit for AI actions. Please try again later.',
    }),
    upload: createLimiter({
      enabled,
      windowMs: hour,
      limit: 20,
      keyGenerator: byUser,
      message: 'Too many uploads. Please try again later.',
    }),
  };
}
