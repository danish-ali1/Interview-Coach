import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { normalizeError } from '../../src/middleware/error.js';
import { AppError } from '../../src/utils/AppError.js';

describe('normalizeError', () => {
  it('passes AppError through untouched', () => {
    const err = AppError.notFound('nope', 'X');
    assert.equal(normalizeError(err), err);
  });

  it('maps Zod errors to a 400 with per-field details', () => {
    const parsed = z.object({ email: z.string() }).safeParse({});
    const out = normalizeError(parsed.error);
    assert.equal(out.status, 400);
    assert.equal(out.code, 'VALIDATION_ERROR');
    assert.equal(out.details[0].path, 'email');
  });

  it('maps library errors to the right status and code', () => {
    const cases = [
      [{ name: 'CastError', path: 'id' }, 400, 'INVALID_ID'],
      [{ name: 'ValidationError', errors: { a: { path: 'a', message: 'bad' } } }, 400, 'VALIDATION_ERROR'],
      [{ code: 11000, keyPattern: { email: 1 } }, 409, 'DUPLICATE_KEY'],      [{ name: 'MulterError', code: 'LIMIT_FILE_SIZE', message: 'x' }, 413, 'FILE_TOO_LARGE'],
      [{ name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE', message: 'x' }, 400, 'UPLOAD_ERROR'],
      [{ type: 'entity.parse.failed' }, 400, 'INVALID_JSON'],
      [{ type: 'entity.too.large' }, 413, 'PAYLOAD_TOO_LARGE'],
      [{ name: 'TokenExpiredError' }, 401, 'TOKEN_EXPIRED'],
      [{ name: 'JsonWebTokenError' }, 401, 'INVALID_TOKEN'],
    ];
    for (const [input, status, code] of cases) {
      const out = normalizeError(input);
      assert.equal(out.status, status, `${code} status`);
      assert.equal(out.code, code);
    }
  });

  it('hides the details of unexpected errors', () => {
    const out = normalizeError(new Error('connection string mongodb://user:hunter2@host leaked'));
    assert.equal(out.status, 500);
    assert.equal(out.code, 'INTERNAL_ERROR');
    assert.ok(!out.message.includes('hunter2'));
  });
});
