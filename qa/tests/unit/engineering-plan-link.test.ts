import { describe, it, expect } from "vitest";
import {
  derivePlanLink,
  effectiveEngineeringDueDate,
  shiftDateDays,
  dayDiff,
} from "@shared/engineering/plan-link";

// The plan-link derivation is the single source the Task Manager list, the task
// detail drawer AND the Engineering Home counts all read through. It was
// previously untested (T1). These tests pin the rule so the three surfaces
// cannot drift.
describe("derivePlanLink", () => {
  const today = "2026-07-01";

  it("'before' relation → plan start minus lead days (engineering leads)", () => {
    const d = derivePlanLink({ relation: "before", leadDays: 5, planStart: "2026-07-20", planEnd: null, taskStatus: "in_progress", today });
    expect(d.derivedDue).toBe("2026-07-15");
    expect(d.planAnchorDate).toBe("2026-07-20");
  });

  it("'after' relation → plan end plus lead days (engineering follows)", () => {
    const d = derivePlanLink({ relation: "after", leadDays: 5, planStart: null, planEnd: "2026-07-20", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBe("2026-07-25");
    expect(d.planAnchorDate).toBe("2026-07-20");
  });

  it("defaults lead days to 5 when null", () => {
    const d = derivePlanLink({ relation: "after", leadDays: null, planStart: null, planEnd: "2026-07-20", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBe("2026-07-25");
  });

  it("missing anchor date → null derived due and never urgent", () => {
    const d = derivePlanLink({ relation: "before", leadDays: 5, planStart: null, planEnd: "2026-07-20", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBeNull();
    expect(d.planAnchorDate).toBeNull();
    expect(d.planLinkUrgent).toBe(false);
  });

  it("unknown relation → null derived due", () => {
    const d = derivePlanLink({ relation: null, leadDays: 5, planStart: "2026-07-20", planEnd: "2026-07-20", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBeNull();
  });

  it("urgent when the derived due is within the 5-day window", () => {
    const d = derivePlanLink({ relation: "after", leadDays: 5, planStart: null, planEnd: "2026-07-01", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBe("2026-07-06"); // exactly 5 days out
    expect(d.planLinkUrgent).toBe(true);
  });

  it("urgent when the derived due is overdue", () => {
    const d = derivePlanLink({ relation: "after", leadDays: 0, planStart: null, planEnd: "2026-06-01", taskStatus: "in_progress", today });
    expect(d.derivedDue).toBe("2026-06-01");
    expect(d.planLinkUrgent).toBe(true);
  });

  it("not urgent when the derived due is comfortably in the future", () => {
    const d = derivePlanLink({ relation: "after", leadDays: 5, planStart: null, planEnd: "2026-12-01", taskStatus: "in_progress", today });
    expect(d.planLinkUrgent).toBe(false);
  });

  it("never urgent once the task is complete", () => {
    const d = derivePlanLink({ relation: "after", leadDays: 0, planStart: null, planEnd: "2026-06-01", taskStatus: "complete", today });
    expect(d.planLinkUrgent).toBe(false);
  });
});

describe("shiftDateDays / dayDiff (UTC whole-day math)", () => {
  it("shiftDateDays crosses month boundaries without drift", () => {
    expect(shiftDateDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDateDays("2026-03-01", -1)).toBe("2026-02-28"); // 2026 is not a leap year
    expect(shiftDateDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("dayDiff counts signed whole days", () => {
    expect(dayDiff("2026-07-01", "2026-07-06")).toBe(5);
    expect(dayDiff("2026-07-06", "2026-07-01")).toBe(-5);
    expect(dayDiff("2026-07-01", "2026-07-01")).toBe(0);
  });
});

describe("effectiveEngineeringDueDate (shared list/detail/home rule)", () => {
  const today = "2026-07-01";

  it("unlinked task → the persisted end date stands", () => {
    expect(
      effectiveEngineeringDueDate({
        planLinkItemId: null, planLinkRelation: null, planLinkLeadDays: null,
        planStart: null, planEnd: null, endDate: "2026-08-15", status: "in_progress", today,
      }),
    ).toBe("2026-08-15");
  });

  it("plan-linked task → derived due overrides a stale persisted end date", () => {
    expect(
      effectiveEngineeringDueDate({
        planLinkItemId: 42, planLinkRelation: "after", planLinkLeadDays: 5,
        planStart: null, planEnd: "2026-07-20", endDate: "2026-01-01", status: "in_progress", today,
      }),
    ).toBe("2026-07-25");
  });

  it("plan-linked but plan date missing → null (reads as 'no due date', matching the Task Manager)", () => {
    expect(
      effectiveEngineeringDueDate({
        planLinkItemId: 42, planLinkRelation: "after", planLinkLeadDays: 5,
        planStart: null, planEnd: null, endDate: "2026-01-01", status: "in_progress", today,
      }),
    ).toBeNull();
  });
});
