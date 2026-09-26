-- Approximate-nearest-neighbour index for match lookups.
--
-- vector_cosine_ops matches the `<=>` (cosine distance) operator used by
-- src/services/matching.ts. Without this index every match query would distance
-- every row in "Item"; with it, Postgres walks the HNSW graph instead.
--
-- Prisma cannot express an HNSW index in schema.prisma (the column is an
-- Unsupported("vector(512)") type), so it lives in plain SQL here and is
-- applied by `prisma migrate deploy` like any other migration.
CREATE INDEX IF NOT EXISTS "item_embedding_hnsw"
  ON "Item" USING hnsw (embedding vector_cosine_ops);
