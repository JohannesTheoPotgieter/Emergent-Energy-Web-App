import { describe, expect, it } from "vitest";
import { buildExceptionLink, computeSeverity, filterResolved, normalizeRoleCluster, type ExceptionItem } from "../../../server/services/exception-dashboard-service";

describe("exception-dashboard-service", () => {
  it("maps user roles to the correct role cluster", () => {
    expect(normalizeRoleCluster("COO_ADMIN")).toBe("coo");
    expect(normalizeRoleCluster("PROGRAM_MANAGER")).toBe("program_manager");
    expect(normalizeRoleCluster("PROJECT_MANAGER_SITE")).toBe("project_manager");
    expect(normalizeRoleCluster("ENGINEERING_MANAGER")).toBe("engineering");
    expect(normalizeRoleCluster("QUALITY_MANAGER")).toBe("quality");
    expect(normalizeRoleCluster("PROGRAM_FINANCE_MANAGER")).toBe("finance");
    expect(normalizeRoleCluster("CONSTRUCTION_MANAGER")).toBe("construction");
  });

  it("calculates severity based on overdue windows and priority", () => {
    const veryOld = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    const mediumOld = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(computeSeverity({ category: "overdue_tasks", dueDate: veryOld })).toBe("critical");
    expect(computeSeverity({ category: "overdue_tasks", dueDate: mediumOld })).toBe("medium");
    expect(computeSeverity({ category: "high_risk_raid_changes", priority: "critical" })).toBe("critical");
  });

  it("builds deep links for exception actions", () => {
    expect(buildExceptionLink("work_item", 21)).toBe("/my-work/tasks?itemKey=plan-21");
    expect(buildExceptionLink("work_item", 21, "Solar A")).toBe("/project/Solar%20A?mode=execution&section=delivery&subTab=task-grid");
    expect(buildExceptionLink("approval", 9)).toBe("/my-work/tasks?itemKey=approval-gen-9");
    expect(buildExceptionLink("approval", 9, "Solar B")).toBe("/project/Solar%20B?mode=execution&section=collaboration&subTab=approvals");
    expect(buildExceptionLink("procurement", 4)).toBe("/subcontractor-dashboard?itemId=4");
    expect(buildExceptionLink("raid", 2, "Solar A")).toBe("/project/Solar%20A?tab=raid");
  });

  it("removes resolved items from active exception lists", () => {
    const items: ExceptionItem[] = [
      { id: "1", category: "overdue_tasks", severity: "high", title: "A", owner: "X", dueDate: null, project: "P", sourceLink: "/", sourceType: "w", sourceId: 1, reason: "Task overdue" },
      { id: "2", category: "pending_approvals", severity: "low", title: "B", owner: "Y", dueDate: null, project: "P", sourceLink: "/", sourceType: "a", sourceId: 2, reason: "Resolved in previous cycle" },
    ];
    expect(filterResolved(items).map((i) => i.id)).toEqual(["1"]);
  });

  it("handles missing data without crashing severity model", () => {
    expect(() => computeSeverity({ category: "invoice_payment_exceptions", dueDate: null, priority: null, status: null })).not.toThrow();
    expect(computeSeverity({ category: "invoice_payment_exceptions", dueDate: null, priority: null, status: null })).toBe("low");
  });
});
