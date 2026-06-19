import { describe, expect, it } from "vitest";
import {
  ROLE_VISIBLE_SECTIONS,
  type SectionKey,
  buildVisibleTopSections,
} from "../../../client/src/config/app-navigation";
import { LEGACY_REDIRECTS, PAGE_REGISTRY } from "../../../client/src/config/page-registry";

type JourneyRole =
  | "COO_ADMIN"
  | "CEO_ADMIN"
  | "CFO"
  | "PROGRAM_FINANCE_MANAGER"
  | "ACCOUNTANT"
  | "PROGRAM_MANAGER"
  | "PROJECT_MANAGER_SITE"
  | "PROJECT_DEVELOPER"
  | "ENGINEER"
  | "ENGINEERING_MANAGER"
  | "QUALITY_MANAGER"
  | "HSE_MANAGER";

const routePaths = new Set(PAGE_REGISTRY.map((page) => page.path));
const legacyAliases = new Map(LEGACY_REDIRECTS.map((redirect) => [redirect.path, redirect.redirectTo]));

/**
 * Locked to the COO-spec six-tab nav (2026-05-12): Home · Project Delivery ·
 * Finance · Engineering · Quality Management · Settings (=ADMIN). Hidden
 * sections (Project Development, Portfolio, Gates, HSE, Reports, Priorities)
 * still resolve as routes but never appear as top-level keys in
 * buildVisibleTopSections — they're surfaced only via Functionality Control.
 * Each role's expectedSections covers the sections that MUST be visible in
 * the top bar for that role to do their job.
 */
const JOURNEYS: Array<{ role: JourneyRole; expectedSections: SectionKey[]; routes: string[] }> = [
  { role: "COO_ADMIN", expectedSections: ["PROJECT_DELIVERY", "FINANCE", "ENGINEERING", "QUALITY", "ADMIN"], routes: ["/company-overview", "/lifecycle-board", "/priorities", "/gates"] },
  { role: "CEO_ADMIN", expectedSections: ["PROJECT_DELIVERY", "FINANCE", "ADMIN"], routes: ["/company-overview", "/lifecycle-board", "/priorities", "/gates"] },
  { role: "CFO", expectedSections: ["FINANCE", "PROJECT_DELIVERY"], routes: ["/cashflow", "/cashflow/analysis", "/cos", "/cos/analysis", "/revenue-tracker"] },
  { role: "PROGRAM_FINANCE_MANAGER", expectedSections: ["FINANCE", "PROJECT_DELIVERY"], routes: ["/cashflow", "/cashflow/analysis", "/cos", "/cos/analysis", "/revenue-tracker"] },
  { role: "ACCOUNTANT", expectedSections: ["FINANCE"], routes: ["/cashflow", "/cashflow/analysis", "/cos", "/cos/analysis", "/revenue-tracker"] },
  { role: "PROGRAM_MANAGER", expectedSections: ["PROJECT_DELIVERY", "FINANCE", "QUALITY"], routes: ["/execution", "/gates", "/projects", "/pm/approvals"] },
  { role: "PROJECT_MANAGER_SITE", expectedSections: ["PROJECT_DELIVERY", "FINANCE", "QUALITY"], routes: ["/pm-dashboard", "/pm/on-the-go", "/pm/approvals", "/handover"] },
  // PROJECT_DEVELOPER: PROJECT_DEVELOPMENT was retired as a top tab; their
  // daily surfaces (Pipeline / Opportunities / Clients) sit behind Functionality
  // Control. Home + Finance are the must-have tabs in the new spec.
  { role: "PROJECT_DEVELOPER", expectedSections: ["FINANCE"], routes: ["/pd", "/opportunities", "/clients", "/handover-control"] },
  { role: "ENGINEER", expectedSections: ["ENGINEERING", "QUALITY"], routes: ["/engineering", "/engineering/tasks", "/engineering/standup"] },
  { role: "ENGINEERING_MANAGER", expectedSections: ["ENGINEERING", "QUALITY", "PROJECT_DELIVERY"], routes: ["/engineering", "/engineering/tasks", "/engineering/standup"] },
  { role: "QUALITY_MANAGER", expectedSections: ["QUALITY", "PROJECT_DELIVERY"], routes: ["/quality", "/commissioning-dashboard", "/hse"] },
  // HSE no longer surfaces as its own top-level tab in the six-tab spec —
  // HSE_MANAGER's must-have is Project Delivery for the operational surfaces.
  { role: "HSE_MANAGER", expectedSections: ["PROJECT_DELIVERY"], routes: ["/quality", "/commissioning-dashboard", "/hse"] },
];

const ADMIN_PATH_PREFIXES = ["/admin", "/settings", "/ee-info", "/training", "/leaderboard", "/department-scores"];

describe("cross-role journey smoke coverage", () => {
  it("journey routes resolve via PAGE_REGISTRY pages, aliases, or legacy redirects", () => {
    for (const journey of JOURNEYS) {
      for (const route of journey.routes) {
        const existsAsPage = routePaths.has(route);
        const existsAsAlias = PAGE_REGISTRY.some((page) => page.aliases?.includes(route));
        const existsAsLegacyRedirect = legacyAliases.has(route);

        expect(
          existsAsPage || existsAsAlias || existsAsLegacyRedirect,
          `${journey.role} route ${route} does not resolve from registry/alias/legacy redirect`,
        ).toBe(true);
      }
    }
  });

  it("each target role sees only relevant top-level sections for daily journeys", () => {
    for (const journey of JOURNEYS) {
      const visible = buildVisibleTopSections({
        companyRole: journey.role,
        canViewPath: () => true,
      }).map((section) => section.key);

      for (const key of journey.expectedSections) {
        expect(visible, `${journey.role} must include ${key}`).toContain(key);
      }
    }
  });

  it("non-admin roles do not expose Admin/System sections", () => {
    for (const journey of JOURNEYS) {
      const visibleSectionKeys = new Set(ROLE_VISIBLE_SECTIONS[journey.role]);
      const isAdminRole = journey.role === "COO_ADMIN" || journey.role === "CEO_ADMIN";
      if (isAdminRole) continue;

      expect(visibleSectionKeys.has("ADMIN"), `${journey.role} should not see ADMIN section`).toBe(false);
      for (const path of ADMIN_PATH_PREFIXES) {
        const sectionMatch = buildVisibleTopSections({
          companyRole: journey.role,
          canViewPath: (candidate) => candidate === path,
        });
        expect(sectionMatch.some((section) => section.key === "ADMIN")).toBe(false);
      }
    }
  });

  it("legacy aliases for core journeys remain intact", () => {
    expect(legacyAliases.get("/dashboard")).toBe("/execution");
    expect(legacyAliases.get("/company-priorities")).toBe("/priorities");

    const pmApprovalAlias = PAGE_REGISTRY.find((page) => page.path === "/my-work/approvals");
    expect(pmApprovalAlias?.redirectTo).toBe("/my-work/tasks?source=approvals");
  });
});
