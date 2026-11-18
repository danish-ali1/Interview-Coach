import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../utils/AppError.js';
import { normalizeWhitespace } from '../utils/text.js';

const MAX_CHARS = 30_000;
const MIN_CHARS = 200;
const MAX_PDF_PAGES = 10;
const PDF_TIMEOUT_MS = 15_000;

/** Decides the real file type from its bytes, not from what the browser claimed. */
export function detectKind(buffer, { mimetype = '', originalname = '' } = {}) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 2048).includes(0)) return null; // NUL bytes: binary, not text
  if (/\.(txt|md|markdown)$/i.test(originalname) || mimetype.startsWith('text/')) return 'text';
  return null;
}

const unreadable = () =>
  new AppError(422, 'RESUME_UNREADABLE', 'We could not read this PDF. It may be corrupted or damaged.');

/**
 * Extracts text with Mozilla's pdf.js (the engine inside Firefox).
 *
 * Why not the popular `pdf-parse` package? Its bundled pdf.js (2018) keeps global state between
 * calls: in a long-running server, parsing one PDF made later, different, perfectly valid PDFs fail
 * with "bad XRef entry". That only shows up under real traffic, never in a one-file test.
 *
 * Hardening: the input is copied (pdf.js detaches the buffer it is given), `eval`-based font
 * handling is disabled, only the first MAX_PDF_PAGES pages are read, and the whole operation has
 * a hard timeout so a crafted file cannot hang a request.
 */
async function extractPdfText(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('PDF parsing timed out'), { name: 'PdfTimeout' })), PDF_TIMEOUT_MS);
  });

  try {
    return await Promise.race([readPages(task), timeout]);
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new AppError(422, 'RESUME_PASSWORD_PROTECTED', 'This PDF is password protected. Remove the password and upload it again.');
    }
    if (err instanceof AppError) throw err;
    throw unreadable();
  } finally {
    clearTimeout(timer);
    // Releases the worker and memory; swallow errors, the outcome is already decided.
    await task.destroy().catch(() => {});
  }
}

async function readPages(task) {
  const doc = await task.promise;
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);
  let text = '';

  for (let pageNumber = 1; pageNumber <= pageCount && text.length < MAX_CHARS; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      // hasEOL marks the end of a visual line; keeping line breaks is what lets the chunker
      // find section headings such as "EXPERIENCE" on a line of their own.
      text += item.hasEOL ? `${item.str}\n` : item.str;
    }
    text += '\n\n';
    page.cleanup();
  }
  return text;
}

export async function extractResumeText(file) {
  const kind = detectKind(file.buffer, file);
  if (!kind) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The file does not look like a PDF or a plain-text document.');
  }

  const raw = kind === 'pdf' ? await extractPdfText(file.buffer) : file.buffer.toString('utf8');

  const text = normalizeWhitespace(raw).slice(0, MAX_CHARS);
  if (text.length < MIN_CHARS) {
    throw new AppError(
      422,
      'RESUME_TOO_SHORT',
      'We could not find enough text in this file. Scanned or image-only PDFs are not supported; upload a text-based PDF or a .txt file.',
    );
  }
  return text;
}
