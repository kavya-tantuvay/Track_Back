import { Link } from "react-router-dom";

import { imageSrc } from "../lib/api";
import { formatDate, matchConfidence } from "../lib/format";
import type { MatchResult } from "../lib/types";

export default function MatchList({ matches }: { matches: MatchResult[] }) {
  if (matches.length === 0) {
    return (
      <p className="muted">
        No matches yet. As more items are posted, AI suggestions will appear here automatically.
      </p>
    );
  }

  return (
    <ul className="match-list">
      {matches.map((m, rank) => {
        const { pct, label, tone } = matchConfidence(m.confidence ?? null);
        const src = imageSrc(m.imageUrl);
        return (
          <li key={m.id} className="match-item">
            <Link to={`/items/${m.id}`} className="match-link">
              <div className="match-thumb">
                {src ? <img src={src} alt={m.title} loading="lazy" /> : <span>📦</span>}
              </div>
              <div className="match-info">
                <div className="match-top">
                  <span className={`badge badge-${m.type}`}>{m.type}</span>
                  <h4>{m.title}</h4>
                </div>
                <p className="muted match-desc">{m.description}</p>
                <div className="item-foot muted">
                  <span>📍 {m.location}</span>
                  <span>{formatDate(m.date)}</span>
                </div>
              </div>
              <div className={`match-score score-${tone}`}>
                <div className="score-pct">{pct === null ? `#${rank + 1}` : `${pct}%`}</div>
                <div className="score-label">{label}</div>
                <div className="score-bar">
                  <span style={{ width: `${pct ?? 0}%` }} />
                </div>
                {/* Raw cosine kept visible: the calibrated % is a ranking aid,
                    this is the underlying measurement. */}
                <div className="score-raw" title="Raw CLIP cosine similarity">
                  cos {m.similarity.toFixed(3)}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
