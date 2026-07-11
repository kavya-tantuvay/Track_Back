import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import MatchList from "../components/MatchList";
import { useAuth } from "../context/AuthContext";
import { api, ApiError, imageSrc } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Item, MatchResult } from "../lib/types";

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated;

  const [item, setItem] = useState<Item | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getItem(id)
      .then(({ item }) => setItem(item))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Not found"))
      .finally(() => setLoading(false));

    setMatchesLoading(true);
    api
      .getMatches(id)
      .then(({ matches }) => setMatches(matches))
      .catch(() => setMatches([]))
      .finally(() => setMatchesLoading(false));
  }, [id]);

  const isOwner = !!user && !!item && user.id === item.ownerId;

  const toggleResolved = async () => {
    if (!item) return;
    const next = item.status === "open" ? "resolved" : "open";
    const { item: updated } = await api.setStatus(item.id, next);
    setItem(updated);
  };

  const remove = async () => {
    if (!item || !confirm("Delete this listing? This cannot be undone.")) return;
    await api.deleteItem(item.id);
    navigate("/my-items");
  };

  if (loading) return <div className="muted center">Loading…</div>;
  if (error || !item) return <div className="alert">{error ?? "Item not found"}</div>;

  const src = imageSrc(item.imageUrl);

  return (
    <div className="stack-lg">
      {justCreated && (
        <div className="banner-success">
          ✓ Posted! We ran your item through the AI matcher — see suggested matches below.
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-media">
          {src ? (
            <img src={src} alt={item.title} />
          ) : (
            <div className="thumb-placeholder large">📦</div>
          )}
        </div>

        <div className="detail-info stack">
          <div className="detail-badges">
            <span className={`badge badge-${item.type}`}>{item.type}</span>
            <span className={`badge badge-status-${item.status}`}>{item.status}</span>
            <span className="chip">{item.category}</span>
          </div>

          <h1>{item.title}</h1>
          <p className="detail-desc">{item.description}</p>

          <dl className="detail-facts">
            <div>
              <dt>Location</dt>
              <dd>📍 {item.location}</dd>
            </div>
            <div>
              <dt>{item.type === "lost" ? "Date lost" : "Date found"}</dt>
              <dd>{formatDate(item.date)}</dd>
            </div>
            <div>
              <dt>Reported by</dt>
              <dd>@{item.owner.username}</dd>
            </div>
            {item.contact && (
              <div>
                <dt>Contact</dt>
                <dd>{item.contact}</dd>
              </div>
            )}
          </dl>

          {isOwner && (
            <div className="owner-actions">
              <button className="btn btn-ghost" onClick={toggleResolved}>
                {item.status === "open" ? "Mark as resolved" : "Reopen"}
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="stack">
        <div className="section-head">
          <h2>
            {item.type === "lost" ? "Possible found matches" : "Possible lost matches"}
            <span className="ai-tag">AI · CLIP similarity</span>
          </h2>
        </div>
        {matchesLoading ? (
          <div className="muted">Scoring candidates…</div>
        ) : (
          <MatchList matches={matches} />
        )}
      </section>
    </div>
  );
}
