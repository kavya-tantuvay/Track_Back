import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { config } from "./config";
import { UPLOAD_DIR } from "./lib/storage";
import { asyncHandler } from "./lib/errors";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { requestLogger } from "./middleware/logging";
import { prisma } from "./prisma";
import authRoutes from "./routes/auth";
import itemRoutes from "./routes/items";
import metaRoutes from "./routes/meta";

export function createApp() {
  const app = express();

  // Render/Vercel/Fly put the app behind a proxy; without this Express sees the
  // proxy's IP, which would make per-IP rate limiting useless.
  app.set("trust proxy", 1);

  // Baseline security headers. crossOriginResourcePolicy is relaxed so locally
  // stored images under /uploads can be rendered by the frontend's origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  app.use(
    cors({
      origin: config.allowAllOrigins ? true : config.corsOrigins,
      credentials: true,
    }),
  );

  // Bounded body sizes — image uploads go through multer, not these parsers.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));

  app.use(requestLogger);

  // Login/register hit bcrypt, which is deliberately slow, so they are the
  // natural target for credential stuffing. Tight budget on the auth routes,
  // a looser one everywhere else.
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many authentication attempts, please try again later." },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests, please slow down." },
    }),
  );

  // Serve locally-stored uploads (no-op when Cloudinary is configured).
  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));

  // Liveness: is the process up? Cheap, no dependencies.
  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "trackback" }));

  // Readiness: can we actually serve traffic (i.e. is the database reachable)?
  // This is what a platform health check should poll — a process that is alive
  // but cannot reach Postgres should not receive traffic.
  app.get(
    "/api/ready",
    asyncHandler(async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ ok: true, db: "up" });
      } catch (err) {
        res.status(503).json({ ok: false, db: "down", error: (err as Error).message });
      }
    }),
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/items", itemRoutes);
  app.use("/api/meta", metaRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
