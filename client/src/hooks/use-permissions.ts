import { useAuth } from "./use-auth";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, PermissionEntity, PermissionAction } from "@shared/schema";

interface PermissionsResponse {
  role?: string;
  entityPermissions?: Record<string, Record<string, boolean>> | null;
}

export function usePermission(entity: PermissionEntity, action: PermissionAction): { allowed: boolean; loading: boolean } {
  const { user, isLoading: authLoading } = useAuth();

  const { data: permissions, isLoading: permsLoading } = useQuery<PermissionsResponse>({
    queryKey: ["auth-permissions", user?.role],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (user?.role) headers["x-company-role"] = user.role;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!user?.role,
    staleTime: 60_000,
  });

  if (authLoading || permsLoading) {
    return { allowed: false, loading: true };
  }

  if (!user) {
    return { allowed: false, loading: false };
  }

  const ep = permissions?.entityPermissions;
  if (ep && ep[entity]) {
    if (ep[entity][action] === true) return { allowed: true, loading: false };
    if (ep[entity][action] === false) return { allowed: false, loading: false };
  }

  const allowed = checkPermission(user.role, entity, action);
  return { allowed, loading: false };
}
