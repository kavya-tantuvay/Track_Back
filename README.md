# 🧭 TrackBack : AI-powered Lost & Found

TrackBack is a full-stack, **AI-powered Lost & Found platform**. Users report lost
items and post found items (with photos, descriptions, location, and date). When
an item is posted, the system uses **CLIP image + text embeddings** and
**pgvector cosine similarity** to automatically surface the most likely matching
items from the opposite pool — so a *found photo can match a lost description*,
even without shared keywords.

> **Stack:** React + TypeScript · Node/Express + TypeScript · PostgreSQL + Prisma
> (Neon) · pgvector · JWT auth · Cloudinary · CLIP via `@xenova/transformers`
> (runs in Node, no Python).

---

## ✨ Features

- **Accounts** — register / login with JWT + bcrypt.
- **Report items** — lost or found, with photo upload, category, location, date, contact.
- **AI matching** — every item gets a 512-d CLIP embedding (image + text blended);
  matches are ranked by cosine similarity in Postgres via pgvector (`<=>`), with a
  small same-category bonus. Cross-modal: photos match text and vice-versa.
- **Browse & search** — filter by type/category, full-text-ish search on
  title/description/location, pagination.
- **Match confidence UI** — each suggestion shows a similarity % and confidence label.
- **My items dashboard** — mark resolved / reopen / delete your listings.

## 🧱 Architecture

```
                 React + TS (Vite)                Node + Express + TS
             ┌───────────────────────┐        ┌─────────────────────────┐
  Browser ──▶│ Home · Report · Detail │──/api─▶│ auth · items · matches  │
             │ AuthContext (JWT)      │◀──────│ zod · helmet · rate-limit│
             └───────────────────────┘        │                         │
                                              │  ┌─────────────────────┐ │
                                              │  │ @xenova/transformers│ │  CLIP → 512-d vector
                                              │  │  (ONNX, in Node)    │ │  (fallback embedder
                                              │  └─────────────────────┘ │   if model can't load)
                                              │  ┌─────────────────────┐ │
                                              │  │ Cloudinary /        │ │  image hosting
                                              │  │ local disk          │ │  (auto-fallback)
                                              │  └─────────────────────┘ │
                                              └───────────┬─────────────┘
                                                          │ Prisma
                                              ┌───────────▼───────────┐
                                              │ PostgreSQL + pgvector │  HNSW ANN + cosine
                                              │ (Neon or local docker)│
                                              └───────────────────────┘
```

**Design principle — local-first with graceful fallbacks.** The app runs with just
a Postgres URL and a JWT secret. Without Cloudinary keys, images are stored on
local disk and served by Express. If the CLIP model can't be downloaded on first
run, a deterministic fallback embedder keeps the whole flow working (matches are
just less meaningful until CLIP loads). Add Neon + Cloudinary env vars and it
"upgrades" transparently — no code changes.

The one thing that is *not* forgiving is configuration: with `NODE_ENV=production`,
`DATABASE_URL` and `JWT_SECRET` have no defaults and the process exits at boot if
they're missing, rather than quietly signing tokens with a placeholder secret.

---

## 🚀 Quick start

