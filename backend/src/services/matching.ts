/**
 * Match discovery using pgvector cosine similarity.
 *
 * A "lost" item is matched against "open" "found" items (and vice versa),
 * ranked by cosine similarity of their blended CLIP embeddings. Items in the
 * same category get a small score bonus. All ranking happens in Postgres via
 * the `<=>` (cosine distance) operator so it stays fast as data grows.
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
  /** 0..~1 cosine similarity (plus category bonus), higher = better. */
  score: number;
}

interface RawMatchRow extends Omit<MatchResult, "score"> {
  score: number | string;
}

/**
 * Find the top matches for an existing item, using its stored embedding.
 * Returns [] if the item has no embedding yet.
 */
export async function findMatchesForItem(itemId: string, topK = config.match.topK): Promise<MatchResult[]> {
  const bonus = config.match.categoryBonus;

  const rows = await prisma.$queryRaw<RawMatchRow[]>(Prisma.sql`
    WITH q AS (
      SELECT embedding, category, type
      FROM "Item"
      WHERE id = ${itemId}
    )
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
      u.username AS "ownerUsername",
      (1 - (i.embedding <=> q.embedding)
        + CASE WHEN i.category = q.category THEN ${bonus} ELSE 0 END) AS score
    FROM "Item" i
    JOIN "User" u ON u.id = i."ownerId"
    CROSS JOIN q
    WHERE i.type <> q.type
      AND i.status = 'open'
      AND i.embedding IS NOT NULL
      AND q.embedding IS NOT NULL
      AND i.id <> ${itemId}
    ORDER BY score DESC
    LIMIT ${topK}
  `);

  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}
