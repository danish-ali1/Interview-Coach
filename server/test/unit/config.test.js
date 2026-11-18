import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../src/config/env.js';
import { testEnv } from '../helpers.js';

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig({ ...testEnv, CLIENT_ORIGIN: 'http://a.test, http://b.test' });
    assert.equal(config.port, 5000);
    assert.deepEqual(config.clientOrigins, ['http://a.test', 'http://b.test']);
    assert.equal(config.auth.accessTtlSeconds, 900);
    assert.equal(config.vector.store, 'local');
    assert.equal(config.gemini.dimensions, 128);
    assert.equal(config.uploads.maxBytes, 5 * 1024 * 1024);
    assert.equal(config.rateLimitEnabled, false);
  });

  it('fails fast and names every problem', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'short' }),
      (err) => /MONGODB_URI/.test(err.message) && /JWT_ACCESS_SECRET/.test(err.message) && /GEMINI_API_KEY/.test(err.message),
    );
  });

  it('uses secure cookies by default only in production', () => {
    assert.equal(loadConfig(testEnv).auth.cookieSecure, false);
    const prod = loadConfig({ ...testEnv, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'k'.repeat(48) });
    assert.equal(prod.auth.cookieSecure, true);
    assert.equal(loadConfig({ ...testEnv, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'k'.repeat(48), COOKIE_SECURE: 'false' }).auth.cookieSecure, false);
  });

  it('refuses placeholder secrets in production', () => {
    assert.throws(
      () => loadConfig({ ...testEnv, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'replace-with-a-long-random-string-at-least-32-chars-change-me' }),
      /placeholder/,
    );
  });

  it('never lets the absolute refresh lifetime be shorter than the sliding one', () => {
    const config = loadConfig({ ...testEnv, REFRESH_TOKEN_TTL_DAYS: '14', REFRESH_TOKEN_ABSOLUTE_TTL_DAYS: '7' });
    assert.equal(config.auth.refreshAbsoluteTtlDays, 14);
  });
});
