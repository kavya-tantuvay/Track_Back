import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import ItemCard from "../components/ItemCard";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { Item } from "../lib/types";

export default function MyItems() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listItems({ mine: true, pageSize: 50 })
      .then((res) => setItems(res.items))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>My items</h1>
        <Link to="/report" className="btn btn-primary">
          + Report item
        </Link>
      </div>
      <p className="muted">Everything you’ve reported, @{user?.username}.</p>

      {loading ? (
        <div className="muted center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty card">
          <p>You haven’t reported anything yet.</p>
          <Link to="/report" className="btn btn-primary">
            Report your first item
          </Link>
        </div>
      ) : (
        <div className="grid">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
