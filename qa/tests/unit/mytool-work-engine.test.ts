import { describe, expect, it } from "vitest";
import {
  computeMilestoneProgress,
  computeNextRecurrenceDate,
  isOverdue,
  shouldBlockTask,
  validateDependencyPair,
} from "../../../server/lib/mytool-work-engine";

describe("mytool work engine", () => {
  it("creates dependency links with valid predecessor/successor", () => {
    expect(validateDependencyPair(10, 11)).toBeNull();
  });

  it("blocks tasks when predecessors are incomplete", () => {
    expect(shouldBlockTask(["done", "in_progress"])).toBe(true);
    expect(shouldBlockTask(["done", "cancelled"])).toBe(false);
  });

  it("rolls up milestone progress from linked tasks", () => {
    expect(computeMilestoneProgress(["done", "done", "in_progress", "planned"])) .toBe(50);
  });

  it("generates recurring next dates deterministically", () => {
    expect(computeNextRecurrenceDate("2026-03-16", "daily", 1, null)).toBe("2026-03-17");
    expect(computeNextRecurrenceDate("2026-03-16", "weekly", 1, "1,3,5")).toBe("2026-03-18");
    expect(computeNextRecurrenceDate("2026-03-16", "monthly", 1, null)).toBe("2026-04-16");
  });

  it("flags overdue open tasks and ignores completed tasks", () => {
    expect(isOverdue("2026-03-10T00:00:00.000Z", "in_progress", new Date("2026-03-16T00:00:00.000Z"))).toBe(true);
    expect(isOverdue("2026-03-10T00:00:00.000Z", "done", new Date("2026-03-16T00:00:00.000Z"))).toBe(false);
  });

  it("prevents impossible dependency states", () => {
    expect(validateDependencyPair(44, 44)).toBe("A task cannot depend on itself");
  });
});
