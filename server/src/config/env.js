import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGO_AUTO_INDEX: bool.default(true),

  // Comma-separated list of allowed browser origins.
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Number of reverse proxies in front of the API (nginx, a load balancer...).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  REFRESH_TOKEN_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  REFRESH_REUSE_LEEWAY_SECONDS: z.coerce.number().int().min(0).default(10),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  COOKIE_SECURE: bool.optional(),

  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  // Google's model docs recommend the 3.x Flash line for new projects (2.5 is limited to existing users).
  // Override with GEMINI_CHAT_MODEL, e.g. gemini-3.5-flash-lite for a cheaper/faster option.
  GEMINI_CHAT_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(128).max(3072).default(768),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(3),

  VECTOR_STORE: z.enum(['local', 'atlas']).default('local'),
  ATLAS_VECTOR_INDEX: z.string().default('resume_chunks_vector'),

  MAX_UPLOAD_MB: z.coerce.number().positive().max(25).default(5),
  MAX_RESUMES_PER_USER: z.coerce.number().int().min(1).default(5),
  MAX_CHUNKS_PER_RESUME: z.coerce.number().int().min(5).default(60),

  RATE_LIMIT_ENABLED: bool.default(true),
});

/**
 * Validates and normalises environment variables into a typed config object.
 * Fails fast with a readable message instead of crashing later with `undefined`.
 */
export function loadConfig(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  if (isProduction && /change-?me|example|secret-here/i.test(e.JWT_ACCESS_SECRET)) {
    throw new Error('JWT_ACCESS_SECRET looks like a placeholder. Generate a real random secret.');
  }

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    mongo: { uri: e.MONGODB_URI, autoIndex: e.MONGO_AUTO_INDEX },
    clientOrigins: e.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    auth: {
      accessSecret: e.JWT_ACCESS_SECRET,
      accessTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      refreshAbsoluteTtlDays: Math.max(e.REFRESH_TOKEN_ABSOLUTE_TTL_DAYS, e.REFRESH_TOKEN_TTL_DAYS),
      reuseLeewaySeconds: e.REFRESH_REUSE_LEEWAY_SECONDS,
      bcryptRounds: e.BCRYPT_ROUNDS,
      cookieSecure: e.COOKIE_SECURE ?? isProduction,
    },
    gemini: {
      apiKey: e.GEMINI_API_KEY,
      chatModel: e.GEMINI_CHAT_MODEL,
      embeddingModel: e.GEMINI_EMBEDDING_MODEL,
      dimensions: e.EMBEDDING_DIMENSIONS,
      timeoutMs: e.GEMINI_TIMEOUT_MS,
      maxRetries: e.GEMINI_MAX_RETRIES,
    },
    vector: { store: e.VECTOR_STORE, atlasIndex: e.ATLAS_VECTOR_INDEX },
    uploads: { maxBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024) },
    limits: { maxResumesPerUser: e.MAX_RESUMES_PER_USER, maxChunksPerResume: e.MAX_CHUNKS_PER_RESUME },
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
  };
}