### Prerequisites
- Node.js 18+
- A PostgreSQL database **with the pgvector extension** — either:
  - **Local:** `docker compose up -d` (uses the `pgvector/pgvector` image), or
  - **Neon:** create a project at [neon.tech](https://neon.tech) (pgvector is available by default).

### 1) Backend

```bash
cd backend
cp .env.example .env          # then edit DATABASE_URL + JWT_SECRET
npm install
npm run db:deploy             # applies migrations: tables + pgvector + HNSW index
npm run db:seed               # optional: demo user + sample items
npm run dev                   # API on http://localhost:4000
```

Demo login after seeding: **`demo` / `password123`**.

> First real embed downloads the CLIP model (~a few hundred MB) into
> `TRANSFORMERS_CACHE` (`.models/` by default). Until then, or if offline, the
> fallback embedder is used automatically. Check `GET /api/meta` to see which
> engine is active (`"embedder": "clip" | "fallback"`).

### 2) Frontend

```bash
cd frontend
npm install
npm run dev                   # app on http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to the backend, so no CORS
setup is needed in development.

### Optional: Cloudinary
Add to `backend/.env` to host images on Cloudinary instead of local disk:
```
CLOUDINARY_URL="cloudinary://API_KEY:API_SECRET@CLOUD_NAME"
```

---

## 🗃️ Database migrations

Schema changes are versioned in `backend/prisma/migrations` and applied with
`prisma migrate deploy` — including the two things Prisma's schema language can't
express, which live as plain SQL inside the migration files:

- `CREATE EXTENSION vector` (pgvector),
- the HNSW index on `Item.embedding` (the column is `Unsupported("vector(512)")`).

```bash
npm run db:migrate    # dev: create a new migration from schema.prisma changes
npm run db:deploy     # CI / production: apply pending migrations, no prompts
```

The server performs **no DDL at runtime**. On boot it only *verifies* that the
database is reachable, pgvector is installed, and the ANN index exists — a process
that rewrites its own schema on startup races with every other replica and hides
failed deploys.

---

## 🔌 API

| Method | Endpoint                | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
| GET    | `/api/health`           | –    | Liveness — is the process up             |
| GET    | `/api/ready`            | –    | Readiness — pings Postgres, `503` if down |
| POST   | `/api/auth/register`    | –    | Create account, returns `{ user, token }` |
| POST   | `/api/auth/login`       | –    | Login with email **or** username         |
| GET    | `/api/auth/me`          | ✔    | Current user                             |
| GET    | `/api/items`            | –    | List/search (`type,category,status,q,mine,page`) |
| POST   | `/api/items`            | ✔    | Create item (multipart) + return matches |
| GET    | `/api/items/:id`        | –    | Item detail                              |
| GET    | `/api/items/:id/matches`| –    | AI match suggestions (`?topK=`)          |
| PATCH  | `/api/items/:id`        | ✔    | Mark resolved/open (owner)               |
| DELETE | `/api/items/:id`        | ✔    | Delete (owner)                           |
| GET    | `/api/meta`             | –    | Categories, active engine, live counts   |

---

## 🧠 How the matching works

1. On post, we build a text string (`title. description. Category: x.`) and, if an
   image was uploaded, read it. CLIP encodes each into the **same 512-d space**.
2. The image and text vectors are L2-normalized, weighted (`0.6 / 0.4`), summed,
   and re-normalized into one **blended embedding** stored in a `vector(512)`
   column. Either component may be missing — a text-only item still matches an
   image-only item because CLIP aligns the two modalities.
3. Matching runs in **two stages**, both in SQL:
   - **Retrieve** — the item's embedding is passed in as a bound vector parameter,
     and the HNSW index returns the nearest `topK × 6` open items of the opposite
     type, ordered by `embedding <=> $1`.
   - **Re-rank** — that small candidate set gets the same-category bonus applied,
     is re-sorted, and is truncated to `topK`.

   The split exists because an HNSW index can *only* accelerate a query shaped
   like `ORDER BY embedding <=> $1 LIMIT n`. Folding the category bonus into that
   `ORDER BY` — or deriving the probe vector from a join — makes the expression
   opaque to the index and silently degrades the query into a sequential scan that
   distances every row in the table. Keeping the ANN step pure preserves the
   index; the business logic rides on the shortlist.

4. **Confidence is calibrated per query, not read off the cosine.** See below.

See `backend/src/lib/embedder.ts`, `backend/src/lib/vector.ts`, and
`backend/src/services/matching.ts`.

### Why the confidence % isn't the raw cosine

Raw CLIP cosine similarities are *not* calibrated, and — more importantly — they
are **not comparable across modality pairs**. Measured on this project with real
CLIP (`npm run verify:clip`, blended item embeddings):

| Pair | Cosine | Verdict |
| ---- | ------ | ------- |
| lost wallet **text** ↔ found wallet **photo** | `0.635` | true match |
| lost wallet **text** ↔ found phone **photo**  | `0.494` | non-match |
| lost phone **text** ↔ found phone **text**    | `0.959` | true match |
| lost phone **text** ↔ found wallet **text**   | `0.863` | **non-match** |

Two forces are at work: CLIP's text tower is **anisotropic** (its embeddings
occupy a narrow cone, so *any* two captions score ~0.85+), and there's the
well-documented **modality gap** between the image and text towers, which pushes
genuine cross-modal pairs down to ~0.6.

So a fixed threshold is meaningless — reading cosine as a percentage would have
labelled an unrelated phone/wallet text pair **"86% · Strong match"** while
calling a genuine photo-to-description match merely "Likely". Ranking within a
single query is reliable; the absolute number is not.

The fix: the ANN stage already retrieves `topK × 6` candidates, which is a free
background sample drawn from *this query's* probe vector and modality mix. Each
hit is expressed as a **z-score against that pool** (`AVG`/`STDDEV_SAMP` window
functions over the candidate CTE, so it costs no extra round trip) and squashed
through a logistic into a 0..1 confidence. When the pool is too small to have a
spread (fewer than 4 candidates), the API returns `confidence: null` and the UI
falls back to showing rank — it doesn't invent a number.

The response therefore carries all four values: `similarity` (raw cosine, shown
in the UI as a small `cos 0.635` readout for transparency), `score` (similarity +
category bonus, which orders the list), `zScore`, and `confidence` (what the
percentage and label render from).

---

## 🔒 Production hardening

- **Fail-fast config** — no implicit secrets in production (see above).
- **helmet** — baseline security headers; `Cross-Origin-Resource-Policy` is
  relaxed so the frontend origin can render locally-stored `/uploads` images.
- **Rate limiting** — 30 requests / 15 min on `/api/auth` (login and register run
  bcrypt, which is deliberately slow and therefore the natural target for
  credential stuffing), 120 / min elsewhere. `trust proxy` is enabled so the
  limiter keys on the real client IP rather than the platform's load balancer.
- **Bounded input** — 100 kB JSON bodies, 8 MB image uploads, MIME allowlist.
- **CORS** — explicit origin allowlist; `CORS_ORIGIN="*"` is translated into
  "reflect any origin" rather than passed through as a literal (the `cors` package
  matches array entries by exact string, so a literal `"*"` would match no origin
  and block every browser request).
- **Readiness endpoint** — `/api/ready` checks Postgres, so a process that is
  alive but can't reach its database is kept out of rotation instead of serving
  500s.
- **Graceful shutdown** — on `SIGTERM` the server stops accepting connections,
  drains in-flight requests, disconnects Prisma, and hard-exits after 10s.
- **Request logging** — one line per request (method, path, status, duration).

---

## 🗂️ Project structure

```
TrackBack/
├── docker-compose.yml         # local Postgres + pgvector
├── render.yaml                # one-click backend + DB blueprint
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # User, Item, vector(512) embedding
│   │   └── migrations/        # init + HNSW index (raw SQL)
│   ├── scripts/
│   │   ├── smoke.ts           # end-to-end test against real Postgres
│   │   └── verify-clip.ts     # cross-modal retrieval check on real CLIP
│   └── src/
│       ├── index.ts app.ts config.ts bootstrap.ts prisma.ts seed.ts
│       ├── lib/     embedder · vector · storage · jwt · validation · errors
│       ├── middleware/ auth · upload · error · logging
│       ├── routes/  auth · items · meta
│       └── services/ items · matching (pgvector)
└── frontend/
    ├── vercel.json            # SPA rewrites
    └── src/
        ├── pages/   Home · Login · Register · ReportItem · ItemDetail · MyItems
        ├── components/ Navbar · ItemCard · MatchList · ProtectedRoute
        ├── context/ AuthContext
        └── lib/     api · types · format
```

---

## ✅ Tests & CI

`backend/scripts/smoke.ts` is an end-to-end test that boots the real Express app
in-process against a **real Postgres + pgvector** database and drives the whole
flow over HTTP: register → post a found wallet → post an unrelated phone → post a
matching lost wallet → call the match endpoint → assert the genuine wallet is
returned *and* outranks the phone, then assert the ownership rules (a non-owner
gets `403`, an anonymous delete gets `401`).

It runs with `EMBEDDER=fallback` so it's deterministic and needs no model
download — the embedding *values* aren't what's under test; the API, the SQL, the
index and the ranking are.

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs it on
every push against a `pgvector/pgvector:pg16` service container, plus typecheck
and build for both packages.

```bash
cd backend && npm run smoke
```

### Verifying CLIP itself

The smoke test covers the plumbing but says nothing about whether the *model*
works. `backend/scripts/verify-clip.ts` covers the other half: it loads the real
CLIP weights and asserts the property the product is built on — that a text
description retrieves the right **photo** and a photo retrieves the right
**description**, across the modality gap, using captions deliberately worded to
share no keywords with the images.

```bash
cd backend && npm run verify:clip
```

It downloads three Wikimedia Commons test images on first run (listed with
credits in `scripts/fixtures.json`; not committed) and prints the full similarity
matrix plus the calibration evidence in the table above. Current result: **6/6
retrieval checks pass in both directions.**

Not in CI — it needs ~350 MB of model weights, which is the wrong thing to pull
on every push. It's a local check you run when touching the embedder.

**Known limitation it surfaced:** base CLIP is zero-shot, so visually atypical
objects can be mis-ranked image→text — a slim *metal* card-holder wallet scored
closer to "small handheld device with a screen" than to the wallet caption, by
0.012. This is why the product surfaces a ranked shortlist for a human to confirm
rather than auto-claiming a single match, and why the same-category bonus exists.

---

## 🎯 Engineering highlights

- **Vector search in a relational DB:** embeddings stored in a `vector(512)`
  column; cosine ranking pushed into Postgres (`<=>`) with an HNSW index instead
  of scoring in app code — scales beyond a naive O(n) scan.
- **Retrieve-then-re-rank:** business logic (the category bonus) is kept *out* of
  the ANN `ORDER BY` so the index stays usable, then applied to the shortlist.
- **Calibrated confidence:** raw CLIP cosines aren't comparable across modality
  pairs, so the displayed confidence is a z-score against the candidate pool the
  ANN stage already fetched — measured, not assumed (see above).
- **CLIP without Python:** ran the model in Node via ONNX (`@xenova/transformers`)
  to keep the stack all-TypeScript, with a deterministic fallback so the product
  never hard-fails on a cold/offline start.
- **Cross-modal matching:** blending normalized image + text vectors in CLIP's
  shared space lets a found *photo* match a lost *description*.
- **Prisma + an unsupported column type:** the `vector` type is written/read via
  `$queryRaw`/`$executeRaw` while Prisma manages the rest of the schema, and the
  index it can't express lives in a hand-written migration.
- **Graceful degradation:** Cloudinary→local disk, CLIP→fallback, Neon→local
  docker — the app is runnable at every level of setup.

### Known trade-offs

- Deleting an item removes the row but not the Cloudinary asset — a background
  sweep (or a delete hook) would fix it; it's skipped deliberately to keep the
  delete path synchronous and simple.
- HNSW is *approximate*: it can miss a true nearest neighbour. Over-fetching
  candidates before re-ranking buys back most of that recall.
- Free-tier hosting runs `EMBEDDER=fallback` because CLIP needs ~1 GB RAM, so the
  deployed demo's matches are lexical rather than semantic until the instance is
  scaled up.

---

## 📦 Deployment

### Backend + database — Render (one click)

The repo ships a [`render.yaml`](render.yaml) blueprint. In the Render dashboard:
**New → Blueprint → connect this repo**. Render provisions Postgres, wires
`DATABASE_URL`, generates `JWT_SECRET`, runs the migrations during the build, and
polls `/api/ready` before sending traffic.

Afterwards, in the service's **Environment** tab:

| Variable         | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `CORS_ORIGIN`    | the deployed frontend origin, e.g. `https://trackback.vercel.app`  |
| `CLOUDINARY_URL` | *(recommended)* — without it, uploads are lost on redeploy         |
| `EMBEDDER`       | remove it on a ≥1 GB instance to enable real CLIP                  |

### Backend — any other Node host (Railway / Fly / a VM)

```bash
npm ci && npm run build && npm run db:deploy && npm start
```

Required env: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN`.
Point the platform's health check at `/api/ready`.

### Frontend — Vercel / Netlify

Root directory `frontend`, build `npm run build`, output `dist`.
[`vercel.json`](frontend/vercel.json) already handles SPA rewrites.

Set **`VITE_API_BASE`** to the deployed API origin (e.g.
`https://trackback-api.onrender.com`) *before* building — Vite inlines env vars at
build time, so changing it later needs a redeploy, not just a restart.

### Post-deploy checklist

```bash
curl https://<api-host>/api/health     # {"ok":true,...}
curl https://<api-host>/api/ready      # {"ok":true,"db":"up"}
curl https://<api-host>/api/meta       # categories + embedder + storage backend
```

Then register a user in the UI and post a lost + found pair to confirm matching
works end-to-end.

## License

MIT — built as a portfolio project.
