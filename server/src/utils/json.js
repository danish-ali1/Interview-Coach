/**
 * Pulls a JSON object out of an LLM response. Models sometimes wrap JSON in
 * markdown fences or add a sentence before/after it even when told not to.
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty model response');
  }
  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to brace matching
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
