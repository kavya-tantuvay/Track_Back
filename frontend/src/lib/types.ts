export type ItemType = "lost" | "found";
export type ItemStatus = "open" | "resolved";

export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface Item {
  id: string;
  type: ItemType;
  status: ItemStatus;
  title: string;
  description: string;
  category: string;
  location: string;
  date: string;
  contact: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  owner: { id: string; username: string };
}

export interface MatchResult {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  category: string;
  location: string;
  imageUrl: string | null;
  date: string;
  status: ItemStatus;
  createdAt: string;
  ownerUsername: string;
  /** Similarity plus the same-category bonus — this is what ranks the list. */
  score: number;
  /** Raw cosine similarity in 0..1 — shown as a transparency readout. */
  similarity: number;
  /** Standard deviations above the candidate pool's mean similarity. */
  zScore: number | null;
  /** Calibrated 0..1 confidence — what the confidence % shows. */
  confidence: number | null;
}

export interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Item[];
}

export interface Meta {
  categories: string[];
  embedder: "clip" | "fallback" | "uninitialized";
  storage: "cloudinary" | "local";
  stats: { lost: number; found: number; resolved: number; total: number };
}
