/**
 * Match discovery using pgvector cosine similarity.
 *
 * A "lost" item is matched against open "found" items (and vice versa), ranked
 * by cosine similarity of their blended CLIP embeddings, with a small bonus
 * when the two items share a category.
 *
 * Why two stages?
 *   An HNSW index can only accelerate a query of the shape
 *       ORDER BY embedding <=> $1 LIMIT n
 *   with the probe vector supplied as a parameter. Adding the category bonus
 *   into the ORDER BY (or deriving the probe vector from a join/subquery)
 *   makes the expression opaque to the index, so Postgres silently falls back
 *   to a sequential scan that reads and distances every row.
 *
 *   So: stage 1 fetches the item's embedding and passes it in as a literal
 *   vector parameter, letting the index return the K·multiplier nearest
 *   candidates; stage 2 applies the category bonus and re-ranks that small
 *   candidate set. Ranking still happens in SQL, and the expensive
 *   nearest-neighbour step stays on the index path.
 */
import { Prisma } from "@prisma/client";

import { config } from "../config";
import { prisma } from "../prisma";

export interface MatchResult {
  id: string;
  type: "lost" | "found";
  title: string;
  description: string;
  category: string;
  location: string;
  imageUrl: string | null;
  date: Date;
  status: "open" | "resolved";
  createdAt: Date;
  ownerUsername: string;
  /** Cosine similarity in 0..1 (plus the category bonus), higher = better. */
  score: number;
  /** Raw cosine similarity, before the category bonus. */
  similarity: number;
  /**
   * How far this candidate's similarity sits above the mean of the retrieved
   * candidate pool, in standard deviations. `null` when the pool is too small
   * to estimate a spread. See calibrateConfidence() for why this exists.
   */
  zScore: number | null;
  /** Calibrated 0..1 confidence for display. `null` mirrors a null zScore. */
  confidence: number | null;
}

interface RawMatchRow
  extends Omit<MatchResult, "score" | "similarity" | "zScore" | "confidence"> {
  score: number | string;
  similarity: number | string;
  zScore: number | string | null;
}

/**
 * Turn a z-score into a 0..1 confidence for the UI.
 *
 * Why not just show the raw cosine as a percentage? Because CLIP cosines are
 * not calibrated and are not comparable across modality pairs:
 *
 *   - CLIP's text encoder is anisotropic — its embeddings occupy a narrow cone,
 *     so *any* two captions score ~0.85+. Measured on this project: an
 *     unrelated "lost phone" / "found wallet" text pair scores 0.863, which the
 *     old UI rendered as "86% — Strong match".
 *   - There is a well-documented modality gap between CLIP's image and text
 *     towers, so a genuine text-to-photo match scores far lower — 0.607 for a
 *     true wallet match here, which rendered as a mere "Likely match".
 *
 * So an absolute threshold is meaningless: the same number means opposite
 * things depending on whether the two items had photos. What *is* meaningful is
 * how a candidate compares to the other candidates for the same query, since
 * they all share one probe vector and one modality mix. The ANN stage already
 * retrieves topK x multiplier rows, so that background sample is free — we
 * express each hit as a z-score against it and squash it with a logistic.
 */
export function calibrateConfidence(z: number | null): number | null {
  if (z === null || !Number.isFinite(z)) return null;
  return 1 / (1 + Math.exp(-1.6 * (z - 1.1)));
}

interface QueryItemRow {
  embedding: string | null;
  category: string;
  type: "lost" | "found";
}

/**
 * Find the top matches for an existing item, using its stored embedding.
 * Returns [] if the item does not exist or has no embedding yet.
 */
export async function findMatchesForItem(
  itemId: string,
  topK = config.match.topK,
): Promise<MatchResult[]> {
  // Stage 1 — read the probe vector. `embedding` is an Unsupported() column,
  // so it is cast to text here and back to `vector` in the query below.
  const [queryItem] = await prisma.$queryRaw<QueryItemRow[]>(Prisma.sql`
    SELECT embedding::text AS embedding, category, type
    FROM "Item"
    WHERE id = ${itemId}
  `);

  if (!queryItem?.embedding) return [];

  const bonus = config.match.categoryBonus;
  const candidates = Math.max(topK, topK * config.match.candidateMultiplier);

  // Stage 2 — index-backed ANN retrieval, then re-rank the candidates.
  const rows = await prisma.$queryRaw<RawMatchRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT
        i.id,
        i.type,
        i.title,
        i.description,
        i.category,
        i.location,
        i."imageUrl",
        i.date,
        i.status,
        i."createdAt",
        i."ownerId",
        1 - (i.embedding <=> ${queryItem.embedding}::vector) AS similarity
      FROM "Item" i
      -- Compared as text so the bound parameter needs no enum cast.
      WHERE i.type::text <> ${queryItem.type}
        AND i.status = 'open'
        AND i.embedding IS NOT NULL
        AND i.id <> ${itemId}
      ORDER BY i.embedding <=> ${queryItem.embedding}::vector
      LIMIT ${candidates}
    )
    SELECT
      c.id,
      c.type,
      c.title,
      c.description,
      c.category,
      c.location,
      c."imageUrl",
      c.date,
      c.status,
      c."createdAt",
      u.username AS "ownerUsername",
      c.similarity,
      (c.similarity + CASE WHEN c.category = ${queryItem.category} THEN ${bonus} ELSE 0 END) AS score,
      -- Calibration sample: the window covers the whole candidate pool, which
      -- is evaluated before the ORDER BY / LIMIT below, so every returned row
      -- is scored against all candidates rather than just its own top-K peers.
      CASE
        WHEN COUNT(*) OVER () >= 4 AND COALESCE(STDDEV_SAMP(c.similarity) OVER (), 0) > 1e-9
        THEN (c.similarity - AVG(c.similarity) OVER ()) / STDDEV_SAMP(c.similarity) OVER ()
        ELSE NULL
      END AS "zScore"
    FROM candidates c
    JOIN "User" u ON u.id = c."ownerId"
    ORDER BY score DESC
    LIMIT ${topK}
  `);

  return rows.map((r) => {
    const zScore = r.zScore === null ? null : Number(r.zScore);
    return {
      ...r,
      score: Number(r.score),
      similarity: Number(r.similarity),
      zScore,
      confidence: calibrateConfidence(zScore),
    };
  });
}
