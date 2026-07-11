import { Link } from "react-router-dom";

import { imageSrc } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Item } from "../lib/types";

export default function ItemCard({ item }: { item: Item }) {
  const src = imageSrc(item.imageUrl);
  return (
    <Link to={`/items/${item.id}`} className="card item-card">
      <div className="item-thumb">
        {src ? (
          <img src={src} alt={item.title} loading="lazy" />
        ) : (
          <div className="thumb-placeholder">📦</div>
        )}
        <span className={`badge badge-${item.type}`}>{item.type}</span>
        {item.status === "resolved" && <span className="badge badge-resolved">resolved</span>}
      </div>
      <div className="item-body">
        <h3 className="item-title">{item.title}</h3>
        <p className="item-desc">{item.description}</p>
        <div className="item-meta">
          <span className="chip">{item.category}</span>
          <span className="muted">📍 {item.location}</span>
        </div>
        <div className="item-foot muted">
          <span>{formatDate(item.date)}</span>
          <span>@{item.owner.username}</span>
        </div>
      </div>
    </Link>
  );
}
