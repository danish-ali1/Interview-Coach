import { ResumeChunk } from '../../models/ResumeChunk.js';
import { dot, topK } from '../../utils/vector.js';

/**
 * Vector store that works on any MongoDB (including the free tier and a plain Docker container).
 *
 * Search is scoped to ONE resume of ONE user, which is a few dozen chunks, so loading them and
 * ranking by dot product (== cosine, since vectors are normalised) takes well under a millisecond
 * of CPU. This is exact search, with no index to build and no extra service to run.
 * For millions of vectors switch to the Atlas store (approximate nearest-neighbour index).
 */
export function createLocalVectorStore() {
  return {
    name: 'local',

    async insertMany(docs) {
      await ResumeChunk.insertMany(docs, { ordered: true });
    },

    async search({ userId, resumeId, vector, k }) {
      const chunks = await ResumeChunk.find({ user: userId, resume: resumeId })
        .select('+embedding section text')
        .lean();

      return topK(chunks, (chunk) => dot(vector, chunk.embedding), k).map(({ item, score }) => ({
        id: String(item._id),
        section: item.section,
        text: item.text,
        score,
      }));
    },

    async deleteByResume(resumeId) {
      await ResumeChunk.deleteMany({ resume: resumeId });
    },
  };
}
