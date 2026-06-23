import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_READY_MODE,
  isLiveReadyEnforced,
  isLiveReadyDevOverrideOn,
  LIVE_READY_MODULE_CONFIG,
  LIVE_READY_LANDING_PATH,
  LIVE_READY_NO_ACCESS_PATH,
  LIVE_READY_ROLE_ALLOWLIST,
  ENABLED_SYSTEM_PAGE_IDS,
  ENABLED_EXECUTION_PAGE_IDS,
  ENABLED_ENGINEERING_PAGE_IDS,
  ACTIVE_MODULE_CONFIG,
  type ModuleRegistryConfig,
  isNavGroupEnabledIn,
  isPageEnabledIn,
  isNavGroupEnabled,
  isPageEnabled,
  isRoleAllowedInLiveReady,
  resolveLiveReadyLanding,
  isAlwaysAllowedApiPath,
  isFinanceSearchType,
} from "@shared/config/enabled-modules";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { isSectionModuleEnabled, filterSectionsByEnabledModules } from "@/config/app-navigation";
import { COMPANY_ROLES } from "@shared/schema/users";

/**
 * Live-Ready module contract + REVERSIBILITY proof (task GP7).
 *
 * These tests lock the live-ready configuration AND prove that re-enabling a
 * module is a one-line registry change: flipping a navGroup to { mode: "full" }
 * restores its routes (isPageEnabledIn) and its nav (isNavGroupEnabledIn →
 * section gate), while disabled routes redirect to /finance.
 */

describe("live-ready module — runtime enforcement (deploy-mode)", () => {
  // Live-Ready is a deploy mode: enforced in production + unit tests, but
  // inert in the run-with-app integration/e2e harness (server API_TEST_MODE,
  // client served by `npm run dev`) and local dev, so the existing full-app
  // api/e2e suite keeps validating every module. This guards that contract —
  // it is the reason CI's test:api / release:gate stay green.
  const origNodeEnv = process.env.NODE_ENV;
  const origApiTestMode = process.env.API_TEST_MODE;
  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origApiTestMode === undefined) delete process.env.API_TEST_MODE;
    else process.env.API_TEST_MODE = origApiTestMode;
  });

  it("enforces by default (vitest / production-like)", () => {
    delete process.env.API_TEST_MODE;
    process.env.NODE_ENV = "test";
    expect(isLiveReadyEnforced()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isLiveReadyEnforced()).toBe(true);
  });

  it("is INERT in the integration/e2e harness (API_TEST_MODE=true)", () => {
    process.env.NODE_ENV = "test";
    process.env.API_TEST_MODE = "true";
    expect(isLiveReadyEnforced()).toBe(false);
  });

  it("is INERT in development (local dev + run-with-app e2e client)", () => {
    delete process.env.API_TEST_MODE;
    process.env.NODE_ENV = "development";
    expect(isLiveReadyEnforced()).toBe(false);
  });

  it("when inert, the wrappers behave as full-app (nothing blocked)", () => {
    process.env.NODE_ENV = "development";
    expect(isNavGroupEnabled("ENGINEERING")).toBe(true);
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isRoleAllowedInLiveReady("ENGINEER")).toBe(true);
    expect(resolveLiveReadyLanding("ENGINEER")).toBeNull();
    expect(isFinanceSearchType("task")).toBe(true);
  });
});

