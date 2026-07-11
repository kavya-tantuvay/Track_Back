import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num("PORT", 4000),
  databaseUrl: required("DATABASE_URL", "postgresql://trackback:trackback@localhost:5432/trackback"),

  jwtSecret: required("JWT_SECRET", "dev-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
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
