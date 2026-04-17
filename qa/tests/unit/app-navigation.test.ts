import { describe, expect, it } from "vitest";
import {
  buildVisibleTopSections,
  getBreadcrumbs,
  parseDisabledSubPages,
  validateDisabledSubPages,
  ROLE_VISIBLE_SECTIONS,
  SECTION_KEYS,
  TOP_SECTIONS,
} from "@/config/app-navigation";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";
import {
  findPageByPath,
  getAppSectionForPath,
  LEGACY_REDIRECTS,
  PAGE_REGISTRY,
  ROLE_LANDING_PAGE,
} from "@/config/page-registry";
import {
  NAVIGATION_PERMISSION_MODEL,
  validateNavigationPermissionModel,
} from "@/config/navigation-permissions";
import { ROUTE_COMPONENT_KEYS } from "@/config/route-components";
import { NAV_GROUP_KEYS } from "@/config/page-registry";
import { COMPANY_ROLES } from "@shared/schema/users";

describe("app navigation visibility", () => {
  it("keeps Home secondary navigation items matching sidebar config", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const homeSection = sections.find((section) => section.label === "Home");

    expect(homeSection?.secondary.map((item) => item.label)).toEqual([
      "My Dashboard",
      "My Tasks",
      "Approvals",
      "Calendar",
      "Meetings",
      "Inbox",
    ]);
  });

  it("filters inaccessible sections and secondary items by permission", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => ["/", "/my-work/tasks", "/projects"].includes(path),
    });

    expect(sections.some((section) => section.label === "Admin")).toBe(false);
    expect(sections.some((section) => section.label === "Finance")).toBe(false);

    const delivery = sections.find((section) => section.label === "Project Delivery");
    expect(delivery?.secondary.map((item) => item.label)).toEqual(["All Projects"]);
  });

  it("retargets a section link to the first visible child when the root page is not permitted", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => path === "/" || path === "/admin/smart-import",
    });

    const adminSection = sections.find((section) => section.label === "Admin");
    expect(adminSection?.path).toBe("/admin/smart-import");
    expect(adminSection?.secondary.map((item) => item.label)).toEqual(["Smart Import"]);
  });

  it("keeps Home visible even when My Work is not permitted", () => {
    const sections = buildVisibleTopSections({
      canViewPath: (path) => path === "/",
    });

    const homeSection = sections.find((section) => section.label === "Home");
    expect(homeSection?.secondary.map((item) => item.label)).toEqual(["My Dashboard"]);
  });

  it("exposes the Project Delivery section with correct secondary items", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const delivery = sections.find((section) => section.label === "Project Delivery");

    expect(delivery).toBeDefined();
    const labels = delivery!.secondary.map((item) => item.label);
    expect(labels).toContain("Execution Dashboard");
    expect(labels).toContain("All Projects");
    expect(labels).toContain("PO Approvals");
    expect(labels).toContain("Milestone Tracker");
    expect(labels).toContain("Sites");
  });

  it("has eleven top-level sections", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    expect(sections.map((s) => s.label)).toEqual([
      "Home",
      "Company",
      "Priorities",
      "Project Development",
      "Project Delivery",
      "Finance",
      "Engineering",
      "HSE",
      "Quality",
      "Reports",
      "Admin",
    ]);
  });

  it("hides disabled sub-pages from section secondary navigation", () => {
    const disabled = parseDisabledSubPages([
      "HOME",
      "PROJECT_DELIVERY",
      "ADMIN",
      "!HOME:/my-work/calendar",
      "!PROJECT_DELIVERY:/weekly-reviews",
      "!ADMIN:/admin/smart-import",
    ]);
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      allowedSectionKeys: ["HOME", "PROJECT_DELIVERY", "ADMIN"],
      disabledSubPages: disabled,
    });

    const home = sections.find((section) => section.key === "HOME");
    expect(home?.secondary.some((item) => item.path === "/my-work/calendar")).toBe(false);

    const delivery = sections.find((section) => section.key === "PROJECT_DELIVERY");
    expect(delivery?.secondary.some((item) => item.path === "/weekly-reviews")).toBe(false);

    const admin = sections.find((section) => section.key === "ADMIN");
    expect(admin?.secondary.some((item) => item.path === "/admin/smart-import")).toBe(false);
  });

  it("shows COO/Admin all sections in current FE order", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "COO_ADMIN",
    });
    expect(sections.map((s) => s.label)).toEqual([
      "Home",
      "Company",
      "Priorities",
      "Project Development",
      "Project Delivery",
      "Finance",
      "Engineering",
      "HSE",
      "Quality",
      "Reports",
      "Admin",
    ]);
  });

  it("limits Engineer to allowed sections and excludes Finance/Admin", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "ENGINEER",
    });
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(["Home", "Priorities", "Engineering", "Quality"]);
    expect(labels).not.toContain("Finance");
    expect(labels).not.toContain("Admin");
  });

  it("keeps PM/Construction delivery sub-pages aligned with app navigation", () => {
    const pmSections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "PROJECT_MANAGER_SITE",
    });
    const pmDelivery = pmSections.find((section) => section.label === "Project Delivery");
    const pmLabels = pmDelivery?.secondary.map((item) => item.label) ?? [];
    expect(pmLabels).toContain("Weekly Reviews");
    expect(pmLabels).toContain("Milestone Tracker");
    expect(pmLabels).toContain("PM On-The-Go");
    expect(pmLabels).toContain("Handover & Closeout");

    const constructionSections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "CONSTRUCTION_MANAGER",
    });
    expect(constructionSections.some((section) => section.label === "Project Delivery")).toBe(true);
  });

  it("keeps Accountant scoped to Home/Priorities/Finance section set", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "ACCOUNTANT",
    });
    expect(sections.map((s) => s.label)).toEqual(["Home", "Priorities", "Finance"]);
    const finance = sections.find((s) => s.label === "Finance");
    expect(finance?.secondary.map((item) => item.label)).toEqual([
      "Cashflow",
      "Revenue",
      "COS",
      "GP / Margin",
      "FYE Revenue",
      "Counterparties",
      "Subcontractors",
      "Invoice Patterns",
    ]);
  });

  it("hides a section entirely when its top-level key is removed", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      allowedSectionKeys: ["HOME", "FINANCE"],
      disabledSubPages: parseDisabledSubPages(["HOME", "FINANCE", "!FINANCE:/cashflow"]),
    });
    expect(sections.some((section) => section.key === "PROJECT_DELIVERY")).toBe(false);
    expect(sections.some((section) => section.key === "ADMIN")).toBe(false);
  });

  it("keeps admin navigation aligned to the approved governed surfaces", () => {
    const labels = ADMIN_SURFACES.map((surface) => surface.label);
    expect(labels).toContain("Control Center");
    expect(labels).toContain("Smart Import");
    expect(labels).toContain("Roles & Permissions");
    expect(labels).toContain("Audit Log");
    ADMIN_SURFACES.forEach((surface) => {
      expect(surface.path).toMatch(/^\/admin\//);
      expect(surface.description).toBeTruthy();
    });
  });

  it("does not surface Command Center in admin navigation", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const adminSection = sections.find((section) => section.label === "Admin");

    expect(adminSection?.secondary.some((item) => /command center/i.test(item.label))).toBe(false);
  });

  it("maps Priorities route to PRIORITIES section key (regression)", () => {
    expect(getAppSectionForPath("/priorities")).toBe("PRIORITIES");
    expect(getAppSectionForPath("/Priorities")).toBe("PRIORITIES");
  });

  it("keeps a single nav-permission source with unique section:path keys", () => {
    const keys = NAVIGATION_PERMISSION_MODEL.flatMap((section) =>
      section.items.map((item) => `${section.key}:${item.path}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("role / section completeness", () => {
  it("every COMPANY_ROLES entry has visible sections configured", () => {
    for (const role of COMPANY_ROLES) {
      expect(ROLE_VISIBLE_SECTIONS[role], `missing ROLE_VISIBLE_SECTIONS[${role}]`).toBeDefined();
      expect(ROLE_VISIBLE_SECTIONS[role].length).toBeGreaterThan(0);
    }
  });

  it("every section listed under a role is a real TOP_SECTIONS key", () => {
    const topKeys = new Set(TOP_SECTIONS.map((s) => s.key));
    for (const role of COMPANY_ROLES) {
      for (const key of ROLE_VISIBLE_SECTIONS[role]) {
        expect(topKeys.has(key), `role ${role} references unknown section ${key}`).toBe(true);
      }
    }
  });

  it("every TOP_SECTIONS key appears in SECTION_KEYS (single source)", () => {
    const sectionKeySet = new Set<string>(SECTION_KEYS);
    for (const section of TOP_SECTIONS) {
      expect(sectionKeySet.has(section.key)).toBe(true);
    }
  });

  it("every SectionKey is visible to at least one role (no dead sections)", () => {
    const seen = new Set<string>();
    for (const role of COMPANY_ROLES) {
      for (const key of ROLE_VISIBLE_SECTIONS[role]) seen.add(key);
    }
    for (const key of SECTION_KEYS) {
      expect(seen.has(key), `section ${key} is not visible to any role`).toBe(true);
    }
  });

  it("every COMPANY_ROLES value resolves to a concrete landing path", () => {
    const registryPaths = new Set(PAGE_REGISTRY.map((p) => p.path));
    const legacyPaths = new Map(LEGACY_REDIRECTS.map((r) => [r.path, r.redirectTo]));
    const resolveHome = (role: string) => {
      const landing = ROLE_LANDING_PAGE[role] || "/dashboard";
      return legacyPaths.get(landing) ?? landing;
    };
    for (const role of COMPANY_ROLES) {
      const resolved = resolveHome(role);
      expect(
        registryPaths.has(resolved),
        `role ${role} resolves to ${resolved} which is not in PAGE_REGISTRY`,
      ).toBe(true);
    }
  });
});

describe("navigation permission model validator", () => {
  it("reports zero errors (duplicate section:path keys)", () => {
    const issues = validateNavigationPermissionModel();
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors, errors.map((e) => e.message).join("\n")).toEqual([]);
  });

  it("reports zero warnings after allowlisted items are excluded", () => {
    const issues = validateNavigationPermissionModel();
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings, warnings.map((w) => w.message).join("\n")).toEqual([]);
  });
});

describe("disabled-subpage format", () => {
  it("parses a valid '!SECTION:/path' entry", () => {
    const map = parseDisabledSubPages(["!FINANCE:/cashflow", "!ADMIN:/admin/smart-import"]);
    expect(map.get("FINANCE")?.has("/cashflow")).toBe(true);
    expect(map.get("ADMIN")?.has("/admin/smart-import")).toBe(true);
  });

  it("ignores plain section-key entries (no '!' prefix)", () => {
    const map = parseDisabledSubPages(["FINANCE", "ADMIN"]);
    expect(map.size).toBe(0);
  });

  it("validateDisabledSubPages flags malformed entries", () => {
    const issues = validateDisabledSubPages([
      "!NOCOLON",
      "!FINANCE/cashflow",
      "!:/orphan",
      "!:/",
    ]);
    expect(issues.every((i) => i.reason === "malformed")).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("validateDisabledSubPages flags unknown section keys", () => {
    const issues = validateDisabledSubPages(["!UNKNOWN_SECTION:/path"]);
    expect(issues.some((i) => i.reason === "unknown_section_key")).toBe(true);
  });

  it("validateDisabledSubPages flags invalid paths", () => {
    const issues = validateDisabledSubPages(["!FINANCE:/"]);
    expect(issues.some((i) => i.reason === "invalid_path")).toBe(true);
  });

  it("validateDisabledSubPages accepts well-formed entries", () => {
    const issues = validateDisabledSubPages([
      "!FINANCE:/cashflow",
      "!ADMIN:/admin/smart-import",
      "!PROJECT_DELIVERY:/weekly-reviews",
      "HOME",
      "FINANCE",
    ]);
    expect(issues).toEqual([]);
  });
});

describe("nav ↔ registry ↔ router parity", () => {
  it("every TOP_SECTIONS secondary path resolves to a PAGE_REGISTRY entry", () => {
    const basePath = (path: string) => path.split("?")[0] || path;
    const orphans: string[] = [];
    for (const section of TOP_SECTIONS) {
      for (const item of section.secondary) {
        const path = basePath(item.path);
        if (path === "/") continue;
        if (!findPageByPath(path)) {
          orphans.push(`${section.key} → ${item.label} (${path})`);
        }
      }
    }
    expect(orphans, orphans.join("\n")).toEqual([]);
  });

  it("every PAGE_REGISTRY routeComponentKey exists in ROUTE_COMPONENTS", () => {
    // Entries with `redirectTo` never consult routeComponentKey at runtime
    // (see App.tsx APP_ROUTES) — ignore their routeComponentKey metadata.
    const missing: string[] = [];
    for (const page of PAGE_REGISTRY) {
      if (page.redirectTo) continue;
      if (page.routeComponentKey && !ROUTE_COMPONENT_KEYS.has(page.routeComponentKey)) {
        missing.push(`${page.id} (${page.path}) → ${page.routeComponentKey}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("every PAGE_REGISTRY entry declares either routeComponentKey or redirectTo", () => {
    const orphans: string[] = [];
    for (const page of PAGE_REGISTRY) {
      if (!page.routeComponentKey && !page.redirectTo) {
        orphans.push(`${page.id} (${page.path})`);
      }
    }
    expect(orphans, orphans.join("\n")).toEqual([]);
  });

  it("every LEGACY_REDIRECTS target resolves to a real route", () => {
    // "/" is routable via the top-level HomePage Route in App.tsx and has no
    // PAGE_REGISTRY entry, so accept it as a valid redirect target.
    const unresolved: string[] = [];
    for (const redirect of LEGACY_REDIRECTS) {
      const target = redirect.redirectTo.split("?")[0];
      if (target === "/") continue;
      if (!findPageByPath(target)) {
        unresolved.push(`${redirect.path} → ${redirect.redirectTo}`);
      }
    }
    expect(unresolved, unresolved.join("\n")).toEqual([]);
  });

  it("every PAGE_REGISTRY redirectTo resolves to a real route", () => {
    const unresolved: string[] = [];
    for (const page of PAGE_REGISTRY) {
      if (page.redirectTo) {
        const target = page.redirectTo.split("?")[0];
        if (target === "/") continue;
        if (!findPageByPath(target)) {
          unresolved.push(`${page.id} (${page.path}) → ${page.redirectTo}`);
        }
      }
    }
    expect(unresolved, unresolved.join("\n")).toEqual([]);
  });

  it("every PAGE_REGISTRY navGroup value is a declared NAV_GROUP_KEYS entry", () => {
    const validGroups = new Set<string>(NAV_GROUP_KEYS);
    const unknown: string[] = [];
    for (const page of PAGE_REGISTRY) {
      if (page.navGroup && !validGroups.has(page.navGroup)) {
        unknown.push(`${page.id} (${page.path}) → ${page.navGroup}`);
      }
    }
    expect(unknown, unknown.join("\n")).toEqual([]);
  });

  it("every sidebar-visible page with a navGroup resolves to a SectionKey", () => {
    const topKeys = new Set(TOP_SECTIONS.map((s) => s.key));
    const orphans: string[] = [];
    for (const page of PAGE_REGISTRY) {
      if (!page.showInSidebar || !page.navGroup) continue;
      const section = getAppSectionForPath(page.path);
      if (!section || !topKeys.has(section)) {
        orphans.push(`${page.id} (${page.path}) → navGroup=${page.navGroup}`);
      }
    }
    expect(orphans, orphans.join("\n")).toEqual([]);
  });
});

describe("breadcrumb generation", () => {
  const allSections = buildVisibleTopSections({ canViewPath: () => true });
  const findSection = (label: string) => allSections.find((s) => s.label === label)!;

  it("returns empty breadcrumbs for root path", () => {
    expect(getBreadcrumbs("/", findSection("Home"))).toEqual([]);
  });

  it("shows 'Priorities' for /priorities (no Home duplication)", () => {
    const crumbs = getBreadcrumbs("/priorities", findSection("Home"));
    expect(crumbs).toEqual([{ label: "Priorities" }]);
  });

  it("maps priority detail with clickable parent", () => {
    const crumbs = getBreadcrumbs("/priorities/42", findSection("Home"));
    expect(crumbs).toEqual([
      { label: "Priorities", path: "/priorities" },
      { label: "Priority #42" },
    ]);
  });

  it("maps project detail breadcrumbs to Project Delivery > project name", () => {
    const crumbs = getBreadcrumbs("/project/Alpha_Site", findSection("Project Delivery"));
    expect(crumbs).toEqual([
      { label: "Project Delivery", path: "/projects" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps project financial linking with full trail", () => {
    const crumbs = getBreadcrumbs("/project/Alpha_Site/financial-linking", findSection("Project Delivery"));
    expect(crumbs).toEqual([
      { label: "Project Delivery", path: "/projects" },
      { label: "Alpha_Site", path: "/project/Alpha_Site" },
      { label: "Financial Linking" },
    ]);
  });

  it("maps portfolio detail with Company parent", () => {
    const crumbs = getBreadcrumbs("/portfolios/solar-portfolio", findSection("Company"));
    expect(crumbs).toEqual([
      { label: "Company", path: "/lifecycle-board" },
      { label: "solar-portfolio" },
    ]);
  });

  it("maps NCR detail with Quality parent chain", () => {
    const crumbs = getBreadcrumbs("/quality/ncr/NCR-001", findSection("Quality"));
    expect(crumbs).toEqual([
      { label: "Quality", path: "/quality" },
      { label: "Quality Dashboard", path: "/quality" },
      { label: "NCR-001" },
    ]);
  });

  it("maps client detail with Project Development parent chain", () => {
    const crumbs = getBreadcrumbs("/clients/acme-corp", findSection("Project Development"));
    expect(crumbs).toEqual([
      { label: "Project Development", path: "/pd" },
      { label: "Clients", path: "/clients" },
      { label: "acme-corp" },
    ]);
  });

  it("maps client project departments with full trail", () => {
    const crumbs = getBreadcrumbs("/clients/acme-corp/project/proj-1", findSection("Project Development"));
    expect(crumbs).toEqual([
      { label: "Project Development", path: "/pd" },
      { label: "Clients", path: "/clients" },
      { label: "acme-corp", path: "/clients/acme-corp" },
      { label: "Project Departments" },
    ]);
  });

  it("maps PD handover with handover queue parent", () => {
    const crumbs = getBreadcrumbs("/pd/handover/proj-123", findSection("Project Development"));
    expect(crumbs).toEqual([
      { label: "Project Development", path: "/pd" },
      { label: "Handover Queue", path: "/handover-control" },
      { label: "proj-123" },
    ]);
  });

  it("maps PM on-the-go project with mobile view parent", () => {
    const crumbs = getBreadcrumbs("/pm/on-the-go/project/proj-1", findSection("Project Delivery"));
    expect(crumbs).toEqual([
      { label: "Project Delivery", path: "/execution-board" },
      { label: "Mobile View", path: "/pm/on-the-go" },
      { label: "proj-1" },
    ]);
  });

  it("maps PM report history sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/history", findSection("Reports"));
    expect(crumbs).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "History" },
    ]);
  });

  it("maps PM report compare sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/compare", findSection("Reports"));
    expect(crumbs).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Compare" },
    ]);
  });

  it("maps engineering report history sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/engineering/monthly/history", findSection("Reports"));
    expect(crumbs).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "History" },
    ]);
  });

  it("maps PM monthly report project detail", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/2026-03/project/Alpha_Site", findSection("Reports"));
    expect(crumbs).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps engineering monthly report project detail", () => {
    const crumbs = getBreadcrumbs("/reports/engineering/monthly/2026-03/project/Alpha_Site", findSection("Reports"));
    expect(crumbs).toEqual([
      { label: "Reports", path: "/reports/center" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps gates sub-pages under Company section", () => {
    const crumbs = getBreadcrumbs("/gates/blocked", findSection("Company"));
    expect(crumbs).toEqual([
      { label: "Company", path: "/lifecycle-board" },
      { label: "Gate Tracker", path: "/gates" },
      { label: "Blocked Gates" },
    ]);
  });

  it("maps PD ticket create with full trail", () => {
    const crumbs = getBreadcrumbs("/pd/tickets/create", findSection("Project Development"));
    expect(crumbs).toEqual([
      { label: "Project Development", path: "/pd" },
      { label: "PD Tickets", path: "/pd/tickets" },
      { label: "Create" },
    ]);
  });

  it("maps PD ticket detail with full trail", () => {
    const crumbs = getBreadcrumbs("/pd/tickets/TKT-42", findSection("Project Development"));
    expect(crumbs).toEqual([
      { label: "Project Development", path: "/pd" },
      { label: "PD Tickets", path: "/pd/tickets" },
      { label: "Ticket TKT-42" },
    ]);
  });

  it("generic fallback produces clickable section label", () => {
    const crumbs = getBreadcrumbs("/cashflow", findSection("Finance"));
    expect(crumbs).toEqual([
      { label: "Finance", path: "/cashflow" },
      { label: "Cashflow" },
    ]);
  });

  it("gates/commitments resolves under Project Delivery section", () => {
    const delivery = findSection("Project Delivery");
    expect(delivery.match("/gates/commitments")).toBe(true);

    const company = findSection("Company");
    expect(company.match("/gates/commitments")).toBe(false);
  });
});
