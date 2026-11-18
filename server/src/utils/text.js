export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const round1 = (n) => Math.round(n * 10) / 10;

export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Collapses runs of spaces/blank lines while keeping line structure (needed for section detection). */
export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Tags the prompts use to fence untrusted content. Users must not be able to close them early.
const FENCE_TAGS =
  /<\/?\s*(resume_context|job_description|candidate_answer|question|requirements|previous_questions|session_results)[^>]*>/gi;

/**
 * Cleans untrusted text (resume, job description, candidate answer) before it is placed
 * inside a prompt: strips NUL bytes and fence tags, then caps the length.
 */
export function sanitizeForPrompt(text, maxChars) {
  const cleaned = String(text ?? '').replace(/\u0000/g, '').replace(FENCE_TAGS, '');
  return truncate(cleaned, maxChars).trim();
}
