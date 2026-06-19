import { describe, expect, it } from "vitest";
import { HOME_KPI_HREF, getHomeProjectHref } from "@/lib/home-links";
import { getRoleQuickActions as getBriefQuickActions } from "@/config/home-brief";
import { getRoleQuickActions as getDashboardQuickActions } from "@/config/role-dashboard-config";
import type { CompanyRole } from "@shared/schema/users";

const DASHBOARD_ROLES: CompanyRole[] = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "PROGRAM_MANAGER",
  "PROJECT_MANAGER_SITE",
  "CONSTRUCTION_MANAGER",
  "ENGINEERING_MANAGER",
  "ENGINEER",
  "QUALITY_MANAGER",
  "CFO",
  "PROGRAM_FINANCE_MANAGER",
  "ACCOUNTANT",
];

describe("home route links", () => {
  it("uses canonical project identity links from Home", () => {
    expect(getHomeProjectHref(42)).toBe("/project/id/42");
    expect(getHomeProjectHref(null)).toBe("/execution");
    expect(getHomeProjectHref(undefined)).toBe("/execution");
  });

  it("routes Home finance KPI drilldowns to finance source-of-truth pages", () => {
    expect(HOME_KPI_HREF["Planned Revenue (FY)"]).toBe("/revenue-tracker");
    expect(HOME_KPI_HREF["Revenue Outstanding"]).toBe("/revenue-tracker");
    expect(HOME_KPI_HREF["Inflow (FY)"]).toBe("/cashflow");
    expect(HOME_KPI_HREF["Inflow Received (FY)"]).toBe("/cashflow");
    expect(HOME_KPI_HREF["Received Inflow (FY)"]).toBe("/cashflow");
    expect(HOME_KPI_HREF["Overdue Inflow"]).toBe("/cashflow");
    expect(HOME_KPI_HREF["Gross Margin"]).toBe("/finance/gp/company");
    expect(HOME_KPI_HREF["Gross Profit"]).toBe("/finance/gp/company");
    expect(HOME_KPI_HREF["Gross Profit (FY)"]).toBe("/finance/gp/company");
  });

  it("does not send role quick actions to stale Home destinations", () => {
    const briefPaths = ["engineering", "admin", "finance", "pm", "quality"].flatMap((role) =>
      getBriefQuickActions(role).map((action) => action.path),
    );
    const dashboardPaths = DASHBOARD_ROLES.flatMap((role) =>
      getDashboardQuickActions(role).map((action) => action.path),
    );
    const allPaths = [...briefPaths, ...dashboardPaths];

    expect(allPaths).not.toContain("/engineering/inbox");
    expect(allPaths).not.toContain("/pd/pm-handover");
    expect(allPaths).not.toContain("/reports");
    expect(allPaths).not.toContain("/admin/control-center");
  });
});
