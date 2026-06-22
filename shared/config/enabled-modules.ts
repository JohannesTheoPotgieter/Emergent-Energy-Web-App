/**
 * LIVE-READY MODULE REGISTRY — single source of truth for which product
 * modules are reachable, keyed by the existing page-registry `navGroup`.
 *
 * Why this exists
 * ---------------
 * The app is being run with a LIVE-READY ring fence: only the modules that are
 * production-ready are reachable — currently Finance and the Execution control
 * tower (plus the platform plumbing they depend on). Every other navGroup is
 * hard-disabled (hidden from nav AND blocked + redirected server/client-side)
 * until it too is promoted into the Live-Ready set.
 *
 * Reversibility (the whole point)
 * -------------------------------
 * To re-enable a module later, flip its navGroup entry in
 * `LIVE_READY_MODULE_CONFIG.navGroups` from `{ mode: "disabled" }` to
 * `{ mode: "full" }` — a one-line change. Nav, routing, search scoping and the
 * no-access gate all derive from this map, so nothing else needs editing.
 * To turn the whole live-ready restriction off, set `LIVE_READY_MODE` to
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
 * Execution control-tower pages inside the PROJECT_MANAGEMENT nav-group that are
 * Live-Ready. Only these are reachable — the rest of PROJECT_MANAGEMENT (All
 * Projects, Milestone Tracker, project detail, etc.) stays disabled, so the
 * Execution module is ring-fenced exactly like Finance.
 *
 * Page IDs match `PageRegistryEntry.id` in client/src/config/page-registry.ts.
 */
export const ENABLED_EXECUTION_PAGE_IDS = [
  "executionReview",       // /execution                    — control-tower board
  "executionMilestones",   // /execution/milestones         — payment milestone tracker
  "executionDeliveries",   // /execution/deliveries         — program deliveries
  "executionAllocations",  // /execution/allocations        — installer/supplier allocation
  "executionSite",         // /execution/site/:projectId    — per-site detail (+ critical path)
] as const;

/**
 * THE registry. Re-enabling a module = change its entry to `{ mode: "full" }`
 * (or `{ mode: "partial", pageIds: [...] }` to ring-fence specific pages).
 */
export const LIVE_READY_MODULE_CONFIG: ModuleRegistryConfig = {
  navGroups: {
    // ── Enabled (the Live-Ready set) ──────────────────────────────────────
    FINANCE: { mode: "full" },
    // Execution control tower — ring-fenced to its own pages within
    // PROJECT_MANAGEMENT (surfaces the "Execution" top tab / PROJECT_DELIVERY
    // section). Added 2026-06-19 as the second Live-Ready module.
    PROJECT_MANAGEMENT: { mode: "partial", pageIds: ENABLED_EXECUTION_PAGE_IDS },
    SYSTEM: { mode: "partial", pageIds: ENABLED_SYSTEM_PAGE_IDS },
    // ── Disabled (re-enable by flipping to { mode: "full" }) ──────────────
    MY_WORK: { mode: "disabled" },
    PORTFOLIO: { mode: "disabled" },
    PRIORITIES: { mode: "disabled" },
    PROJECT_DEVELOPMENT: { mode: "disabled" },
    PROJECTS: { mode: "disabled" },
    GATES: { mode: "disabled" },
    ENGINEERING: { mode: "disabled" },
    QUALITY: { mode: "disabled" },
    HSE: { mode: "disabled" },
    REPORTS: { mode: "disabled" },
    KNOWLEDGE: { mode: "disabled" },
  },
};

/**
 * Master config switch — is the module registry live-ready?
 * Set to `false` to lift the live-ready configuration entirely.
 *
 * This is the CONFIG flag. Whether the restriction is actively ENFORCED in the
 * current runtime is `isLiveReadyEnforced()` below — live-ready is a
 * *deploy mode*: it enforces in production (and in unit tests, which lock the
 * behaviour) but stays inert in the integration / e2e harness and local dev so
 * the existing full-app api/e2e suite keeps validating every module.
 */
export const LIVE_READY_MODE = true;

/**
 * Is the live-ready restriction actively enforced in THIS runtime?
 *
 * Live-Ready is a *deploy mode*. Enforced: the production deploy (the built
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
 * is invisible locally. `isLiveReadyDevOverrideOn()` is an OPT-IN switch that
 * turns enforcement ON in development for verification. It is strictly additive
 * — it can only flip enforcement from off→on where the base logic would be off
 * (dev / the harness); it can NEVER turn enforcement OFF in a production build,
 * because the production branches below `return true` before it is consulted.
 * See docs/finance-freeze-runbook.md § F.
 */
export function isLiveReadyEnforced(): boolean {
  if (!LIVE_READY_MODE) return false;

  // BROWSER: a production build ALWAYS enforces — checked first so no query
  // param / flag can ever weaken prod. The dev-served client enforces only when
  // the opt-in dev override is active.
  //
  // `import.meta.env.PROD` MUST be read as a direct member expression: Vite only
  // statically replaces this exact syntax (→ `true` in a production build,
  // `false` in dev). Reading it indirectly (a local alias or a cast over
  // `import.meta`) is NOT replaced and resolves to `undefined` in the browser,
  // which silently disables enforcement in production — the exact bug this
  // shape avoids. `import.meta.env` is typed for the server tsconfig (which has
  // no Vite types) by server/types/import-meta-env.d.ts; the server bundle
  // never reaches this branch because `window` is undefined there.
  if (typeof window !== "undefined") {
    if (import.meta.env.PROD === true) return true;
    return isLiveReadyDevOverrideOn();
  }

  // SERVER / vitest (node): enforce unless local dev or the run-with-app
  // harness — UNLESS the opt-in dev override turns it back on for testing.
  if (typeof process !== "undefined" && process.env) {
    if (isLiveReadyDevOverrideOn()) return true;
    if (process.env.NODE_ENV === "development") return false;
    if (process.env.API_TEST_MODE === "true") return false;
  }
  return true;
}

