import { describe, expect, it } from "vitest";
import { buildVisibleTopSections, getBreadcrumbs, parseDisabledSubPages } from "@/config/app-navigation";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";
import { getAppSectionForPath } from "@/config/page-registry";
import { NAVIGATION_PERMISSION_MODEL } from "@/config/navigation-permissions";

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

    const management = sections.find((section) => section.label === "Project Management");
    expect(management?.secondary.map((item) => item.label)).toEqual(["All Projects"]);
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

  it("exposes the Project Management section with correct secondary items", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const management = sections.find((section) => section.label === "Project Management");

    expect(management).toBeDefined();
    const labels = management!.secondary.map((item) => item.label);
    expect(labels).toContain("Execution Dashboard");
    expect(labels).toContain("All Projects");
    expect(labels).toContain("PO Approvals");
    expect(labels).toContain("Milestone Tracker");
    expect(labels).toContain("Sites");
  });

  it("has nine top-level sections (9-department model)", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    expect(sections.map((s) => s.label)).toEqual([
      "Home",
      "Priorities",
      "Project Development",
      "Project Management",
      "Engineering",
      "Quality",
      "Finance",
      "Parties",
      "Admin",
    ]);
  });

  it("hides disabled sub-pages from section secondary navigation", () => {
    const disabled = parseDisabledSubPages([
      "HOME",
      "PROJECT_MANAGEMENT",
      "ADMIN",
      "!HOME:/my-work/calendar",
      "!PROJECT_MANAGEMENT:/weekly-reviews",
      "!ADMIN:/admin/smart-import",
    ]);
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      allowedSectionKeys: ["HOME", "PROJECT_MANAGEMENT", "ADMIN"],
      disabledSubPages: disabled,
    });

    const home = sections.find((section) => section.key === "HOME");
    expect(home?.secondary.some((item) => item.path === "/my-work/calendar")).toBe(false);

    const management = sections.find((section) => section.key === "PROJECT_MANAGEMENT");
    expect(management?.secondary.some((item) => item.path === "/weekly-reviews")).toBe(false);

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
      "Priorities",
      "Project Development",
      "Project Management",
      "Engineering",
      "Quality",
      "Finance",
      "Parties",
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
    expect(labels).not.toContain("Parties");
  });

  it("keeps PM/Construction management sub-pages aligned with app navigation", () => {
    const pmSections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "PROJECT_MANAGER_SITE",
    });
    const pmManagement = pmSections.find((section) => section.label === "Project Management");
    const pmLabels = pmManagement?.secondary.map((item) => item.label) ?? [];
    expect(pmLabels).toContain("Weekly Reviews");
    expect(pmLabels).toContain("Milestone Tracker");
    expect(pmLabels).toContain("PM On-The-Go");
    expect(pmLabels).toContain("Handover & Closeout");

    const constructionSections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "CONSTRUCTION_MANAGER",
    });
    expect(constructionSections.some((section) => section.label === "Project Management")).toBe(true);
  });

  it("keeps Accountant scoped to Home/Priorities/Finance section set", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      companyRole: "ACCOUNTANT",
    });
    expect(sections.map((s) => s.label)).toEqual(["Home", "Priorities", "Finance"]);
    const finance = sections.find((s) => s.label === "Finance");
    expect(finance?.secondary.map((item) => item.label)).toEqual([
      "Finance Records",
      "Cashflow",
      "Revenue",
      "COS",
      "GP / Margin",
      "FYE Revenue",
      "Invoice Patterns",
    ]);
  });

  it("hides a section entirely when its top-level key is removed", () => {
    const sections = buildVisibleTopSections({
      canViewPath: () => true,
      allowedSectionKeys: ["HOME", "FINANCE"],
      disabledSubPages: parseDisabledSubPages(["HOME", "FINANCE", "!FINANCE:/cashflow"]),
    });
    expect(sections.some((section) => section.key === "PROJECT_MANAGEMENT")).toBe(false);
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

  it("maps project detail breadcrumbs to Project Management > project name", () => {
    const crumbs = getBreadcrumbs("/project/Alpha_Site", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/projects" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps project financial linking with full trail", () => {
    const crumbs = getBreadcrumbs("/project/Alpha_Site/financial-linking", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/projects" },
      { label: "Alpha_Site", path: "/project/Alpha_Site" },
      { label: "Financial Linking" },
    ]);
  });

  it("maps portfolio detail with Project Management parent", () => {
    const crumbs = getBreadcrumbs("/portfolios/solar-portfolio", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
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
    const crumbs = getBreadcrumbs("/pm/on-the-go/project/proj-1", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
      { label: "Mobile View", path: "/pm/on-the-go" },
      { label: "proj-1" },
    ]);
  });

  it("maps PM report history sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/history", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "History" },
    ]);
  });

  it("maps PM report compare sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/compare", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Compare" },
    ]);
  });

  it("maps engineering report history sub-page", () => {
    const crumbs = getBreadcrumbs("/reports/engineering/monthly/history", findSection("Engineering"));
    expect(crumbs).toEqual([
      { label: "Engineering", path: "/engineering" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "History" },
    ]);
  });

  it("maps PM monthly report project detail", () => {
    const crumbs = getBreadcrumbs("/reports/pm/monthly/2026-03/project/Alpha_Site", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
      { label: "PM Monthly", path: "/reports/pm/monthly" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps engineering monthly report project detail", () => {
    const crumbs = getBreadcrumbs("/reports/engineering/monthly/2026-03/project/Alpha_Site", findSection("Engineering"));
    expect(crumbs).toEqual([
      { label: "Engineering", path: "/engineering" },
      { label: "Engineering Monthly", path: "/reports/engineering/monthly" },
      { label: "Alpha_Site" },
    ]);
  });

  it("maps gates sub-pages under Project Management section", () => {
    const crumbs = getBreadcrumbs("/gates/blocked", findSection("Project Management"));
    expect(crumbs).toEqual([
      { label: "Project Management", path: "/execution-board" },
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

  it("gates/commitments resolves under Project Management section", () => {
    const management = findSection("Project Management");
    expect(management.match("/gates/commitments")).toBe(true);

    const finance = findSection("Finance");
    expect(finance.match("/gates/commitments")).toBe(false);
  });
});
