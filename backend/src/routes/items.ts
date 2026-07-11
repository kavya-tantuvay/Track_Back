import { Router } from "express";

import { ApiError, asyncHandler } from "../lib/errors";
import { embedItem } from "../lib/embedder";
import { storeImage } from "../lib/storage";
import { createItemSchema, listItemsSchema } from "../lib/validation";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { upload } from "../middleware/upload";
import { findMatchesForItem } from "../services/matching";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  setStatus,
} from "../services/items";

const router = Router();

/** POST /api/items — report a lost or found item (auth required). */
router.post(
  "/",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const input = createItemSchema.parse(req.body);

    // 1. Store the image (Cloudinary or local disk), if provided.
    let imageUrl: string | null = null;
    let imageSource: string | null = null;
    if (req.file) {
      const stored = await storeImage(req.file);
      imageUrl = stored.url;
      imageSource = stored.source;
    }

    // 2. Compute the blended CLIP embedding (image + text).
    const embedding = await embedItem({
      text: `${input.title}. ${input.description}. Category: ${input.category}.`,
      imageSource,
      imageBytes: req.file?.buffer ?? null,
    });

    // 3. Persist the item + embedding.
    const item = await createItem({
      ownerId: req.userId!,
      input,
      imageUrl,
      embedding,
    });

    // 4. Immediately surface likely matches from the opposite pool.
    const matches = await findMatchesForItem(item.id);

    res.status(201).json({ item, matches });
  }),
);

/** GET /api/items — browse/search listings (public; `mine` needs auth). */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = listItemsSchema.parse(req.query);
    const result = await listItems(query, req.userId);
    res.json(result);
  }),
);

/** GET /api/items/:id — item detail. */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const item = await getItem(req.params.id);
    if (!item) throw ApiError.notFound("Item not found");
    res.json({ item });
  }),
);

/** GET /api/items/:id/matches — AI match suggestions for an item. */
router.get(
  "/:id/matches",
  asyncHandler(async (req, res) => {
    const item = await getItem(req.params.id);
    if (!item) throw ApiError.notFound("Item not found");
    const topK = req.query.topK ? Math.min(Number(req.query.topK) || 5, 20) : undefined;
    const matches = await findMatchesForItem(item.id, topK);
    res.json({ matches });
  }),
);

/** PATCH /api/items/:id — mark resolved/open (owner only). */
router.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await getItem(req.params.id);
    if (!item) throw ApiError.notFound("Item not found");
    if (item.ownerId !== req.userId) throw ApiError.forbidden("You don't own this item");

    const status = req.body?.status;
    if (status !== "open" && status !== "resolved") {
      throw ApiError.badRequest("status must be 'open' or 'resolved'");
    }
    const updated = await setStatus(item.id, status);
    res.json({ item: updated });
  }),
);

/** DELETE /api/items/:id — remove a listing (owner only). */
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await getItem(req.params.id);
    if (!item) throw ApiError.notFound("Item not found");
    if (item.ownerId !== req.userId) throw ApiError.forbidden("You don't own this item");
    await deleteItem(item.id);
    res.status(204).end();
  }),
);

export default router;
