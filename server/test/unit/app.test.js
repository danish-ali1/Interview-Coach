import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { buildContainer } from '../../src/container.js';
import { createScriptedGemini, createMemoryVectorStore, silentLogger, testEnv } from '../helpers.js';

/**
 * HTTP-level tests for everything that is decided BEFORE the database is touched:
 * security headers, CORS, CSRF guard, auth guard, validation, error shape, request ids.
 */
describe('HTTP layer (no database needed)', () => {
  let app;

  before(() => {
    const config = loadConfig({ ...testEnv, CLIENT_ORIGIN: 'http://localhost:5173' });
    const container = buildContainer({
      config,
      logger: silentLogger,
      overrides: { gemini: createScriptedGemini(), vectorStore: createMemoryVectorStore() },
    });
    app = createApp({ config, logger: silentLogger, ...container });
  });

  it('serves liveness and readiness probes', async () => {
    assert.equal((await request(app).get('/healthz')).body.status, 'ok');
    assert.equal((await request(app).get('/readyz')).status, 200);
  });

  it('reports not-ready when the database is down', async () => {
    const config = loadConfig(testEnv);
    const container = buildContainer({ config, logger: silentLogger, overrides: { gemini: createScriptedGemini(), vectorStore: createMemoryVectorStore() } });
    const down = createApp({ config, logger: silentLogger, isReady: () => false, ...container });
    assert.equal((await request(down).get('/readyz')).status, 503);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/healthz');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('returns JSON 404s with the standard error shape', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
    assert.ok(res.body.error.requestId);
  });

  it('echoes a valid X-Request-ID and ignores a malicious one', async () => {
    const good = await request(app).get('/api/nope').set('x-request-id', 'req-12345678');
    assert.equal(good.headers['x-request-id'], 'req-12345678');
    assert.equal(good.body.error.requestId, 'req-12345678');

    // Node's HTTP client refuses to send CR/LF in a header, so use a value it can send but our
    // allow-list (letters, digits, "_" and "-") must reject.
    const bad = await request(app).get('/api/nope').set('x-request-id', 'bad id <script>');
    assert.notEqual(bad.headers['x-request-id'], 'bad id <script>');
    assert.match(bad.headers['x-request-id'], /^[\w-]{8,64}$/);
  });

  it('only allows configured CORS origins', async () => {
    const allowed = await request(app).get('/healthz').set('Origin', 'http://localhost:5173');
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');

    const denied = await request(app).get('/healthz').set('Origin', 'http://evil.test');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('answers malformed JSON with a clean 400', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  it('validates input and reports every failing field', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'J', email: 'not-an-email', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    assert.ok(paths.includes('name') && paths.includes('email') && paths.includes('password'));
  });

  it('rejects over-long passwords that bcrypt would silently truncate', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Jane', email: 'j@example.com', password: `a1${'x'.repeat(80)}` });
    assert.equal(res.status, 400);
  });

  it('requires the CSRF header on cookie-based endpoints', async () => {
    const refresh = await request(app).post('/api/auth/refresh');
    assert.equal(refresh.status, 403);
    assert.equal(refresh.body.error.code, 'CSRF_REJECTED');
    assert.equal((await request(app).post('/api/auth/logout')).status, 403);
  });

  it('answers a refresh without a cookie with 401 REFRESH_TOKEN_MISSING', async () => {
    const res = await request(app).post('/api/auth/refresh').set('X-Requested-With', 'XMLHttpRequest');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'REFRESH_TOKEN_MISSING');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('protects every private route', async () => {
    for (const [method, path] of [
      ['get', '/api/resumes'], ['post', '/api/resumes'], ['get', '/api/sessions'], ['post', '/api/sessions'],
      ['get', '/api/progress'], ['get', '/api/auth/me'], ['delete', '/api/resumes/665f1c2e8a1b2c3d4e5f6a7b'],
    ]) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    }
  });

  it('rejects malformed and foreign-signed tokens', async () => {
    const res = await request(app).get('/api/resumes').set('Authorization', 'Bearer not.a.jwt');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_TOKEN');
    assert.equal((await request(app).get('/api/resumes').set('Authorization', 'Basic abc')).body.error.code, 'UNAUTHENTICATED');
  });
});
