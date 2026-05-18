import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeRoleForPermissions, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { parseDisabledSubPages } from "@/config/app-navigation";
import { evaluateEntityAccess, evaluatePathAccess } from "@/config/runtime-access";
import { useAuth } from "./use-auth";
import { useLensContext } from "./use-lens-context";

interface PermissionsResponse {
  entityPermissions?: Record<string, Record<string, boolean>> | null;
  userOverrides?: Record<string, boolean> | null;
  sections?: string[] | null;
}

export function useAccessMatrix() {
  const { user, isLoading: authLoading } = useAuth();
  const lens = useLensContext();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;

  // When simulating, use the lens's effective permission role instead of localStorage
  const effectiveRole = lens.simulation
    ? normalizeRoleForPermissions(lens.effectivePermissionRole)
    : normalizeRoleForPermissions(companyRole || user?.role || null);

  const {
    data: permissions,
    isLoading: permissionsLoading,
    isError: permissionsError,
    refetch: refetchPermissions,
  } = useQuery<PermissionsResponse>({
    queryKey: ["auth-permissions-matrix", effectiveRole],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (effectiveRole) headers["x-company-role"] = effectiveRole;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      if (!res.ok) throw new Error(`permissions http ${res.status}`);
      return res.json();
    },
    enabled: !!effectiveRole,
    staleTime: 30_000,
    retry: 1,
  });

  const disabledSubPages = useMemo(() => {
    const s = permissions?.sections;
    if (!s || s.length === 0) return null;
    const parsed = parseDisabledSubPages(s);
    return parsed.size > 0 ? parsed : null;
  }, [permissions?.sections]);

  const canAccessEntityAction = useMemo(() => {
    return (entity: PermissionEntity, action: PermissionAction) => {
      if (!effectiveRole) return false;
      return evaluateEntityAccess({
        role: effectiveRole,
        entity,
        action,
        snapshot: {
          sections: permissions?.sections,
          entityPermissions: permissions?.entityPermissions,
          userOverrides: permissions?.userOverrides,
        },
      });
    };
  }, [effectiveRole, permissions?.sections, permissions?.entityPermissions, permissions?.userOverrides]);

  const canViewPath = useMemo(() => {
    return (path: string) => {
      const result = evaluatePathAccess({
        role: effectiveRole,
        path,
        snapshot: {
          sections: permissions?.sections,
          entityPermissions: permissions?.entityPermissions,
          userOverrides: permissions?.userOverrides,
        },
        failOpenForUnknown: false,
      });
      return result.allowed;
    };
  }, [effectiveRole, permissions?.sections, permissions?.entityPermissions, permissions?.userOverrides]);

  return {
    effectiveRole,
    canAccessEntityAction,
    canViewPath,
    disabledSubPages,
    loading: authLoading || permissionsLoading,
    permissionsError,
    refetchPermissions,
  };
}
