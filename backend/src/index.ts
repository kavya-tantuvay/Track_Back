import { createApp } from "./app";
import { bootstrapDatabase } from "./bootstrap";
import { config } from "./config";
import { warmup } from "./lib/embedder";
import { storageBackend } from "./lib/storage";
import { prisma } from "./prisma";

async function main() {
  await bootstrapDatabase();

  // Begin downloading/loading the CLIP model in the background so the first
  // real request isn't blocked on it.
  warmup();

  if (config.isProduction && storageBackend() === "local") {
    console.warn(
      "[startup] No CLOUDINARY_URL set — uploads are written to the container's " +
        "local disk, which most PaaS filesystems discard on restart/redeploy. " +
        "Set CLOUDINARY_URL for durable image hosting in production.",
    );
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`\n🧭  TrackBack API listening on port ${config.port}`);
    console.log(`    Health:  /api/health   Ready: /api/ready`);
    console.log(`    CORS:    ${config.allowAllOrigins ? "* (any origin)" : config.corsOrigins.join(", ")}`);
    console.log(`    Storage: ${storageBackend()}\n`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down.`);
    // Stop accepting new connections, then let in-flight requests finish before
    // closing the database pool. Falls back to a hard exit if that takes too long.
    const forceExit = setTimeout(() => {
      console.warn("Graceful shutdown timed out — exiting.");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
