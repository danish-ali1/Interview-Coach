import mongoose from 'mongoose';
import { ResumeChunk } from '../../models/ResumeChunk.js';

/**
 * MongoDB Atlas Vector Search implementation (VECTOR_STORE=atlas).
 *
 * Requires an Atlas Search index on the `resumechunks` collection (see README):
 *   { "fields": [
 *       { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "dotProduct" },
 *       { "type": "filter", "path": "user" },
 *       { "type": "filter", "path": "resume" } ] }
 * `numDimensions` must equal EMBEDDING_DIMENSIONS. Note that Atlas scores are not comparable
 * with the local store's raw dot products, so nothing in the app thresholds on `score`.
 */
export function createAtlasVectorStore({ indexName }) {
  const oid = (id) => new mongoose.Types.ObjectId(String(id));

  return {
    name: 'atlas',

    async insertMany(docs) {
      await ResumeChunk.insertMany(docs, { ordered: true });
    },

    async search({ userId, resumeId, vector, k }) {
      const results = await ResumeChunk.aggregate([
        {
          $vectorSearch: {
            index: indexName,
            path: 'embedding',
            queryVector: vector,
            numCandidates: Math.max(k * 20, 100),
            limit: k,
            filter: { $and: [{ user: { $eq: oid(userId) } }, { resume: { $eq: oid(resumeId) } }] },
          },
        },
        { $project: { section: 1, text: 1, score: { $meta: 'vectorSearchScore' } } },
      ]);

      return results.map((r) => ({ id: String(r._id), section: r.section, text: r.text, score: r.score }));
    },

    async deleteByResume(resumeId) {
      await ResumeChunk.deleteMany({ resume: resumeId });
    },
  };
}
