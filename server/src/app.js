import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createRequireAuth } from './middleware/auth.js';
import { createErrorHandler, notFound } from './middleware/error.js';
import { createApiRouter } from './routes/index.js';

const SAFE_REQUEST_ID = /^[\w-]{8,64}$/;

/**
 * Builds the Express app from already-constructed dependencies (see container.js).
 * Nothing in here reads process.env or opens connections, so tests can create apps freely.
 */
export function createApp({ config, logger, tokenService, controllers, limiters, upload, isReady = () => true }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
    }),
  );

  app.use(helmet());

  const allowedOrigins = new Set(config.clientOrigins);
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Liveness: is the process up? Readiness: can it serve traffic (database connected)?
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) =>
    isReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'unavailable' }),
  );

  app.use(
    '/api',
    limiters.global,
    createApiRouter({ controllers, requireAuth: createRequireAuth(tokenService), limiters, upload }),
  );

  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}
