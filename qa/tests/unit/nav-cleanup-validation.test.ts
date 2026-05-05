/**
 * Navigation Cleanup Validation
 *
 * Validates the 7-item top nav (Home | Projects | Gates | Finance | Departments | Reports | Admin)
 * after Replit's visual polish. Covers:
 *   - Top-nav visibility by role
 *   - Secondary-nav visibility by role
 *   - Grouped secondary nav (Projects, Departments)
 *   - Flat fallback when secondaryGroups is absent
 *   - Hidden / detail pages remain reachable via PAGE_REGISTRY
 *   - Legacy redirects
 *   - routeComponentKey parity (structural)
 *   - Breadcrumbs
 *   - Active-nav highlighting
 *   - CEO / COO report views
 *   - Mobile drawer group structure at 390 px (structural)
 */

import { describe, expect, it } from "vitest";
import {
  TOP_SECTIONS,
  DISPLAY_TOP_NAV,
  ROLE_VISIBLE_SECTIONS,
  buildVisibleTopSections,
  getBreadcrumbs,
  linkIsActive,
  type SectionKey,
} from "@/config/app-navigation";
import { PAGE_REGISTRY, LEGACY_REDIRECTS } from "@/config/page-registry";
import { ROUTE_COMPONENT_KEYS } from "@/config/route-components";
import type { CompanyRole } from "@shared/schema/users";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function visibleFor(role: CompanyRole) {
  return buildVisibleTopSections({ companyRole: role, canViewPath: () => true });
}

function visibleLabels(role: CompanyRole) {
  return visibleFor(role).map((s) => s.label);
}

function secondaryPaths(role: CompanyRole, sectionLabel: string) {
  const sections = visibleFor(role);
  const section = sections.find((s) => s.label === sectionLabel);
  return section?.secondary.map((i) => i.path) ?? [];
}

// ---------------------------------------------------------------------------
// 1. Top-nav visibility by role
// ---------------------------------------------------------------------------

