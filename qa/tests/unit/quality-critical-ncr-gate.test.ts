/**
 * Task 3.5 — open critical NCRs block handover (opt-in, default off).
 *
 * Behavioural tests over the extended pure `evaluateChecklistHandoverReadiness`.
 * The gate must be a no-op unless explicitly enabled, so existing callers are
 * unaffected; when enabled, open critical NCRs become a handover blocker.
 */
import { describe, expect, it } from "vitest";
import { evaluateChecklistHandoverReadiness } from "../../../shared/quality-governance";

// A fully-complete, ready checklist (no other blockers) so the only variable
// is the critical-NCR gate.
const readyItems = [
  { qmStatus: "pass", approved: true, isApplicable: true, isEvidenceRequired: false, evidenceCount: 0 },
];

describe("critical-NCR handover gate", () => {
  it("does NOT block when the gate is disabled (default)", () => {
    const r = evaluateChecklistHandoverReadiness({
      items: readyItems,
      openCriticalNcrCount: 3,
      // criticalNcrGateEnabled omitted → off
    });
    expect(r.ready).toBe(true);
    expect(r.openCriticalNcrCount).toBe(0);
    expect(r.blockers.join(" ")).not.toMatch(/critical NCR/i);
  });

  it("does NOT block when the gate is enabled but there are no critical NCRs", () => {
    const r = evaluateChecklistHandoverReadiness({
      items: readyItems,
      openCriticalNcrCount: 0,
      criticalNcrGateEnabled: true,
    });
    expect(r.ready).toBe(true);
    expect(r.openCriticalNcrCount).toBe(0);
  });

  it("blocks handover when the gate is enabled and open critical NCRs exist", () => {
    const r = evaluateChecklistHandoverReadiness({
      items: readyItems,
      openCriticalNcrCount: 2,
      criticalNcrGateEnabled: true,
    });
    expect(r.ready).toBe(false);
    expect(r.openCriticalNcrCount).toBe(2);
    expect(r.blockers).toContain("2 open critical NCR(s)");
  });

  it("clamps a negative count to zero and does not block", () => {
    const r = evaluateChecklistHandoverReadiness({
      items: readyItems,
      openCriticalNcrCount: -5,
      criticalNcrGateEnabled: true,
    });
    expect(r.ready).toBe(true);
    expect(r.openCriticalNcrCount).toBe(0);
  });
});
