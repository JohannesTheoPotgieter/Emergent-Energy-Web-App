import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * The finance project-detail page shows ONLY financial views. Two corrections
 * are guarded here:
 *
 *  1. "Milestone Tracker" tab = the Revenue Milestone sheet replica
 *     (RevenueTrackingContent), NOT the delivery/programme Gantt
 *     (ProgramPlanContent), which is an engineering artifact.
 *  2. "Revenue" tab = monthly recognised revenue by state
 *     (ProjectRevenueTrackerView), mirroring the Cost of sales tab with a real
 *     Realised / Committed / Planned / Total split.
 *
 * The Planned column is sourced from a dedicated `plannedProjects` field on
 * /api/revenue-tracker (FYE planned + unrealised — identical to the COS tab's
 * "Planned" definition), so Planned = Planned rather than a catch-all unrealised.
 */
describe("finance project detail — financial-only tabs", () => {
  const detail = read("client/src/pages/finance-project-detail.tsx");
  const revenueView = read("client/src/components/finance/ProjectRevenueTrackerView.tsx");
  const financeRoutes = read("server/departments/finance-routes.ts");

  it("Milestone Tracker tab renders the Revenue Milestone sheet replica, not the Gantt", () => {
    const milestoneBlock = detail.match(
      /<TabsContent value="milestones"[\s\S]*?<\/TabsContent>/,
    )?.[0];
    expect(milestoneBlock).toBeDefined();
    expect(milestoneBlock).toContain("<RevenueTrackingContent");
    expect(milestoneBlock).not.toContain("ProgramPlanContent");
  });

  it("the Gantt (ProgramPlanContent) is no longer imported or used on the finance detail page", () => {
    expect(detail).not.toContain("ProgramPlanContent");
    expect(detail).not.toContain("@/pages/program-plan");
  });

  it("Revenue tab renders the monthly recognised-revenue view, not the milestone replica", () => {
    const revenueBlock = detail.match(
      /<TabsContent value="revenue"[\s\S]*?<\/TabsContent>/,
    )?.[0];
    expect(revenueBlock).toBeDefined();
    expect(revenueBlock).toContain("<ProjectRevenueTrackerView");
    expect(revenueBlock).not.toContain("<RevenueTrackingContent");
  });

  it("ProjectRevenueTrackerView reads the canonical /api/revenue-tracker endpoint", () => {
    expect(revenueView).toContain("/api/revenue-tracker");
    expect(revenueView).toContain('data-testid="project-revenue-tracker"');
  });

  it("ProjectRevenueTrackerView mirrors Cost of sales: Realised / Committed / Planned / Total", () => {
    expect(revenueView).toContain(">Realised<");
    expect(revenueView).toContain(">Committed<");
    expect(revenueView).toContain(">Planned<");
    expect(revenueView).toContain(">Total Revenue<");
    // Total recognised revenue = the three states summed (same shape as COS).
    expect(revenueView).toContain("realised + committed + planned");
    // Planned is its own per-project slice — not derived from unrealised.
    expect(revenueView).toContain("sumForProject(m.plannedProjects");
  });

  it("/api/revenue-tracker surfaces a dedicated plannedProjects field (= FYE planned + unrealised)", () => {
    // The handler builds a planned bucket combining planned + unrealised, exactly
    // like the COS handler's plannedByMonth, and emits it as plannedProjects.
    expect(financeRoutes).toContain("plannedRevByMonth");
    expect(financeRoutes).toMatch(
      /ms\.revenue\.planned\.total\s*\+\s*ms\.revenue\.unrealised\.total/,
    );
    expect(financeRoutes).toMatch(
      /plannedProjects:\s*mapToSortedArray\(plannedRevByMonth/,
    );
  });
});
