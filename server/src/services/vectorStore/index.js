import { createLocalVectorStore } from './local.js';
import { createAtlasVectorStore } from './atlas.js';

/**
 * Both stores expose the same three methods, so RAG code never knows which one it is using:
 *   insertMany(docs), search({ userId, resumeId, vector, k }), deleteByResume(resumeId)
 * A pgvector implementation would be a third file with the same shape.
 */
export function createVectorStore({ store, atlasIndex }) {
  if (store === 'atlas') return createAtlasVectorStore({ indexName: atlasIndex });
  return createLocalVectorStore();
}
