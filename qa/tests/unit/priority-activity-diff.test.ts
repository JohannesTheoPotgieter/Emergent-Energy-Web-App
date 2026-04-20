import { describe, expect, it } from "vitest";
import { computeUpdateActivities } from "../../../server/departments/priority-activity-log";

describe("computeUpdateActivities", () => {
  it("emits nothing when before and after are identical", () => {
    const events = computeUpdateActivities({
      before: { status: "active", severity: "normal", manualHealth: null, manualProgress: 50, dueDate: "2026-05-01" },
      after:  { status: "active", severity: "normal", manualHealth: null, manualProgress: 50, dueDate: "2026-05-01" },
    });
    expect(events).toEqual([]);
  });

  it("translates status → closed into a 'closed' event (not 'status_changed')", () => {
    const events = computeUpdateActivities({
      before: { status: "active" },
      after:  { status: "closed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "closed", fromValue: "active", toValue: "closed" });
  });

  it("translates status → complete into 'marked_complete'", () => {
    const events = computeUpdateActivities({
      before: { status: "active" },
      after:  { status: "complete" },
    });
    expect(events[0].action).toBe("marked_complete");
  });

  it("translates closed → active into 'reopened'", () => {
    const events = computeUpdateActivities({
      before: { status: "closed" },
      after:  { status: "active" },
    });
    expect(events[0]).toMatchObject({ action: "reopened", fromValue: "closed", toValue: "active" });
  });

  it("emits 'status_changed' for other status transitions", () => {
    const events = computeUpdateActivities({
      before: { status: "active" },
      after:  { status: "monitoring" },
    });
    expect(events[0].action).toBe("status_changed");
  });

  it("emits 'assigned' when no prior assignee → a new assignee", () => {
    const events = computeUpdateActivities({
      before: { assignedUserId: null },
      after:  { assignedUserId: 42 },
    });
    expect(events[0]).toMatchObject({ action: "assigned", fromValue: null, toValue: "42" });
  });

  it("emits 'reassigned' when assignee changes from one user to another", () => {
    const events = computeUpdateActivities({
      before: { assignedUserId: 42 },
      after:  { assignedUserId: 77 },
    });
    expect(events[0]).toMatchObject({ action: "reassigned", fromValue: "42", toValue: "77" });
  });

  it("emits 'unassigned' when an assignee is removed", () => {
    const events = computeUpdateActivities({
      before: { assignedUserId: 42 },
      after:  { assignedUserId: null },
    });
    expect(events[0]).toMatchObject({ action: "unassigned", fromValue: "42", toValue: null });
  });

  it("emits severity_changed, manual_health_changed, manual_progress_changed, due_date_changed", () => {
    const events = computeUpdateActivities({
      before: {
        severity: "normal", manualHealth: "healthy", manualProgress: 20, dueDate: "2026-05-01",
      },
      after: {
        severity: "critical", manualHealth: "at_risk", manualProgress: 60, dueDate: "2026-06-01",
      },
    });
    const actions = events.map((e) => e.action).sort();
    expect(actions).toEqual([
      "due_date_changed",
      "manual_health_changed",
      "manual_progress_changed",
      "severity_changed",
    ]);
  });

  it("emits owner_changed and accountable_exec_changed for exec/owner field swaps", () => {
    const events = computeUpdateActivities({
      before: { ownerUserId: 1, accountableExecId: 2 },
      after:  { ownerUserId: 3, accountableExecId: 4 },
    });
    const actions = events.map((e) => e.action).sort();
    expect(actions).toEqual(["accountable_exec_changed", "owner_changed"]);
  });

  it("does not emit events when the after snapshot omits a field (undefined = unchanged)", () => {
    const events = computeUpdateActivities({
      before: { severity: "normal", dueDate: "2026-05-01" },
      after:  {},
    });
    expect(events).toEqual([]);
  });

  it("treats identical user-id transitions as no-ops", () => {
    const events = computeUpdateActivities({
      before: { assignedUserId: 42 },
      after:  { assignedUserId: 42 },
    });
    expect(events).toEqual([]);
  });
});
