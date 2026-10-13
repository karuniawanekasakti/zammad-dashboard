import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";

/**
 * Confirms the persisted login still maps to a real session when the app opens.
 * The persisted user alone proves nothing: the server may have expired the token
 * (or, in mock mode, no longer know the user). A 401 is already handled by the
 * API client; a null result means "no such session" and signs the user out.
 */
export function useSessionCheck() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const session = useQuery({
    queryKey: ["session", user?.id],
    queryFn: () => api.me(user!.id),
    enabled: !!user,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (session.isSuccess && session.data === null) {
      logout();
      navigate("/login", { replace: true });
    }
  }, [session.isSuccess, session.data, logout, navigate]);
}
