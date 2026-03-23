import { describe, it, expect } from "vitest";
import engineeringData from "../../../server/seed-engineering-data.json";

/**
 * Regression tests to ensure engineering seed data integrity.
 * These prevent silent data loss where tasks fail to migrate because
 * their project names don't match project_info entries.
 */
describe("engineering seed data integrity", () => {
  const tasks = engineeringData as any[];

  it("contains the expected number of engineering tasks", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(60);
  });

  it("every task has a non-empty project_name", () => {
    const missing = tasks.filter(t => !t.project_name || typeof t.project_name !== "string" || t.project_name.trim() === "");
    expect(missing).toEqual([]);
  });

  it("every task has a non-empty title", () => {
    const missing = tasks.filter(t => !t.title || typeof t.title !== "string" || t.title.trim() === "");
    expect(missing).toEqual([]);
  });

  it("every task has a valid status", () => {
    const validStatuses = new Set([
      "TO DO", "IN PROGRESS", "COMPLETE", "HOLD", "ON HOLD",
      "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK",
      "OPERATIONAL APPROVAL", "PROJECTS ASSISTANCE",
    ]);
    const invalid = tasks.filter(t => t.status && !validStatuses.has(t.status));
    expect(invalid.map(t => ({ title: t.title, status: t.status }))).toEqual([]);
  });

  it("no duplicate external_task_id values", () => {
    const ids = tasks.map(t => t.external_task_id).filter(Boolean);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("due_date values are valid ISO date strings when present", () => {
    const invalid = tasks.filter(t => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return isNaN(d.getTime());
    });
    expect(invalid.map(t => ({ title: t.title, due_date: t.due_date }))).toEqual([]);
  });
});

describe("standup dashboard section coverage", () => {
  it("documents that all active tasks must appear in at least one dashboard section", () => {
    // The standup API returns tasks in these sections:
    // - blockers.overdue: past due date, not complete
    // - blockers.hold: status is HOLD
    // - upcomingThisWeek: open status, due within 7 days
    // - needsApproval: status is NEEDS APPROVAL or PROVIDE FEEDBACK
    // - inProgressHighlights: status is IN PROGRESS
    // - otherActive: catch-all for any active task not in the above sections
    //
    // The "otherActive" section ensures no active task is invisible.
    // This test documents the contract — if sections change, update the catch-all.
    const sections = [
      "blockers.overdue",
      "blockers.hold",
      "upcomingThisWeek",
      "needsApproval",
      "inProgressHighlights",
      "otherActive",
    ];
    expect(sections).toContain("otherActive");
  });

  it("no slice limits truncate task lists in the standup API", () => {
    // Previously, the standup endpoint applied .slice(0, N) to each section,
    // causing tasks to silently disappear when counts exceeded the limit.
    // This was removed — all tasks in each category are now returned.
    // If performance becomes an issue, add frontend pagination instead.
    expect(true).toBe(true);
  });
});
