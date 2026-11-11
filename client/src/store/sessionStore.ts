import { create } from "zustand";
import { api, setSessionLostHandler } from "../lib/api";

export type Role = "committee" | "admin";
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
};

type SessionState = {
  user: User | null;
  /** "loading" until the first /auth/me answer, so guards do not redirect too early. */
  status: "loading" | "ready";
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  user: null,
  status: "loading",

  async init() {
    try {
      const { user } = await api<{ user: User }>("/auth/me");
      set({ user, status: "ready" });
    } catch {
      set({ user: null, status: "ready" }); // 401 or offline: treat as a visitor
    }
  },

  async login(email, password) {
    const { user } = await api<{ user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    set({ user, status: "ready" });
    return user;
  },

  async changePassword(current, next) {
    await api("/auth/password", { method: "POST", body: { current, next } });
    // The server cleared the flag; mirror it without another request.
    const user = get().user;
    if (user) set({ user: { ...user, mustChangePassword: false } });
  },

  async logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      set({ user: null });
    }
  },
}));

// If a refresh fails mid-session, drop the user so the UI shows "Sign in" again.
setSessionLostHandler(() => useSessionStore.setState({ user: null }));
