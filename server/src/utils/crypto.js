import crypto from 'node:crypto';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Cryptographically random, URL-safe token (default 384 bits). */
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

export const randomId = () => crypto.randomUUID();
