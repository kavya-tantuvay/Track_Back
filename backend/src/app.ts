import cors from "cors";
import express from "express";

import { config } from "./config";
import { UPLOAD_DIR } from "./lib/storage";
import { errorHandler, notFoundHandler } from "./middleware/error";
import authRoutes from "./routes/auth";
import itemRoutes from "./routes/items";
import metaRoutes from "./routes/meta";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve locally-stored uploads (no-op when Cloudinary is configured).
  app.use("/uploads", express.static(UPLOAD_DIR));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "trackback" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/items", itemRoutes);
  app.use("/api/meta", metaRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
