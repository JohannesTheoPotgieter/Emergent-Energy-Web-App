import { describe, expect, it } from "vitest";
import {
  FINANCE_ONLY_MODE,
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
