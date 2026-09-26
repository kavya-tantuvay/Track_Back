import type { Item, ListResponse, MatchResult, Meta, User } from "./types";

// Empty in dev: Vite proxies /api and /uploads to the backend, so relative URLs
// work same-origin. In a production build it must point at the deployed API.
const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const TOKEN_KEY = "trackback_token";

if (import.meta.env.PROD && !BASE) {
  // Without this the bundle would request /api/* from the static host, which
  // returns the SPA's index.html and fails with a confusing JSON parse error.
  console.error(
    "[TrackBack] VITE_API_BASE was not set at build time — API requests will " +
      "hit the static host instead of the backend. Set it and rebuild.",
  );
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Only set JSON content-type when body is not FormData.
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

// ---- Resolve an image URL (local uploads are relative to the API origin) ----
export function imageSrc(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${BASE}${url}`;
}

// ---- Auth ----
export const api = {
  register: (body: { email: string; username: string; password: string }) =>
    request<{ user: User; token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: { identifier: string; password: string }) =>
    request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  me: () => request<{ user: User }>("/auth/me"),

  meta: () => request<Meta>("/meta"),

  // ---- Items ----
  listItems: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    return request<ListResponse>(`/items${q ? `?${q}` : ""}`);
  },

  getItem: (id: string) => request<{ item: Item }>(`/items/${id}`),

  getMatches: (id: string, topK?: number) =>
    request<{ matches: MatchResult[] }>(`/items/${id}/matches${topK ? `?topK=${topK}` : ""}`),

  createItem: (form: FormData) =>
    request<{ item: Item; matches: MatchResult[] }>("/items", { method: "POST", body: form }),

  setStatus: (id: string, status: "open" | "resolved") =>
    request<{ item: Item }>(`/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  deleteItem: (id: string) => request<void>(`/items/${id}`, { method: "DELETE" }),
};
