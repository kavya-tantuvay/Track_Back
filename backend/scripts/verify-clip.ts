/**
 * Cross-modal retrieval check for the REAL CLIP embedder.
 *
 * The smoke test deliberately runs with EMBEDDER=fallback: it verifies the API,
 * the SQL and the ranking, but says nothing about whether CLIP itself works.
 * This script covers the other half — it downloads/loads the actual model and
 * asserts the property the product depends on:
 *
 *     a text description retrieves the right PHOTO, and a photo retrieves the
 *     right DESCRIPTION, across the modality gap, without shared keywords.
 *
 * Run it against a few local images:
 *
 *     npx tsx scripts/verify-clip.ts .fixtures/wallet.jpg .fixtures/keys.jpg ...
 *
 * With no arguments it uses whatever is in .fixtures/. The file's base name
 * (wallet.jpg -> "wallet") is taken as the ground-truth label, and each label
 * must have a caption in CAPTIONS below.
 *
 * First run downloads ~350 MB of ONNX weights into TRANSFORMERS_CACHE.
 */
import fs from "node:fs";
import path from "node:path";

import { embedImage, embedText, getBackend } from "../src/lib/embedder";
import { cosine } from "../src/lib/vector";

// Captions are worded to share as few literal words with the filenames as
// possible — this is a semantic test, not a string-matching test.
const CAPTIONS: Record<string, string> = {
  wallet: "a slim billfold for holding cash and bank cards",
  keys: "a bunch of metal door keys on a ring",
  phone: "a small handheld mobile device with a screen and buttons",
};

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

function fmt(n: number) {
  return n.toFixed(4).padStart(7);
}

const FIXTURE_DIR = ".fixtures";

/**
 * Fetch the test images listed in fixtures.json on first run. They are not
 * committed — the repo stays free of third-party media, and the check still
 * works from a clean clone.
 */
