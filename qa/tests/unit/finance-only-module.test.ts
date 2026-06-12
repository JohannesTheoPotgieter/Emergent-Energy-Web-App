import { afterEach, describe, expect, it } from "vitest";
import {
  FINANCE_ONLY_MODE,
  isFinanceOnlyEnforced,
  isFinanceOnlyDevOverrideOn,
  FINANCE_ONLY_MODULE_CONFIG,
  FINANCE_ONLY_LANDING_PATH,
  FINANCE_ONLY_NO_ACCESS_PATH,
  FINANCE_MODULE_ROLE_ALLOWLIST,
  ENABLED_SYSTEM_PAGE_IDS,
  ACTIVE_MODULE_CONFIG,
  type ModuleRegistryConfig,
  isNavGroupEnabledIn,
  isPageEnabledIn,
  isNavGroupEnabled,
  isPageEnabled,
  isRoleAllowedInFinanceModule,
  resolveFinanceOnlyLanding,
  isAlwaysAllowedApiPath,
  isFinanceSearchType,
} from "@shared/config/enabled-modules";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { isSectionModuleEnabled, filterSectionsByEnabledModules } from "@/config/app-navigation";
import { COMPANY_ROLES } from "@shared/schema/users";

/**
 * Finance-only module contract + REVERSIBILITY proof (task GP7).
 *
 * These tests lock the finance-only configuration AND prove that re-enabling a
 * module is a one-line registry change: flipping a navGroup to { mode: "full" }
 * restores its routes (isPageEnabledIn) and its nav (isNavGroupEnabledIn →
 * section gate), while disabled routes redirect to /finance.
 */

describe("finance-only module — runtime enforcement (deploy-mode)", () => {
  // Finance-only is a deploy mode: enforced in production + unit tests, but
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
    expect(isFinanceOnlyEnforced()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isFinanceOnlyEnforced()).toBe(true);
  });

  it("is INERT in the integration/e2e harness (API_TEST_MODE=true)", () => {
    process.env.NODE_ENV = "test";
    process.env.API_TEST_MODE = "true";
    expect(isFinanceOnlyEnforced()).toBe(false);
  });

  it("is INERT in development (local dev + run-with-app e2e client)", () => {
    delete process.env.API_TEST_MODE;
    process.env.NODE_ENV = "development";
    expect(isFinanceOnlyEnforced()).toBe(false);
  });

  it("when inert, the wrappers behave as full-app (nothing blocked)", () => {
    process.env.NODE_ENV = "development";
    expect(isNavGroupEnabled("ENGINEERING")).toBe(true);
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isRoleAllowedInFinanceModule("ENGINEER")).toBe(true);
    expect(resolveFinanceOnlyLanding("ENGINEER")).toBeNull();
    expect(isFinanceSearchType("task")).toBe(true);
  });
});

