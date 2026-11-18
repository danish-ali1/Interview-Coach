import { AppError } from '../utils/AppError.js';

/** Verifies the short-lived access token from the Authorization header. */
export function createRequireAuth(tokenService) {
  return (req, _res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
    }
    try {
      const payload = tokenService.verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Defence in depth for the two endpoints that rely on the refresh cookie.
 * Cross-site HTML forms cannot add custom headers, and CORS blocks cross-origin
 * fetches that do, so requiring this header rules out classic CSRF on top of SameSite=Strict.
 */
export function requireCsrfHeader(req, _res, next) {
  if (!req.get('x-requested-with')) {
    return next(AppError.forbidden('Missing X-Requested-With header', 'CSRF_REJECTED'));
  }
  return next();
}
