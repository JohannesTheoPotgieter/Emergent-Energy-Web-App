/**
 * FINANCE-ONLY MODULE REGISTRY — single source of truth for which product
 * modules are reachable, keyed by the existing page-registry `navGroup`.
 *
 * Why this exists
 * ---------------
 * The app is being run as a FINANCE-ONLY module: only Finance (plus the
 * platform plumbing finance depends on) is enabled; every other navGroup is
 * hard-disabled (hidden from nav AND blocked + redirected server/client-side).
 *
 * Reversibility (the whole point)
 * -------------------------------
 * To re-enable a module later, flip its navGroup entry in
 * `FINANCE_ONLY_MODULE_CONFIG.navGroups` from `{ mode: "disabled" }` to
 * `{ mode: "full" }` — a one-line change. Nav, routing, search scoping and the
 * no-access gate all derive from this map, so nothing else needs editing.
 * To turn the whole finance-only restriction off, set `FINANCE_ONLY_MODE` to
 * `false` (every helper then falls back to "everything enabled").
 *
 * See `docs/finance-freeze-runbook.md` § "Re-enabling a module" for the runbook.
 *
 * This module is imported by BOTH the client (`@shared/config/enabled-modules`)
 * and the server, and changes NO finance number, formula, or schema — it is a
 * pure navigation / access-surface configuration layer.
 */

import type { CompanyRole } from "../schema/users";

/** The page-registry nav-group keys (mirrors NAV_GROUP_KEYS in page-registry.ts). */
export type NavGroup =
  | "MY_WORK"
  | "PORTFOLIO"
  | "PRIORITIES"
  | "PROJECT_DEVELOPMENT"
  | "PROJECTS"
  | "PROJECT_MANAGEMENT"
  | "GATES"
  | "FINANCE"
  | "ENGINEERING"
  | "QUALITY"
  | "HSE"
  | "REPORTS"
  | "KNOWLEDGE"
  | "SYSTEM";

/**
 * A module is enabled either:
 *  - "full"     → every page in the nav-group is reachable;
 *  - "disabled" → the whole nav-group is hidden + blocked;
 *  - "partial"  → only the listed page IDs in the nav-group are reachable
 *                 (used for SYSTEM: only the finance plumbing is kept).
 */
export type ModuleEnablement =
  | { mode: "full" }
  | { mode: "disabled" }
  | { mode: "partial"; pageIds: readonly string[] };

export interface ModuleRegistryConfig {
  navGroups: Record<NavGroup, ModuleEnablement>;
}

/**
 * Plumbing pages inside the SYSTEM nav-group that finance depends on.
 * Audited against page-registry.ts SYSTEM entries (2026-06-11). Everything
 * else in SYSTEM (priority templates, doc-management admin, recovery, stage
 * lifecycle, phase/eng templates, workflow config, work-item linkage,
 * pipedrive, KPI traceability, email-linker, pending-approvals,
 * engineering-audit, lessons/handover-health, my-tool settings, data-migration
 * status) is intentionally DISABLED.
 *
 * Page IDs match `PageRegistryEntry.id` in client/src/config/page-registry.ts.
 */
export const ENABLED_SYSTEM_PAGE_IDS = [
  "settingsHome",            // /settings                     — settings hub
  "smartImport",             // /admin/smart-import           — Excel/tracker import
  "adminImportMappings",     // /admin/import-mappings        — import setup
  "adminImportControlTower", // /admin/import-control-tower   — import control tower
  "adminQuickBooks",         // /admin/quickbooks             — QuickBooks integration
  "sharepointIntake",        // /admin/sharepoint-intake      — SharePoint/Graph intake
  "adminRoles",              // /admin/roles                  — user & role admin
  "adminFunctionality",      // /admin/functionality          — functionality control
  "adminIntegrations",       // /admin/integrations           — integration statuses
  "adminActivity",           // /admin/activity-log           — audit log
  "adminSettings",           // /admin/settings               — system settings
] as const;

