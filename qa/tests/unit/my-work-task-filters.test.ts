import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { taskLevel, taskHealth, type MyWorkTaskRow } from "../../../client/src/components/priorities/MyWorkTasksList";

function makeTask(overrides: Partial<MyWorkTaskRow> = {}): MyWorkTaskRow {
  return {
    id: 1,
    title: "Task",
    description: null,
    status: "in_progress",
    priority: null,
    dueDate: null,
    startDate: null,
    projectId: null,
    projectName: null,
    ownerUserId: null,
    ownerName: null,
    workstream: "PERSONAL",
    source: "UI",
    taskCategory: null,
    bucket: null,
    percentComplete: 0,
    trackingRag: null,
    createdAt: "2026-05-01",
    updatedAt: "2026-05-01",
    ...overrides,
  };
}

describe("Phase 7C — taskLevel projection", () => {
  it("returns 'critical' when priority is critical (case-insensitive)", () => {
    expect(taskLevel(makeTask({ priority: "critical" }))).toBe("critical");
    expect(taskLevel(makeTask({ priority: "Critical" }))).toBe("critical");
    expect(taskLevel(makeTask({ priority: "CRITICAL" }))).toBe("critical");
  });

  it("returns 'important' when priority is high", () => {
    expect(taskLevel(makeTask({ priority: "high" }))).toBe("important");
    expect(taskLevel(makeTask({ priority: "High" }))).toBe("important");
  });

  it("returns 'normal' for normal / low / null / unknown priority", () => {
    expect(taskLevel(makeTask({ priority: "normal" }))).toBe("normal");
    expect(taskLevel(makeTask({ priority: "low" }))).toBe("normal");
    expect(taskLevel(makeTask({ priority: null }))).toBe("normal");
    expect(taskLevel(makeTask({ priority: "unknown" }))).toBe("normal");
  });
});

describe("Phase 7C — taskHealth projection", () => {
  // Freeze "today" so the overdue branch is deterministic.
  const FROZEN_TODAY = "2026-05-12";
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TODAY + "T12:00:00Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  describe("RAG signal wins", () => {
    it("'red' → critical regardless of status / dueDate", () => {
      expect(taskHealth(makeTask({ trackingRag: "red" }))).toBe("critical");
      expect(taskHealth(makeTask({ trackingRag: "Red", status: "in_progress", dueDate: "2027-01-01" }))).toBe("critical");
    });

    it("'amber' / 'yellow' → at_risk", () => {
      expect(taskHealth(makeTask({ trackingRag: "amber" }))).toBe("at_risk");
      expect(taskHealth(makeTask({ trackingRag: "yellow" }))).toBe("at_risk");
    });

    it("'green' on its own → healthy", () => {
      expect(taskHealth(makeTask({ trackingRag: "green" }))).toBe("healthy");
    });

    it("'green' does NOT override overdue → still at_risk (overdue trumps self-reported green)", () => {
      // Design call: an explicit `green` RAG does not suppress an overdue
      // due date. RAG flags rot if the owner forgets to update them; the
      // dueDate is canonical. If the project wants the opposite (trust the
      // PM's last RAG over date math), update the helper and this test.
      expect(taskHealth(makeTask({ trackingRag: "green", dueDate: "2025-01-01", status: "in_progress" }))).toBe("at_risk");
    });
  });

  describe("status fallback", () => {
    it("status=blocked → critical (no RAG required)", () => {
      expect(taskHealth(makeTask({ status: "blocked" }))).toBe("critical");
      expect(taskHealth(makeTask({ status: "BLOCK" }))).toBe("critical");
    });

    it("status=complete with overdue date → still healthy (done is done)", () => {
      expect(taskHealth(makeTask({ status: "complete", dueDate: "2025-01-01" }))).toBe("healthy");
      expect(taskHealth(makeTask({ status: "done", dueDate: "2025-01-01" }))).toBe("healthy");
    });
  });

  describe("overdue fallback", () => {
    it("dueDate before today + active status → at_risk", () => {
      expect(taskHealth(makeTask({ dueDate: "2026-05-11", status: "in_progress" }))).toBe("at_risk");
      expect(taskHealth(makeTask({ dueDate: "2026-01-01", status: "not_started" }))).toBe("at_risk");
    });

    it("dueDate today or future → healthy", () => {
      expect(taskHealth(makeTask({ dueDate: FROZEN_TODAY }))).toBe("healthy");
      expect(taskHealth(makeTask({ dueDate: "2027-01-01" }))).toBe("healthy");
    });

    it("no dueDate → healthy", () => {
      expect(taskHealth(makeTask({ dueDate: null }))).toBe("healthy");
    });
  });

  describe("composite", () => {
    it("status=blocked AND rag=green → critical (blocked is hard-blocking; rag is advisory)", () => {
      expect(taskHealth(makeTask({ status: "blocked", trackingRag: "green" }))).toBe("critical");
    });

    it("rag=red AND status=complete → critical (rag=red is a hard signal)", () => {
      expect(taskHealth(makeTask({ trackingRag: "red", status: "complete" }))).toBe("critical");
    });
  });
});
