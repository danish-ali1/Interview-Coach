import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createAuthService } from '../../src/services/auth.service.js';
import { createTokenService } from '../../src/services/token.service.js';
import { sha256 } from '../../src/utils/crypto.js';
import { createFakeRefreshTokens, createFakeUsers } from '../fakeModels.js';
import { silentLogger } from '../helpers.js';

const meta = { ip: '203.0.113.9', userAgent: 'test-agent' };
const credentials = { name: 'Jane Doe', email: 'jane@example.com', password: 'Passw0rd!' };

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err.code;
  }
  return null;
};

function setup({ leewaySeconds = 10, beforeCreate } = {}) {
  const clock = { t: new Date('2026-01-01T00:00:00Z').getTime() };
  const refreshTokens = createFakeRefreshTokens({ beforeCreate });
  const users = createFakeUsers();
  const tokenService = createTokenService({ accessSecret: 'x'.repeat(40), accessTtlSeconds: 900 });
  const auth = createAuthService({
    tokenService,
    logger: silentLogger,
    now: () => new Date(clock.t),
    models: { User: users, RefreshToken: refreshTokens },
    config: {
      refreshTtlDays: 7,
      refreshAbsoluteTtlDays: 30,
      reuseLeewaySeconds: leewaySeconds,
      bcryptRounds: 4,
    },
  });
  const advance = (ms) => {
    clock.t += ms;
  };
  const live = (family) => refreshTokens.rows.filter((r) => r.family === family && r.revokedAt === null);
  return { auth, refreshTokens, users, advance, live };
}

describe('refresh token rotation', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('stores only a hash of the refresh token, never the token itself', async () => {
    const session = await ctx.auth.register(credentials, meta);
    const [row] = ctx.refreshTokens.rows;
    assert.equal(row.tokenHash, sha256(session.refreshToken));
    assert.ok(!JSON.stringify(row).includes(session.refreshToken));
  });

  it('each refresh returns a new token in the same family and invalidates the old one', async () => {
    const first = await ctx.auth.register(credentials, meta);
    const second = await ctx.auth.refresh(first.refreshToken, meta);
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.ok(second.accessToken);

    const [a, b] = ctx.refreshTokens.rows;
    assert.equal(a.family, b.family);
    assert.ok(a.revokedAt, 'old token is consumed');
    assert.equal(b.revokedAt, null);
  });

  it('REUSE DETECTION: replaying a used token (after the leeway) revokes the whole login', async () => {
    const first = await ctx.auth.register(credentials, meta);
    const second = await ctx.auth.refresh(first.refreshToken, meta); // legitimate rotation
    ctx.advance(60_000); // well past the 10s leeway

    assert.equal(await codeOf(ctx.auth.refresh(first.refreshToken, meta)), 'REFRESH_TOKEN_REUSED'); // the thief
    const family = ctx.refreshTokens.rows[0].family;
    assert.equal(ctx.live(family).length, 0, 'every token in the family must be dead');
    // ...so the real user's newest token no longer works either, which forces a fresh sign-in.
    assert.equal(await codeOf(ctx.auth.refresh(second.refreshToken, meta)), 'REFRESH_TOKEN_REUSED');
  });

  it('a different login (family) is unaffected by reuse on another device', async () => {
    const laptop = await ctx.auth.register(credentials, meta);
    const phone = await ctx.auth.login({ email: credentials.email, password: credentials.password }, meta);
    await ctx.auth.refresh(laptop.refreshToken, meta);
    ctx.advance(60_000);
    await codeOf(ctx.auth.refresh(laptop.refreshToken, meta)); // theft on the laptop family
    const phoneRefreshed = await ctx.auth.refresh(phone.refreshToken, meta);
    assert.ok(phoneRefreshed.accessToken);
  });

  it('rejects unknown, missing and non-string tokens', async () => {
    assert.equal(await codeOf(ctx.auth.refresh('does-not-exist', meta)), 'REFRESH_TOKEN_INVALID');
    assert.equal(await codeOf(ctx.auth.refresh(undefined, meta)), 'REFRESH_TOKEN_MISSING');
    assert.equal(await codeOf(ctx.auth.refresh({ $gt: '' }, meta)), 'REFRESH_TOKEN_MISSING'); // NoSQL-injection shape
  });

  it('rejects an expired refresh token', async () => {
    const session = await ctx.auth.register(credentials, meta);
    ctx.advance(8 * 24 * 60 * 60 * 1000);
    assert.equal(await codeOf(ctx.auth.refresh(session.refreshToken, meta)), 'REFRESH_TOKEN_EXPIRED');
  });

  it('caps the total lifetime of one login even though every refresh extends the window', async () => {
    let session = await ctx.auth.register(credentials, meta);
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 4; i += 1) {
      ctx.advance(6 * day); // refresh every 6 days: the 7-day sliding window never lapses
      session = await ctx.auth.refresh(session.refreshToken, meta);
    }
    // Day 24. A refresh on day 29 would normally extend to day 36, but the login may not outlive day 30.
    ctx.advance(5 * day);
    session = await ctx.auth.refresh(session.refreshToken, meta);
    const family = ctx.refreshTokens.rows[0].family;
    const last = ctx.refreshTokens.rows.filter((r) => r.family === family).at(-1);
    assert.equal(last.expiresAt.getTime(), last.absoluteExpiresAt.getTime(), 'the hard cap must clamp the new expiry');
    assert.equal(last.absoluteExpiresAt.getTime() - new Date('2026-01-01T00:00:00Z').getTime(), 30 * day);

    ctx.advance(2 * day); // day 31: past the hard limit, so the login ends and the user must sign in again
    assert.equal(await codeOf(ctx.auth.refresh(session.refreshToken, meta)), 'REFRESH_TOKEN_EXPIRED');
  });
});

