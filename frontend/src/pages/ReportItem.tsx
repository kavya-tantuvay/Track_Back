import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Meta } from "../lib/types";

export default function ReportItem() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);

  const [type, setType] = useState<"lost" | "found">("lost");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contact, setContact] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
  }, []);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("type", type);
      form.set("title", title);
      form.set("description", description);
      form.set("category", category);
      form.set("location", location);
      form.set("date", new Date(date).toISOString());
      if (contact) form.set("contact", contact);
      if (file) form.set("image", file);

      const { item } = await api.createItem(form);
      navigate(`/items/${item.id}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create item");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>Report an item</h1>
      <p className="muted">
        Fill in the details and (ideally) add a photo — the more you describe, the better the AI can
        match it.
      </p>

      <form className="card report-form" onSubmit={submit}>
        {error && <div className="alert">{error}</div>}

        <div className="type-toggle big">
          <button
            type="button"
            className={`toggle ${type === "lost" ? "active" : ""}`}
            onClick={() => setType("lost")}
          >
            I lost this
          </button>
          <button
            type="button"
            className={`toggle ${type === "found" ? "active" : ""}`}
            onClick={() => setType("found")}
          >
            I found this
          </button>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Black leather wallet"
            required
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            className="input"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Colour, brand, distinguishing marks, what was inside…"
            required
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Category</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {(meta?.categories ?? ["other"]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{type === "lost" ? "Date lost" : "Date found"}</span>
            <input
              className="input"
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="field">
          <span>Location</span>
          <input
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Where it was lost / found"
            required
          />
        </label>

        <label className="field">
          <span>Contact (optional)</span>
          <input
            className="input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="How finders can reach you (email / phone)"
          />
        </label>

        <label className="field">
          <span>Photo (optional, boosts match accuracy)</span>
          <input
            className="input file"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {preview && (
          <div className="image-preview">
            <img src={preview} alt="preview" />
          </div>
        )}

        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? "Analyzing & matching…" : "Post & find matches"}
        </button>
      </form>
    </div>
  );
}
