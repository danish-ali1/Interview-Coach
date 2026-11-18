import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const ALLOWED_MIME = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown']);
const GENERIC_MIME = new Set(['application/octet-stream', '']);

/**
 * Accepts a single in-memory file in the `file` field. Files are never written to disk:
 * the text is extracted immediately and the original is discarded.
 * Content is re-checked by magic bytes in the parser; the MIME type is only a first filter.
 */
export function createResumeUpload({ maxBytes }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 2 * 1024 },
    fileFilter(_req, file, cb) {
      const looksTextual = /\.(txt|md|markdown)$/i.test(file.originalname);
      if (ALLOWED_MIME.has(file.mimetype) || (GENERIC_MIME.has(file.mimetype) && looksTextual)) {
        return cb(null, true);
      }
      return cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF, TXT or Markdown files are supported.'));
    },
  });
  return upload.single('file');
}