describe("live-ready module — opt-in DEV override (verify the lockdown locally)", () => {
  // The override turns enforcement ON in development for testing WITHOUT
  // weakening production. These tests pin: (1) default dev stays unrestricted;
  // (2) LIVE_READY_DEV=1 makes dev enforce — disabled routes redirect to
  // /finance and a non-allowlisted role resolves to /no-access; (3) the
  // override can never turn enforcement OFF in production.
  const origNodeEnv = process.env.NODE_ENV;
  const origApiTestMode = process.env.API_TEST_MODE;
  const origLiveReadyDev = process.env.LIVE_READY_DEV;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origApiTestMode === undefined) delete process.env.API_TEST_MODE;
    else process.env.API_TEST_MODE = origApiTestMode;
    if (origLiveReadyDev === undefined) delete process.env.LIVE_READY_DEV;
    else process.env.LIVE_READY_DEV = origLiveReadyDev;
  });

  it("is OFF by default in development (the app stays unrestricted)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.API_TEST_MODE;
    delete process.env.LIVE_READY_DEV;
    expect(isLiveReadyDevOverrideOn()).toBe(false);
    expect(isLiveReadyEnforced()).toBe(false);
    // Nothing blocked: a disabled module + a non-allowlisted role are both fine.
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isNavGroupEnabled("ENGINEERING")).toBe(true);
    expect(resolveLiveReadyLanding("ENGINEER")).toBeNull();
  });

  it("LIVE_READY_DEV=1 turns enforcement ON in development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.API_TEST_MODE;
    process.env.LIVE_READY_DEV = "1";
    expect(isLiveReadyDevOverrideOn()).toBe(true);
    expect(isLiveReadyEnforced()).toBe(true);
  });

  it("with the override ON, a disabled-navGroup route redirects to /finance", () => {
    process.env.NODE_ENV = "development";
    process.env.LIVE_READY_DEV = "1";
    // App.tsx renders <Redirect to={LIVE_READY_LANDING_PATH}/> for any page
    // whose module is disabled (isPageEnabled === false). QUALITY is a still-
    // disabled module (ENGINEERING is now partially enabled).
    const disabledPage = PAGE_REGISTRY.find((p) => p.navGroup === "QUALITY");
    expect(disabledPage).toBeDefined();
    expect(isPageEnabled({ id: disabledPage!.id, navGroup: disabledPage!.navGroup })).toBe(false);
    expect(isNavGroupEnabled("QUALITY")).toBe(false);
    expect(LIVE_READY_LANDING_PATH).toBe("/finance");
  });

  it("with the override ON, a non-allowlisted role resolves to /no-access; finance roles to /finance", () => {
    process.env.NODE_ENV = "development";
    process.env.LIVE_READY_DEV = "1";
    expect(resolveLiveReadyLanding("ENGINEER")).toBe(LIVE_READY_NO_ACCESS_PATH);
    expect(resolveLiveReadyLanding("QUALITY_MANAGER")).toBe(LIVE_READY_NO_ACCESS_PATH);
    expect(resolveLiveReadyLanding("CFO")).toBe(LIVE_READY_LANDING_PATH);
    expect(resolveLiveReadyLanding("PROGRAM_MANAGER")).toBe(LIVE_READY_LANDING_PATH);
  });

  it("accepts LIVE_READY_DEV=true as well as =1, and ignores other values", () => {
    process.env.NODE_ENV = "development";
    process.env.LIVE_READY_DEV = "true";
    expect(isLiveReadyEnforced()).toBe(true);
    process.env.LIVE_READY_DEV = "0";
    expect(isLiveReadyEnforced()).toBe(false);
    process.env.LIVE_READY_DEV = "yes-please";
    expect(isLiveReadyEnforced()).toBe(false);
  });

  it("can never weaken production — prod enforces regardless of the override value", () => {
    process.env.NODE_ENV = "production";
    delete process.env.API_TEST_MODE;
    // Even an explicit "off" value cannot disable enforcement in production.
    process.env.LIVE_READY_DEV = "0";
    expect(isLiveReadyEnforced()).toBe(true);
    delete process.env.LIVE_READY_DEV;
    expect(isLiveReadyEnforced()).toBe(true);
  });
});