describe('logout', () => {
  it('kills the login so the token cannot be refreshed, and never reveals whether a token existed', async () => {
    const ctx = setup();
    const session = await ctx.auth.register(credentials, meta);
    await ctx.auth.logout(session.refreshToken);
    assert.equal(await codeOf(ctx.auth.refresh(session.refreshToken, meta)), 'REFRESH_TOKEN_REUSED');
    await ctx.auth.logout('unknown-token'); // no throw
    await ctx.auth.logout(undefined); // no throw
  });

  it('a token cannot be refreshed within the leeway window after logout', async () => {
    const ctx = setup({ leewaySeconds: 10 });
    const session = await ctx.auth.register(credentials, meta);
    await ctx.auth.logout(session.refreshToken);
    ctx.advance(2_000); // inside the leeway
    assert.equal(await codeOf(ctx.auth.refresh(session.refreshToken, meta)), 'REFRESH_TOKEN_REUSED');
  });

  it('logout-all ends every device', async () => {
    const ctx = setup();
    const a = await ctx.auth.register(credentials, meta);
    const b = await ctx.auth.login({ email: credentials.email, password: credentials.password }, meta);
    await ctx.auth.logoutAll(ctx.users.rows[0]._id);
    assert.ok(await codeOf(ctx.auth.refresh(a.refreshToken, meta)));
    assert.ok(await codeOf(ctx.auth.refresh(b.refreshToken, meta)));
  });
});

describe('login and register', () => {
  it('rejects wrong passwords and unknown emails with the same error', async () => {
    const ctx = setup();
    await ctx.auth.register(credentials, meta);
    assert.equal(await codeOf(ctx.auth.login({ email: credentials.email, password: 'wrong-password' }, meta)), 'INVALID_CREDENTIALS');
    assert.equal(await codeOf(ctx.auth.login({ email: 'nobody@example.com', password: 'whatever1' }, meta)), 'INVALID_CREDENTIALS');
  });

  it('refuses duplicate emails and never stores the plain password', async () => {
    const ctx = setup();
    await ctx.auth.register(credentials, meta);
    assert.equal(await codeOf(ctx.auth.register(credentials, meta)), 'EMAIL_TAKEN');
    assert.ok(!JSON.stringify(ctx.users.rows).includes(credentials.password));
  });
});

describe('concurrent refresh (two browser tabs)', () => {
  it('RACE: a second tab refreshing a few ms later must NOT be treated as token theft', async () => {
    // Hold request A inside RefreshToken.create(), i.e. after it consumed the old token but BEFORE
    // it has recorded the replacement. Request B arrives in exactly that window.
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let armed = false;
    const ctx = setup({
      leewaySeconds: 10,
      beforeCreate: async () => {
        if (armed) await gate;
      },
    });

    const session = await ctx.auth.register(credentials, meta);
    armed = true;

    const requestA = ctx.auth.refresh(session.refreshToken, meta);
    await new Promise((resolve) => setImmediate(resolve)); // let A reach the gate
    const requestB = ctx.auth.refresh(session.refreshToken, meta);
    const settledB = Promise.allSettled([requestB]);
    await new Promise((resolve) => setImmediate(resolve));
    armed = false;
    release();

    const [a] = await Promise.allSettled([requestA]);
    const [b] = await settledB;

    assert.equal(a.status, 'fulfilled', 'the first tab must succeed');
    assert.equal(b.status, 'fulfilled', `the second tab must succeed too, got: ${b.reason?.code}`);
    const family = ctx.refreshTokens.rows[0].family;
    assert.ok(ctx.live(family).length >= 1, 'the login must still be alive');
  });

  it('still treats a replay AFTER the leeway as theft', async () => {
    const ctx = setup({ leewaySeconds: 10 });
    const session = await ctx.auth.register(credentials, meta);
    await ctx.auth.refresh(session.refreshToken, meta);
    ctx.advance(11_000);
    assert.equal(await codeOf(ctx.auth.refresh(session.refreshToken, meta)), 'REFRESH_TOKEN_REUSED');
  });
});
