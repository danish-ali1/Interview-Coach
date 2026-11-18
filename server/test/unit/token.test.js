import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { createTokenService } from '../../src/services/token.service.js';

const SECRET = 'a-very-long-test-secret-0123456789-abcdef';
const service = createTokenService({ accessSecret: SECRET, accessTtlSeconds: 900 });
const user = { id: '665f1c2e8a1b2c3d4e5f6a7b', email: 'jane@example.com' };

const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
};

describe('access tokens', () => {
  it('round-trips subject and email', () => {
    const payload = service.verifyAccessToken(service.signAccessToken(user));
    assert.equal(payload.sub, user.id);
    assert.equal(payload.email, user.email);
    assert.equal(payload.iss, 'interview-coach');
  });

  it('rejects an expired token with TOKEN_EXPIRED (so the client knows to refresh)', () => {
    const expired = jwt.sign({ email: user.email }, SECRET, { subject: user.id, issuer: 'interview-coach', expiresIn: -10 });
    assert.equal(codeOf(() => service.verifyAccessToken(expired)), 'TOKEN_EXPIRED');
  });

  it('rejects tokens signed with another secret', () => {
    const forged = jwt.sign({}, 'another-secret-another-secret-another', { subject: user.id, issuer: 'interview-coach' });
    assert.equal(codeOf(() => service.verifyAccessToken(forged)), 'INVALID_TOKEN');
  });

  it('rejects "alg: none" tokens', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, iss: 'interview-coach' })}.`;
    assert.equal(codeOf(() => service.verifyAccessToken(none)), 'INVALID_TOKEN');
  });

  it('rejects tampered payloads and tokens from another issuer', () => {
    const [h, , s] = service.signAccessToken(user).split('.');
    const evil = Buffer.from(JSON.stringify({ sub: 'someone-else', iss: 'interview-coach' })).toString('base64url');
    assert.equal(codeOf(() => service.verifyAccessToken(`${h}.${evil}.${s}`)), 'INVALID_TOKEN');

    const otherIssuer = jwt.sign({}, SECRET, { subject: user.id, issuer: 'someone-else' });
    assert.equal(codeOf(() => service.verifyAccessToken(otherIssuer)), 'INVALID_TOKEN');
  });

  it('rejects garbage', () => {
    assert.equal(codeOf(() => service.verifyAccessToken('not.a.jwt')), 'INVALID_TOKEN');
  });
});
