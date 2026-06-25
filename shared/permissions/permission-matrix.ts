/**
 * Permission Matrix — Unified permission evaluation for frontend and backend.
 *
 * Both the frontend nav guard (useAccessMatrix) and the backend middleware
 * (permission-middleware) consume this module so permission logic is never duplicated.
 */

import type { PermissionEntity } from "../schema/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionAction = "view" | "edit";

export interface PermissionCheck {
  entity: PermissionEntity;
  action: PermissionAction;
}

export interface RolePermissionState {
  /** Section visibility keys (HOME, FINANCE, etc.) */
  sections: string[];
  /** Per-entity permission roles: entity → action → role[] */
  entityPermissions: Record<string, Record<PermissionAction, string[]>>;
  /** Per-user overrides: entity → action → boolean */
  userOverrides?: Record<string, Record<PermissionAction, boolean>>;
  /** Flags */
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a role has permission to perform an action on an entity.
 * This is the SINGLE permission check used by both frontend and backend.
 *
 * Priority:
 *   1. User-specific overrides (if present) — always win
 *   2. Entity permission defaults — role must be in the allowed roles list
 *   3. Admin fallback — COO_ADMIN and CEO_ADMIN have implicit access to everything
 */
export function hasPermission(
  userRole: string,
  check: PermissionCheck,
  state: RolePermissionState,
): boolean {
  // 1. User-specific overrides
  const overrides = state.userOverrides?.[check.entity];
  if (overrides && check.action in overrides) {
    return overrides[check.action];
  }

  // 2. Entity permission roles
  const entityPerms = state.entityPermissions[check.entity];
  if (entityPerms) {
    const allowedRoles = entityPerms[check.action];
    if (allowedRoles && allowedRoles.includes(userRole)) {
      return true;
    }
  }

  // 3. Admin fallback
  if (userRole === "COO_ADMIN" || userRole === "CEO_ADMIN") {
    return true;
  }

  return false;
}

/**
 * Check if a role can view a given path based on the permission entity
 * resolved from the route registry.
 */
export function canViewPath(
  userRole: string,
  permissionEntity: PermissionEntity | undefined,
  state: RolePermissionState,
): boolean {
  if (!permissionEntity) return false;
  return hasPermission(userRole, { entity: permissionEntity, action: "view" }, state);
}

/**
 * Filter a list of routes to only those the user can view.
 */
export function filterVisibleRoutes<T extends { permissionEntity?: PermissionEntity }>(
  routes: T[],
  userRole: string,
  state: RolePermissionState,
): T[] {
  return routes.filter(route =>
    route.permissionEntity
      ? hasPermission(userRole, { entity: route.permissionEntity, action: "view" }, state)
      : false
  );
}

// ---------------------------------------------------------------------------
// Section visibility
// ---------------------------------------------------------------------------

/**
 * Maps navigation groups from the route registry to section keys.
 * Routes are only visible if their section is enabled for the user's role.
 */
export const NAV_GROUP_TO_SECTION: Record<string, string> = {
  MY_WORK: "HOME",
  EXCO: "EXCO",
  PROJECTS: "PROJECT_DELIVERY",
  PROJECT_DEVELOPMENT: "PROJECT_DEVELOPMENT",
  PROJECT_MANAGEMENT: "PROJECT_DELIVERY",
  ENGINEERING: "ENGINEERING",
  QUALITY: "QUALITY",
  HSE: "HSE",
  GATES: "PORTFOLIO",
  FINANCE: "FINANCE",
  KNOWLEDGE: "ADMIN",
  FEEDBACK: "ADMIN",
  PRIORITIES: "PRIORITIES",
  PORTFOLIO: "PORTFOLIO",
  REPORTS: "REPORTS",
  SYSTEM: "ADMIN",
};

/**
 * Check if a nav group is visible for a role based on their sections.
 */
export function isSectionVisible(navGroup: string, sections: string[]): boolean {
  const section = NAV_GROUP_TO_SECTION[navGroup];
  if (!section) return false;
  return sections.includes(section);
}