describe("live-ready module — role allowlist", () => {
  it("is exactly the seven locked management + finance roles", () => {
    expect([...LIVE_READY_ROLE_ALLOWLIST].sort()).toEqual(
      [
        "ACCOUNTANT",
        "CEO_ADMIN",
        "CFO",
        "CONSTRUCTION_MANAGER",
        "COO_ADMIN",
        "PROGRAM_FINANCE_MANAGER",
        "PROGRAM_MANAGER",
      ].sort(),
    );
  });

  it("every allowlisted role is a real COMPANY_ROLE", () => {
    for (const role of LIVE_READY_ROLE_ALLOWLIST) {
      expect(COMPANY_ROLES).toContain(role);
    }
  });

  it("allows the allowlisted roles and blocks everyone else", () => {
    expect(isRoleAllowedInLiveReady("CFO")).toBe(true);
    expect(isRoleAllowedInLiveReady("ACCOUNTANT")).toBe(true);
    expect(isRoleAllowedInLiveReady("CONSTRUCTION_MANAGER")).toBe(true);
    for (const blocked of ["ENGINEER", "QUALITY_MANAGER", "HSE_MANAGER", "PROJECT_DEVELOPER", "CCO", "KEY_ACCOUNTS_MANAGER"]) {
      expect(isRoleAllowedInLiveReady(blocked), `${blocked} must be blocked`).toBe(false);
    }
    expect(isRoleAllowedInLiveReady(null)).toBe(false);
  });
});

describe("live-ready module — enabled module set", () => {
  it("enables FINANCE (full), EXECUTION + ENGINEERING (partial) + SYSTEM (partial); disables every other navGroup", () => {
    const groups = LIVE_READY_MODULE_CONFIG.navGroups;
    expect(groups.FINANCE).toEqual({ mode: "full" });
    expect(groups.SYSTEM.mode).toBe("partial");
    // Execution control tower is the second Live-Ready module, ring-fenced to
    // its own pages within PROJECT_MANAGEMENT.
    expect(groups.PROJECT_MANAGEMENT.mode).toBe("partial");
    // Engineering (delivery scope) is the third Live-Ready module, ring-fenced
    // to its delivery pages within the ENGINEERING nav-group.
    expect(groups.ENGINEERING.mode).toBe("partial");
    const disabled = [
      "MY_WORK", "PORTFOLIO", "PRIORITIES", "PROJECT_DEVELOPMENT", "PROJECTS",
      "GATES", "QUALITY", "HSE", "REPORTS", "KNOWLEDGE",
    ] as const;
    for (const g of disabled) {
      expect(groups[g], `${g} must be disabled`).toEqual({ mode: "disabled" });
    }
  });

  it("SYSTEM plumbing allowlist is exactly the finance-essential pages", () => {
    expect([...ENABLED_SYSTEM_PAGE_IDS].sort()).toEqual(
      [
        "adminActivity", "adminFunctionality", "adminImportControlTower",
        "adminImportMappings", "adminIntegrations", "adminQuickBooks",
        "adminRoles", "adminSettings", "settingsHome", "sharepointIntake", "smartImport",
      ].sort(),
    );
  });

  it("EXECUTION allowlist is exactly the ring-fenced control-tower pages", () => {
    expect([...ENABLED_EXECUTION_PAGE_IDS].sort()).toEqual(
      [
        "executionReview", "executionMilestones", "executionDeliveries",
        "executionAllocations", "executionSite",
      ].sort(),
    );
  });

  it("ENGINEERING allowlist is exactly the ring-fenced delivery pages", () => {
    // Delivery rebuild promotes pages into this set as they land. Document
    // Manager joins when Phase 3 lands; Home + Task Manager are live now.
    expect([...ENABLED_ENGINEERING_PAGE_IDS].sort()).toEqual(
      ["engineering", "engineeringTasks"].sort(),
    );
  });
});