async function ensureFixtures(): Promise<string[]> {
  const { fixtures } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"),
  ) as { fixtures: Array<{ label: string; file: string; url: string }> };

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const paths: string[] = [];

  for (const fx of fixtures) {
    const dest = path.join(FIXTURE_DIR, fx.file);
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      console.log(`  downloading ${fx.file} ...`);
      // Wikimedia rate-limits bursts, so back off and retry rather than failing
      // the whole check on a transient 429.
      let lastErr = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        const res = await fetch(fx.url, {
          // Wikimedia rejects requests without a descriptive User-Agent.
          headers: { "User-Agent": "TrackBack-verify-clip/1.0 (project self-test)" },
        });
        if (res.ok) {
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          lastErr = "";
          break;
        }
        lastErr = `HTTP ${res.status}`;
      }
      if (lastErr) throw new Error(`Failed to download ${fx.url}: ${lastErr}`);
    }
    paths.push(dest);
  }
  return paths;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : await ensureFixtures();

  if (files.length < 2) {
    console.error("Need at least 2 images to test retrieval. Found:", files);
    process.exit(1);
  }

  const labels = files.map((f) => path.basename(f).replace(/\.[^.]+$/, ""));
  const missing = labels.filter((l) => !CAPTIONS[l]);
  if (missing.length) {
    console.error(`No caption defined for: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("Loading CLIP (first run downloads the model)...\n");

  // Embed every image and every caption independently.
  const imageVecs: number[][] = [];
  for (const f of files) {
    imageVecs.push(await embedImage(path.resolve(f), fs.readFileSync(f)));
  }
  const textVecs: number[][] = [];
  for (const l of labels) {
    textVecs.push(await embedText(CAPTIONS[l]));
  }

  const backend = getBackend();
  console.log(`Embedder backend: ${backend}`);
  console.log(`Embedding dimension: ${imageVecs[0].length}\n`);

  check(backend === "clip", "real CLIP loaded (not the deterministic fallback)");
  check(
    imageVecs.every((v) => v.length === 512) && textVecs.every((v) => v.length === 512),
    "every embedding is 512-dimensional",
  );

  // Similarity matrix: rows = captions, columns = images.
  console.log("\nCosine similarity — rows: caption, columns: image\n");
  console.log("            " + labels.map((l) => l.padStart(9)).join(""));
  for (let t = 0; t < textVecs.length; t++) {
    const row = imageVecs.map((iv) => cosine(textVecs[t], iv));
    console.log(labels[t].padEnd(12) + row.map(fmt).join("  "));
  }

  console.log("\nText -> image retrieval (does a description find the right photo?)");
  for (let t = 0; t < textVecs.length; t++) {
    const scored = imageVecs.map((iv, i) => ({ i, s: cosine(textVecs[t], iv) }));
    scored.sort((a, b) => b.s - a.s);
    check(
      scored[0].i === t,
      `"${CAPTIONS[labels[t]]}" -> ${labels[scored[0].i]} ` +
        `(want ${labels[t]}, margin ${(scored[0].s - scored[1].s).toFixed(4)})`,
    );
  }

  console.log("\nImage -> text retrieval (does a photo find the right description?)");
  for (let i = 0; i < imageVecs.length; i++) {
    const scored = textVecs.map((tv, t) => ({ t, s: cosine(imageVecs[i], tv) }));
    scored.sort((a, b) => b.s - a.s);
    check(
      scored[0].t === i,
      `${labels[i]} photo -> "${CAPTIONS[labels[scored[0].t]]}" ` +
        `(want ${labels[i]}, margin ${(scored[0].s - scored[1].s).toFixed(4)})`,
    );
  }

  await reportCalibration(files, labels);

  console.log(
    failures === 0
      ? "\nCROSS-MODAL RETRIEVAL VERIFIED — CLIP matches photos to descriptions both ways."
      : `\nFAILED — ${failures} check(s) did not pass.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Show why the UI must not render raw cosine as a confidence percentage.
 *
 * This embeds items the way the product actually does (blended image + text via
 * embedItem) and prints the cosines a real match query would produce. The point
 * is the *ranges*: text-to-text pairs sit far higher than cross-modal pairs, so
 * a single absolute threshold mislabels one or the other. Ranking is reliable;
 * the absolute number is not. Hence the z-score calibration in
 * src/services/matching.ts.
 */
async function reportCalibration(files: string[], labels: string[]) {
  const byLabel = new Map(labels.map((l, i) => [l, files[i]]));
  const wallet = byLabel.get("wallet");
  const phone = byLabel.get("phone");
  if (!wallet || !phone) return;

  const { embedItem } = await import("../src/lib/embedder");
  const item = async (text: string, file?: string) =>
    embedItem({
      text,
      imageSource: file ? path.resolve(file) : null,
      imageBytes: file ? fs.readFileSync(file) : null,
    });

  const lostWalletText = await item(
    "Lost brown leather wallet. Slim bifold wallet with my cards inside. Category: wallet.",
  );
  const foundWalletPhoto = await item("Found this on a bench. Category: wallet.", wallet);
  const foundPhonePhoto = await item("Found this at the bus stop. Category: phone.", phone);
  const lostPhoneText = await item(
    "Lost my mobile phone. Small handheld device with a screen. Category: phone.",
  );
  const foundPhoneText = await item(
    "Found a smartphone, silver, screen slightly cracked. Category: phone.",
  );
  const foundWalletText = await item(
    "Found a billfold for cash and cards on a bench. Category: wallet.",
  );

  const rows: Array<[string, number, boolean]> = [
    ["cross-modal  lost wallet TEXT vs found wallet PHOTO", cosine(lostWalletText, foundWalletPhoto), true],
    ["cross-modal  lost wallet TEXT vs found phone  PHOTO", cosine(lostWalletText, foundPhonePhoto), false],
    ["text-text    lost phone  TEXT vs found phone  TEXT ", cosine(lostPhoneText, foundPhoneText), true],
    ["text-text    lost phone  TEXT vs found wallet TEXT ", cosine(lostPhoneText, foundWalletText), false],
  ];

  console.log("\nWhy raw cosine is not a confidence score (blended item embeddings)\n");
  for (const [label, v, isTrueMatch] of rows) {
    console.log(
      `  ${label}  cos=${v.toFixed(4)}  ${isTrueMatch ? "TRUE MATCH " : "NON-MATCH  "}` +
        `raw%=${String(Math.round(v * 100)).padStart(3)}`,
    );
  }
  const crossTrue = rows[0][1];
  const textFalse = rows[3][1];
  check(
    rows[0][1] > rows[1][1] && rows[2][1] > rows[3][1],
    "ranking is correct within each modality pairing",
  );
  check(
    textFalse > crossTrue,
    `an unrelated TEXT-TEXT pair (${textFalse.toFixed(3)}) outscores a genuine ` +
      `CROSS-MODAL match (${crossTrue.toFixed(3)}) — absolute cosine is not comparable ` +
      "across modality pairs, which is why confidence is calibrated per query",
  );
}

main().catch((err) => {
  console.error("verify-clip crashed:", err);
  process.exit(1);
});
