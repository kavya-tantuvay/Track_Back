/**
 * Image storage abstraction.
 *
 * If CLOUDINARY_URL is set, images are uploaded to Cloudinary and we store the
 * returned secure URL. Otherwise images are written to backend/uploads/ and
 * served by Express at /uploads/<file> — so the app works with zero external
 * accounts, then transparently "upgrades" to Cloudinary when configured.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { config } from "../config";

export const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

let cloudinaryReady = false;
let cloudinary: any = null;

if (config.cloudinaryUrl) {
  try {
    // cloudinary reads CLOUDINARY_URL from the environment automatically.
    cloudinary = require("cloudinary").v2;
    cloudinary.config({ secure: true });
    cloudinaryReady = true;
  } catch (err) {
    console.warn(`[storage] Cloudinary init failed, using local disk: ${(err as Error).message}`);
  }
}

if (!cloudinaryReady) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function storageBackend(): "cloudinary" | "local" {
  return cloudinaryReady ? "cloudinary" : "local";
}

export interface StoredImage {
  /** Public URL to display the image (absolute for Cloudinary, /uploads/... for local). */
  url: string;
  /**
   * Location the embedder can read the image from. For local storage this is an
   * absolute file path; for Cloudinary it's the same public URL.
   */
  source: string;
}

function extensionFor(mimetype: string, original: string): string {
  const fromName = path.extname(original);
  if (fromName) return fromName;
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return map[mimetype] ?? ".bin";
}

export async function storeImage(file: {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}): Promise<StoredImage> {
  if (cloudinaryReady) {
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "trackback", resource_type: "image" },
        (error: unknown, res: unknown) => (error ? reject(error) : resolve(res)),
      );
      stream.end(file.buffer);
    });
    return { url: result.secure_url, source: result.secure_url };
  }

  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extensionFor(
    file.mimetype,
    file.originalname,
  )}`;
  const abs = path.join(UPLOAD_DIR, name);
  await fs.promises.writeFile(abs, file.buffer);
  return { url: `/uploads/${name}`, source: abs };
}
