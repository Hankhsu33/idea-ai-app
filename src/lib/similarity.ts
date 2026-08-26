/**
 * Comparing CLIP vectors.
 *
 * Every vector that leaves the engine page is already L2-normalised, which is what
 * makes a dot product a cosine similarity. Nothing here re-normalises — if a vector
 * ever arrives from somewhere else, normalise it there.
 *
 * Scores land in roughly -1..1, but CLIP's useful range is much narrower than that.
 * Treat the *ranking* as the signal and the absolute number as decoration: a best
 * match at 0.28 can be perfectly correct.
 */

/** Cosine similarity of two unit vectors. */
export function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cannot compare a ${a.length}-d vector with a ${b.length}-d one`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Every candidate scored against one query vector, best first. */
export function rank<T>(query: number[], candidates: T[], vectorOf: (item: T) => number[]): Scored<T>[] {
  return candidates
    .map((item) => ({ item, score: dot(query, vectorOf(item)) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Softmax over the similarities, so a set of labels reads as percentages.
 *
 * The default temperature is CLIP's own learned logit scale of ~100 expressed as its
 * reciprocal. Using anything flatter (0.05, say) makes every label look equally likely,
 * because raw CLIP cosines only span about 0.15 apart end to end — the scale is not a
 * cosmetic knob, it is the thing that makes the numbers mean anything.
 */
export function toPercentages(scores: number[], temperature = 0.01): number[] {
  if (!scores.length) return [];
  const scaled = scores.map((s) => s / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - max));
  const total = exps.reduce((n, e) => n + e, 0) || 1;
  return exps.map((e) => e / total);
}
