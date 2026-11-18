import { createAuthController } from './controllers/auth.controller.js';
import { createResumeController } from './controllers/resume.controller.js';
import { createSessionController } from './controllers/session.controller.js';
import { createLimiters } from './middleware/rateLimit.js';
import { createResumeUpload } from './middleware/upload.js';
import { createAuthService } from './services/auth.service.js';
import { chunkResume } from './services/chunker.js';
import { createGeminiClient } from './services/gemini.client.js';
import { createInterviewService } from './services/interview.service.js';
import { createProgressService } from './services/progress.service.js';
import { createRagService } from './services/rag.service.js';
import { extractResumeText } from './services/resume.parser.js';
import { createResumeService } from './services/resume.service.js';
import { createTokenService } from './services/token.service.js';
import { createVectorStore } from './services/vectorStore/index.js';
import { createCookieHelpers } from './utils/cookies.js';

/**
 * Composition root: the only place that decides which concrete implementation is used.
 * `overrides` lets tests swap the AI client or vector store for fakes.
 */
export function buildContainer({ config, logger, overrides = {} }) {
  const gemini = overrides.gemini ?? createGeminiClient({ ...config.gemini, logger });
  const vectorStore =
    overrides.vectorStore ??
    createVectorStore({ store: config.vector.store, atlasIndex: config.vector.atlasIndex });

  const rag = createRagService({ gemini, vectorStore, logger });
  const tokenService = createTokenService({
    accessSecret: config.auth.accessSecret,
    accessTtlSeconds: config.auth.accessTtlSeconds,
  });
  const authService = createAuthService({ tokenService, config: config.auth, logger });
  const resumeService = createResumeService({
    rag,
    vectorStore,
    parser: { extractResumeText },
    chunker: { chunkResume },
    limits: config.limits,
    logger,
  });
  const interviewService = createInterviewService({ rag, logger });
  const progressService = createProgressService();

  return {
    tokenService,
    limiters: createLimiters({ enabled: config.rateLimitEnabled }),
    upload: createResumeUpload({ maxBytes: config.uploads.maxBytes }),
    controllers: {
      auth: createAuthController({ authService, cookies: createCookieHelpers({ secure: config.auth.cookieSecure }) }),
      resumes: createResumeController({ resumeService }),
      sessions: createSessionController({ interviewService, progressService }),
    },
  };
}