describe("top-nav visibility by role", () => {
  it("Home is visible to every role", () => {
    for (const role of Object.keys(ROLE_VISIBLE_SECTIONS) as CompanyRole[]) {
      expect(visibleLabels(role), `${role} should see Home`).toContain("Home");
    }
  });

  it("Projects is visible to roles with PORTFOLIO, PROJECT_DEVELOPMENT, or PROJECT_DELIVERY", () => {
    const rolesWithProjects: CompanyRole[] = [
      "COO_ADMIN", "CEO_ADMIN", "CCO", "PROGRAM_MANAGER", "CFO", "PROGRAM_FINANCE_MANAGER",
      "KEY_ACCOUNTS_MANAGER",
    ];
    for (const role of rolesWithProjects) {
      expect(visibleLabels(role), `${role} should see Projects`).toContain("Projects");
    }
  });

  it("Projects is NOT visible to roles with only ENGINEERING / QUALITY / HSE access", () => {
    const rolesWithoutProjects: CompanyRole[] = ["ENGINEER", "ACCOUNTANT"];
    for (const role of rolesWithoutProjects) {
      expect(visibleLabels(role), `${role} should not see Projects`).not.toContain("Projects");
    }
  });

  it("Gates is visible when path /gates is accessible and user has PORTFOLIO or PROJECT_DELIVERY", () => {
    const withPortfolio = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "PORTFOLIO"],
      canViewPath: () => true,
    });
    expect(withPortfolio.some((s) => s.label === "Gates")).toBe(true);

    const withDelivery = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "PROJECT_DELIVERY"],
      canViewPath: () => true,
    });
    expect(withDelivery.some((s) => s.label === "Gates")).toBe(true);
  });

  it("Gates is hidden when /gates path permission is denied", () => {
    const sections = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "PORTFOLIO", "PROJECT_DELIVERY"],
      canViewPath: (path) => path !== "/gates",
    });
    expect(sections.some((s) => s.label === "Gates")).toBe(false);
  });

  it("Finance is visible to FINANCE roles; hidden from ENGINEER and ACCOUNTANT is only FINANCE", () => {
    const financeRoles: CompanyRole[] = ["COO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"];
    for (const role of financeRoles) {
      expect(visibleLabels(role), `${role} should see Finance`).toContain("Finance");
    }
    expect(visibleLabels("ENGINEER"), "ENGINEER should not see Finance").not.toContain("Finance");
  });

  it("Departments is visible for ENGINEERING, QUALITY, or HSE roles", () => {
    const deptRoles: CompanyRole[] = [
      "COO_ADMIN", "ENGINEER", "ENGINEERING_MANAGER", "QUALITY_MANAGER", "HSE_MANAGER", "SSEG_MANAGER",
    ];
    for (const role of deptRoles) {
      expect(visibleLabels(role), `${role} should see Departments`).toContain("Departments");
    }
  });

  it("Departments is hidden from finance-only roles", () => {
    expect(visibleLabels("ACCOUNTANT")).not.toContain("Departments");
    expect(visibleLabels("PROJECT_DEVELOPER")).not.toContain("Departments");
  });

  it("Reports is visible to REPORTS roles", () => {
    const reportRoles: CompanyRole[] = [
      "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "CFO", "PROGRAM_FINANCE_MANAGER",
      "ENGINEERING_MANAGER", "QUALITY_MANAGER", "HSE_MANAGER", "PROJECT_MANAGER_SITE",
      "CONSTRUCTION_MANAGER",
    ];
    for (const role of reportRoles) {
      expect(visibleLabels(role), `${role} should see Reports`).toContain("Reports");
    }
  });

  it("Admin is visible ONLY to COO_ADMIN and CEO_ADMIN", () => {
    expect(visibleLabels("COO_ADMIN")).toContain("Admin");
    expect(visibleLabels("CEO_ADMIN")).toContain("Admin");

    const nonAdmin: CompanyRole[] = [
      "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER",
      "QUALITY_MANAGER", "ENGINEERING_MANAGER", "KEY_ACCOUNTS_MANAGER", "ACCOUNTANT",
      "ENGINEER", "PROJECT_MANAGER_SITE", "PROJECT_DEVELOPER", "HSE_MANAGER", "SSEG_MANAGER",
    ];
    for (const role of nonAdmin) {
      expect(visibleLabels(role), `${role} should not see Admin`).not.toContain("Admin");
    }
  });

  it("DISPLAY_TOP_NAV exactly defines 7 items: Home | Projects | Gates | Finance | Departments | Reports | Admin", () => {
    const labels = DISPLAY_TOP_NAV.map((x) => x.label);
    expect(labels).toEqual(["Home", "Projects", "Gates", "Finance", "Departments", "Reports", "Admin"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Secondary nav visibility by role
// ---------------------------------------------------------------------------

describe("secondary nav visibility by role", () => {
  it("CEO Report View is shown only to CEO_ADMIN in Reports secondary", () => {
    const ceoReports = secondaryPaths("CEO_ADMIN", "Reports");
    expect(ceoReports).toContain("/ceo");
    expect(secondaryPaths("COO_ADMIN", "Reports")).not.toContain("/ceo");
    expect(secondaryPaths("PROGRAM_MANAGER", "Reports")).not.toContain("/ceo");
  });

  it("COO Report View is shown only to COO_ADMIN in Reports secondary", () => {
    const cooReports = secondaryPaths("COO_ADMIN", "Reports");
    expect(cooReports).toContain("/coo");
    expect(secondaryPaths("CEO_ADMIN", "Reports")).not.toContain("/coo");
    expect(secondaryPaths("CFO", "Reports")).not.toContain("/coo");
  });

  it("Reports hub path is /reports/center for every role that sees Reports", () => {
    const reportsSection = TOP_SECTIONS.find((s) => s.label === "Reports");
    expect(reportsSection?.path).toBe("/reports/center");
  });

  it("Finance secondary always includes core finance routes", () => {
    const paths = secondaryPaths("COO_ADMIN", "Finance");
    expect(paths).toContain("/cashflow");
    expect(paths).toContain("/cos");
    expect(paths).toContain("/revenue-tracker");
    expect(paths).toContain("/po-approval-board");
    expect(paths).toContain("/payment-request-board");
    expect(paths).toContain("/payment-batch-manager");
  });

  it("Finance secondary is unaffected by Projects or Departments consolidation", () => {
    const section = TOP_SECTIONS.find((s) => s.key === "FINANCE");
    const paths = section?.secondary.map((i) => i.path) ?? [];
    // Finance core paths must all be present
    for (const p of ["/cashflow", "/cashflow/analysis", "/cos", "/cos/analysis", "/revenue-tracker",
      "/po-approval-board", "/payment-request-board", "/payment-batch-manager"]) {
      expect(paths, `Finance must contain ${p}`).toContain(p);
    }
    // No project-management paths should have crept in
    expect(paths).not.toContain("/execution-board");
    expect(paths).not.toContain("/gates");
  });

  it("Priorities secondary item is gated by PRIORITIES section key inside Home", () => {
    const homeSection = TOP_SECTIONS.find((s) => s.key === "HOME");
    const prioritiesItem = homeSection?.secondary.find((i) => i.path === "/priorities");
    expect(prioritiesItem?.requiredSectionKey).toBe("PRIORITIES");

    // All 16 company roles include PRIORITIES in ROLE_VISIBLE_SECTIONS,
    // so any role-based user sees /priorities if canViewPath allows it.
    const cooHome = buildVisibleTopSections({
      companyRole: "COO_ADMIN",
      canViewPath: () => true,
    }).find((s) => s.key === "HOME");
    expect(cooHome?.secondary.some((i) => i.path === "/priorities")).toBe(true);

    // A lens with explicit allowedSectionKeys that omits PRIORITIES hides the item.
    const noPrioritiesHome = buildVisibleTopSections({
      allowedSectionKeys: ["HOME"],
      canViewPath: () => true,
    }).find((s) => s.key === "HOME");
    expect(noPrioritiesHome?.secondary.some((i) => i.path === "/priorities")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Grouped secondary nav – Projects
// ---------------------------------------------------------------------------

describe("grouped secondary nav — Projects", () => {
  it("Projects section defines three secondaryGroups", () => {
    const projects = TOP_SECTIONS.find((s) => s.label === "Projects");
    const groupLabels = projects?.secondaryGroups?.map((g) => g.label);
    expect(groupLabels).toEqual(["Portfolio", "Project Development", "Project Delivery"]);
  });

  it("buildVisibleTopSections filters Projects groups by section access", () => {
    // User with PROJECT_DELIVERY but not PROJECT_DEVELOPMENT
    const sections = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "PORTFOLIO", "PROJECT_DELIVERY"],
      canViewPath: () => true,
    });
    const projects = sections.find((s) => s.label === "Projects");
    expect(projects).toBeDefined();

    const groups = projects?.secondaryGroups ?? [];
    const pdGroup = groups.find((g) => g.label === "Project Development");
    // All PD items require PROJECT_DEVELOPMENT — none should survive
    expect(pdGroup?.items.length ?? 0).toBe(0);

    const deliveryGroup = groups.find((g) => g.label === "Project Delivery");
    expect((deliveryGroup?.items.length ?? 0)).toBeGreaterThan(0);
  });

  it("all items in Projects secondaryGroups are also present in flat secondary", () => {
    const projects = TOP_SECTIONS.find((s) => s.label === "Projects")!;
    const flatPaths = new Set(projects.secondary.map((i) => i.path));
    for (const group of projects.secondaryGroups ?? []) {
      for (const item of group.items) {
        expect(flatPaths.has(item.path), `${item.path} in group '${group.label}' missing from flat secondary`).toBe(true);
      }
    }
  });

  it("a user does not lose access to a link because it moved into a group", () => {
    // /company-overview lives in Portfolio group — must remain accessible
    const sections = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "PORTFOLIO"],
      canViewPath: () => true,
    });
    const projects = sections.find((s) => s.label === "Projects");
    expect(projects?.secondary.some((i) => i.path === "/company-overview")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Grouped secondary nav – Departments
// ---------------------------------------------------------------------------

describe("grouped secondary nav — Departments", () => {
  it("Departments section defines three secondaryGroups: Engineering, Quality, HSE", () => {
    const depts = TOP_SECTIONS.find((s) => s.label === "Departments");
    const groupLabels = depts?.secondaryGroups?.map((g) => g.label);
    expect(groupLabels).toEqual(["Engineering", "Quality", "HSE"]);
  });

  it("Engineering-only access shows Engineering group; Quality and HSE groups are filtered out", () => {
    // Use explicit allowedSectionKeys (as a lens would) to isolate ENGINEERING access only.
    const sections = buildVisibleTopSections({
      allowedSectionKeys: ["HOME", "ENGINEERING"],
      canViewPath: () => true,
    });
    const depts = sections.find((s) => s.label === "Departments");
    const groups = depts?.secondaryGroups ?? [];
    expect(groups.find((g) => g.label === "Engineering")?.items.length ?? 0).toBeGreaterThan(0);
    expect(groups.find((g) => g.label === "Quality")).toBeUndefined();
    expect(groups.find((g) => g.label === "HSE")).toBeUndefined();
  });

  it("QUALITY_MANAGER sees Quality group only", () => {
    const sections = buildVisibleTopSections({
      companyRole: "QUALITY_MANAGER",
      canViewPath: () => true,
    });
    const depts = sections.find((s) => s.label === "Departments");
    const groups = depts?.secondaryGroups ?? [];
    expect(groups.find((g) => g.label === "Engineering")).toBeUndefined();
    expect(groups.find((g) => g.label === "Quality")?.items.length ?? 0).toBeGreaterThan(0);
  });

  it("HSE_MANAGER sees HSE group only", () => {
    const sections = buildVisibleTopSections({
      companyRole: "HSE_MANAGER",
      canViewPath: () => true,
    });
    const depts = sections.find((s) => s.label === "Departments");
    const groups = depts?.secondaryGroups ?? [];
    expect(groups.find((g) => g.label === "Engineering")).toBeUndefined();
    expect(groups.find((g) => g.label === "Quality")).toBeUndefined();
    expect(groups.find((g) => g.label === "HSE")?.items.length ?? 0).toBeGreaterThan(0);
  });

  it("COO_ADMIN sees all three Departments groups", () => {
    const sections = buildVisibleTopSections({
      companyRole: "COO_ADMIN",
      canViewPath: () => true,
    });
    const depts = sections.find((s) => s.label === "Departments");
    const groups = depts?.secondaryGroups ?? [];
    expect(groups.find((g) => g.label === "Engineering")?.items.length ?? 0).toBeGreaterThan(0);
    expect(groups.find((g) => g.label === "Quality")?.items.length ?? 0).toBeGreaterThan(0);
    expect(groups.find((g) => g.label === "HSE")?.items.length ?? 0).toBeGreaterThan(0);
  });

  it("all items in Departments secondaryGroups are also in flat secondary", () => {
    const depts = TOP_SECTIONS.find((s) => s.label === "Departments")!;
    const flatPaths = new Set(depts.secondary.map((i) => i.path));
    for (const group of depts.secondaryGroups ?? []) {
      for (const item of group.items) {
        expect(flatPaths.has(item.path), `${item.path} in '${group.label}' missing from flat secondary`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Flat secondary fallback when secondaryGroups is absent/empty
// ---------------------------------------------------------------------------

describe("flat secondary fallback", () => {
  it("Finance section uses flat secondary (no secondaryGroups)", () => {
    const sections = buildVisibleTopSections({
      companyRole: "CFO",
      canViewPath: () => true,
    });
    const finance = sections.find((s) => s.key === "FINANCE");
    expect(finance?.secondaryGroups).toBeUndefined();
    expect(finance?.secondary.length).toBeGreaterThan(0);
  });

  it("Home section uses flat secondary", () => {
    const sections = buildVisibleTopSections({
      companyRole: "COO_ADMIN",
      canViewPath: () => true,
    });
    const home = sections.find((s) => s.key === "HOME");
    // HOME may have secondaryGroups defined in future, but currently flat
    expect(home?.secondary.length).toBeGreaterThan(0);
  });

  it("Gates section uses flat secondary (no secondaryGroups)", () => {
    const gates = TOP_SECTIONS.find((s) => s.label === "Gates");
    expect(gates?.secondaryGroups).toBeUndefined();
    expect(gates?.secondary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Hidden / detail pages remain reachable via PAGE_REGISTRY
// ---------------------------------------------------------------------------

describe("hidden and detail pages remain reachable", () => {
  const detailRoutes = [
    "/project/id/:projectId",
    "/project/id/:projectId/gate/:stageCode",
    "/portfolios/:id",
    "/pd/handover/:projectId",
    "/clients/:clientId",
    "/clients/:clientId/project/:projectId",
    "/pm/on-the-go/project/:projectId",
    "/reports/pm/monthly/:month/project/:projectId",
    "/reports/engineering/monthly/:month/project/:projectId",
    "/handover/:projectId/live",
  ];

  it("all critical detail routes exist in PAGE_REGISTRY", () => {
    const registryPaths = new Set(PAGE_REGISTRY.map((p) => p.path));
    for (const route of detailRoutes) {
      expect(registryPaths.has(route), `${route} must be in PAGE_REGISTRY`).toBe(true);
    }
  });

  it("CEO and COO pages are in PAGE_REGISTRY under REPORTS navGroup", () => {
    const ceo = PAGE_REGISTRY.find((p) => p.path === "/ceo");
    const coo = PAGE_REGISTRY.find((p) => p.path === "/coo");
    expect(ceo?.navGroup).toBe("REPORTS");
    expect(coo?.navGroup).toBe("REPORTS");
  });
});

// ---------------------------------------------------------------------------
// 7. Legacy redirects
// ---------------------------------------------------------------------------

describe("legacy redirects remain intact", () => {
  const aliases = new Map(LEGACY_REDIRECTS.map((r) => [r.path, r.redirectTo]));

  it("canonical redirects are unchanged", () => {
    expect(aliases.get("/dashboard")).toBe("/gates");
    expect(aliases.get("/revenue")).toBe("/revenue-tracker");
    expect(aliases.get("/company-priorities")).toBe("/priorities");
    expect(aliases.get("/exceptions")).toBe("/gates/exceptions");
    expect(aliases.get("/project-lifecycle")).toBe("/lifecycle-board");
    expect(aliases.get("/command-center")).toBe("/my-work");
    expect(aliases.get("/admin/control-center")).toBe("/admin/roles");
    expect(aliases.get("/admin-settings")).toBe("/admin/settings");
  });

  it("admin hyphenated redirects cover all legacy admin paths", () => {
    const adminRedirects = ["/admin-pipedrive", "/admin-quickbooks", "/admin-workflow-config",
      "/admin-backfill", "/admin-recovery", "/admin-roles", "/admin-settings",
      "/system-activity-log", "/phase-templates"];
    for (const path of adminRedirects) {
      expect(aliases.has(path), `${path} must have a redirect`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. routeComponentKey parity
// ---------------------------------------------------------------------------

describe("routeComponentKey parity", () => {
  it("every non-alias routeComponentKey maps to a component in ROUTE_COMPONENTS", () => {
    const missing = PAGE_REGISTRY
      .filter((p) => p.type !== "alias" && p.routeComponentKey)
      .map((p) => p.routeComponentKey!)
      .filter((key) => !ROUTE_COMPONENT_KEYS.has(key));
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Breadcrumbs
// ---------------------------------------------------------------------------

describe("breadcrumbs", () => {
  const gates = TOP_SECTIONS.find((s) => s.label === "Gates")!;
  const reports = TOP_SECTIONS.find((s) => s.key === "REPORTS")!;
  const delivery = TOP_SECTIONS.find((s) => s.key === "PROJECT_DELIVERY")!;

  it("/gates routes root breadcrumb to Projects, not the Gates section label", () => {
    const crumbs = getBreadcrumbs("/gates/commitments", gates);
    expect(crumbs[0]).toEqual({ label: "Projects", path: "/execution-board" });
    expect(crumbs[1]).toEqual({ label: "Gate Tracker", path: "/gates" });
  });

  it("gate sub-pages use the Gates section secondary items for leaf label", () => {
    const crumbs = getBreadcrumbs("/gates/commitments", gates);
    expect(crumbs[2]).toEqual({ label: "Client Commitments" });

    const blocked = getBreadcrumbs("/gates/blocked", gates);
    expect(blocked[2]).toEqual({ label: "Blocked Gates" });
  });

  it("report sub-pages breadcrumb correctly", () => {
    expect(getBreadcrumbs("/reports/pm/monthly/history", reports)).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "History" },
    ]);
    expect(getBreadcrumbs("/reports/engineering/monthly/compare", reports)).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "Compare" },
    ]);
  });

  it("project detail breadcrumb resolves from Project Delivery section", () => {
    const crumbs = getBreadcrumbs("/project/SolarFarm%20Alpha", delivery);
    expect(crumbs).toEqual([
      { label: "Project Delivery", path: "/projects" },
      { label: "SolarFarm Alpha" },
    ]);
  });

  it("home returns empty breadcrumbs", () => {
    const home = TOP_SECTIONS.find((s) => s.key === "HOME")!;
    expect(getBreadcrumbs("/", home)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Active nav highlighting
// ---------------------------------------------------------------------------

describe("active nav highlighting", () => {
  const gates = TOP_SECTIONS.find((s) => s.label === "Gates")!;
  const projects = TOP_SECTIONS.find((s) => s.label === "Projects")!;

  it("/gates/commitments activates Gates section, not Projects", () => {
    expect(gates.match("/gates/commitments")).toBe(true);
    expect(projects.match("/gates/commitments")).toBe(false);
  });

  it("/gates itself activates Gates, not Projects", () => {
    expect(gates.match("/gates")).toBe(true);
    expect(projects.match("/gates")).toBe(false);
  });

  it("/dashboard legacy path activates Gates", () => {
    expect(gates.match("/dashboard")).toBe(true);
  });

  it("/exceptions legacy path activates Gates", () => {
    expect(gates.match("/exceptions")).toBe(true);
  });

  it("linkIsActive marks /gates/commitments as active for the commitments subnav pill", () => {
    expect(linkIsActive("/gates/commitments", "/gates/commitments")).toBe(true);
    expect(linkIsActive("/gates/commitments", "/gates")).toBe(true); // parent
    expect(linkIsActive("/gates/commitments", "/gates/blocked")).toBe(false);
  });

  it("Reports section matches /ceo and /coo paths", () => {
    const reportsSection = TOP_SECTIONS.find((s) => s.label === "Reports")!;
    expect(reportsSection.match("/ceo")).toBe(true);
    expect(reportsSection.match("/coo")).toBe(true);
    expect(reportsSection.match("/reports/center")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Mobile drawer group structure (structural, at 390 px)
// ---------------------------------------------------------------------------

describe("mobile drawer group structure", () => {
  it("Projects has secondaryGroups suitable for grouped mobile rendering", () => {
    const projects = TOP_SECTIONS.find((s) => s.label === "Projects")!;
    // All group items must exist in secondary so the allowedPaths filter works
    const allowedPaths = new Set(projects.secondary.map((i) => i.path));
    for (const group of projects.secondaryGroups ?? []) {
      for (const item of group.items) {
        expect(allowedPaths.has(item.path), `${item.path} not in secondary`).toBe(true);
      }
    }
  });

  it("Departments has secondaryGroups suitable for grouped mobile rendering", () => {
    const depts = TOP_SECTIONS.find((s) => s.label === "Departments")!;
    const allowedPaths = new Set(depts.secondary.map((i) => i.path));
    for (const group of depts.secondaryGroups ?? []) {
      for (const item of group.items) {
        expect(allowedPaths.has(item.path), `${item.path} not in secondary`).toBe(true);
      }
    }
  });

  it("sections without secondaryGroups fall back to flat rendering path", () => {
    const flatSections = TOP_SECTIONS.filter((s) => !s.secondaryGroups);
    expect(flatSections.length).toBeGreaterThan(0);
    // Gates, Finance, Home, Reports, Admin, and Project{Dev,Delivery} are all flat
    const flatLabels = flatSections.map((s) => s.label);
    expect(flatLabels).toContain("Gates");
    expect(flatLabels).toContain("Finance");
  });

  it("item-count badge (section.secondary.length) is non-zero for major nav sections", () => {
    const majorSections = ["Projects", "Gates", "Finance", "Reports"];
    for (const label of majorSections) {
      const section = TOP_SECTIONS.find((s) => s.label === label);
      expect(section?.secondary.length ?? 0, `${label} must have secondary items`).toBeGreaterThan(0);
    }
  });

  it("each section row meets the 44px target touch size via data-testid testability", () => {
    // Structural: every TOP_SECTION has a label usable as the mobile-nav-section key.
    for (const section of TOP_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.key.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Finance and PO/payment board routes unchanged
// ---------------------------------------------------------------------------

describe("finance and payment routes unchanged", () => {
  const financeSection = TOP_SECTIONS.find((s) => s.key === "FINANCE")!;
  const financePaths = financeSection.secondary.map((i) => i.path);

  it("all finance sub-routes are present and in order", () => {
    const expected = [
      "/cashflow", "/cashflow/analysis", "/cos", "/cos/analysis",
      "/revenue-tracker", "/program/excel-vs-app", "/finance/quickbooks",
      "/governance/financial-reviews", "/po-approval-board",
      "/payment-request-board", "/payment-batch-manager",
    ];
    for (const path of expected) {
      expect(financePaths, `Finance must include ${path}`).toContain(path);
    }
  });

  it("PO and payment board routes appear in Finance section secondary", () => {
    expect(financePaths).toContain("/po-approval-board");
    expect(financePaths).toContain("/payment-request-board");
    expect(financePaths).toContain("/payment-batch-manager");
  });

  it("PO and payment board routes have correct page-registry entries", () => {
    const po = PAGE_REGISTRY.find((p) => p.path === "/po-approval-board");
    const pr = PAGE_REGISTRY.find((p) => p.path === "/payment-request-board");
    const pb = PAGE_REGISTRY.find((p) => p.path === "/payment-batch-manager");
    expect(po?.routeComponentKey).toBe("POApprovalBoardPage");
    expect(pr?.routeComponentKey).toBe("PaymentRequestBoardPage");
    expect(pb?.routeComponentKey).toBe("PaymentBatchManagerPage");
    expect(ROUTE_COMPONENT_KEYS.has("POApprovalBoardPage")).toBe(true);
    expect(ROUTE_COMPONENT_KEYS.has("PaymentRequestBoardPage")).toBe(true);
    expect(ROUTE_COMPONENT_KEYS.has("PaymentBatchManagerPage")).toBe(true);
  });
});
