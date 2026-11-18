import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/vector.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const EMBED_BATCH_SIZE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(attempt, retryAfterHeader) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 20_000);
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 8_000);
}

/**
 * Minimal Gemini REST client: timeouts, retries with backoff, and errors translated into
 * AppErrors so the API answers with a clear message instead of leaking upstream details.
 * `fetchImpl` and `sleepImpl` are injectable for tests.
 */
export function createGeminiClient({
  apiKey,
  chatModel,
  embeddingModel,
  dimensions,
  timeoutMs = 45_000,
  maxRetries = 3,
  logger,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
}) {
  function mapHttpError(status, bodyText) {
    // Upstream error bodies can contain request details; log them, never forward them.
    logger?.warn({ status, body: bodyText.slice(0, 500) }, 'Gemini API error');
    if (status === 429) {
      return new AppError(503, 'AI_RATE_LIMITED', 'The AI service is busy right now. Please try again in a minute.');
    }
    if ([400, 401, 403, 404].includes(status)) {
      return new AppError(502, 'AI_CONFIG_ERROR', 'The AI service rejected the request. Please contact support.');
    }
    return new AppError(502, 'AI_UPSTREAM_ERROR', 'The AI service returned an error. Please try again.');
  }

  async function post(path, body) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${BASE_URL}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.ok) return await response.json();

        const text = await response.text().catch(() => '');
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          await sleepImpl(retryDelay(attempt, response.headers?.get?.('retry-after')));
          continue;
        }
        throw mapHttpError(response.status, text);
      } catch (err) {
        if (err instanceof AppError) throw err;
        const timedOut = err?.name === 'AbortError';
        if (attempt < maxRetries) {
          await sleepImpl(retryDelay(attempt));
          continue;
        }
        logger?.error({ err }, 'Gemini request failed');
        throw timedOut
          ? new AppError(504, 'AI_TIMEOUT', 'The AI service took too long to respond. Please try again.')
          : new AppError(502, 'AI_UNAVAILABLE', 'Could not reach the AI service. Please try again.');
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AppError(502, 'AI_UNAVAILABLE', 'Could not reach the AI service. Please try again.');
  }

  return {
    /**
     * Embeds texts. `taskType` should be RETRIEVAL_DOCUMENT when indexing and RETRIEVAL_QUERY when
     * searching: the model optimises the two sides differently. Vectors are L2-normalised because
     * truncated (non-3072) outputs are not unit length.
     */
    async embed(texts, taskType) {
      const vectors = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const data = await post(`models/${embeddingModel}:batchEmbedContents`, {
          requests: batch.map((text) => ({
            model: `models/${embeddingModel}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: dimensions,
          })),
        });

        const embeddings = data?.embeddings ?? [];
        if (embeddings.length !== batch.length) {
          throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI service returned an unexpected embedding response.');
        }
        for (const item of embeddings) {
          if (!Array.isArray(item.values) || item.values.length !== dimensions) {
            throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI service returned embeddings of an unexpected size.');
          }
          vectors.push(normalize(item.values));
        }
      }
      return vectors;
    },

    /** Generates text constrained to JSON. Parsing and schema validation happen in the RAG layer. */
    async generate({ system, prompt, temperature = 0.4, maxOutputTokens = 4096 }) {
      const data = await post(`models/${chatModel}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json' },
      });

      if (data?.promptFeedback?.blockReason) {
        throw new AppError(422, 'AI_CONTENT_BLOCKED', 'The AI service could not process this content.');
      }
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('');
      if (!text.trim()) {
        throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The AI service returned an empty response. Please try again.');
      }
      return text;
    },
  };
}
