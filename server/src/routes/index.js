import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireCsrfHeader } from '../middleware/auth.js';
import { idParams } from '../validators/common.js';
import { loginBody, registerBody } from '../validators/auth.schema.js';
import { uploadResumeBody } from '../validators/resume.schema.js';
import { answerBody, createSessionBody, listSessionsQuery } from '../validators/session.schema.js';

export function createApiRouter({ controllers, requireAuth, limiters, upload }) {
  const { auth, resumes, sessions } = controllers;
  const api = Router();

  // ---- Auth -------------------------------------------------------------
  const authRouter = Router();
  authRouter.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  authRouter.post('/register', limiters.login, validate({ body: registerBody }), h(auth.register));
  authRouter.post('/login', limiters.login, validate({ body: loginBody }), h(auth.login));
  authRouter.post('/refresh', limiters.refresh, requireCsrfHeader, h(auth.refresh));
  authRouter.post('/logout', requireCsrfHeader, h(auth.logout));
  authRouter.post('/logout-all', requireAuth, requireCsrfHeader, h(auth.logoutAll));
  authRouter.get('/me', requireAuth, h(auth.me));
  api.use('/auth', authRouter);

  // ---- Resumes ----------------------------------------------------------
  const resumeRouter = Router();
  resumeRouter.use(requireAuth);
  resumeRouter.get('/', h(resumes.list));
  resumeRouter.post('/', limiters.upload, upload, validate({ body: uploadResumeBody }), h(resumes.upload));
  resumeRouter.get('/:id', validate({ params: idParams }), h(resumes.get));
  resumeRouter.delete('/:id', validate({ params: idParams }), h(resumes.remove));
  api.use('/resumes', resumeRouter);

  // ---- Interview sessions -----------------------------------------------
  const sessionRouter = Router();
  sessionRouter.use(requireAuth);
  sessionRouter.get('/', validate({ query: listSessionsQuery }), h(sessions.list));
  sessionRouter.post('/', limiters.ai, validate({ body: createSessionBody }), h(sessions.create));
  sessionRouter.get('/:id', validate({ params: idParams }), h(sessions.get));
  sessionRouter.post(
    '/:id/answer',
    limiters.ai,
    validate({ params: idParams, body: answerBody }),
    h(sessions.answer),
  );
  sessionRouter.post('/:id/complete', limiters.ai, validate({ params: idParams }), h(sessions.complete));
  sessionRouter.delete('/:id', validate({ params: idParams }), h(sessions.remove));
  api.use('/sessions', sessionRouter);

  // ---- Progress ---------------------------------------------------------
  api.get('/progress', requireAuth, h(sessions.progress));

  return api;
}
