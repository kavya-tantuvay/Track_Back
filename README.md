# 🧭 TrackBack — AI-powered Lost & Found

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
             ┌───────────────────────┐        ┌────────────────────────┐
  Browser ──▶│ Home · Report · Detail │──/api─▶│ auth · items · matches │
             │ AuthContext (JWT)      │◀──────│ zod validation         │
             └───────────────────────┘        │                        │
                                              │  ┌──────────────────┐   │
                                              │  │ @xenova/transformers│ │  CLIP → 512-d vector
                                              │  │  (ONNX, in Node)  │   │  (fallback embedder
                                              │  └──────────────────┘   │   if model can't load)
                                              │  ┌──────────────────┐   │
                                              │  │ Cloudinary /      │   │  image hosting
                                              │  │ local disk        │   │  (auto-fallback)
                                              │  └──────────────────┘   │
                                              └───────────┬────────────┘
                                                          │ Prisma
                                                 ┌────────▼─────────┐
                                                 │ PostgreSQL + pgvector │  cosine <=> ranking
                                                 │ (Neon or local docker)│
                                                 └──────────────────────┘
```

**Design principle — local-first with graceful fallbacks.** The app runs with just
a Postgres URL and a JWT secret. Without Cloudinary keys, images are stored on
local disk and served by Express. If the CLIP model can't be downloaded on first
run, a deterministic fallback embedder keeps the whole flow working (matches are
just less meaningful until CLIP loads). Add Neon + Cloudinary env vars and it
"upgrades" transparently — no code changes.

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
npm run db:push               # creates tables + pgvector extension
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

## 🔌 API

| Method | Endpoint                | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
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
3. A match query ranks opposite-type, still-open items by
   `1 - (embedding <=> query_embedding)` (cosine similarity) with a small bonus
   when categories agree — all in SQL, using an HNSW index for speed.

See `backend/src/lib/embedder.ts`, `backend/src/lib/vector.ts`, and
`backend/src/services/matching.ts`.

---

## 🗂️ Project structure

```
TrackBack/
├── docker-compose.yml         # local Postgres + pgvector
├── backend/
│   ├── prisma/schema.prisma   # User, Item, vector(512) embedding
│   └── src/
│       ├── index.ts app.ts config.ts bootstrap.ts prisma.ts seed.ts
│       ├── lib/     embedder · vector · storage · jwt · validation · errors
│       ├── middleware/ auth · upload · error
│       ├── routes/  auth · items · meta
│       └── services/ items · matching (pgvector)
└── frontend/
    └── src/
        ├── pages/   Home · Login · Register · ReportItem · ItemDetail · MyItems
        ├── components/ Navbar · ItemCard · MatchList · ProtectedRoute
        ├── context/ AuthContext
        └── lib/     api · types · format
```

---

## 🎙️ Interview talking points

- **Vector search in a relational DB:** embeddings stored in a `vector(512)`
  column; cosine ranking pushed into Postgres (`<=>`) with an HNSW index instead
  of scoring in app code — scales beyond a naive O(n) scan.
- **CLIP without Python:** ran the model in Node via ONNX (`@xenova/transformers`)
  to keep the stack all-TypeScript, with a deterministic fallback so the product
  never hard-fails on a cold/offline start.
- **Cross-modal matching:** blending normalized image + text vectors in CLIP's
  shared space lets a found *photo* match a lost *description*.
- **Prisma + an unsupported column type:** the `vector` type is written/read via
  `$queryRaw`/`$executeRaw` while Prisma manages the rest of the schema.
- **Graceful degradation:** Cloudinary→local disk, CLIP→fallback, Neon→local
  docker — the app is runnable at every level of setup.

---

## 📦 Deployment notes

- **DB:** Neon (enable pgvector — it's available by default).
- **Backend:** any Node host (Render, Railway, Fly). Set `DATABASE_URL`,
  `JWT_SECRET`, `CORS_ORIGIN`, `CLOUDINARY_URL`. Run `npm run build && npm start`.
- **Frontend:** `npm run build` → static `dist/` on Vercel/Netlify; set
  `VITE_API_BASE` to the deployed API origin.

## License

MIT — built as a portfolio project.
