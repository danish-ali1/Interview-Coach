/**
 * End-to-end API tests against a REAL MongoDB (real models, queries, indexes and aggregations).
 * Only the AI provider is replaced by a scripted fake, so no API key or network is needed.
 *
 *   npm run test:integration
 *
 * Database: by default an in-memory MongoDB is downloaded and started by mongodb-memory-server
 * (needs internet access once). To use your own instance instead:
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:integration
 * A throw-away database is created and dropped, so existing data is never touched.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { buildContainer } from '../../src/container.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { ResumeChunk } from '../../src/models/ResumeChunk.js';
import { User } from '../../src/models/User.js';
import { Resume } from '../../src/models/Resume.js';
import { InterviewSession } from '../../src/models/InterviewSession.js';
import { SAMPLE_RESUME, createScriptedGemini, silentLogger, testEnv } from '../helpers.js';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const JD =
  'We are hiring a backend developer to build REST APIs with Node.js and MongoDB, write tests, and deploy with Docker.';

let memoryServer;
let app;
let dbName;

async function signUp(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name: 'Test User', email, password: 'Passw0rd!' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { agent, token: res.body.accessToken, user: res.body.user, cookie: res.headers['set-cookie'][0] };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function uploadResume(token, title = 'My resume') {
  return request(app)
    .post('/api/resumes')
    .set(auth(token))
    .field('title', title)
    .attach('file', Buffer.from(SAMPLE_RESUME), { filename: 'cv.txt', contentType: 'text/plain' });
}

async function startSession(token, resumeId, numQuestions = 3) {
  return request(app)
    .post('/api/sessions')
    .set(auth(token))
    .send({ resumeId, jobTitle: 'Backend Developer', company: 'Acme', jobDescription: JD, numQuestions, difficulty: 'mid' });
}

describe('API against a real MongoDB', () => {
  before(async () => {
    dbName = `ic_test_${Date.now()}`;
    let baseUri = process.env.TEST_MONGODB_URI;
    if (!baseUri) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      baseUri = memoryServer.getUri();
    }
    const uri = `${baseUri.replace(/\/$/, '').split('?')[0]}/${dbName}`;
    await mongoose.connect(uri);
    // Build every index up front so unique/TTL behaviour is real.
    await Promise.all([User, RefreshToken, Resume, ResumeChunk, InterviewSession].map((m) => m.init()));

    const config = loadConfig({ ...testEnv, MONGODB_URI: uri });
    const container = buildContainer({ config, logger: silentLogger, overrides: { gemini: createScriptedGemini() } });
    app = createApp({ config, logger: silentLogger, ...container });
  });

  after(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  describe('authentication', () => {
    it('registers, sets an httpOnly SameSite=Strict refresh cookie scoped to /api/auth, and never returns the refresh token in JSON', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: 'Jane', email: 'Jane@Example.com', password: 'Passw0rd!' });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.email, 'jane@example.com'); // normalised
      assert.ok(res.body.accessToken);
      assert.ok(!('passwordHash' in res.body.user));
      assert.ok(!JSON.stringify(res.body).includes('refresh'));

      const cookie = res.headers['set-cookie'][0];
      assert.match(cookie, /^ic_refresh=/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Path=\/api\/auth/);

      const stored = await User.findOne({ email: 'jane@example.com' }).select('+passwordHash');
      assert.match(stored.passwordHash, /^\$2[aby]\$/); // bcrypt, not plain text
    });

    it('rejects duplicate emails (case-insensitive) and wrong credentials', async () => {
      assert.equal((await request(app).post('/api/auth/register').send({ name: 'Jane 2', email: 'JANE@example.com', password: 'Passw0rd!' })).status, 409);
      const bad = await request(app).post('/api/auth/login').send({ email: 'jane@example.com', password: 'wrong-password1' });
      assert.equal(bad.status, 401);
      assert.equal(bad.body.error.code, 'INVALID_CREDENTIALS');
      const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Passw0rd!1' });
      assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS'); // same answer: no account enumeration
    });

    it('rotates the refresh token on every refresh and stores only its hash', async () => {
      const { agent, cookie: first } = await signUp('rotate@example.com');
      const raw = first.split(';')[0].split('=')[1];
      const row = await RefreshToken.findOne({}).sort({ createdAt: -1 });
      assert.ok(!JSON.stringify(row.toObject()).includes(raw));

      const res = await agent.post('/api/auth/refresh').set(XHR);
      assert.equal(res.status, 200);
      assert.ok(res.body.accessToken);
      assert.notEqual(res.headers['set-cookie'][0].split(';')[0], first.split(';')[0]);
    });

    it('detects refresh-token reuse and revokes the whole login', async () => {
      const { agent, cookie: stolen } = await signUp('theft@example.com');
      await agent.post('/api/auth/refresh').set(XHR); // legitimate rotation; REFRESH_REUSE_LEEWAY_SECONDS=0 in tests

      const thief = await request(app).post('/api/auth/refresh').set(XHR).set('Cookie', stolen.split(';')[0]);
      assert.equal(thief.status, 401);
      assert.equal(thief.body.error.code, 'REFRESH_TOKEN_REUSED');

      const victim = await agent.post('/api/auth/refresh').set(XHR); // the real user's newest token is dead too
      assert.equal(victim.status, 401);
    });

    it('logout revokes the token; the API rejects tokens for deleted users', async () => {
      const { agent, token, user } = await signUp('logout@example.com');
      assert.equal((await agent.post('/api/auth/logout').set(XHR)).status, 204);
      assert.equal((await agent.post('/api/auth/refresh').set(XHR)).status, 401);

      await User.deleteOne({ _id: user.id });
      assert.equal((await request(app).get('/api/auth/me').set(auth(token))).status, 401);
    });

    it('has a unique index on email and a TTL index on refresh tokens', async () => {
      const userIdx = await User.collection.indexes();
      assert.ok(userIdx.some((i) => i.key.email === 1 && i.unique));
      const tokenIdx = await RefreshToken.collection.indexes();
      assert.ok(tokenIdx.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0));
      assert.ok(tokenIdx.some((i) => i.key.tokenHash === 1 && i.unique));
    });
  });

  describe('resumes', () => {
    it('uploads, indexes into chunks, lists and deletes (removing the chunks too)', async () => {
      const { token } = await signUp('resumes@example.com');
      const up = await uploadResume(token);
      assert.equal(up.status, 201, JSON.stringify(up.body));
      const resume = up.body.resume;
      assert.ok(resume.chunkCount >= 5);
      assert.ok(resume.sections.includes('projects'));
      assert.ok(!('user' in resume));
      assert.equal(await ResumeChunk.countDocuments({ resume: resume.id }), resume.chunkCount);

      const stored = await ResumeChunk.find({ resume: resume.id });
      assert.ok(!stored.map((c) => c.text).join('\n').includes('555-2671')); // contact details never stored

      const list = await request(app).get('/api/resumes').set(auth(token));
      assert.equal(list.body.resumes.length, 1);

      assert.equal((await request(app).delete(`/api/resumes/${resume.id}`).set(auth(token))).status, 204);
      assert.equal(await ResumeChunk.countDocuments({ resume: resume.id }), 0);
    });

    it('rejects binary uploads, missing files and oversized files', async () => {
      const { token } = await signUp('badupload@example.com');
      const zip = await request(app).post('/api/resumes').set(auth(token))
        .attach('file', Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0]), { filename: 'cv.txt', contentType: 'text/plain' });
      assert.equal(zip.status, 415);
      assert.equal((await request(app).post('/api/resumes').set(auth(token)).field('title', 'x')).body.error.code, 'FILE_REQUIRED');

      const big = await request(app).post('/api/resumes').set(auth(token))
        .attach('file', Buffer.alloc(6 * 1024 * 1024, 'a'), { filename: 'cv.txt', contentType: 'text/plain' });
      assert.equal(big.status, 413);
    });

    it('isolates users: nobody can read, use or delete another user\'s resume', async () => {
      const alice = await signUp('alice@example.com');
      const bob = await signUp('bob@example.com');
      const { resume } = (await uploadResume(alice.token)).body;

      assert.equal((await request(app).get(`/api/resumes/${resume.id}`).set(auth(bob.token))).status, 404);
      assert.equal((await request(app).delete(`/api/resumes/${resume.id}`).set(auth(bob.token))).status, 404);
      assert.equal((await startSession(bob.token, resume.id)).status, 404);
      assert.equal((await request(app).get('/api/resumes').set(auth(bob.token))).body.resumes.length, 0);
      assert.equal(await ResumeChunk.countDocuments({ resume: resume.id }), resume.chunkCount); // untouched
    });
  });

  describe('interview flow', () => {
    it('runs a full interview: questions grounded in the resume, scored answers, summary, progress', async () => {
      const { token } = await signUp('flow@example.com');
      const { resume } = (await uploadResume(token)).body;

      const created = await startSession(token, resume.id, 3);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      let session = created.body.session;
      assert.equal(session.questions.length, 1);
      assert.ok(session.questions[0].sources.length > 0);
      assert.ok(!('jobDescription' in session));

      for (let i = 0; i < 3; i += 1) {
        const q = session.questions.find((x) => !x.answer);
        const res = await request(app)
          .post(`/api/sessions/${session.id}/answer`)
          .set(auth(token))
          .send({ questionId: q.id, answer: 'I chose this approach because it reduced latency, and I measured the result.' });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.evaluation.score >= 0 && res.body.evaluation.score <= 10);
        session = res.body.session;
        assert.equal(res.body.nextQuestion === null, i === 2);
      }

      assert.equal(session.status, 'completed');
      assert.equal(session.questions.length, 3);
      assert.ok(session.averageScore > 0);
      assert.ok(session.summary.overall);

      const again = await request(app)
        .post(`/api/sessions/${session.id}/answer`).set(auth(token))
        .send({ questionId: session.questions[0].id, answer: 'Trying to answer a finished interview.' });
      assert.equal(again.status, 409);

      const progress = (await request(app).get('/api/progress').set(auth(token))).body;
      assert.equal(progress.totals.answers, 3);
      assert.equal(progress.totals.completedSessions, 1);
      assert.ok(progress.byTopic.length > 0 && progress.byKind.length > 0);
      assert.equal(progress.trend.length, 1);

      const list = (await request(app).get('/api/sessions').set(auth(token))).body;
      assert.equal(list.total, 1);
      assert.ok(!('questions' in list.items[0]));
    });

    it('lets only one of two simultaneous submissions evaluate the same question', async () => {
      const { token } = await signUp('double@example.com');
      const { resume } = (await uploadResume(token)).body;
      const session = (await startSession(token, resume.id, 3)).body.session;
      const body = { questionId: session.questions[0].id, answer: 'I would first measure, then change one thing at a time.' };

      const [a, b] = await Promise.all([
        request(app).post(`/api/sessions/${session.id}/answer`).set(auth(token)).send(body),
        request(app).post(`/api/sessions/${session.id}/answer`).set(auth(token)).send(body),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409]);

      const stored = await InterviewSession.findById(session.id);
      assert.equal(stored.questions.length, 2); // exactly one next question, never two
      assert.ok(stored.questions[0].evaluation.score >= 0);
    });

    it('protects a resume that an unfinished interview uses, and allows deletion afterwards', async () => {
      const { token } = await signUp('inuse@example.com');
      const { resume } = (await uploadResume(token)).body;
      const session = (await startSession(token, resume.id, 3)).body.session;

      const blocked = await request(app).delete(`/api/resumes/${resume.id}`).set(auth(token));
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error.code, 'RESUME_IN_USE');

      await request(app).post(`/api/sessions/${session.id}/answer`).set(auth(token))
        .send({ questionId: session.questions[0].id, answer: 'A reasonably detailed answer about my work.' });
      const done = await request(app).post(`/api/sessions/${session.id}/complete`).set(auth(token));
      assert.equal(done.status, 200);
      assert.equal(done.body.session.status, 'completed');
      assert.equal((await request(app).delete(`/api/resumes/${resume.id}`).set(auth(token))).status, 204);
    });

    it('refuses to finish an interview with no answers and isolates sessions between users', async () => {
      const alice = await signUp('alice2@example.com');
      const bob = await signUp('bob2@example.com');
      const { resume } = (await uploadResume(alice.token)).body;
      const session = (await startSession(alice.token, resume.id)).body.session;

      assert.equal((await request(app).post(`/api/sessions/${session.id}/complete`).set(auth(alice.token))).body.error.code, 'NO_ANSWERS');
      assert.equal((await request(app).get(`/api/sessions/${session.id}`).set(auth(bob.token))).status, 404);
      assert.equal((await request(app).delete(`/api/sessions/${session.id}`).set(auth(bob.token))).status, 404);
      assert.equal((await request(app).get('/api/progress').set(auth(bob.token))).body.totals.answers, 0);
    });
  });
});
