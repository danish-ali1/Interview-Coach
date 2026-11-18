import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGeminiClient } from '../../src/services/gemini.client.js';
import { silentLogger } from '../helpers.js';

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

function makeClient(responder, overrides = {}) {
  const calls = [];
  const client = createGeminiClient({
    apiKey: 'secret-key',
    chatModel: 'chat-model',
    embeddingModel: 'embed-model',
    dimensions: 4,
    timeoutMs: 200,
    maxRetries: 2,
    logger: silentLogger,
    sleepImpl: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return responder(calls.length, init);
    },
    ...overrides,
  });
  return { client, calls };
}

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return { code: err.code, status: err.status };
  }
  return null;
};

describe('embed', () => {
  it('sends task type, dimensionality and key, and returns unit vectors', async () => {
    const { client, calls } = makeClient(() => res(200, { embeddings: [{ values: [3, 4, 0, 0] }, { values: [0, 0, 0, 2] }] }));
    const vectors = await client.embed(['a', 'b'], 'RETRIEVAL_DOCUMENT');

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /models\/embed-model:batchEmbedContents$/);
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'secret-key');
    assert.equal(calls[0].body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
    assert.equal(calls[0].body.requests[0].outputDimensionality, 4);
    assert.equal(calls[0].body.requests[0].model, 'models/embed-model');
    assert.deepEqual(vectors[0], [0.6, 0.8, 0, 0]);
    assert.deepEqual(vectors[1], [0, 0, 0, 1]);
  });

  it('batches large inputs into requests of at most 100', async () => {
    const { client, calls } = makeClient((_, init) => {
      const n = JSON.parse(init.body).requests.length;
      return res(200, { embeddings: Array.from({ length: n }, () => ({ values: [1, 0, 0, 0] })) });
    });
    const out = await client.embed(Array.from({ length: 250 }, (_, i) => `t${i}`), 'RETRIEVAL_QUERY');
    assert.equal(out.length, 250);
    assert.deepEqual(calls.map((c) => c.body.requests.length), [100, 100, 50]);
  });

  it('rejects embeddings of the wrong size or count', async () => {
    const wrongSize = makeClient(() => res(200, { embeddings: [{ values: [1, 2] }] })).client;
    assert.equal((await codeOf(wrongSize.embed(['a'], 'RETRIEVAL_QUERY'))).code, 'AI_BAD_RESPONSE');

    const wrongCount = makeClient(() => res(200, { embeddings: [] })).client;
    assert.equal((await codeOf(wrongCount.embed(['a'], 'RETRIEVAL_QUERY'))).code, 'AI_BAD_RESPONSE');
  });
});

describe('retries and error mapping', () => {
  it('retries transient 503s and then succeeds', async () => {
    const { client, calls } = makeClient((n) => (n < 3 ? res(503, 'overloaded') : res(200, { embeddings: [{ values: [1, 0, 0, 0] }] })));
    await client.embed(['a'], 'RETRIEVAL_QUERY');
    assert.equal(calls.length, 3);
  });

  it('turns exhausted 429s into a friendly 503 AI_RATE_LIMITED', async () => {
    const { client, calls } = makeClient(() => res(429, 'quota'));
    assert.deepEqual(await codeOf(client.embed(['a'], 'RETRIEVAL_QUERY')), { code: 'AI_RATE_LIMITED', status: 503 });
    assert.equal(calls.length, 3); // first try + 2 retries
  });

  it('does not retry client errors and hides upstream details', async () => {
    const { client, calls } = makeClient(() => res(403, 'API key not valid: secret-key'));
    try {
      await client.embed(['a'], 'RETRIEVAL_QUERY');
      assert.fail('should throw');
    } catch (err) {
      assert.equal(err.code, 'AI_CONFIG_ERROR');
      assert.ok(!err.message.includes('secret-key'));
    }
    assert.equal(calls.length, 1);
  });

  it('maps network failures to AI_UNAVAILABLE after retrying', async () => {
    const { client, calls } = makeClient(() => {
      throw new Error('ECONNRESET');
    });
    assert.equal((await codeOf(client.embed(['a'], 'RETRIEVAL_QUERY'))).code, 'AI_UNAVAILABLE');
    assert.equal(calls.length, 3);
  });

  it('aborts slow requests and reports AI_TIMEOUT', async () => {
    const { client } = makeClient(() => new Promise(() => {}), {
      maxRetries: 0,
      timeoutMs: 30,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    });
    assert.deepEqual(await codeOf(client.embed(['a'], 'RETRIEVAL_QUERY')), { code: 'AI_TIMEOUT', status: 504 });
  });
});

describe('generate', () => {
  it('requests JSON output and joins text parts, ignoring thinking parts', async () => {
    const { client, calls } = makeClient(() =>
      res(200, { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '{"a":' }, { text: '1}' }] } }] }),
    );
    const text = await client.generate({ system: 'sys', prompt: 'hi', temperature: 0.1 });
    assert.equal(text, '{"a":1}');
    assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
    assert.equal(calls[0].body.systemInstruction.parts[0].text, 'sys');
    assert.match(calls[0].url, /models\/chat-model:generateContent$/);
  });

  it('reports blocked prompts and empty answers distinctly', async () => {
    const blocked = makeClient(() => res(200, { promptFeedback: { blockReason: 'SAFETY' } })).client;
    assert.equal((await codeOf(blocked.generate({ system: 's', prompt: 'p' }))).code, 'AI_CONTENT_BLOCKED');

    const empty = makeClient(() => res(200, { candidates: [{ content: { parts: [] } }] })).client;
    assert.equal((await codeOf(empty.generate({ system: 's', prompt: 'p' }))).code, 'AI_EMPTY_RESPONSE');
  });
});
