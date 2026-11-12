import { create } from "zustand";
import { api } from "../lib/api";

export type Notice = {
  id: string;
  title: string;
  body: string;
  category: { id: string; name: string };
  images: { id: string; alt: string }[];
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present for the author and admins.
  status?: "draft" | "published" | "archived";
  authorId?: string;
};
export type Category = { id: string; name: string };
export type BoardQuery = {
  q?: string;
  category?: string;
  from?: string;
  to?: string;
  page?: number;
};

type NoticesState = {
  items: Notice[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  categories: Category[];
  /** Ids of notices that just arrived by a live update (cleared after a few seconds). */
  fresh: string[];
  /** `silent` keeps the current list on screen (no spinner, no error) for live refreshes. */
  load: (query: BoardQuery, silent?: boolean) => Promise<void>;
  /** Live update: reloads the current view once, however many events arrive close together. */
  reload: () => void;
  /** Hides notices whose expiry time has passed (the server already stops sending them). */
  dropExpired: () => void;
  loadCategories: () => Promise<void>;
};

// Only the newest request may write its result, so a slow old answer never overwrites a newer one.
let latest = 0;
let lastQuery: BoardQuery = {};
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
export const FRESH_MS = 8000;

export const useNoticesStore = create<NoticesState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  loading: true,
  error: null,
  categories: [],
  fresh: [],

  async load(query, silent = false) {
    const id = ++latest;
    lastQuery = query;
    if (!silent) set({ loading: true, error: null });
    try {
      const data = await api<{ items: Notice[]; total: number; page: number; limit: number }>(
        "/notices",
        { query },
      );
      if (id === latest) {
        // A live refresh that brings notices the page did not have marks them as new for a moment.
        const seen = new Set(get().items.map((n) => n.id));
        const arrived =
          silent && seen.size > 0 ? data.items.filter((n) => !seen.has(n.id)).map((n) => n.id) : [];
        set({ ...data, loading: false, fresh: [...get().fresh, ...arrived] });
        if (arrived.length > 0) {
          setTimeout(
            () => set({ fresh: get().fresh.filter((x) => !arrived.includes(x)) }),
            FRESH_MS,
          );
        }
      }
    } catch {
      if (id === latest) set(silent ? {} : { loading: false, error: "Could not load notices." });
    }
  },

  reload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void get().load(lastQuery, true), 300);
  },

  dropExpired() {
    const now = Date.now();
    const live = get().items.filter((n) => !n.expiresAt || new Date(n.expiresAt).getTime() > now);
    const gone = get().items.length - live.length;
    if (gone > 0) set({ items: live, total: Math.max(0, get().total - gone) });
  },

  async loadCategories() {
    try {
      const { items } = await api<{ items: Category[] }>("/categories");
      set({ categories: items });
    } catch {
      // The filter just shows no categories; the board still works.
    }
  },
}));
