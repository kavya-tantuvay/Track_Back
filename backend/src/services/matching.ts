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
}

interface RawMatchRow extends Omit<MatchResult, "score" | "similarity"> {
  score: number | string;
  similarity: number | string;
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
      (c.similarity + CASE WHEN c.category = ${queryItem.category} THEN ${bonus} ELSE 0 END) AS score
    FROM candidates c
    JOIN "User" u ON u.id = c."ownerId"
    ORDER BY score DESC
    LIMIT ${topK}
  `);

  return rows.map((r) => ({
    ...r,
    score: Number(r.score),
    similarity: Number(r.similarity),
  }));
}
