/**
 * C3 — Pure transition-detection rules + task reminder classifier.
 *
 * The DB side of the alert engine (dispatcher worker, monitor write
 * paths, task reminder dedup) is covered by the release gate against
 * a live test DB. This file pins the pure rules so a future refactor
 * can't silently turn a single transition into a paging storm.
 *
 * Confirmed behaviour:
 *   - Integration alerts only fire on transitions, never sustained
 *     state. unknown <-> anything is suppressed.
 *   - Dashboard alerts only fire on transitions to `stale` (the 4h
 *     cutoff) — not on `warn`, since the freshness panel already
 *     surfaces those.
 *   - Task reminders use whole-day boundaries and pick the highest
 *     priority milestone (overdue > due_today > due_in_24h).
 */

import { describe, expect, it } from "vitest";
import {
  shouldAlertIntegrationTransition,
  shouldAlertDashboardTransition,
} from "../../../server/services/alert-transition-rules";
import {
  classifyDueDate,
  isClosedTaskStatus,
} from "../../../server/services/task-reminder-dispatcher";
import { TASK_REMINDER_KINDS } from "../../../shared/schema/task-reminders";

describe("C3 — shouldAlertIntegrationTransition", () => {
  it("does not fire when the state is unchanged", () => {
    expect(
      shouldAlertIntegrationTransition({ prev: "healthy", next: "healthy" }),
    ).toBeNull();
    expect(
      shouldAlertIntegrationTransition({ prev: "failing", next: "failing" }),
    ).toBeNull();
  });

  it("does not fire on any unknown <-> anything transition (boot noise)", () => {
    expect(
      shouldAlertIntegrationTransition({ prev: null, next: "healthy" }),
    ).toBeNull();
    expect(
      shouldAlertIntegrationTransition({ prev: "unknown", next: "failing" }),
    ).toBeNull();
    expect(
      shouldAlertIntegrationTransition({ prev: "healthy", next: "unknown" }),
    ).toBeNull();
  });

  it("fires 'now_failing' on any transition into failing", () => {
    expect(
      shouldAlertIntegrationTransition({ prev: "healthy", next: "failing" }),
    ).toBe("now_failing");
    expect(
      shouldAlertIntegrationTransition({ prev: "stale", next: "failing" }),
    ).toBe("now_failing");
  });

  it("fires 'now_stale_from_healthy' only on healthy -> stale", () => {
    expect(
      shouldAlertIntegrationTransition({ prev: "healthy", next: "stale" }),
    ).toBe("now_stale_from_healthy");
    // failing -> stale should NOT fire (we already paged on failing)
    expect(
      shouldAlertIntegrationTransition({ prev: "failing", next: "stale" }),
    ).toBeNull();
  });

  it("fires 'recovered_to_healthy' on failing -> healthy and stale -> healthy", () => {
    expect(
      shouldAlertIntegrationTransition({ prev: "failing", next: "healthy" }),
    ).toBe("recovered_to_healthy");
    expect(
      shouldAlertIntegrationTransition({ prev: "stale", next: "healthy" }),
    ).toBe("recovered_to_healthy");
  });
});

describe("C3 — shouldAlertDashboardTransition", () => {
  it("does not fire on equal states", () => {
    expect(
      shouldAlertDashboardTransition({ prev: "fresh", next: "fresh" }),
    ).toBeNull();
    expect(
      shouldAlertDashboardTransition({ prev: "stale", next: "stale" }),
    ).toBeNull();
  });

  it("does not fire on unknown <-> anything", () => {
    expect(
      shouldAlertDashboardTransition({ prev: null, next: "fresh" }),
    ).toBeNull();
    expect(
      shouldAlertDashboardTransition({ prev: "fresh", next: "unknown" }),
    ).toBeNull();
  });

  it("fires 'now_stale' only on transitions INTO stale", () => {
    expect(
      shouldAlertDashboardTransition({ prev: "fresh", next: "stale" }),
    ).toBe("now_stale");
    expect(
      shouldAlertDashboardTransition({ prev: "warn", next: "stale" }),
    ).toBe("now_stale");
  });

  it("does NOT fire on transitions to warn (panel already shows them)", () => {
    expect(
      shouldAlertDashboardTransition({ prev: "fresh", next: "warn" }),
    ).toBeNull();
    expect(
      shouldAlertDashboardTransition({ prev: "stale", next: "warn" }),
    ).toBeNull();
  });

  it("fires 'recovered_to_fresh' on stale -> fresh", () => {
    expect(
      shouldAlertDashboardTransition({ prev: "stale", next: "fresh" }),
    ).toBe("recovered_to_fresh");
  });

  it("does NOT fire on warn -> fresh (no preceding alert to recover from)", () => {
    expect(
      shouldAlertDashboardTransition({ prev: "warn", next: "fresh" }),
    ).toBeNull();
  });
});

describe("C3 — classifyDueDate", () => {
  // Anchor "now" so the test is deterministic.
  const NOW = new Date("2026-04-13T10:30:00Z");

  it("returns null when there is no end date", () => {
    expect(classifyDueDate({ endDate: null, now: NOW })).toBeNull();
  });

  it("returns 'overdue' for an end date strictly before today", () => {
    expect(
      classifyDueDate({ endDate: new Date("2026-04-12"), now: NOW }),
    ).toBe("overdue");
    expect(
      classifyDueDate({ endDate: new Date("2025-12-31"), now: NOW }),
    ).toBe("overdue");
  });

  it("returns 'due_today' when end date is today", () => {
    expect(
      classifyDueDate({ endDate: new Date("2026-04-13"), now: NOW }),
    ).toBe("due_today");
  });

  it("returns 'due_in_24h' when end date is tomorrow", () => {
    expect(
      classifyDueDate({ endDate: new Date("2026-04-14"), now: NOW }),
    ).toBe("due_in_24h");
  });

  it("returns null when end date is more than 1 day out", () => {
    expect(
      classifyDueDate({ endDate: new Date("2026-04-15"), now: NOW }),
    ).toBeNull();
    expect(
      classifyDueDate({ endDate: new Date("2026-05-01"), now: NOW }),
    ).toBeNull();
  });
});

describe("C3 — isClosedTaskStatus", () => {
  it("treats common closed/done variants as closed", () => {
    expect(isClosedTaskStatus("Complete")).toBe(true);
    expect(isClosedTaskStatus("completed")).toBe(true);
    expect(isClosedTaskStatus("DONE")).toBe(true);
    expect(isClosedTaskStatus("Closed")).toBe(true);
    expect(isClosedTaskStatus("Cancelled")).toBe(true);
  });

  it("treats open variants as not closed", () => {
    expect(isClosedTaskStatus("Not Started")).toBe(false);
    expect(isClosedTaskStatus("In Progress")).toBe(false);
    expect(isClosedTaskStatus("Blocked")).toBe(false);
    expect(isClosedTaskStatus(null)).toBe(false);
    expect(isClosedTaskStatus("")).toBe(false);
  });
});

describe("C3 — TASK_REMINDER_KINDS shape", () => {
  it("is exactly the 3 milestones we ship", () => {
    expect([...TASK_REMINDER_KINDS].sort()).toEqual(
      ["due_in_24h", "due_today", "overdue"].sort(),
    );
  });
});