describe("finance-only module — opt-in DEV override (verify the lockdown locally)", () => {
  // The override turns enforcement ON in development for testing WITHOUT
  // weakening production. These tests pin: (1) default dev stays unrestricted;
  // (2) FINANCE_ONLY_DEV=1 makes dev enforce — disabled routes redirect to
  // /finance and a non-allowlisted role resolves to /no-access; (3) the
  // override can never turn enforcement OFF in production.
  const origNodeEnv = process.env.NODE_ENV;
  const origApiTestMode = process.env.API_TEST_MODE;
  const origFinanceOnlyDev = process.env.FINANCE_ONLY_DEV;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origApiTestMode === undefined) delete process.env.API_TEST_MODE;
    else process.env.API_TEST_MODE = origApiTestMode;
    if (origFinanceOnlyDev === undefined) delete process.env.FINANCE_ONLY_DEV;
    else process.env.FINANCE_ONLY_DEV = origFinanceOnlyDev;
  });

  it("is OFF by default in development (the app stays unrestricted)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.API_TEST_MODE;
    delete process.env.FINANCE_ONLY_DEV;
    expect(isFinanceOnlyDevOverrideOn()).toBe(false);
    expect(isFinanceOnlyEnforced()).toBe(false);
    // Nothing blocked: a disabled module + a non-allowlisted role are both fine.
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isNavGroupEnabled("ENGINEERING")).toBe(true);
    expect(resolveFinanceOnlyLanding("ENGINEER")).toBeNull();
  });

  it("FINANCE_ONLY_DEV=1 turns enforcement ON in development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.API_TEST_MODE;
    process.env.FINANCE_ONLY_DEV = "1";
    expect(isFinanceOnlyDevOverrideOn()).toBe(true);
    expect(isFinanceOnlyEnforced()).toBe(true);
  });

  it("with the override ON, a disabled-navGroup route redirects to /finance", () => {
    process.env.NODE_ENV = "development";
    process.env.FINANCE_ONLY_DEV = "1";
    // App.tsx renders <Redirect to={FINANCE_ONLY_LANDING_PATH}/> for any page
    // whose module is disabled (isPageEnabled === false).
    const disabledPage = PAGE_REGISTRY.find((p) => p.navGroup === "ENGINEERING");
    expect(disabledPage).toBeDefined();
    expect(isPageEnabled({ id: disabledPage!.id, navGroup: disabledPage!.navGroup })).toBe(false);
    expect(isNavGroupEnabled("ENGINEERING")).toBe(false);
    expect(FINANCE_ONLY_LANDING_PATH).toBe("/finance");
  });

  it("with the override ON, a non-allowlisted role resolves to /no-access; finance roles to /finance", () => {
    process.env.NODE_ENV = "development";
    process.env.FINANCE_ONLY_DEV = "1";
    expect(resolveFinanceOnlyLanding("ENGINEER")).toBe(FINANCE_ONLY_NO_ACCESS_PATH);
    expect(resolveFinanceOnlyLanding("QUALITY_MANAGER")).toBe(FINANCE_ONLY_NO_ACCESS_PATH);
    expect(resolveFinanceOnlyLanding("CFO")).toBe(FINANCE_ONLY_LANDING_PATH);
    expect(resolveFinanceOnlyLanding("PROGRAM_MANAGER")).toBe(FINANCE_ONLY_LANDING_PATH);
  });

  it("accepts FINANCE_ONLY_DEV=true as well as =1, and ignores other values", () => {
    process.env.NODE_ENV = "development";
    process.env.FINANCE_ONLY_DEV = "true";
    expect(isFinanceOnlyEnforced()).toBe(true);
    process.env.FINANCE_ONLY_DEV = "0";
    expect(isFinanceOnlyEnforced()).toBe(false);
    process.env.FINANCE_ONLY_DEV = "yes-please";
    expect(isFinanceOnlyEnforced()).toBe(false);
  });

  it("can never weaken production — prod enforces regardless of the override value", () => {
    process.env.NODE_ENV = "production";
    delete process.env.API_TEST_MODE;
    // Even an explicit "off" value cannot disable enforcement in production.
    process.env.FINANCE_ONLY_DEV = "0";
    expect(isFinanceOnlyEnforced()).toBe(true);
    delete process.env.FINANCE_ONLY_DEV;
    expect(isFinanceOnlyEnforced()).toBe(true);
  });
});

