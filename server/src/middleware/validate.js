import { AppError } from '../utils/AppError.js';

/**
 * Validates req.params / req.query / req.body against Zod schemas.
 * Parsed (typed, trimmed, defaulted) values are placed on `req.valid`; the raw request
 * objects are never mutated, so handlers only ever see validated data.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const valid = {};
    const issues = [];

    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;

      // multer gives multipart bodies a null prototype; spread into a plain object first.
      const input = part === 'body' ? { ...(req.body ?? {}) } : { ...(req[part] ?? {}) };
      const result = schema.safeParse(input);

      if (result.success) {
        valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location: part, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) return next(AppError.validation(issues));
    req.valid = valid;
    return next();
  };
}
