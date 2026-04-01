import { describe, expect, it } from "vitest";
import { buildVisibleTopSections, getBreadcrumbs } from "@/config/app-navigation";
import { ADMIN_SURFACES } from "@/config/admin-surfaces";

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
      "Company Priorities",
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
    expect(labels).toContain("Construction");
    expect(labels).toContain("Procurement");
    expect(labels).toContain("PO Approvals");
    expect(labels).toContain("Milestone Tracker");
    expect(labels).toContain("Sites");
  });

  it("has eleven top-level sections", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    expect(sections.map((s) => s.label)).toEqual([
      "Home",
      "Company",
      "Project Development",
      "Project Delivery",
      "HSE",
      "Engineering",
      "Quality",
      "Finance",
      "Reports",
      "Priorities",
      "Admin",
    ]);
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
});

describe("breadcrumb generation", () => {
  const allSections = buildVisibleTopSections({ canViewPath: () => true });
  const findSection = (label: string) => allSections.find((s) => s.label === label)!;

  it("returns empty breadcrumbs for root path", () => {
    expect(getBreadcrumbs("/", findSection("Home"))).toEqual([]);
  });

  it("shows 'Company Priorities' for /priorities (no Home duplication)", () => {
    const crumbs = getBreadcrumbs("/priorities", findSection("Home"));
    expect(crumbs).toEqual([{ label: "Company Priorities" }]);
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
      { label: "Inspections / NCRs", path: "/quality/ncrs" },
      { label: "NCR NCR-001" },
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
