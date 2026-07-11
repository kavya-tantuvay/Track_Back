import { Router } from "express";

import { CATEGORIES } from "../config";
import { getBackend } from "../lib/embedder";
import { asyncHandler } from "../lib/errors";
import { storageBackend } from "../lib/storage";
import { countsByType } from "../services/items";

const router = Router();

/** GET /api/meta — categories, backend info, and live counts (for the dashboard). */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const stats = await countsByType();
    res.json({
      categories: CATEGORIES,
      embedder: getBackend(), // "clip" | "fallback" | "uninitialized"
      storage: storageBackend(), // "cloudinary" | "local"
      stats,
    });
  }),
);

export default router;
