/**
 * Seed script: creates a demo user and a handful of lost/found items so the
 * matching feature has something to show immediately.
 *
 *   npm run db:seed
 *
 * Safe to re-run: it upserts the demo user and skips if items already exist.
 */
import bcrypt from "bcryptjs";

import { bootstrapDatabase } from "./bootstrap";
import { embedItem } from "./lib/embedder";
import { toPgVector } from "./lib/vector";
import { prisma } from "./prisma";

const DEMO = { email: "demo@trackback.app", username: "demo", password: "password123" };

const SAMPLE_ITEMS: Array<{
  type: "lost" | "found";
  title: string;
  description: string;
  category: string;
  location: string;
  daysAgo: number;
}> = [
  {
    type: "lost",
    title: "Black leather wallet",
    description: "Slim black bifold wallet with a few cards and a train pass. Lost near the library.",
    category: "wallet",
    location: "Central Library",
    daysAgo: 3,
  },
  {
    type: "found",
    title: "Dark wallet found on bench",
    description: "Found a small dark leather wallet on a bench outside the library. Has some cards inside.",
    category: "wallet",
    location: "Library Gardens",
    daysAgo: 2,
  },
  {
    type: "lost",
    title: "Silver iPhone 13",
    description: "Silver Apple iPhone 13 with a clear case and a cracked top-left corner.",
    category: "phone",
    location: "Bus Stop 12",
    daysAgo: 5,
  },
  {
    type: "found",
    title: "Apple phone handed to reception",
    description: "Someone handed in a silvery Apple smartphone in a transparent case. Screen slightly cracked.",
    category: "phone",
    location: "Student Center Reception",
    daysAgo: 1,
  },
  {
    type: "found",
    title: "Set of keys with blue tag",
    description: "Bunch of keys with a blue plastic keychain tag found in the parking lot.",
    category: "keys",
    location: "Lot B",
    daysAgo: 4,
  },
];

async function main() {
  await bootstrapDatabase();

  const passwordHash = await bcrypt.hash(DEMO.password, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO.email },
    update: {},
    create: { email: DEMO.email, username: DEMO.username, password: passwordHash },
  });

  const existing = await prisma.item.count({ where: { ownerId: user.id } });
  if (existing > 0) {
    console.log(`Seed: demo user already has ${existing} items — skipping item creation.`);
    return;
  }

  for (const s of SAMPLE_ITEMS) {
    const date = new Date(Date.now() - s.daysAgo * 24 * 60 * 60 * 1000);
    const item = await prisma.item.create({
      data: {
        ownerId: user.id,
        type: s.type,
        title: s.title,
        description: s.description,
        category: s.category,
        location: s.location,
        date,
      },
    });
    const embedding = await embedItem({
      text: `${s.title}. ${s.description}. Category: ${s.category}.`,
    });
    await prisma.$executeRaw`
      UPDATE "Item" SET embedding = ${toPgVector(embedding)}::vector WHERE id = ${item.id}
    `;
    console.log(`  + ${s.type.padEnd(5)}  ${s.title}`);
  }

  console.log(`\nSeed complete. Login with  ${DEMO.username} / ${DEMO.password}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
