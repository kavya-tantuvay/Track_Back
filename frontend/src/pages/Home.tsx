import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import ItemCard from "../components/ItemCard";
import { api } from "../lib/api";
import type { Item, Meta } from "../lib/types";

const TYPES = [
  { value: "", label: "All" },
  { value: "lost", label: "Lost" },
  { value: "found", label: "Found" },
];

export default function Home() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
  }, [items.length]);

  useEffect(() => {
    setLoading(true);
    api
      .listItems({ type, category, q, page, pageSize })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [type, category, q, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack-lg">
      <section className="hero">
        <div className="hero-text">
          <h1>
            Lost something? <span className="accent">Found something?</span>
          </h1>
          <p>
            TrackBack uses <strong>CLIP image + text embeddings</strong> to automatically match lost
            reports with found items — so a photo can match a description, even without the same
            keywords.
          </p>
          <div className="hero-cta">
            <Link to="/report" className="btn btn-primary btn-lg">
              Report an item
            </Link>
            <a href="#browse" className="btn btn-ghost btn-lg">
              Browse listings
            </a>
          </div>
        </div>
        {meta && (
          <div className="stat-row">
            <Stat n={meta.stats.lost} label="Lost" />
            <Stat n={meta.stats.found} label="Found" />
            <Stat n={meta.stats.resolved} label="Reunited" />
          </div>
        )}
      </section>

      {meta && (
        <p className="backend-note muted">
          AI engine: <b>{meta.embedder === "clip" ? "CLIP (transformers.js)" : meta.embedder}</b> ·
          image storage: <b>{meta.storage}</b>
        </p>
      )}

      <section id="browse" className="stack">
        <div className="filters card">
          <div className="type-toggle">
            {TYPES.map((t) => (
              <button
                key={t.value}
                className={`toggle ${type === t.value ? "active" : ""}`}
                onClick={() => {
                  setType(t.value);
                  setPage(1);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <input
            className="input search"
            placeholder="Search title, description, location…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />

          <select
            className="input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {meta?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="muted center">Loading listings…</div>
        ) : items.length === 0 ? (
          <div className="empty card">
            <p>No items match your filters yet.</p>
            <Link to="/report" className="btn btn-primary">
              Be the first to report one
            </Link>
          </div>
        ) : (
          <div className="grid">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="muted">
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-n">{n}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
