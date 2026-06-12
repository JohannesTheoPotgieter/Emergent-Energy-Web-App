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
 * Finance-only is a *deploy mode*. Enforced: the production deploy (the built
 * client bundle in the browser + NODE_ENV=production on the server) and unit
 * tests (vitest, node), which lock the behaviour. NOT enforced: local dev and
 * the `script/run-with-app.ts` integration / e2e harness, so the existing
 * full-app api + e2e suite keeps validating every module.
 *
 * Detection differs by runtime because `process.env.NODE_ENV` is NOT reliable
 * in the Vite-dev-served browser bundle:
 *   - BROWSER → use Vite's canonical `import.meta.env.PROD`, which is true ONLY
 *     for a `vite build` (the production deploy) and false for the dev-served
 *     client (`npm run dev`, including the run-with-app e2e harness).
 *   - SERVER / vitest (node) → use `process.env`: not enforced in local dev
 *     (NODE_ENV=development) or the harness (API_TEST_MODE=true); enforced
 *     otherwise (production server + vitest's NODE_ENV=test).
 *
 * DEV override: because the restriction is normally inert in dev, the lockdown
 * is invisible locally. `isFinanceOnlyDevOverrideOn()` is an OPT-IN switch that
 * turns enforcement ON in development for verification. It is strictly additive
 * — it can only flip enforcement from off→on where the base logic would be off
 * (dev / the harness); it can NEVER turn enforcement OFF in a production build,
 * because the production branches below `return true` before it is consulted.
 * See docs/finance-freeze-runbook.md § F.
 */
export function isFinanceOnlyEnforced(): boolean {
  if (!FINANCE_ONLY_MODE) return false;

  // BROWSER: a production build ALWAYS enforces — checked first so no query
  // param / flag can ever weaken prod. The dev-served client enforces only when
  // the opt-in dev override is active. `import.meta` is read defensively (the
  // server tsconfig has no Vite env types; the server bundle never reaches this
  // branch because `window` is undefined there).
  if (typeof window !== "undefined") {
    const meta = import.meta as unknown as { env?: { PROD?: boolean } };
    if (meta.env?.PROD === true) return true;
    return isFinanceOnlyDevOverrideOn();
  }

  // SERVER / vitest (node): enforce unless local dev or the run-with-app
  // harness — UNLESS the opt-in dev override turns it back on for testing.
  if (typeof process !== "undefined" && process.env) {
    if (isFinanceOnlyDevOverrideOn()) return true;
    if (process.env.NODE_ENV === "development") return false;
    if (process.env.API_TEST_MODE === "true") return false;
  }
  return true;
}

/**
 * Opt-in DEV override for `isFinanceOnlyEnforced()` — turn the finance-only
 * lockdown ON in development so the nav hiding, route redirects, no-access
 * landing and server API gate can be exercised and verified locally (the
 * restriction is otherwise inert in dev). Never weakens production; it can only
 * turn enforcement ON where it would otherwise be off.
 *
 * Activation (any of):
 *   - SERVER / vitest (node): env `FINANCE_ONLY_DEV=1` (or `=true`). e.g.
 *       `FINANCE_ONLY_DEV=1 npm run dev`
 *   - BROWSER (dev-served): Vite env `VITE_FINANCE_ONLY_DEV=1`, the URL query
 *       `?financeOnly=1` (persisted to `localStorage.financeOnlyDev` so it
 *       survives client-side navigation), or a prior persisted flag.
 *       `?financeOnly=0` clears the browser override.
 *
 * Best-effort and side-effect-light: it never throws (an enforcement check must
 * not crash the app) and reads `localStorage` / `location` defensively.
 */
export function isFinanceOnlyDevOverrideOn(): boolean {
  // SERVER / vitest (node)
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.FINANCE_ONLY_DEV;
    if (v === "1" || v === "true") return true;
  }

  // BROWSER (dev-served client)
  if (typeof window !== "undefined") {
    try {
      const meta = import.meta as unknown as { env?: { VITE_FINANCE_ONLY_DEV?: string } };
      const viteFlag = meta.env?.VITE_FINANCE_ONLY_DEV;
      if (viteFlag === "1" || viteFlag === "true") return true;

      const store: Storage | undefined = window.localStorage;
      const q = new URLSearchParams(window.location.search).get("financeOnly");
      if (q === "0" || q === "false") {
        store?.removeItem("financeOnlyDev");
        return false;
      }
      if (q === "1" || q === "true") {
        store?.setItem("financeOnlyDev", "1");
        return true;
      }
      if (store?.getItem("financeOnlyDev") === "1") return true;
    } catch {
      // Best-effort only — never throw from an enforcement check.
    }
  }

  return false;
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
