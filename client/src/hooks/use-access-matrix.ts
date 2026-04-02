import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { checkPermission, normalizeRoleForPermissions, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { getPermissionEntityForPath, getAppSectionForPath } from "@/config/page-registry";
import { parseDisabledSubPages } from "@/config/app-navigation";
import { NAVIGATION_PERMISSION_MODEL, validateNavigationPermissionModel } from "@/config/navigation-permissions";
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

  const allowedSections = useMemo(() => {
    const s = permissions?.sections;
    if (!s || s.length === 0) return null;
    const normalized = new Set<string>();
    for (const key of s) {
      if (key.startsWith("!")) continue;
      const mapped = OLD_TO_NEW_SECTIONS[key];
      if (mapped) {
        for (const k of mapped) normalized.add(k);
      } else {
        normalized.add(key);
      }
    }
    return normalized;
  }, [permissions?.sections]);

  const disabledSubPages = useMemo(() => {
    const s = permissions?.sections;
    if (!s || s.length === 0) return null;
    const parsed = parseDisabledSubPages(s);
    return parsed.size > 0 ? parsed : null;
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
    if (import.meta.env.DEV) {
      validateNavigationPermissionModel().forEach((warning) => {
        console.warn(`[NavPermissions] ${warning}`);
      });
    }
    const knownNavPaths = new Set(
      NAVIGATION_PERMISSION_MODEL.flatMap((section) => section.items.map((item) => item.path.split("?")[0])),
    );
    return (path: string) => {
      if (path === "/") return true;

      if (allowedSections) {
        const section = getAppSectionForPath(path);
        if (!section && import.meta.env.DEV && knownNavPaths.has(path.split("?")[0])) {
          console.warn(`[AccessMatrix] Missing section mapping for nav path "${path}". This can cause permission drift.`);
        }
        if (section && !allowedSections.has(section)) {
          return false;
        }
      }

      if (disabledSubPages) {
        for (const [sectionKey, paths] of disabledSubPages) {
          if (paths.has(path)) return false;
        }
      }

      const entity = getPermissionEntityForPath(path);
      if (!entity && import.meta.env.DEV && knownNavPaths.has(path.split("?")[0])) {
        console.warn(`[AccessMatrix] Missing permission entity mapping for nav path "${path}". Falling back to allow to avoid false deny.`);
      }
      if (!entity) return true;
      return canAccessEntityAction(entity, "view");
    };
  }, [canAccessEntityAction, allowedSections, disabledSubPages]);

  return {
    effectiveRole,
    canAccessEntityAction,
    canViewPath,
    disabledSubPages,
    loading: authLoading || permissionsLoading,
  };
}
