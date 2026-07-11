import { config } from "../config";

/** L2-normalize a vector in place-safe manner (returns a new array). */
export function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

/** Cosine similarity of two equal-length vectors (assumes finite numbers). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Blend an image vector and a text vector into one representation living in the
 * shared CLIP space. Each component is normalized, weighted, summed, then the
 * result is re-normalized. Missing components are simply skipped (so a text-only
 * item still produces a valid vector that can match an image-only item — the
 * cross-modal magic of CLIP).
 */
export function blend(imageVec: number[] | null, textVec: number[] | null): number[] {
  const dim = config.embeddingDim;
  const out = new Array<number>(dim).fill(0);
  const parts: Array<{ vec: number[]; weight: number }> = [];
  if (imageVec) parts.push({ vec: normalize(imageVec), weight: config.match.imageWeight });
  if (textVec) parts.push({ vec: normalize(textVec), weight: config.match.textWeight });
  if (parts.length === 0) return out; // zero vector — never matched

  for (const { vec, weight } of parts) {
    for (let i = 0; i < dim; i++) out[i] += (vec[i] ?? 0) * weight;
  }
  return normalize(out);
}

/** Format a JS number array as a pgvector literal: "[0.1,0.2,...]". */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