describe("live-ready module — page reachability", () => {
  it("FINANCE pages are reachable, non-finance pages are not", () => {
    expect(isPageEnabled({ id: "financeHome", navGroup: "FINANCE" })).toBe(true);
    expect(isPageEnabled({ id: "cashflow", navGroup: "FINANCE" })).toBe(true);
    // engineeringStandup is OUTSIDE the Engineering ring fence (only the Home
    // page is enabled), so it stays unreachable.
    expect(isPageEnabled({ id: "engineeringStandup", navGroup: "ENGINEERING" })).toBe(false);
    expect(isPageEnabled({ id: "portfolio", navGroup: "PROJECTS" })).toBe(false);
    expect(isPageEnabled({ id: "quality", navGroup: "QUALITY" })).toBe(false);
  });

  it("EXECUTION control-tower pages are reachable; the rest of PROJECT_MANAGEMENT is not (ring fence)", () => {
    for (const id of ["executionReview", "executionMilestones", "executionDeliveries", "executionAllocations", "executionSite"]) {
      expect(isPageEnabled({ id, navGroup: "PROJECT_MANAGEMENT" }), `${id} must be reachable`).toBe(true);
    }
    // Other PROJECT_MANAGEMENT pages stay blocked — Execution is ring-fenced.
    for (const id of ["projects", "milestoneTracker", "projectDetail", "now"]) {
      expect(isPageEnabled({ id, navGroup: "PROJECT_MANAGEMENT" }), `${id} must stay blocked`).toBe(false);
    }
  });

  it("ENGINEERING Home + Task Manager are reachable; the rest of ENGINEERING is not (ring fence)", () => {
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isPageEnabled({ id: "engineeringTasks", navGroup: "ENGINEERING" })).toBe(true);
    // Document management and standup stay blocked until the rebuild promotes
    // them into the ring fence.
    for (const id of ["engineeringDocuments", "engineeringStandup"]) {
      expect(isPageEnabled({ id, navGroup: "ENGINEERING" }), `${id} must stay blocked`).toBe(false);
    }
  });

  it("SYSTEM plumbing pages are reachable, non-plumbing SYSTEM pages are not", () => {
    expect(isPageEnabled({ id: "smartImport", navGroup: "SYSTEM" })).toBe(true);
    expect(isPageEnabled({ id: "adminRoles", navGroup: "SYSTEM" })).toBe(true);
    expect(isPageEnabled({ id: "adminQuickBooks", navGroup: "SYSTEM" })).toBe(true);
    // Non-plumbing SYSTEM pages stay disabled.
    expect(isPageEnabled({ id: "adminPipedrive", navGroup: "SYSTEM" })).toBe(false);
    expect(isPageEnabled({ id: "stageAdmin", navGroup: "SYSTEM" })).toBe(false);
    expect(isPageEnabled({ id: "phaseTemplates", navGroup: "SYSTEM" })).toBe(false);
  });

  it("pages with no navGroup are not reachable in live-ready mode", () => {
    expect(isPageEnabled({ id: "projectDetail", navGroup: undefined })).toBe(false);
  });

  it("EVERY finance-domain page in the registry stays reachable (no finance route hidden)", () => {
    const financePages = PAGE_REGISTRY.filter((p) => p.navGroup === "FINANCE");
    expect(financePages.length).toBeGreaterThan(5);
    for (const page of financePages) {
      expect(isPageEnabled({ id: page.id, navGroup: page.navGroup }), `${page.id} (${page.path})`).toBe(true);
    }
  });
});

describe("live-ready module — nav section gate", () => {
  it("shows Finance + Execution(PROJECT_DELIVERY) + Engineering + Settings(ADMIN); hides the rest", () => {
    expect(isSectionModuleEnabled("FINANCE")).toBe(true);
    expect(isSectionModuleEnabled("ADMIN")).toBe(true);
    // Execution control tower surfaces the PROJECT_DELIVERY top tab.
    expect(isSectionModuleEnabled("PROJECT_DELIVERY")).toBe(true);
    // Engineering (delivery scope) is the third Live-Ready section.
    expect(isSectionModuleEnabled("ENGINEERING")).toBe(true);
    for (const hidden of ["HOME", "PORTFOLIO", "PRIORITIES", "PROJECT_DEVELOPMENT", "QUALITY", "HSE", "REPORTS"] as const) {
      expect(isSectionModuleEnabled(hidden), `${hidden} must be hidden`).toBe(false);
    }
  });

  it("filterSectionsByEnabledModules keeps only enabled sections", () => {
    const sections = [
      { key: "HOME" as const },
      { key: "FINANCE" as const },
      { key: "ENGINEERING" as const },
      { key: "QUALITY" as const },
      { key: "ADMIN" as const },
    ];
    expect(filterSectionsByEnabledModules(sections).map((s) => s.key)).toEqual(["FINANCE", "ENGINEERING", "ADMIN"]);
  });
});

