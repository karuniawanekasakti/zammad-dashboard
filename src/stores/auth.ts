import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  token: string | null;
  setUser: (u: User | null) => void;
  setToken: (t: string | null) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setUser: (u) => set({ user: u }),
      setToken: (t) => set({ token: t }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: "zm-auth",
    }
  )
);

export function useScope() {
  const user = useAuth((s) => s.user);
  return {
    role: user?.role ?? "agent",
    group_ids: user?.group_ids ?? [],
    user_id: user?.id ?? "",
  } as const;
}
