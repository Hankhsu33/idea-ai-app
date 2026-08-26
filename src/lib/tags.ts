import AsyncStorage from '@react-native-async-storage/async-storage';

import { prepareForEmbedding } from './imagePrep';
import type { EmbeddingPayload } from './types';

/**
 * Turning a CLIP vector into words.
 *
 * The labels are fixed and their vectors never change, so they are computed once and
 * kept. That matters more than it looks: embedding an image needs the 11 MB image
 * encoder, but embedding a *label* needs the 42 MB text one. Caching the label vectors
 * means the text encoder is downloaded once on this device and then only for
 * free-text search.
 */

export interface Label {
  /** What the user sees. */
  name: string;
  /** What CLIP sees. Phrased as a caption, because that is what it was trained on. */
  prompt: string;
}

/**
 * The subject axis: what the picture is *of*.
 *
 * Deliberately broad and mutually distinguishable. CLIP scores every label against
 * every image, so a label that overlaps another ("animal" next to "dog") splits the
 * score between them and neither wins cleanly.
 */
export const LABELS: Label[] = [
  { name: 'person', prompt: 'a photo of a person' },
  { name: 'dog', prompt: 'a photo of a dog' },
  { name: 'cat', prompt: 'a photo of a cat' },
  { name: 'food', prompt: 'a photo of food on a plate' },
  { name: 'drink', prompt: 'a photo of a drink in a glass or cup' },
  { name: 'car', prompt: 'a photo of a car' },
  { name: 'building', prompt: 'a photo of a building' },
  { name: 'plant', prompt: 'a photo of a plant or flower' },
  { name: 'landscape', prompt: 'a photo of a landscape' },
  { name: 'clothing', prompt: 'a photo of a piece of clothing' },
  { name: 'shoe', prompt: 'a photo of a shoe' },
  { name: 'furniture', prompt: 'a photo of a piece of furniture' },
  { name: 'product', prompt: 'a product photo on a plain background' },
  { name: 'screenshot', prompt: 'a screenshot of a user interface' },
  { name: 'document', prompt: 'a photo of text or a document' },
  { name: 'toy', prompt: 'a photo of a toy' },
];

/**
 * Extra axes, scored against the same image vector.
 *
 * CLIP cannot write a sentence — it has no decoder, only the ability to say how close
 * an image is to text you hand it. So a description is assembled rather than generated:
 * ask several narrow questions, keep the answers the model is sure about, and template
 * them together. It costs nothing per image, because the image is embedded once and
 * every axis is a dot product against that one vector.
 */
export const SHOTS: Label[] = [
  { name: 'a close-up', prompt: 'a close-up photo of a face' },
  { name: 'a portrait', prompt: 'a portrait photo of a person from the waist up' },
  { name: 'a full-body shot', prompt: 'a full-body photo of a person standing' },
  { name: 'a wide shot', prompt: 'a wide photo of a large scene' },
];

export const SETTINGS: Label[] = [
  { name: 'indoors', prompt: 'a photo taken indoors, inside a room' },
  { name: 'outdoors', prompt: 'a photo taken outdoors, outside in daylight' },
  { name: 'at night', prompt: 'a photo taken at night in the dark' },
  { name: 'on a plain background', prompt: 'a photo of an object on a plain studio background' },
];

/**
 * Everything embedded in one batch, in a fixed order.
 *
 * Order is the contract: the cache stores a flat array of vectors and every axis reads
 * its own slice back out by offset.
 */
const AXES: { labels: Label[]; offset: number }[] = [];
let cursor = 0;
for (const labels of [LABELS, SHOTS, SETTINGS]) {
  AXES.push({ labels, offset: cursor });
  cursor += labels.length;
}
const [SUBJECT_AXIS, SHOT_AXIS, SETTING_AXIS] = AXES;

const ALL_PROMPTS: string[] = [...LABELS, ...SHOTS, ...SETTINGS].map((l) => l.prompt);

/** Bumped whenever the prompts or the model change, so stale vectors are recomputed. */
const CACHE_KEY = 'bgone.labelVectors.v2';

interface Cached {
  /** Guards against a cache written for a different label set. */
  prompts: string[];
  vectors: number[][];
}

/**
 * Rounded before storing.
 *
 * Sixteen 512-float vectors is ~120 KB of JSON at full precision and about half that
 * at five decimals. The difference is far below what changes a ranking.
 */
function shrink(vectors: number[][]): number[][] {
  return vectors.map((v) => v.map((n) => Math.round(n * 1e5) / 1e5));
}

let memo: number[][] | null = null;

/**
 * Label vectors, from memory, then disk, then the model.
 *
 * `embed` is `engine.embedText` — passed in rather than imported so this stays a plain
 * module with no React dependency.
 */
export async function ensureLabelVectors(
  embed: (texts: string[]) => Promise<EmbeddingPayload>
): Promise<number[][]> {
  if (memo) return memo;

  const prompts = ALL_PROMPTS;

  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as Cached;
      const sameLabels =
        Array.isArray(cached?.vectors) &&
        cached.vectors.length === prompts.length &&
        cached.prompts?.length === prompts.length &&
        cached.prompts.every((p, i) => p === prompts[i]);
      if (sameLabels) {
        memo = cached.vectors;
        return memo;
      }
    }
  } catch {
    // A damaged cache is not worth reporting — recomputing costs one forward pass.
  }

  const result = await embed(prompts);
  const vectors = shrink(result.vectors);
  memo = vectors;

  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ prompts, vectors } satisfies Cached)).catch(
    () => {
      /* the vectors are already in memory; persisting is an optimisation */
    }
  );

  return vectors;
}

