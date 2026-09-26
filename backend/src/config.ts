import dotenv from "dotenv";

dotenv.config();

const isProduction = (process.env.NODE_ENV ?? "development") === "production";

/**
 * Read an env var. In production a `devFallback` is NOT accepted: a missing
 * value throws at boot instead of silently starting with an insecure default.
 * Failing fast at startup beats discovering a placeholder JWT secret in prod.
 */
function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (isProduction) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "It must be set explicitly when NODE_ENV=production.",
    );
  }
  return devFallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rawCorsOrigin = (process.env.CORS_ORIGIN ?? "http://localhost:5173").trim();
// "*" means "reflect any origin". The cors package compares an array of origins
// by exact string match, so a literal "*" entry would match nothing and silently
// block every browser request — it has to become `true` instead.
const allowAllOrigins = rawCorsOrigin === "*";

export const config = {
  isProduction,
  port: num("PORT", 4000),
  databaseUrl: required("DATABASE_URL", "postgresql://trackback:trackback@localhost:5432/trackback"),

  jwtSecret: required("JWT_SECRET", "dev-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  allowAllOrigins,
  corsOrigins: allowAllOrigins
    ? []
    : rawCorsOrigin
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),

  // Cloudinary: single-URL form. If absent, we fall back to local disk storage.
  cloudinaryUrl: process.env.CLOUDINARY_URL,

  embeddingDim: 512,
  match: {
    imageWeight: num("MATCH_IMAGE_WEIGHT", 0.6),
    textWeight: num("MATCH_TEXT_WEIGHT", 0.4),
    categoryBonus: num("MATCH_CATEGORY_BONUS", 0.05),
    topK: num("MATCH_TOP_K", 5),
    // Approximate-nearest-neighbour candidates fetched from the HNSW index
    // before the category bonus is applied and the list is re-ranked.
    candidateMultiplier: num("MATCH_CANDIDATE_MULTIPLIER", 6),
  },
} as const;

export const CATEGORIES = [
  "electronics",
  "phone",
  "laptop",
  "wallet",
  "keys",
  "bag",
  "jewelry",
  "clothing",
  "documents",
  "pet",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];
