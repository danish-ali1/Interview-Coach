import { Resume } from '../models/Resume.js';
import { InterviewSession } from '../models/InterviewSession.js';
import { AppError } from '../utils/AppError.js';

export function createResumeService({ rag, vectorStore, parser, chunker, limits, logger }) {
  const findOwned = async (userId, id) => {
    const resume = await Resume.findOne({ _id: id, user: userId });
    if (!resume) throw AppError.notFound('Resume not found', 'RESUME_NOT_FOUND');
    return resume;
  };

  return {
    async list(userId) {
      const resumes = await Resume.find({ user: userId }).sort({ createdAt: -1 });
      return resumes.map((r) => r.toJSON());
    },

    async get(userId, id) {
      return (await findOwned(userId, id)).toJSON();
    },

    async upload(userId, file, { title } = {}) {
      if ((await Resume.countDocuments({ user: userId })) >= limits.maxResumesPerUser) {
        throw AppError.conflict(
          `You can keep up to ${limits.maxResumesPerUser} resumes. Delete one to upload another.`,
          'RESUME_LIMIT_REACHED',
        );
      }

      const text = await parser.extractResumeText(file);
      const chunks = chunker.chunkResume(text, { maxChunks: limits.maxChunksPerResume });
      if (chunks.length === 0) {
        throw AppError.unprocessable('We could not find any usable text in this resume.', 'RESUME_EMPTY');
      }

      const fallbackTitle = (file.originalname ?? '').replace(/\.[^.]+$/, '').trim();
      const resume = await Resume.create({
        user: userId,
        title: (title || fallbackTitle || 'Resume').slice(0, 100),
        originalName: (file.originalname ?? '').slice(0, 200),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        charCount: text.length,
        chunkCount: chunks.length,
        sections: [...new Set(chunks.map((c) => c.section))],
      });

      try {
        await rag.indexResume({ userId, resumeId: resume.id, chunks });
      } catch (err) {
        // Never leave a half-indexed resume behind: it would exist in the UI but retrieve nothing.
        await Promise.allSettled([resume.deleteOne(), vectorStore.deleteByResume(resume._id)]);
        logger.warn({ err, resumeId: resume.id }, 'resume indexing failed, rolled back');
        throw err;
      }
      return resume.toJSON();
    },

    async remove(userId, id) {
      const resume = await findOwned(userId, id);
      if (await InterviewSession.exists({ resume: resume._id, status: 'active' })) {
        throw AppError.conflict(
          'This resume is used by an interview in progress. Finish or delete that interview first.',
          'RESUME_IN_USE',
        );
      }
      await vectorStore.deleteByResume(resume._id);
      await resume.deleteOne();
    },
  };
}
