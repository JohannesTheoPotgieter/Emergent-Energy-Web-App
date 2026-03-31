import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { getPermissionEntityForPath, getAppSectionForPath } from "@/config/page-registry";
import { useAuth } from "./use-auth";

interface PermissionsResponse {
  entityPermissions?: Record<string, Record<string, boolean>> | null;
  userOverrides?: Record<string, boolean> | null;
  sections?: string[] | null;
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
    staleTime: 30_000,
  });

  // Normalize legacy section keys to the current 6-section navigation model.
  // Existing DB records may still contain old keys (COCKPIT, MONEY, etc.).
  // Normalize legacy + current section keys to the 8-section nav model.
  // DB records may contain old keys (COCKPIT, MONEY, etc.) or
  // the intermediate 6-section keys (PROJECTS, REPORTS, etc.).
  const OLD_TO_NEW_SECTIONS: Record<string, string[]> = {
    // Legacy keys
    COCKPIT: ["HOME"],
    MONEY: ["FINANCE"],
    INFORMATION: ["ADMIN"],
    COLLABORATION: ["HOME"],
    // Intermediate 6-section model keys
    PROJECTS: ["PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE"],
    MY_WORK: ["HOME"],
    GATES: ["PORTFOLIO"],
    // Legacy combined section — expand to both new sections
    QUALITY_HSE: ["QUALITY", "HSE"],
    // Standalone QUALITY always implies HSE visibility
    QUALITY: ["QUALITY", "HSE"],
    // Legacy department keys
    GOVERNANCE: ["QUALITY", "HSE"],
    PROJECT_MANAGEMENT: ["PROJECT_DELIVERY"],
  };

  // Build a set of allowed sections from the role's section toggles
  const allowedSections = useMemo(() => {
    const s = permissions?.sections;
    if (!s || s.length === 0) return null;
    const normalized = new Set<string>();
    for (const key of s) {
      const mapped = OLD_TO_NEW_SECTIONS[key];
      if (mapped) {
        for (const k of mapped) normalized.add(k);
      } else {
        normalized.add(key);
      }
    }
    return normalized;
  }, [permissions?.sections]);

  const canAccessEntityAction = useMemo(() => {
    return (entity: PermissionEntity, action: PermissionAction) => {
      if (!effectiveRole) return false;

      // Check user-specific overrides first (highest priority)
      const overrideKey = `${entity}:${action}`;
      const userOverrides = permissions?.userOverrides;
      if (userOverrides && overrideKey in userOverrides) {
        return userOverrides[overrideKey];
      }

      // Then check DB entity permission overrides
      const entityPermissions = permissions?.entityPermissions as Partial<Record<PermissionEntity, Record<string, boolean>>> | undefined;
      const explicit = entityPermissions?.[entity];
      if (explicit && typeof explicit[action] === "boolean") {
        return explicit[action] === true;
      }

      // Fall back to hardcoded defaults
      return checkPermission(effectiveRole, entity, action);
    };
  }, [effectiveRole, permissions?.entityPermissions, permissions?.userOverrides]);

  const canViewPath = useMemo(() => {
    return (path: string) => {
      if (path === "/") return true;

      // Section-level gate: if the role's allowed sections don't include
      // the section this path belongs to, deny access immediately.
      // This is what makes the Admin → Roles & Permissions → Navigation
      // toggles actually control top-level nav visibility.
      if (allowedSections) {
        const section = getAppSectionForPath(path);
        if (section && !allowedSections.has(section)) {
          return false;
        }
      }

      const entity = getPermissionEntityForPath(path);
      if (!entity) return true;
      return canAccessEntityAction(entity, "view");
    };
  }, [canAccessEntityAction, allowedSections]);

  return {
    effectiveRole,
    canAccessEntityAction,
    canViewPath,
    loading: authLoading || permissionsLoading,
  };
}
