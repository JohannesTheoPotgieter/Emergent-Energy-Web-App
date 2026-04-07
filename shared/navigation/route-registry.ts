/**
 * Route Registry — Single source of truth for valid application routes.
 *
 * Rules:
 * 1. Every renderable route MUST have a routeComponentKey.
 * 2. Every route MUST have a permissionEntity (no ungated routes except auth pages).
 * 3. Redirects are aliases (type: "alias") with a redirectTo — they do NOT render components.
 * 4. No redirect chains: a redirect target must be a renderable route, never another redirect.
 * 5. LEGACY_REDIRECTS are for old bookmarks only and are NOT routes.
 */

import type { PermissionEntity } from "../schema/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteEntry {
  /** Unique identifier */
  id: string;
  /** URL path pattern (may contain :params) */
  path: string;
  /** Human-readable label */
  label: string;
  /** 'page' = renders a component; 'alias' = client-side redirect */
  type: "page" | "alias";
  /** Permission entity required to access this route */
  permissionEntity: PermissionEntity;
  /** Component key for lazy loading (required for type: 'page') */
  routeComponentKey?: string;
  /** Redirect target (required for type: 'alias') */
  redirectTo?: string;
  /** Show in sidebar navigation */
  showInSidebar?: boolean;
  /** Icon key for sidebar */
  iconKey?: string;
  /** Navigation group for sidebar organization */
  navGroup?: string;
  /** Alternative paths that resolve to this route */
  aliases?: string[];
  /** Roles eligible for this as landing page */
  roleLandingEligibility?: string[];
  /** Match sub-routes for permission checks */
  matchSubRoutes?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RouteValidationError {
  routeId: string;
  message: string;
}

/**
 * Validate the route registry for structural integrity.
 * Called by architecture contract tests.
 */
export function validateRouteRegistry(routes: RouteEntry[]): RouteValidationError[] {
  const errors: RouteValidationError[] = [];
  const pathSet = new Set<string>();
  const redirectTargets = new Set<string>();

  for (const route of routes) {
    // No duplicate paths
    if (pathSet.has(route.path)) {
      errors.push({ routeId: route.id, message: `Duplicate path: ${route.path}` });
    }
    pathSet.add(route.path);

    // Pages must have a component key
    if (route.type === "page" && !route.routeComponentKey) {
      errors.push({ routeId: route.id, message: "Page route missing routeComponentKey" });
    }

    // Aliases must have a redirect target
    if (route.type === "alias" && !route.redirectTo) {
      errors.push({ routeId: route.id, message: "Alias route missing redirectTo" });
    }

    // All routes must have a permission entity
    if (!route.permissionEntity) {
      errors.push({ routeId: route.id, message: "Route missing permissionEntity" });
    }

    if (route.redirectTo) {
      redirectTargets.add(route.redirectTo);
    }
  }

  // No redirect chains: redirect targets must not be aliases
  for (const route of routes) {
    if (route.type === "alias" && route.redirectTo) {
      const target = routes.find(r => r.path === route.redirectTo);
      if (target?.type === "alias") {
        errors.push({
          routeId: route.id,
          message: `Redirect chain: ${route.path} → ${route.redirectTo} → ${target.redirectTo}`,
        });
      }
    }
  }

  return errors;
}

/**
 * Check if a legacy redirect target is itself a redirect source (chain detection).
 */
export function detectRedirectChains(
  legacyRedirects: Array<{ path: string; redirectTo: string }>,
  routes: RouteEntry[],
): string[] {
  const chains: string[] = [];
  const redirectSources = new Set(legacyRedirects.map(r => r.path));

  for (const redirect of legacyRedirects) {
    // Target is also a legacy redirect source
    if (redirectSources.has(redirect.redirectTo)) {
      chains.push(`${redirect.path} → ${redirect.redirectTo} (target is also a redirect source)`);
    }
    // Target is an alias route
    const targetRoute = routes.find(r => r.path === redirect.redirectTo);
    if (targetRoute?.type === "alias") {
      chains.push(`${redirect.path} → ${redirect.redirectTo} → ${targetRoute.redirectTo} (alias chain)`);
    }
  }

  return chains;
}

// ---------------------------------------------------------------------------
// Route access utilities (shared between frontend and backend)
// ---------------------------------------------------------------------------

/**
 * Resolve the permission entity required for a given path.
 * Matches exact paths, parameterized paths, and sub-routes.
 */
export function resolvePermissionEntity(
  pathname: string,
  routes: RouteEntry[],
): PermissionEntity | undefined {
  const normalized = normalizePath(pathname);

  // Exact match first
  const exact = routes.find(r =>
    normalizePath(r.path) === normalized ||
    r.aliases?.some(a => normalizePath(a) === normalized)
  );
  if (exact) return exact.permissionEntity;

  // Parameterized match
  const paramMatch = routes
    .filter(r => r.path.includes(":"))
    .sort((a, b) => b.path.length - a.path.length)
    .find(r => matchesPattern(normalized, r.path));
  if (paramMatch) return paramMatch.permissionEntity;

  // Sub-route match
  const subMatch = routes
    .filter(r => r.matchSubRoutes)
    .sort((a, b) => b.path.length - a.path.length)
    .find(r => normalized.startsWith(normalizePath(r.path) + "/"));
  if (subMatch) return subMatch.permissionEntity;

  return undefined;
}

function normalizePath(p: string): string {
  const clean = p.split("?")[0].split("#")[0].trim().toLowerCase();
  if (clean.length > 1 && clean.endsWith("/")) return clean.slice(0, -1);
  return clean || "/";
}

function matchesPattern(pathname: string, pattern: string): boolean {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = normalizePath(pattern).split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return false;
  return patternParts.every((part, i) => part.startsWith(":") || part === pathParts[i]);
}
