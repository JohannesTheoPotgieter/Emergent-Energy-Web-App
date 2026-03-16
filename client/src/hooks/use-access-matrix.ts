import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { getPermissionEntityForPath } from "@/config/page-registry";
import { useAuth } from "./use-auth";

interface PermissionsResponse {
  entityPermissions?: Record<string, Record<string, boolean>> | null;
}

export function useAccessMatrix() {
  const { user, isLoading: authLoading } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const effectiveRole = normalizeRoleForPermissions(companyRole || user?.role || null);

  const { data: permissions, isLoading: permissionsLoading } = useQuery<PermissionsResponse>({
    queryKey: ["auth-permissions-matrix", effectiveRole],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (effectiveRole) headers["x-company-role"] = effectiveRole;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!effectiveRole,
    staleTime: 60_000,
  });

  const canAccessEntityAction = useMemo(() => {
    return (entity: PermissionEntity, action: PermissionAction) => {
      if (!effectiveRole) return false;

      const entityPermissions = permissions?.entityPermissions as Partial<Record<PermissionEntity, Record<string, boolean>>> | undefined;
      const explicit = entityPermissions?.[entity];
      if (explicit && typeof explicit[action] === "boolean") {
        return explicit[action] === true;
      }

      return checkPermission(effectiveRole, entity, action);
    };
  }, [effectiveRole, permissions?.entityPermissions]);

  const canViewPath = useMemo(() => {
    return (path: string) => {
      if (path === "/") return true;
      const entity = getPermissionEntityForPath(path);
      if (!entity) return true;
      return canAccessEntityAction(entity, "view");
    };
  }, [canAccessEntityAction]);

  return {
    effectiveRole,
    canAccessEntityAction,
    canViewPath,
    loading: authLoading || permissionsLoading,
  };
}
