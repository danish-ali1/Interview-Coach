import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { AppError } from '../utils/AppError.js';
import { randomId, randomToken, sha256 } from '../utils/crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Authentication with short-lived access tokens + rotating refresh tokens.
 *
 *  - Access token: JWT, ~15 min, kept in memory by the client.
 *  - Refresh token: opaque random string in an httpOnly cookie. Only its SHA-256 hash is stored.
 *  - Rotation: every refresh consumes the old token and issues a new one (same "family").
 *  - Reuse detection: presenting an already-used token means it was probably stolen,
 *    so the entire family (that login) is revoked.
 *  - Leeway: a token rotated a few seconds ago is still accepted once, so two browser
 *    tabs refreshing at the same moment do not log the user out.
 *
 * `models` and `now` are injectable so the rotation logic can be tested without a database.
 */
export function createAuthService({
  tokenService,
  config,
  logger,
  models = { User, RefreshToken },
  now = () => new Date(),
}) {
  const { User: Users, RefreshToken: RefreshTokens } = models;
  const refreshTtlMs = config.refreshTtlDays * DAY_MS;
  const absoluteTtlMs = config.refreshAbsoluteTtlDays * DAY_MS;
  const leewayMs = config.reuseLeewaySeconds * 1000;

  // Compared against when the email is unknown so login timing does not reveal which emails exist.
  let dummyHashPromise;
  const getDummyHash = () => {
    dummyHashPromise ??= bcrypt.hash(randomToken(12), config.bcryptRounds);
    return dummyHashPromise;
  };

  async function issueRefreshToken({ userId, family, absoluteExpiresAt, meta }) {
    const token = randomToken();
    const expiresAt = new Date(Math.min(now().getTime() + refreshTtlMs, absoluteExpiresAt.getTime()));
    const doc = await RefreshTokens.create({
      user: userId,
      family,
      tokenHash: sha256(token),
      expiresAt,
      absoluteExpiresAt,
      userAgent: meta?.userAgent?.slice(0, 300),
      ip: meta?.ip,
    });
    return { token, doc };
  }

  function buildSession(user, refreshToken, refreshExpiresAt) {
    return {
      user: user.toJSON(),
      accessToken: tokenService.signAccessToken(user),
      expiresIn: tokenService.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
    };
  }

  async function startSession(user, meta) {
    const { token, doc } = await issueRefreshToken({
      userId: user.id,
      family: randomId(),
      absoluteExpiresAt: new Date(now().getTime() + absoluteTtlMs),
      meta,
    });
    return buildSession(user, token, doc.expiresAt);
  }

  return {
    async register({ name, email, password }, meta) {
      if (await Users.exists({ email })) {
        throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
      }
      const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
      // A concurrent duplicate registration trips the unique index and surfaces as 409 DUPLICATE_KEY.
      const user = await Users.create({ name, email, passwordHash });
      return startSession(user, meta);
    },

    async login({ email, password }, meta) {
      const user = await Users.findOne({ email }).select('+passwordHash');
      const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !passwordOk) {
        throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
      }
      return startSession(user, meta);
    },

    async refresh(rawToken, meta) {
      if (!rawToken || typeof rawToken !== 'string') {
        throw AppError.unauthorized('Refresh token missing', 'REFRESH_TOKEN_MISSING');
      }
      const tokenHash = sha256(rawToken);
      const at = now();

      // Atomically "consume" the token. Of two concurrent requests with the same token, only one wins.
      let parent = await RefreshTokens.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: at } },
        { $set: { revokedAt: at, rotatedAt: at } },
      ); // returns the document as it was before the update

      if (!parent) {
        const existing = await RefreshTokens.findOne({ tokenHash });
        if (!existing) {
          throw AppError.unauthorized('Invalid refresh token', 'REFRESH_TOKEN_INVALID');
        }
        if (existing.expiresAt <= at) {
          throw AppError.unauthorized('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
        }

        // Another request rotated this token a moment ago (two tabs refreshing together). This must
        // not depend on `replacedBy`: that is written only after the winner has created its new
        // token, so the loser can arrive before it exists and would be mistaken for a thief.
        const rotatedJustNow = existing.rotatedAt && at - existing.rotatedAt <= leewayMs;
        if (!rotatedJustNow) {
          // A used (or logged-out) token came back: assume theft and kill the whole login.
          await RefreshTokens.updateMany(
            { family: existing.family, revokedAt: null },
            { $set: { revokedAt: at } },
          );
          logger.warn(
            { userId: String(existing.user), family: existing.family },
            'refresh token reuse detected, token family revoked',
          );
          throw AppError.unauthorized('Session is no longer valid. Please sign in again.', 'REFRESH_TOKEN_REUSED');
        }
        parent = existing;
      }

      const user = await Users.findById(parent.user);
      if (!user) {
        throw AppError.unauthorized('Account no longer exists', 'REFRESH_TOKEN_INVALID');
      }

      const { token, doc } = await issueRefreshToken({
        userId: user.id,
        family: parent.family,
        absoluteExpiresAt: parent.absoluteExpiresAt,
        meta,
      });
      // Audit link only; keep the first successor if a concurrent request already recorded one.
      await RefreshTokens.updateOne({ _id: parent._id, replacedBy: null }, { $set: { replacedBy: doc._id } });

      return buildSession(user, token, doc.expiresAt);
    },

    /** Ends this device's login. Idempotent: never fails because the token is missing or unknown. */
    async logout(rawToken) {
      if (!rawToken || typeof rawToken !== 'string') return;
      const existing = await RefreshTokens.findOne({ tokenHash: sha256(rawToken) });
      if (!existing) return;
      await RefreshTokens.updateMany({ family: existing.family, revokedAt: null }, { $set: { revokedAt: now() } });
    },

    /** Ends every login for the user (all devices). */
    async logoutAll(userId) {
      await RefreshTokens.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: now() } });
    },

    async getUser(userId) {
      const user = await Users.findById(userId);
      if (!user) throw AppError.unauthorized('Account no longer exists', 'INVALID_TOKEN');
      return user.toJSON();
    },
  };
}
