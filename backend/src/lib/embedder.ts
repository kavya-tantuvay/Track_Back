/**
 * CLIP embedder.
 *
 * Primary path: @xenova/transformers runs CLIP (clip-vit-base-patch32) natively
 * in Node via ONNX — no Python, no API key. The model is downloaded once on
 * first use and cached to disk (TRANSFORMERS_CACHE).
 *
 * Fallback path: if the model fails to load or run (e.g. no network on first
 * boot), we produce a deterministic 512-dim embedding so the app still works
 * end-to-end. Fallback text embeddings use feature hashing over tokens; fallback
 * image embeddings hash the raw bytes. Same dimensionality as CLIP (512) so the
 * pgvector column and cosine math are unaffected — real CLIP just makes the
 * matches semantically meaningful.
 */
import { config } from "../config";
import { blend, normalize } from "./vector";

const DIM = config.embeddingDim;
const MODEL_ID = "Xenova/clip-vit-base-patch32";

export type EmbedderBackend = "clip" | "fallback" | "uninitialized";

let backend: EmbedderBackend = "uninitialized";
let loadPromise: Promise<void> | null = null;

// Lazily-populated transformers.js handles.
let tokenizer: any = null;
let textModel: any = null;
let processor: any = null;
let visionModel: any = null;
let RawImageRef: any = null;

export function getBackend(): EmbedderBackend {
  return backend;
}

/** Attempt to load the real CLIP model. Idempotent; safe to call repeatedly. */
async function ensureLoaded(): Promise<void> {
  if (backend === "clip" || backend === "fallback") return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Allow forcing the deterministic fallback (fast dev, offline CI, tests).
    if ((process.env.EMBEDDER ?? "").toLowerCase() === "fallback") {
      backend = "fallback";
      console.log("[embedder] EMBEDDER=fallback set — using deterministic embedder.");
      return;
    }
    try {
      // Dynamic import: @xenova/transformers is ESM-only, we are CommonJS.
      const tf: any = await import("@xenova/transformers");
      if (process.env.TRANSFORMERS_CACHE) {
        tf.env.cacheDir = process.env.TRANSFORMERS_CACHE;
      }
      const {
        AutoTokenizer,
        CLIPTextModelWithProjection,
        AutoProcessor,
        CLIPVisionModelWithProjection,
        RawImage,
      } = tf;

      [tokenizer, textModel, processor, visionModel] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
        AutoProcessor.from_pretrained(MODEL_ID),
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID),
      ]);
      RawImageRef = RawImage;
      backend = "clip";
      console.log("[embedder] CLIP model loaded — semantic matching enabled.");
    } catch (err) {
      backend = "fallback";
      console.warn(
        "[embedder] Could not load CLIP model; using deterministic fallback embedder.\n" +
          "           Matches will be low-quality until the model can be downloaded.\n" +
          `           Reason: ${(err as Error).message}`,
      );
    }
  })();

  return loadPromise;
}

/** Kick off model loading in the background at startup (non-blocking). */
export function warmup(): void {
  void ensureLoaded();
}

// --------------------------------------------------------------------------
// Real CLIP embeddings
// --------------------------------------------------------------------------

async function clipEmbedText(text: string): Promise<number[]> {
  const inputs = tokenizer(text, { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  return Array.from(text_embeds.data as Float32Array);
}

async function clipEmbedImage(source: string): Promise<number[]> {
  // source may be a local file path or an http(s) URL — RawImage.read handles both.
  const image = await RawImageRef.read(source);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  return Array.from(image_embeds.data as Float32Array);
}

// --------------------------------------------------------------------------
// Deterministic fallback embeddings
// --------------------------------------------------------------------------

function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fallbackText(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const h = hashString(tok);
    const idx = h % DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  return normalize(vec);
}

function fallbackImage(bytes: Buffer): number[] {
  const vec = new Array<number>(DIM).fill(0);
  if (bytes.length === 0) return vec;
  // Distribute byte energy across dimensions deterministically.
  for (let i = 0; i < bytes.length; i++) {
    const idx = (i * 2654435761) % DIM; // Knuth multiplicative hash
    vec[idx] += (bytes[i] - 128) / 128;
  }
  return normalize(vec);
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  await ensureLoaded();
  if (backend === "clip") {
    try {
      return await clipEmbedText(text);
    } catch (err) {
      console.warn(`[embedder] CLIP text embed failed, falling back: ${(err as Error).message}`);
    }
  }
  return fallbackText(text);
}

/**
 * Embed an image given its stored location (path or URL) and, optionally, the
 * raw bytes (used by the fallback path when CLIP is unavailable).
 */
export async function embedImage(source: string, bytes?: Buffer): Promise<number[]> {
  await ensureLoaded();
  if (backend === "clip") {
    try {
      return await clipEmbedImage(source);
    } catch (err) {
      console.warn(`[embedder] CLIP image embed failed, falling back: ${(err as Error).message}`);
    }
  }
  return fallbackImage(bytes ?? Buffer.from(source));
}

/**
 * Produce the single blended embedding stored for an item. Combines the image
 * and text vectors in CLIP space; either may be absent.
 */
export async function embedItem(params: {
  text: string;
  imageSource?: string | null;
  imageBytes?: Buffer | null;
}): Promise<number[]> {
  const { text, imageSource, imageBytes } = params;
  const [textVec, imageVec] = await Promise.all([
    text.trim() ? embedText(text) : Promise.resolve(null),
    imageSource ? embedImage(imageSource, imageBytes ?? undefined) : Promise.resolve(null),
  ]);
  return blend(imageVec, textVec);
}
