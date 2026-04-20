import { describe, expect, it } from "vitest";
import { computeEffectivePriorityHealth } from "@shared/kpi-definitions";

const NOW = new Date("2026-04-20T12:00:00Z");

describe("computeEffectivePriorityHealth", () => {
  it("short-circuits to healthy when status is complete or closed", () => {
    const done = computeEffectivePriorityHealth({
      manualHealth: "critical",
      derivedHealth: "critical",
      severity: "critical",
      dueDate: "2024-01-01",
      status: "complete",
      blockerCount: 10,
      now: NOW,
    });
    expect(done.health).toBe("healthy");
    expect(done.reasons).toEqual([]);

    const closed = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "at_risk",
      severity: "normal",
      dueDate: "2024-01-01",
      status: "closed",
      blockerCount: 0,
      now: NOW,
    });
    expect(closed.health).toBe("healthy");
  });

  it("flags a 20-day overdue critical-severity priority as critical (the screenshot case)", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "critical",
      dueDate: "2026-03-31",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("critical");
    expect(result.reasons.join(";")).toMatch(/overdue/);
  });

  it("flags a 20-day overdue normal-severity priority as at_risk", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: "2026-03-31",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("at_risk");
  });

  it("marks anything 30+ days overdue as critical regardless of severity", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: "2026-03-01",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("critical");
  });

  it("treats 1+ blocker as at_risk and 3+ as critical", () => {
    const one = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: null,
      status: "active",
      blockerCount: 1,
      now: NOW,
    });
    expect(one.health).toBe("at_risk");

    const three = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: null,
      status: "active",
      blockerCount: 3,
      now: NOW,
    });
    expect(three.health).toBe("critical");
  });

  it("takes the worst of project RAG, manual override, overdue, and blockers", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: "at_risk",
      derivedHealth: "at_risk",
      severity: "critical",
      dueDate: "2026-03-31",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("critical");
  });

  it("stays healthy when nothing is wrong", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: "2026-12-31",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("healthy");
    expect(result.reasons).toEqual([]);
  });

  it("honours an explicit manual override even when other signals say healthy", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: "critical",
      derivedHealth: "healthy",
      severity: "normal",
      dueDate: "2026-12-31",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("critical");
    expect(result.reasons.join(";")).toMatch(/manually/);
  });

  it("does not fire the overdue rule for a date in the future", () => {
    const result = computeEffectivePriorityHealth({
      manualHealth: null,
      derivedHealth: "healthy",
      severity: "critical",
      dueDate: "2026-06-01",
      status: "active",
      blockerCount: 0,
      now: NOW,
    });
    expect(result.health).toBe("healthy");
  });
});
