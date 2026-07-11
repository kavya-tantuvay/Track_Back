import { prisma } from "./prisma";

/**
 * One-time database preparation performed at startup:
 *  - ensure the pgvector extension exists (idempotent),
 *  - create an HNSW index on the embedding column for fast cosine search.
 *
 * `prisma db push` creates the extension too (via the schema's `extensions`),
 * but doing it here as well means a freshly-provisioned DB works even if push
 * couldn't create the extension (insufficient privileges are surfaced clearly).
 */
export async function bootstrapDatabase() {
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch (err) {
    console.warn(
      "[bootstrap] Could not create the 'vector' extension automatically. " +
        "Run `CREATE EXTENSION vector;` on your database (Neon: enabled by default).\n" +
        `           Reason: ${(err as Error).message}`,
    );
  }

  try {
    // HNSW gives fast approximate cosine search; harmless on small datasets.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS item_embedding_hnsw
       ON "Item" USING hnsw (embedding vector_cosine_ops)`,
    );
  } catch (err) {
    // Index is an optimization; the app works (seq scan) without it.
    console.warn(`[bootstrap] Skipped embedding index: ${(err as Error).message}`);
  }
}
