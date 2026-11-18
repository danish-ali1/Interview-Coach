import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';

const ISSUER = 'interview-coach';

/** Short-lived, stateless access tokens (JWT, HS256). Refresh tokens are handled in auth.service. */
export function createTokenService({ accessSecret, accessTtlSeconds }) {
  return {
    accessTtlSeconds,

    signAccessToken(user) {
      return jwt.sign({ email: user.email }, accessSecret, {
        algorithm: 'HS256',
        subject: String(user.id),
        issuer: ISSUER,
        expiresIn: accessTtlSeconds,
      });
    },

    verifyAccessToken(token) {
      try {
        // Pinning the algorithm list blocks "alg: none" and algorithm-confusion attacks.
        return jwt.verify(token, accessSecret, { algorithms: ['HS256'], issuer: ISSUER });
      } catch (err) {
        if (err?.name === 'TokenExpiredError') {
          throw AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
        }
        throw AppError.unauthorized('Invalid access token', 'INVALID_TOKEN');
      }
    },
  };
}