/**
 * Opt-in DEV override for `isLiveReadyEnforced()` — turn the live-ready
 * lockdown ON in development so the nav hiding, route redirects, no-access
 * landing and server API gate can be exercised and verified locally (the
 * restriction is otherwise inert in dev). Never weakens production; it can only
 * turn enforcement ON where it would otherwise be off.
 *
 * Activation (any of):
 *   - SERVER / vitest (node): env `LIVE_READY_DEV=1` (or `=true`). e.g.
 *       `LIVE_READY_DEV=1 npm run dev`
 *   - BROWSER (dev-served): Vite env `VITE_LIVE_READY_DEV=1`, the URL query
 *       `?liveReady=1` (persisted to `localStorage.liveReadyDev` so it
 *       survives client-side navigation), or a prior persisted flag.
 *       `?liveReady=0` clears the browser override.
 *
 * Best-effort and side-effect-light: it never throws (an enforcement check must
 * not crash the app) and reads `localStorage` / `location` defensively.
 */
export function isLiveReadyDevOverrideOn(): boolean {
  // SERVER / vitest (node)
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.LIVE_READY_DEV;
    if (v === "1" || v === "true") return true;
  }

  // BROWSER (dev-served client)
  if (typeof window !== "undefined") {
    try {
      // Direct member access so Vite statically replaces it (see the note in
      // isLiveReadyEnforced). Unset in a normal build → replaced with
      // `undefined`, so the override stays off unless explicitly provided.
      const viteFlag = import.meta.env.VITE_LIVE_READY_DEV;
      if (viteFlag === "1" || viteFlag === "true") return true;

      const store: Storage | undefined = window.localStorage;
      const q = new URLSearchParams(window.location.search).get("liveReady");
      if (q === "0" || q === "false") {
        store?.removeItem("liveReadyDev");
        return false;
      }
      if (q === "1" || q === "true") {
        store?.setItem("liveReadyDev", "1");
        return true;
      }
      if (store?.getItem("liveReadyDev") === "1") return true;
    } catch {
      // Best-effort only — never throw from an enforcement check.
    }
  }

  return false;
}

/** The config the production helpers read. */
export const ACTIVE_MODULE_CONFIG: ModuleRegistryConfig = LIVE_READY_MODULE_CONFIG;

/** Where allowed users land / where disabled routes redirect to. */
export const LIVE_READY_LANDING_PATH = "/finance";
/** Where disallowed roles are sent (the branded no-access landing). */
export const LIVE_READY_NO_ACCESS_PATH = "/no-access";

/**
 * ROLE ALLOWLIST (locked) — management + finance roles that may enter the
 * finance module. Every entry is a real value in COMPANY_ROLES
 * (shared/schema/users.ts), enforced by the live-ready unit test.
 */
export const LIVE_READY_ROLE_ALLOWLIST: readonly CompanyRole[] = [
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
  // reachable when their domain is fully enabled — never in live-ready mode.
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
// When live-ready is NOT enforced in this runtime (dev / e2e harness) these
// all return "enabled / allowed" so the full app works.
// ---------------------------------------------------------------------------

/** Is a whole nav-group reachable in the current runtime? */
export function isNavGroupEnabled(navGroup?: string | null): boolean {
  if (!isLiveReadyEnforced()) return true;
  return isNavGroupEnabledIn(ACTIVE_MODULE_CONFIG, navGroup);
}

/** Is a specific page (by registry id + navGroup) reachable? */
export function isPageEnabled(page: { id?: string | null; navGroup?: string | null }): boolean {
  if (!isLiveReadyEnforced()) return true;
  return isPageEnabledIn(ACTIVE_MODULE_CONFIG, page);
}

/** May this company role enter the finance module at all? */
export function isRoleAllowedInLiveReady(role?: string | null): boolean {
  if (!isLiveReadyEnforced()) return true;
  return isRoleAllowedIn(LIVE_READY_ROLE_ALLOWLIST as readonly string[], role);
}

/**
 * Effective post-login landing path for the live-ready module.
 * Returns null when live-ready is not enforced (callers then use their legacy
 * role-landing logic).
 */
export function resolveLiveReadyLanding(role?: string | null): string | null {
  if (!isLiveReadyEnforced()) return null;
  return isRoleAllowedInLiveReady(role)
    ? LIVE_READY_LANDING_PATH
    : LIVE_READY_NO_ACCESS_PATH;
}

// ---------------------------------------------------------------------------
// Search scoping — finance-domain entity types for the global search surface.
// ---------------------------------------------------------------------------

/** `type` values returned by /api/search that count as finance entities. */
export const FINANCE_SEARCH_TYPES = ["project", "cost", "revenue", "invoice", "po", "client"] as const;

export function isFinanceSearchType(type?: string | null): boolean {
  if (!isLiveReadyEnforced()) return true;
  return !!type && (FINANCE_SEARCH_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Server API gate — API path prefixes that stay reachable for everyone
// (auth/version/health/flags) even when a role is outside the allowlist, so
// login, logout, the no-access landing and version checks keep working.
// ---------------------------------------------------------------------------

export const LIVE_READY_ALWAYS_ALLOWED_API_PREFIXES = [
  "/api/auth",
  "/api/version",
  "/api/environment",
  "/api/feature-flags",
  "/api/screen-settings",
] as const;

export function isAlwaysAllowedApiPath(pathname: string): boolean {
  return LIVE_READY_ALWAYS_ALLOWED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