/**
 * THE registry. Re-enabling a module = change its entry to `{ mode: "full" }`.
 */
export const FINANCE_ONLY_MODULE_CONFIG: ModuleRegistryConfig = {
  navGroups: {
    // ── Enabled ───────────────────────────────────────────────────────────
    FINANCE: { mode: "full" },
    SYSTEM: { mode: "partial", pageIds: ENABLED_SYSTEM_PAGE_IDS },
    // ── Disabled (re-enable by flipping to { mode: "full" }) ──────────────
    MY_WORK: { mode: "disabled" },
    PORTFOLIO: { mode: "disabled" },
    PRIORITIES: { mode: "disabled" },
    PROJECT_DEVELOPMENT: { mode: "disabled" },
    PROJECTS: { mode: "disabled" },
    PROJECT_MANAGEMENT: { mode: "disabled" },
    GATES: { mode: "disabled" },
    ENGINEERING: { mode: "disabled" },
    QUALITY: { mode: "disabled" },
    HSE: { mode: "disabled" },
    REPORTS: { mode: "disabled" },
    KNOWLEDGE: { mode: "disabled" },
  },
};

/**
 * Master config switch — is the module registry finance-only?
 * Set to `false` to lift the finance-only configuration entirely.
 *
 * This is the CONFIG flag. Whether the restriction is actively ENFORCED in the
 * current runtime is `isFinanceOnlyEnforced()` below — finance-only is a
 * *deploy mode*: it enforces in production (and in unit tests, which lock the
 * behaviour) but stays inert in the integration / e2e harness and local dev so
 * the existing full-app api/e2e suite keeps validating every module.
 */
export const FINANCE_ONLY_MODE = true;

/**
 * Is the finance-only restriction actively enforced in THIS runtime?
 *
 * Enforced: production deploy (NODE_ENV=production) + unit tests
 * (vitest, NODE_ENV=test). NOT enforced: local dev and the
 * `script/run-with-app.ts` integration / e2e harness (server sets
 * API_TEST_MODE=true; client is served by `npm run dev` → NODE_ENV=development).
 *
 * `process.env.NODE_ENV` is statically inlined by Vite in the client bundle, so
 * this resolves correctly on the server, in vitest, and in the browser.
 */
export function isFinanceOnlyEnforced(): boolean {
  if (!FINANCE_ONLY_MODE) return false;
  // Local dev + the run-with-app e2e client (served by `npm run dev`) → full app.
  if (process.env.NODE_ENV === "development") return false;
  // Server-only harness flag — run-with-app sets it for test:api / release:gate.
  // Guarded so the lookup never runs in the browser bundle.
  if (
    typeof window === "undefined" &&
    typeof process !== "undefined" &&
    process.env.API_TEST_MODE === "true"
  ) {
    return false;
  }
  return true;
}

/** The config the production helpers read. */
export const ACTIVE_MODULE_CONFIG: ModuleRegistryConfig = FINANCE_ONLY_MODULE_CONFIG;

/** Where allowed users land / where disabled routes redirect to. */
export const FINANCE_ONLY_LANDING_PATH = "/finance";
/** Where disallowed roles are sent (the branded no-access landing). */
export const FINANCE_ONLY_NO_ACCESS_PATH = "/no-access";

/**
 * ROLE ALLOWLIST (locked) — management + finance roles that may enter the
 * finance module. Every entry is a real value in COMPANY_ROLES
 * (shared/schema/users.ts), enforced by the finance-only unit test.
 */
export const FINANCE_MODULE_ROLE_ALLOWLIST: readonly CompanyRole[] = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CFO",
  "PROGRAM_FINANCE_MANAGER",
  "ACCOUNTANT",
  "PROGRAM_MANAGER",
  "CONSTRUCTION_MANAGER",
];

