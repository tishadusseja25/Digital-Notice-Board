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
  load: (query: BoardQuery) => Promise<void>;
  loadCategories: () => Promise<void>;
};

// Only the newest request may write its result, so a slow old answer never overwrites a newer one.
let latest = 0;

export const useNoticesStore = create<NoticesState>((set) => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  loading: true,
  error: null,
  categories: [],

  async load(query) {
    const id = ++latest;
    set({ loading: true, error: null });
    try {
      const data = await api<{ items: Notice[]; total: number; page: number; limit: number }>(
        "/notices",
        { query },
      );
      if (id === latest) set({ ...data, loading: false });
    } catch {
      if (id === latest) set({ loading: false, error: "Could not load notices." });
    }
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