describe("live-ready module — landing + redirect targets", () => {
  it("allowed roles land on /finance, others on the no-access landing", () => {
    expect(LIVE_READY_LANDING_PATH).toBe("/finance");
    expect(resolveLiveReadyLanding("CFO")).toBe("/finance");
    expect(resolveLiveReadyLanding("COO_ADMIN")).toBe("/finance");
    expect(resolveLiveReadyLanding("ENGINEER")).toBe(LIVE_READY_NO_ACCESS_PATH);
    expect(resolveLiveReadyLanding("QUALITY_MANAGER")).toBe(LIVE_READY_NO_ACCESS_PATH);
  });
});

describe("live-ready module — search + server gate scoping", () => {
  it("scopes search to finance entity types only", () => {
    for (const t of ["project", "cost", "revenue", "invoice", "po", "client"]) {
      expect(isFinanceSearchType(t)).toBe(true);
    }
    for (const t of ["task", "engineering", "quality", "document", "person"]) {
      expect(isFinanceSearchType(t), `${t} must not leak`).toBe(false);
    }
  });

  it("keeps auth/version/health reachable for everyone at the API boundary", () => {
    expect(isAlwaysAllowedApiPath("/api/auth/permissions")).toBe(true);
    expect(isAlwaysAllowedApiPath("/api/version")).toBe(true);
    expect(isAlwaysAllowedApiPath("/api/environment/status")).toBe(true);
    expect(isAlwaysAllowedApiPath("/api/feature-flags/rollout")).toBe(true);
    expect(isAlwaysAllowedApiPath("/api/engineering/tasks")).toBe(false);
  });
});

/**
 * REVERSIBILITY — re-enabling a module is a one-line registry change.
 * Proven against the pure *In(config, …) helpers so we can flip a navGroup
 * without mutating the production config.
 */
describe("live-ready module — reversibility (one-line re-enable)", () => {
  it("QUALITY is disabled under the production config", () => {
    expect(isNavGroupEnabled("QUALITY")).toBe(false);
    expect(isPageEnabled({ id: "quality", navGroup: "QUALITY" })).toBe(false);
    expect(LIVE_READY_MODE).toBe(true);
  });

  it("flipping QUALITY to { mode: 'full' } restores its routes AND nav", () => {
    // The exact one-line change documented in docs/finance-freeze-runbook.md.
    const reEnabled: ModuleRegistryConfig = {
      navGroups: { ...ACTIVE_MODULE_CONFIG.navGroups, QUALITY: { mode: "full" } },
    };

    // Route gate: quality pages become reachable again.
    expect(isPageEnabledIn(reEnabled, { id: "quality", navGroup: "QUALITY" })).toBe(true);
    expect(isPageEnabledIn(reEnabled, { id: "qualityTasks", navGroup: "QUALITY" })).toBe(true);
    // Nav gate (section visibility derives from navGroup enablement).
    expect(isNavGroupEnabledIn(reEnabled, "QUALITY")).toBe(true);

    // Other modules stay exactly as configured — only the flipped one changed.
    expect(isNavGroupEnabledIn(reEnabled, "HSE")).toBe(false);
    expect(isPageEnabledIn(reEnabled, { id: "financeHome", navGroup: "FINANCE" })).toBe(true);
  });

  it("a disabled route redirects to /finance (no deep-link bypass)", () => {
    // App.tsx renders <Redirect to={LIVE_READY_LANDING_PATH}/> for any page
    // whose module is disabled; this pins the redirect target. QUALITY is a
    // still-disabled module (ENGINEERING is now partially enabled).
    const disabledPage = PAGE_REGISTRY.find((p) => p.navGroup === "QUALITY");
    expect(disabledPage).toBeDefined();
    expect(isPageEnabled({ id: disabledPage!.id, navGroup: disabledPage!.navGroup })).toBe(false);
    expect(LIVE_READY_LANDING_PATH).toBe("/finance");
  });
});
