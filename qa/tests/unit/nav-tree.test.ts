import { describe, expect, it } from "vitest";
import {
  buildNavTree,
  findActiveNavItem,
  getNavBreadcrumbs,
  type NavGroup,
} from "../../../client/src/config/nav-tree";

const allowAll = () => true;
const enableAll = () => true;

function flatPaths(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.path));
}
function headings(groups: NavGroup[]): string[] {
  return groups.map((g) => g.heading);
}

describe("nav-tree — registry-driven navigation", () => {
  it("surfaces every business domain that the legacy 6-tab nav hid", () => {
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll });
    const h = headings(tree);
    // Domains that previously had no top-nav entry at all.
    for (const domain of ["Company", "Project Development", "Gates", "HSE", "Reports", "Knowledge"]) {
      expect(h, `missing domain: ${domain}`).toContain(domain);
    }
  });

  it("gives every role-landing page a home (no more dead-ends)", () => {
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll });
    const paths = flatPaths(tree);
    // /now (COO/CEO/PM…), /pd (PD roles), /hse (HSE roles) were unreachable from nav.
    expect(paths).toContain("/now");
    expect(paths).toContain("/pd");
    expect(paths).toContain("/hse");
  });

  it("always includes a Home item pointing at the root dashboard", () => {
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll });
    const home = tree.find((g) => g.key === "MY_WORK");
    expect(home?.items[0]).toMatchObject({ path: "/", label: "Home" });
  });

  it("excludes sub-views/duplicates that are reached contextually", () => {
    const paths = flatPaths(buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll }));
    for (const sub of ["/execution-board/program", "/cos/analysis", "/reports/pm/monthly/history", "/execution-dashboard"]) {
      expect(paths, `should not list sub-view ${sub}`).not.toContain(sub);
    }
  });

  it("respects RBAC — denied items disappear, and groups left empty are dropped", () => {
    // Deny all of Finance plus the single-item HSE group.
    const deny = (path: string) =>
      path !== "/hse" &&
      !["/cashflow", "/cos", "/revenue", "/fye", "/finance", "/payment", "/po-approval", "/counterparties", "/subcontractor", "/invoice-patterns", "/governance"].some((p) => path.startsWith(p));
    const tree = buildNavTree({ canViewPath: deny, isScreenEnabled: enableAll });
    const paths = flatPaths(tree);
    expect(paths).not.toContain("/cashflow");
    expect(paths).not.toContain("/finance/quickbooks");
    expect(paths).not.toContain("/hse");
    // Both groups are now empty of permitted items → removed entirely.
    expect(headings(tree)).not.toContain("Finance");
    expect(headings(tree)).not.toContain("HSE");
  });

  it("respects screen-availability — a disabled screen is dropped", () => {
    // PATH_TO_SCREEN_ID maps /hse -> "hseDashboard".
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: (id) => id !== "hseDashboard" });
    expect(flatPaths(tree)).not.toContain("/hse");
  });

  it("findActiveNavItem picks the deepest matching item", () => {
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll });
    expect(findActiveNavItem("/engineering/tasks", tree)?.item.path).toBe("/engineering/tasks");
    expect(findActiveNavItem("/engineering", tree)?.item.path).toBe("/engineering");
    // Deep sub-route resolves to its nearest nav parent.
    expect(findActiveNavItem("/projects/123", tree)?.item.path).toBe("/projects");
    expect(findActiveNavItem("/", tree)?.item.path).toBe("/");
  });

  it("breadcrumbs root on the correct domain (fixes the Home mislabel)", () => {
    const tree = buildNavTree({ canViewPath: allowAll, isScreenEnabled: enableAll });
    expect(getNavBreadcrumbs("/", tree)).toEqual([]);

    const oppo = getNavBreadcrumbs("/opportunities", tree);
    expect(oppo[0]?.label).toBe("Project Development");
    expect(oppo[oppo.length - 1]?.label).toBe("Opportunities");

    const tasks = getNavBreadcrumbs("/engineering/tasks", tree);
    expect(tasks[0]?.label).toBe("Engineering");
    expect(tasks.some((c) => /Task Board/.test(c.label))).toBe(true);
  });
});
