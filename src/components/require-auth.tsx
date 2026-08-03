import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import type { Role } from "@/types";

interface Props {
  roles?: Role[];
  children: ReactNode;
}

/**
 * Wraps a route; redirects to /login if not authenticated,
 * and to /dashboard if role is not permitted.
 */
export function RequireAuth({ roles, children }: Props) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
