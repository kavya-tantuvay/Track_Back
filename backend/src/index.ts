import { createApp } from "./app";
import { bootstrapDatabase } from "./bootstrap";
import { config } from "./config";
import { warmup } from "./lib/embedder";
import { prisma } from "./prisma";

async function main() {
  await bootstrapDatabase();

  // Begin downloading/loading the CLIP model in the background so the first
  // real request isn't blocked on it.
  warmup();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`\n🧭  TrackBack API listening on http://localhost:${config.port}`);
    console.log(`    Health:  http://localhost:${config.port}/api/health`);
    console.log(`    CORS:    ${config.corsOrigins.join(", ")}\n`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down.`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