/**
 * The labels that best describe one image vector, best first.
 *
 * Both sides are unit vectors, so the dot product is the cosine similarity — but a raw
 * cosine is the wrong thing to threshold on. CLIP's similarities live in a narrow band
 * (roughly 0.15–0.30 for everything, related or not), so a fixed gap like "within 0.02
 * of the winner" is inside the noise and lets a portrait be called a dog.
 *
 * CLIP was trained with a learned logit scale of ~100, and that scale is what turns
 * those crowded cosines into a decision. At 100, a 0.02 gap becomes 2 logits, which is
 * roughly a sevenfold difference in probability — so the softmax below separates what
 * the raw scores could not.
 *
 * The winner is always kept, however unsure the model is: an image that resists every
 * label still gets the closest word rather than nothing.
 *
 * `top` defaults to 1. A second label is only ever as good as the gap behind the first,
 * and on a 16-way list that gap is usually noise — one confident word reads better than
 * three hedged ones. Raise it and `minShare` decides who else earns a place.
 */
export const LOGIT_SCALE = 100;

export function tagsFor(
  embedding: number[],
  labelVectors: number[][],
  { top = 1, minShare = 0.15 }: { top?: number; minShare?: number } = {}
): string[] {
  if (!embedding.length || !labelVectors.length) return [];

  const ranked = scoreAxis(embedding, labelVectors, SUBJECT_AXIS);

  return ranked
    .slice(0, top)
    .filter((entry, i) => i === 0 || entry.share >= minShare)
    .map((entry) => entry.name);
}

interface Ranked {
  name: string;
  /** Share of the softmax mass on this axis, at CLIP's own logit scale. */
  share: number;
}

/** One axis scored against an image vector, best first. */
function scoreAxis(
  embedding: number[],
  labelVectors: number[][],
  axis: { labels: Label[]; offset: number }
): Ranked[] {
  const scored = axis.labels.map((label, i) => {
    const vector = labelVectors[axis.offset + i];
    let sum = 0;
    for (let j = 0; j < vector.length; j++) sum += vector[j] * embedding[j];
    return { name: label.name, score: sum };
  });

  scored.sort((a, b) => b.score - a.score);

  const max = scored[0].score * LOGIT_SCALE;
  const exps = scored.map((entry) => Math.exp(entry.score * LOGIT_SCALE - max));
  const total = exps.reduce((n, e) => n + e, 0) || 1;

  return scored.map((entry, i) => ({ name: entry.name, share: exps[i] / total }));
}

/**
 * A sentence assembled from several axes.
 *
 * Each axis only contributes while the model is actually sure of it — an image where
 * "indoors" and "outdoors" are a coin toss says neither, which is the difference
 * between a description and a guess dressed up as one. The subject is always named,
 * because a description with no noun in it is worthless.
 */
export function captionFor(
  embedding: number[],
  labelVectors: number[][],
  { confidence = 0.55 }: { confidence?: number } = {}
): string {
  if (!embedding.length || !labelVectors.length) return '';

  const subject = scoreAxis(embedding, labelVectors, SUBJECT_AXIS)[0];
  const shot = scoreAxis(embedding, labelVectors, SHOT_AXIS)[0];
  const setting = scoreAxis(embedding, labelVectors, SETTING_AXIS)[0];

  const opening = shot.share >= confidence ? shot.name : 'a photo';
  const sentence = `${opening} of ${article(subject.name)}`;

  return setting.share >= confidence ? `${sentence}, ${setting.name}` : sentence;
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * The two engine calls this module needs.
 *
 * Passed in rather than imported so `tags.ts` never has to reach into React context —
 * which is also what lets the same routine run from the Create screen and the viewer.
 */
export interface Embedder {
  embedImage(imageBase64: string, mimeType: string): Promise<EmbeddingPayload>;
  embedText(texts: string[]): Promise<EmbeddingPayload>;
}

/**
 * Describe one saved cutout and persist what was found.
 *
 * `source` is the picture to read, which is not always the cutout itself. CLIP was
 * trained on ordinary photographs, and a subject floating on the flat background left
 * behind by matting is well outside that — the Create screen therefore describes the
 * original the user picked, and only a backfill from the gallery, where the original is
 * long gone, falls back to the cutout.
 *
 * Stages on purpose. The embedding is written the moment it exists, before any attempt
 * to name it: an image with a vector is already searchable, and naming needs a second,
 * much larger encoder that is the likeliest thing to fail or be interrupted. A caller
 * that only gets as far as the vector has still made progress worth keeping.
 */
export async function describeImage(
  embedder: Embedder,
  source: { uri: string; width: number; height: number }
): Promise<{ embedding: number[]; tags: string[]; caption: string }> {
  const base64 = await prepareForEmbedding(source.uri, source.width, source.height);
  const image = await embedder.embedImage(base64, 'image/jpeg');
  const embedding = image.vectors[0];

  const labelVectors = await ensureLabelVectors(embedder.embedText);
  const tags = tagsFor(embedding, labelVectors);
  const caption = captionFor(embedding, labelVectors);

  return { embedding, tags, caption };
}
