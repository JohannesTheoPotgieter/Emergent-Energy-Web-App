/**
 * Prompt 15 — Simplified permission hook
 *
 * Reads permissions from the server via /api/auth/permissions.
 * Also exports useV2Permissions() for reading V2 API-embedded permissions
 * from the React Query cache.
 */

import { useAuth } from "./use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions, PermissionEntity, PermissionAction } from "@shared/schema";
import type { ProjectPermissions } from "@shared/api-types/project-v2";

interface PermissionsResponse {
  role?: string;
  entityPermissions?: Record<string, Record<string, boolean>> | null;
  userOverrides?: Record<string, boolean> | null;
}

export function usePermission(entity: PermissionEntity, action: PermissionAction): { allowed: boolean; loading: boolean } {
  const { user, isLoading: authLoading } = useAuth();

  const { data: permissions, isLoading: permsLoading } = useQuery<PermissionsResponse>({
    queryKey: ["auth-permissions", user?.role],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (user?.role) headers["x-company-role"] = normalizeRoleForPermissions(user.role);
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

  // Check user-specific overrides first (highest priority)
  const overrideKey = `${entity}:${action}`;
  const userOverrides = permissions?.userOverrides;
  if (userOverrides && overrideKey in userOverrides) {
    return { allowed: userOverrides[overrideKey], loading: false };
  }

  // Then check DB entity permission overrides
  const ep = permissions?.entityPermissions;
  if (ep && ep[entity]) {
    if (ep[entity][action] === true) return { allowed: true, loading: false };
    if (ep[entity][action] === false) return { allowed: false, loading: false };
  }

  // Fall back to hardcoded defaults
  const allowed = checkPermission(normalizeRoleForPermissions(user.role), entity, action);
  return { allowed, loading: false };
}

/**
 * Read V2-embedded project permissions from the React Query cache.
 * Returns null if the project hasn't been loaded via V2 yet.
 */
export function useV2ProjectPermissions(projectId: number | undefined): ProjectPermissions | null {
  const queryClient = useQueryClient();
  if (!projectId) return null;

  const cached = queryClient.getQueryData<{ permissions?: ProjectPermissions }>(["v2-project-detail", projectId]);
  return cached?.permissions ?? null;
}