// ---------------------------------------------------------------------------
// Pure helpers — take an explicit config so the reversibility test can verify
// behaviour against a modified registry without mutating module state.
// ---------------------------------------------------------------------------

export function isNavGroupEnabledIn(config: ModuleRegistryConfig, navGroup?: string | null): boolean {
  if (!navGroup) return false;
  const cfg = config.navGroups[navGroup as NavGroup];
  return !!cfg && cfg.mode !== "disabled";
}

export function isPageEnabledIn(
  config: ModuleRegistryConfig,
  page: { id?: string | null; navGroup?: string | null },
): boolean {
  const navGroup = page.navGroup;
  // Pages with no nav-group are detail/sub surfaces of a domain; they are only
  // reachable when their domain is fully enabled — never in finance-only mode.
  if (!navGroup) return false;
  const cfg = config.navGroups[navGroup as NavGroup];
  if (!cfg || cfg.mode === "disabled") return false;
  if (cfg.mode === "full") return true;
  return !!page.id && cfg.pageIds.includes(page.id);
}

export function isRoleAllowedIn(allowlist: readonly string[], role?: string | null): boolean {
  if (!role) return false;
  return allowlist.includes(role);
}

// ---------------------------------------------------------------------------
// Production wrappers — runtime-enforcement-aware, read ACTIVE_MODULE_CONFIG.
// When finance-only is NOT enforced in this runtime (dev / e2e harness) these
// all return "enabled / allowed" so the full app works.
// ---------------------------------------------------------------------------

/** Is a whole nav-group reachable in the current runtime? */
export function isNavGroupEnabled(navGroup?: string | null): boolean {
  if (!isFinanceOnlyEnforced()) return true;
  return isNavGroupEnabledIn(ACTIVE_MODULE_CONFIG, navGroup);
}

/** Is a specific page (by registry id + navGroup) reachable? */
export function isPageEnabled(page: { id?: string | null; navGroup?: string | null }): boolean {
  if (!isFinanceOnlyEnforced()) return true;
  return isPageEnabledIn(ACTIVE_MODULE_CONFIG, page);
}

/** May this company role enter the finance module at all? */
export function isRoleAllowedInFinanceModule(role?: string | null): boolean {
  if (!isFinanceOnlyEnforced()) return true;
  return isRoleAllowedIn(FINANCE_MODULE_ROLE_ALLOWLIST as readonly string[], role);
}

/**
 * Effective post-login landing path for the finance-only module.
 * Returns null when finance-only is not enforced (callers then use their legacy
 * role-landing logic).
 */
export function resolveFinanceOnlyLanding(role?: string | null): string | null {
  if (!isFinanceOnlyEnforced()) return null;
  return isRoleAllowedInFinanceModule(role)
    ? FINANCE_ONLY_LANDING_PATH
    : FINANCE_ONLY_NO_ACCESS_PATH;
}

// ---------------------------------------------------------------------------
// Search scoping — finance-domain entity types for the global search surface.
// ---------------------------------------------------------------------------

/** `type` values returned by /api/search that count as finance entities. */
export const FINANCE_SEARCH_TYPES = ["project", "cost", "revenue", "invoice", "po", "client"] as const;

export function isFinanceSearchType(type?: string | null): boolean {
  if (!isFinanceOnlyEnforced()) return true;
  return !!type && (FINANCE_SEARCH_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Server API gate — API path prefixes that stay reachable for everyone
// (auth/version/health/flags) even when a role is outside the allowlist, so
// login, logout, the no-access landing and version checks keep working.
// ---------------------------------------------------------------------------

export const FINANCE_ONLY_ALWAYS_ALLOWED_API_PREFIXES = [
  "/api/auth",
  "/api/version",
  "/api/environment",
  "/api/feature-flags",
  "/api/screen-settings",
] as const;

export function isAlwaysAllowedApiPath(pathname: string): boolean {
  return FINANCE_ONLY_ALWAYS_ALLOWED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