describe("finance-only module — role allowlist", () => {
  it("is exactly the seven locked management + finance roles", () => {
    expect([...FINANCE_MODULE_ROLE_ALLOWLIST].sort()).toEqual(
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
    for (const role of FINANCE_MODULE_ROLE_ALLOWLIST) {
      expect(COMPANY_ROLES).toContain(role);
    }
  });

  it("allows the allowlisted roles and blocks everyone else", () => {
    expect(isRoleAllowedInFinanceModule("CFO")).toBe(true);
    expect(isRoleAllowedInFinanceModule("ACCOUNTANT")).toBe(true);
    expect(isRoleAllowedInFinanceModule("CONSTRUCTION_MANAGER")).toBe(true);
    for (const blocked of ["ENGINEER", "QUALITY_MANAGER", "HSE_MANAGER", "PROJECT_DEVELOPER", "CCO", "KEY_ACCOUNTS_MANAGER"]) {
      expect(isRoleAllowedInFinanceModule(blocked), `${blocked} must be blocked`).toBe(false);
    }
    expect(isRoleAllowedInFinanceModule(null)).toBe(false);
  });
});

describe("finance-only module — enabled module set", () => {
  it("enables FINANCE (full) and SYSTEM (partial); disables every other navGroup", () => {
    const groups = FINANCE_ONLY_MODULE_CONFIG.navGroups;
    expect(groups.FINANCE).toEqual({ mode: "full" });
    expect(groups.SYSTEM.mode).toBe("partial");
    const disabled = [
      "MY_WORK", "PORTFOLIO", "PRIORITIES", "PROJECT_DEVELOPMENT", "PROJECTS",
      "PROJECT_MANAGEMENT", "GATES", "ENGINEERING", "QUALITY", "HSE", "REPORTS", "KNOWLEDGE",
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
});

describe("finance-only module — page reachability", () => {
  it("FINANCE pages are reachable, non-finance pages are not", () => {
    expect(isPageEnabled({ id: "financeHome", navGroup: "FINANCE" })).toBe(true);
    expect(isPageEnabled({ id: "cashflow", navGroup: "FINANCE" })).toBe(true);
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(false);
    expect(isPageEnabled({ id: "portfolio", navGroup: "PROJECTS" })).toBe(false);
    expect(isPageEnabled({ id: "quality", navGroup: "QUALITY" })).toBe(false);
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

  it("pages with no navGroup are not reachable in finance-only mode", () => {
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

describe("finance-only module — nav section gate", () => {
  it("shows only Finance + Settings(ADMIN) sections; hides the rest", () => {
    expect(isSectionModuleEnabled("FINANCE")).toBe(true);
    expect(isSectionModuleEnabled("ADMIN")).toBe(true);
    for (const hidden of ["HOME", "PORTFOLIO", "PRIORITIES", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "ENGINEERING", "QUALITY", "HSE", "REPORTS"] as const) {
      expect(isSectionModuleEnabled(hidden), `${hidden} must be hidden`).toBe(false);
    }
  });

  it("filterSectionsByEnabledModules keeps only enabled sections", () => {
    const sections = [
      { key: "HOME" as const },
      { key: "FINANCE" as const },
      { key: "ENGINEERING" as const },
      { key: "ADMIN" as const },
    ];
    expect(filterSectionsByEnabledModules(sections).map((s) => s.key)).toEqual(["FINANCE", "ADMIN"]);
  });
});

describe("finance-only module — landing + redirect targets", () => {
  it("allowed roles land on /finance, others on the no-access landing", () => {
    expect(FINANCE_ONLY_LANDING_PATH).toBe("/finance");
    expect(resolveFinanceOnlyLanding("CFO")).toBe("/finance");
    expect(resolveFinanceOnlyLanding("COO_ADMIN")).toBe("/finance");
    expect(resolveFinanceOnlyLanding("ENGINEER")).toBe(FINANCE_ONLY_NO_ACCESS_PATH);
    expect(resolveFinanceOnlyLanding("QUALITY_MANAGER")).toBe(FINANCE_ONLY_NO_ACCESS_PATH);
  });
});

describe("finance-only module — search + server gate scoping", () => {
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
describe("finance-only module — reversibility (one-line re-enable)", () => {
  it("ENGINEERING is disabled under the production config", () => {
    expect(isNavGroupEnabled("ENGINEERING")).toBe(false);
    expect(isPageEnabled({ id: "engineering", navGroup: "ENGINEERING" })).toBe(false);
    expect(FINANCE_ONLY_MODE).toBe(true);
  });

  it("flipping ENGINEERING to { mode: 'full' } restores its routes AND nav", () => {
    // The exact one-line change documented in docs/finance-freeze-runbook.md.
    const reEnabled: ModuleRegistryConfig = {
      navGroups: { ...ACTIVE_MODULE_CONFIG.navGroups, ENGINEERING: { mode: "full" } },
    };

    // Route gate: engineering pages become reachable again.
    expect(isPageEnabledIn(reEnabled, { id: "engineering", navGroup: "ENGINEERING" })).toBe(true);
    expect(isPageEnabledIn(reEnabled, { id: "engineeringTasks", navGroup: "ENGINEERING" })).toBe(true);
    // Nav gate (section visibility derives from navGroup enablement).
    expect(isNavGroupEnabledIn(reEnabled, "ENGINEERING")).toBe(true);

    // Other modules stay exactly as configured — only the flipped one changed.
    expect(isNavGroupEnabledIn(reEnabled, "QUALITY")).toBe(false);
    expect(isPageEnabledIn(reEnabled, { id: "financeHome", navGroup: "FINANCE" })).toBe(true);
  });

  it("a disabled route redirects to /finance (no deep-link bypass)", () => {
    // App.tsx renders <Redirect to={FINANCE_ONLY_LANDING_PATH}/> for any page
    // whose module is disabled; this pins the redirect target.
    const disabledPage = PAGE_REGISTRY.find((p) => p.navGroup === "ENGINEERING");
    expect(disabledPage).toBeDefined();
    expect(isPageEnabled({ id: disabledPage!.id, navGroup: disabledPage!.navGroup })).toBe(false);
    expect(FINANCE_ONLY_LANDING_PATH).toBe("/finance");
  });
});
