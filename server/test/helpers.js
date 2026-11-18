import pino from 'pino';
import { SYSTEM } from '../src/services/prompts.js';
import { normalize, dot } from '../src/utils/vector.js';

export const silentLogger = pino({ level: 'silent' });

export const testEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/interview-coach-test',
  JWT_ACCESS_SECRET: 'unit-test-secret-unit-test-secret-1234',
  GEMINI_API_KEY: 'test-key',
  EMBEDDING_DIMENSIONS: '128',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  BCRYPT_ROUNDS: '4',
  REFRESH_REUSE_LEEWAY_SECONDS: '0',
};

/** Hashes words into a small bag-of-words vector: deterministic and "semantic enough" for ranking tests. */
export function fakeEmbed(text, dims = 32) {
  const vec = new Array(dims).fill(0);
  for (const token of String(text).toLowerCase().match(/[a-z0-9.+#]+/g) ?? []) {
    let h = 0;
    for (const ch of token) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    vec[h % dims] += 1;
  }
  return normalize(vec.some((x) => x !== 0) ? vec : vec.map((_, i) => (i === 0 ? 1 : 0)));
}

const GENERATE_KIND = new Map([
  [SYSTEM.requirements, 'requirements'],
  [SYSTEM.question, 'question'],
  [SYSTEM.evaluation, 'evaluation'],
  [SYSTEM.summary, 'summary'],
]);

/**
 * Stand-in for the Gemini client. `generate` recognises which pipeline step is calling by its
 * system prompt and returns valid JSON for it; individual steps can be scripted to fail or to
 * return custom text.
 */
export function createScriptedGemini({ dimensions = 32 } = {}) {
  const calls = { embed: [], generate: [] };
  const failures = [];
  const custom = new Map();
  let questionCounter = 0;
  const topics = ['Node.js', 'React', 'Databases', 'Teamwork', 'System Design'];

  const defaults = {
    requirements: () =>
      JSON.stringify({
        requirements: [
          'Build REST APIs with Node.js',
          'React front-end development',
          'MongoDB data modelling',
          'Docker and deployment',
          'Testing and code quality',
        ],
      }),
    question: () => {
      questionCounter += 1;
      return JSON.stringify({
        question: `Walk me through decision number ${questionCounter} you made in your projects and why.`,
        topic: topics[questionCounter % topics.length],
      });
    },
    evaluation: () =>
      JSON.stringify({
        rubric: { relevance: 8, technicalAccuracy: 8, depth: 6, communication: 8 },
        strengths: ['Clear structure'],
        gaps: ['No measurable results'],
        feedback: 'Good structure. Add numbers to show impact.',
        improvedAnswer: 'I chose this approach because it reduced latency, and I measured the result.',
      }),
    summary: () =>
      JSON.stringify({
        overall: 'Solid interview with room to add measurable results.',
        strengths: ['Clear communication'],
        improvements: ['Add metrics'],
        nextSteps: ['Practise quantifying impact'],
      }),
  };

  return {
    calls,
    /** Make the next call of this pipeline step throw `error`. */
    failNext(kind, error) {
      failures.push({ kind, error });
    },
    /** Replace the reply of a step with a function returning raw text. */
    reply(kind, fn) {
      custom.set(kind, fn);
    },
    async embed(texts, taskType) {
      calls.embed.push({ texts, taskType });
      return texts.map((t) => fakeEmbed(t, dimensions));
    },
    async generate(args) {
      const kind = GENERATE_KIND.get(args.system) ?? 'unknown';
      calls.generate.push({ kind, ...args });
      const failureIndex = failures.findIndex((f) => f.kind === kind);
      if (failureIndex !== -1) throw failures.splice(failureIndex, 1)[0].error;
      return (custom.get(kind) ?? defaults[kind])(args);
    },
  };
}

/** In-memory implementation of the vector store interface. */
export function createMemoryVectorStore() {
  const docs = [];
  return {
    name: 'memory',
    docs,
    async insertMany(items) {
      docs.push(...items);
    },
    async search({ userId, resumeId, vector, k }) {
      return docs
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => String(d.user) === String(userId) && String(d.resume) === String(resumeId))
        .map(({ d, i }) => ({ id: String(i), section: d.section, text: d.text, score: dot(vector, d.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
    async deleteByResume(resumeId) {
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (String(docs[i].resume) === String(resumeId)) docs.splice(i, 1);
      }
    },
  };
}

export const SAMPLE_RESUME = `Jane Doe
jane.doe@example.com | +1 (415) 555-2671 | github.com/janedoe

SUMMARY
Full-stack developer with 2 years of experience building MERN applications and REST APIs.

EXPERIENCE
Software Intern - Acme Corp (2024)
- Built REST APIs with Node.js and Express serving 10k requests per day.
- Wrote Jest tests that raised coverage from 40% to 80%.
- Containerised services with Docker and deployed them to AWS.

PROJECTS
Interview Coach - React, Node.js, MongoDB
- Built JWT authentication with refresh token rotation and reuse detection.
- Implemented retrieval augmented generation using embeddings and vector search.

Expense Tracker - React, Express, PostgreSQL
- Designed a relational schema and wrote aggregation queries for monthly reports.
- Added role based access control and input validation.

SKILLS
JavaScript, TypeScript, React, Node.js, Express, MongoDB, PostgreSQL, Docker, Git

EDUCATION
B.Tech Computer Science, 2025
`;
