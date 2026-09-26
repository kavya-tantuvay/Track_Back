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

The API returns both numbers: `similarity` (raw cosine, 0..1 — what the UI's
confidence % shows) and `score` (similarity + category bonus — what ranks the list).

See `backend/src/lib/embedder.ts`, `backend/src/lib/vector.ts`, and
`backend/src/services/matching.ts`.

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
│   ├── scripts/smoke.ts       # end-to-end test against real Postgres
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

---

## 🎯 Engineering highlights

- **Vector search in a relational DB:** embeddings stored in a `vector(512)`
  column; cosine ranking pushed into Postgres (`<=>`) with an HNSW index instead
  of scoring in app code — scales beyond a naive O(n) scan.
- **Retrieve-then-re-rank:** business logic (the category bonus) is kept *out* of
  the ANN `ORDER BY` so the index stays usable, then applied to the shortlist.
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
