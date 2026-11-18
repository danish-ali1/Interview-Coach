/** L2-normalises a vector so that cosine similarity equals the dot product. */
export function normalize(vec) {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((x) => x / norm);
}

export function dot(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function cosine(a, b) {
  return dot(normalize(a), normalize(b));
}

/** Returns the k items with the highest score, best first. */
export function topK(items, scoreFn, k) {
  return items
    .map((item) => ({ item, score: scoreFn(item) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}
