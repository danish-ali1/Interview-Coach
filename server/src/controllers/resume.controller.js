import { AppError } from '../utils/AppError.js';

export function createResumeController({ resumeService }) {
  return {
    async list(req, res) {
      res.json({ resumes: await resumeService.list(req.user.id) });
    },

    async upload(req, res) {
      if (!req.file) {
        throw AppError.badRequest('Attach your resume in the "file" field.', 'FILE_REQUIRED');
      }
      const resume = await resumeService.upload(req.user.id, req.file, req.valid.body);
      res.status(201).json({ resume });
    },

    async get(req, res) {
      res.json({ resume: await resumeService.get(req.user.id, req.valid.params.id) });
    },

    async remove(req, res) {
      await resumeService.remove(req.user.id, req.valid.params.id);
      res.status(204).end();
    },
  };
}
