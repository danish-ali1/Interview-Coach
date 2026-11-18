/**
 * Resume-aware chunking.
 *
 * Generic "split every 500 characters" chunkers cut projects in half and lose which part of the
 * resume a passage came from. Here we first split by resume section (experience, projects, skills...)
 * and only then pack paragraphs inside each section up to a size limit. Each chunk keeps its
 * section name, which is later used both for embedding context and for "based on your resume" citations.
 */

const SECTION_RULES = [
  ['summary', /^(professional |career )?(summary|profile|objective|about( me)?)$/],
  ['experience', /^(work |professional |relevant )?(experience|employment( history)?|work history|internships?)$/],
  ['projects', /^((personal|academic|key|selected|side|notable) )?projects?( (and|&) .+)?$/],
  ['skills', /^((technical|core|key) )?(skills|technologies|tech stack)( (and|&) tools)?$/],
  ['education', /^(education|educational background|academics|academic background|qualifications)$/],
  ['certifications', /^(certifications?|licenses( (and|&) certifications)?|courses)$/],
  ['achievements', /^(achievements?|awards?( (and|&) honou?rs)?|honou?rs|accomplishments|extracurriculars?|activities)$/],
];

/** Returns the section name if the line is a resume heading, otherwise null. */
export function detectSection(line) {
  const cleaned = line
    .trim()
    .replace(/^[#*\-–—_•\s]+/, '')
    .replace(/[:\-–—_*#|•\s]+$/, '')
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned.length > 40) return null;
  for (const [name, pattern] of SECTION_RULES) {
    if (pattern.test(cleaned)) return name;
  }
  return null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}|\+?\d{2}[\s-]?\d{5}[\s-]?\d{5}/g;

/** Contact details are not needed to ask interview questions, so they never reach the AI provider. */
export function redactContactInfo(text) {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

function splitIntoSections(text) {
  const sections = [];
  let current = { name: 'header', lines: [] };
  for (const line of text.split('\n')) {
    const heading = detectSection(line);
    if (heading) {
      if (current.lines.some((l) => l.trim())) sections.push(current);
      current = { name: heading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);
  return sections.map((s) => ({ name: s.name, body: s.lines.join('\n').trim() }));
}

/** Splits one oversized block on line/sentence boundaries, hard-cutting only as a last resort. */
function splitLong(unit, maxChars) {
  if (unit.length <= maxChars) return [unit];
  const byLines = unit.includes('\n');
  const separator = byLines ? '\n' : ' ';
  const pieces = byLines ? unit.split('\n') : unit.split(/(?<=[.!?])\s+/);

  const parts = [];
  let buffer = '';
  for (const piece of pieces) {
    if (piece.length > maxChars) {
      if (buffer) parts.push(buffer);
      buffer = '';
      for (let i = 0; i < piece.length; i += maxChars) parts.push(piece.slice(i, i + maxChars));
      continue;
    }
    const next = buffer ? `${buffer}${separator}${piece}` : piece;
    if (next.length > maxChars) {
      parts.push(buffer);
      buffer = piece;
    } else {
      buffer = next;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

function packSection(body, maxChars, minChars) {
  const units = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, maxChars));

  const chunks = [];
  let buffer = '';
  for (const unit of units) {
    const next = buffer ? `${buffer}\n\n${unit}` : unit;
    if (next.length > maxChars && buffer) {
      chunks.push(buffer);
      buffer = unit;
    } else {
      buffer = next;
    }
  }
  if (buffer) chunks.push(buffer);

  // Fold a tiny trailing fragment into the previous chunk instead of embedding it alone.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < minChars) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n${tail}`;
  }
  return chunks;
}

export function chunkResume(text, { maxChars = 900, minChars = 120, maxChunks = 60 } = {}) {
  const safeText = redactContactInfo(text);
  const chunks = [];
  for (const section of splitIntoSections(safeText)) {
    for (const piece of packSection(section.body, maxChars, minChars)) {
      chunks.push({ section: section.name, text: piece });
    }
  }
  return chunks.slice(0, maxChunks).map((chunk, index) => ({ index, ...chunk }));
}
