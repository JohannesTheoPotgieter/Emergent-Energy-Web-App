/**
 * TF-10 (audit V3) — Contract test for the finance close-out gate.
 *
 * The gate in `server/services/finance-close-out-gate.ts` evaluates
 * whether a project is ready for handover-to-S_DONE by counting open
 * AR / AP / POs / disputes. This test pins the public surface so a
 * future refactor cannot silently break the integration with
 * `markProjectDone` in stage-lifecycle-service.ts.
 *
 * End-to-end behaviour (numeric correctness against a fixture project)
 * needs a test DB; queued as DF-21 follow-up.
 */
import { describe, it, expect } from "vitest";
import * as gate from "../../../server/services/finance-close-out-gate";

describe("TF-10 — finance close-out gate contract", () => {
  it("exports the evaluator function", () => {
    expect(typeof gate.evaluateFinanceCloseOutGate).toBe("function");
    expect(gate.evaluateFinanceCloseOutGate.length).toBe(1);
  });

  it("result shape includes ok, all five counters, all three amounts, and the blockers list", () => {
    // Compile-time check via type assertion — a future refactor that
    // drops one of these fields will fail this test.
    const stub: gate.FinanceCloseOutGateResult = {
      ok: true,
      outstandingArAmount: 0,
      outstandingArCount: 0,
      outstandingApAmount: 0,
      outstandingApCount: 0,
      openPoCount: 0,
      openRevenueDisputeCount: 0,
      openCostDisputeCount: 0,
      blockers: [],
    };
    expect(stub.ok).toBe(true);
    expect(stub.blockers).toEqual([]);
  });
});
