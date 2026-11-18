import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per issued refresh token. Only the SHA-256 hash is stored, so a database
 * leak does not hand out usable tokens. Tokens that belong to the same login share a
 * `family`; if an already-used token shows up again the whole family is revoked.
 */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    // Hard cap on how long one login can be kept alive by rotation (sliding window limit).
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    // Set in the SAME atomic write that consumes the token. Only a rotation sets it (logout and
    // theft-revocation do not), which is what lets a second browser tab refresh safely moments later.
    rotatedAt: { type: Date, default: null },
    // Audit trail only; the reuse logic must never depend on it (it is written after the new token exists).
    replacedBy: { type: Schema.Types.ObjectId, ref: 'RefreshToken', default: null },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);

// MongoDB deletes expired rows automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
