import { describe, expect, it } from "vitest";
import { computeEffectivePriorityHealth } from "@shared/kpi-definitions";

const NOW = new Date("2026-04-20T12:00:00Z");

const base = {
  manualHealth: null,
  derivedHealth: null,
  severity: "normal",
  dueDate: null as string | null,
  status: "active",
  blockerCount: 0,
  now: NOW,
};

describe("computeEffectivePriorityHealth — cross-department signals (Tier 4 · PR 3)", () => {
  // Engineering
  it("1 blocked engineering gate → at_risk", () => {
    const r = computeEffectivePriorityHealth({ ...base, engBlockerCount: 1 });
    expect(r.health).toBe("at_risk");
    expect(r.reasons.join(";")).toMatch(/engineering gate/i);
  });

  it("3 blocked engineering gates → critical", () => {
    const r = computeEffectivePriorityHealth({ ...base, engBlockerCount: 3 });
    expect(r.health).toBe("critical");
  });

  // Quality
  it("4 open QC defects stays healthy (threshold is 5)", () => {
    const r = computeEffectivePriorityHealth({ ...base, qualityDefectCount: 4 });
    expect(r.health).toBe("healthy");
  });

  it("5 open QC defects → at_risk", () => {
    const r = computeEffectivePriorityHealth({ ...base, qualityDefectCount: 5 });
    expect(r.health).toBe("at_risk");
    expect(r.reasons.join(";")).toMatch(/QC defects/);
  });

  it("15 open QC defects → critical", () => {
    const r = computeEffectivePriorityHealth({ ...base, qualityDefectCount: 15 });
    expect(r.health).toBe("critical");
  });

  // HSE
  it("1 open high-severity HSE incident → at_risk", () => {
    const r = computeEffectivePriorityHealth({ ...base, hseIncidentCount: 1, hseCriticalCount: 0 });
    expect(r.health).toBe("at_risk");
    expect(r.reasons.join(";")).toMatch(/HSE/);
  });

  it("1 HSE incident with severity=critical → critical regardless of everything else", () => {
    const r = computeEffectivePriorityHealth({
      ...base,
      hseIncidentCount: 1,
      hseCriticalCount: 1,
    });
    expect(r.health).toBe("critical");
    expect(r.reasons.join(";")).toMatch(/critical HSE incident/);
  });

  it("HSE critical still applies even when status is active and everything else is green", () => {
    const r = computeEffectivePriorityHealth({
      ...base,
      manualHealth: "healthy",
      derivedHealth: "healthy",
      hseCriticalCount: 1,
    });
    expect(r.health).toBe("critical");
  });

  // Status short-circuit still wins
  it("status=closed still short-circuits to healthy even with HSE critical", () => {
    const r = computeEffectivePriorityHealth({
      ...base,
      status: "closed",
      hseCriticalCount: 5,
      engBlockerCount: 10,
      qualityDefectCount: 100,
    });
    expect(r.health).toBe("healthy");
  });

  // Combined worst-of
  it("combines multiple dept signals — 1 HSE critical beats 1 QC defect beats nothing", () => {
    const r = computeEffectivePriorityHealth({
      ...base,
      hseCriticalCount: 1,
      qualityDefectCount: 6,
      engBlockerCount: 1,
    });
    expect(r.health).toBe("critical");
    // All three reasons should be present
    const joined = r.reasons.join(";");
    expect(joined).toMatch(/engineering/);
    expect(joined).toMatch(/QC/);
    expect(joined).toMatch(/HSE/);
  });

  it("no dept signals + no other signals → healthy (regression guard)", () => {
    const r = computeEffectivePriorityHealth({ ...base });
    expect(r.health).toBe("healthy");
    expect(r.reasons).toEqual([]);
  });

  it("undefined dept counts are treated as zero (backward compat with old data)", () => {
    const r = computeEffectivePriorityHealth({
      ...base,
      // engBlockerCount, qualityDefectCount, hseIncidentCount intentionally omitted
    });
    expect(r.health).toBe("healthy");
  });
});
