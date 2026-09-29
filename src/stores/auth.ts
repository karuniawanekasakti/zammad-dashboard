import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";
import { SESSION_LOG_REVEAL_KEY } from "@/lib/session-log";

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
      logout: () => {
        try {
          localStorage.removeItem(SESSION_LOG_REVEAL_KEY);
        } catch {
          // Storage failures must not prevent logout.
        }
        set({ user: null, token: null });
      },
    }),
    {
      name: "zm-auth",
    }
  )
);

export function useScope() {
  const user = useAuth((s) => s.user);
  return useMemo(
    () => ({ role: user?.role ?? "agent", group_ids: user?.group_ids ?? [], user_id: user?.id ?? "" }) as const,
    [user?.role, user?.group_ids, user?.id]
  );
}
