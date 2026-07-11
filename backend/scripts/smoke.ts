/**
 * End-to-end smoke test against a REAL Postgres + pgvector database.
 *
 * Boots the Express app in-process, then exercises the full flow over HTTP:
 *   register → post a found item → post a matching lost item → post an
 *   unrelated item → call the AI match endpoint → assert the genuine match is
 *   returned and outranks the unrelated one.
 *
 * Uses EMBEDDER=fallback so it's fast/deterministic and needs no model download.
 * Requires DATABASE_URL to point at a pgvector-enabled Postgres (CI provides one).
 *
 *   npm run smoke
 */
process.env.EMBEDDER = "fallback";

import type { Server } from "node:http";

import { createApp } from "../src/app";
import { bootstrapDatabase } from "../src/bootstrap";
import { prisma } from "../src/prisma";

const PORT = 4599;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`  ${cond ? "✓" : "✗ FAIL:"} ${msg}`);
  if (!cond) failures++;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body: any = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  await bootstrapDatabase();

  // Clean slate so repeated runs are deterministic.
  await prisma.item.deleteMany();
  await prisma.user.deleteMany();

  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(PORT, () => resolve(s));
  });

  try {
    console.log("1) Health");
    const health = await api("/api/health");
    check(health.status === 200 && health.body.ok === true, "GET /api/health ok");

    console.log("\n2) Auth");
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "smoke@trackback.app",
        username: "smoke_user",
        password: "password123",
      }),
    });
    check(reg.status === 201 && !!reg.body.token, "register returns a token");
    const token = reg.body.token as string;

    const me = await api("/api/auth/me", { token });
    check(me.status === 200 && me.body.user.username === "smoke_user", "GET /me returns the user");

    console.log("\n3) Post items (found wallet, lost wallet, unrelated phone)");
    const found = await api("/api/items", {
      method: "POST",
      token,
      body: JSON.stringify({
        type: "found",
        title: "Found dark leather wallet",
        description: "Found a dark brown leather bifold wallet on a bench near the library.",
        category: "wallet",
        location: "Library Gardens",
        date: new Date().toISOString(),
      }),
    });
    check(found.status === 201, "create found item → 201");

    const phone = await api("/api/items", {
      method: "POST",
      token,
      body: JSON.stringify({
        type: "found",
        title: "Found silver iPhone",
        description: "A silver Apple iPhone 13 with a cracked screen at the bus stop.",
        category: "phone",
        location: "Bus Stop 12",
        date: new Date().toISOString(),
      }),
    });
    check(phone.status === 201, "create unrelated found item → 201");

    const lost = await api("/api/items", {
      method: "POST",
      token,
      body: JSON.stringify({
        type: "lost",
        title: "Lost brown leather wallet",
        description: "Lost my brown leather wallet with cards somewhere around the library.",
        category: "wallet",
        location: "Central Library",
        date: new Date().toISOString(),
      }),
    });
    check(lost.status === 201, "create lost item → 201");
    // Matches are returned inline on creation too:
    check(Array.isArray(lost.body.matches), "creation response includes a matches array");

    console.log("\n4) AI matching (pgvector cosine ranking against real Postgres)");
    const lostId = lost.body.item.id as string;
    const foundId = found.body.item.id as string;
    const { status, body } = await api(`/api/items/${lostId}/matches`);
    check(status === 200 && Array.isArray(body.matches), "GET /items/:id/matches → 200");

    const matches: Array<{ id: string; title: string; score: number }> = body.matches;
    console.log(
      "     ranked matches:",
      matches.map((m) => `${m.title} (${m.score.toFixed(3)})`).join(" | ") || "(none)",
    );
    check(matches.length > 0, "at least one match returned");
    check(matches[0]?.id === foundId, "top match is the genuine wallet (not the phone)");

    const walletScore = matches.find((m) => m.id === foundId)?.score ?? -1;
    const phoneScore = matches.find((m) => m.id === phone.body.item.id)?.score ?? -1;
    check(walletScore > phoneScore, "wallet match scores higher than the unrelated phone");

    console.log(
      failures === 0
        ? "\nSMOKE TEST PASSED ✅  full stack (API + pgvector + matching) works end-to-end"
        : `\nSMOKE TEST FAILED ❌  ${failures} check(s) failed`,
    );
  } finally {
    server.close();
    await prisma.$disconnect();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
