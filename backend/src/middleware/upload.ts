import multer from "multer";

import { ApiError } from "../lib/errors";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Keep the file in memory so we can both hand the bytes to the embedder and
// stream them to Cloudinary / write to disk.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported image type: ${file.mimetype}`));
  },
});
