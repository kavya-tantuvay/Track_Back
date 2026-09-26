import { prisma } from "./prisma";

/**
 * Startup preflight.
 *
 * All schema DDL — tables, the `vector` extension, and the HNSW index — is
 * owned by the migrations in prisma/migrations and applied by
 * `prisma migrate deploy` during the build/release step. The server itself
 * deliberately performs no DDL at runtime: an app process that rewrites its own
 * schema on boot races with every other replica and hides failed deploys.
 *
 * What we do here instead is verify that the deploy actually happened, fail
 * fast if the database is unreachable, and warn loudly if the ANN index is
 * missing (matching would still work, but via a sequential scan).
 */
export async function bootstrapDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new Error(
      `Cannot reach the database. Check DATABASE_URL.\nReason: ${(err as Error).message}`,
    );
  }

  const [{ present: hasVector }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS present
  `;
  if (!hasVector) {
    throw new Error(
      "The pgvector extension is not installed on this database. " +
        "Run `npx prisma migrate deploy` (it issues CREATE EXTENSION vector), " +
        "or enable pgvector on your provider first.",
    );
  }

  const [{ present: hasIndex }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'Item' AND indexname = 'item_embedding_hnsw'
    ) AS present
  `;
  if (!hasIndex) {
    console.warn(
      "[bootstrap] HNSW index 'item_embedding_hnsw' is missing — match queries " +
        "will fall back to a sequential scan. Run `npx prisma migrate deploy`.",
    );
  }
}
