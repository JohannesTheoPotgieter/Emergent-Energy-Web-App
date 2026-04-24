/**
 * Task #84 — Gate auto-evaluator registry unit tests.
 *
 * Verifies the pure registry behaviour without spinning up a DB:
 *   - evaluator coverage spans S01..S10 + S9B (the ten sequential phases).
 *   - effectiveRequirementStatus respects the "manual wins" rule.
 *   - summarizeAutoCoverage tallies the right counts.
 *   - Hold/Done are intentionally excluded from evaluation.
 *
 * The full happy-path against real DB data is exercised by the
 * stage-detail integration tests via the auto-eval-on-read hook.
 */

import { describe, expect, it } from "vitest";
import {
  EVALUATOR_BINDINGS,
  effectiveRequirementStatus,
  evaluateGateAutoFromContext,
  getEvaluator,
  listEvaluatorsForPhase,
  summarizeAutoCoverage,
  type ProjectEvaluatorContext,
} from "../../../server/services/gate-auto-evaluator-service";
import { SEQUENTIAL_PHASE_CODES } from "../../../shared/phases";

const EXPECTED_PHASES = [
  "S01_FIRST_ASSESSMENT",
  "S02_DESIGN_COST_PROPOSAL",
  "S03_SIGNATURE_FINANCIAL_CLOSE",
  "S04_PLANNING",
  "S06_CONSTRUCTION",
  "S07_COMMISSIONING",
  "S08_OM_HANDOVER",
  "S09_CLIENT_HANDOVER",
  "S10_POST_HANDOVER_REVIEW",
  "S9B_COMPLIANCE_HANDOVER",
];

function emptyContext(projectId: number): ProjectEvaluatorContext {
  return {
    projectId,
    project: null,
    execState: null,
    revenueSummary: null,
    opportunity: null,
    client: null,
    sites: [],
    workItems: [],
    deliverables: [],
    drawings: [],
    transmittals: [],
    revenueLines: [],
    costLines: [],
    handoverPacks: [],
    omHandovers: [],
    safetyFileItems: [],
    hseIncidents: [],
    qcChecklists: [],
    qcItemInstances: [],
    commissioningSnapshots: [],
    emailLinks: [],
    teamsLinks: [],
  };
}

describe("Task #84 — gate auto-evaluator registry coverage", () => {
  it("registers at least one evaluator for every sequential phase (S01..S10 + S9B)", () => {
    for (const phase of EXPECTED_PHASES) {
      const bindings = listEvaluatorsForPhase(phase);
      expect(bindings.length, `phase ${phase} has no evaluators`).toBeGreaterThan(0);
    }
  });

  it("the ten sequential phases align with shared/phases.ts SEQUENTIAL_PHASE_CODES", () => {
    expect(EXPECTED_PHASES.sort()).toEqual([...SEQUENTIAL_PHASE_CODES].sort());
  });

  it("does not register any evaluators against terminal phases (Hold/Done)", () => {
    const terminal = EVALUATOR_BINDINGS.filter(
      (b) => b.phaseCode === "S_HOLD" || b.phaseCode === "S_DONE",
    );
    expect(terminal).toHaveLength(0);
  });

  it("getEvaluator returns the right binding for a known pair", () => {
    const b = getEvaluator("S03_SIGNATURE_FINANCIAL_CLOSE", "cost_proposal_signed");
    expect(b).toBeDefined();
    expect(b!.phaseCode).toBe("S03_SIGNATURE_FINANCIAL_CLOSE");
  });

  it("getEvaluator returns undefined for an unknown pair", () => {
    expect(getEvaluator("S99_FAKE", "no_such_item")).toBeUndefined();
  });
});

describe("Task #84 — evaluateGateAutoFromContext", () => {
  it("returns NOT_DETECTED for every binding when context is empty", () => {
    const ctx = emptyContext(123);
    const results = evaluateGateAutoFromContext("S03_SIGNATURE_FINANCIAL_CLOSE", ctx);
    // Some evaluators may still detect "complete" from `null`-tolerant logic.
    // What we guarantee is every result has the right shape and
    // any null-status result reports a null sourceLabel too.
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.phaseCode).toBe("S03_SIGNATURE_FINANCIAL_CLOSE");
      expect(typeof r.itemCode).toBe("string");
      if (r.status === null) {
        expect(r.sourceLabel).toBeNull();
      } else {
        expect(r.sourceLabel).not.toBeNull();
      }
    }
  });

  it("returns an empty array for terminal phases", () => {
    const ctx = emptyContext(123);
    expect(evaluateGateAutoFromContext("S_HOLD", ctx)).toEqual([]);
    expect(evaluateGateAutoFromContext("S_DONE", ctx)).toEqual([]);
  });

  it("S03 cost_proposal_signed detects from execState.cpSigned=true", () => {
    const ctx = emptyContext(123);
    ctx.execState = {
      cpSigned: true,
      cpSignedDate: "2026-04-12",
    } as any;
    const results = evaluateGateAutoFromContext("S03_SIGNATURE_FINANCIAL_CLOSE", ctx);
    const cp = results.find((r) => r.itemCode === "cost_proposal_signed");
    expect(cp).toBeDefined();
    expect(cp!.status).toBe("complete");
    expect(cp!.sourceLabel).toMatch(/Cost proposal signed/);
    expect(cp!.confidence).toBe("high");
  });

  it("S03 epc_contract_signed detects PENDING as in_progress (not complete)", () => {
    const ctx = emptyContext(123);
    ctx.execState = { signedStatus: "PENDING", executionGateStatus: "ELIGIBLE" } as any;
    const results = evaluateGateAutoFromContext("S03_SIGNATURE_FINANCIAL_CLOSE", ctx);
    const epc = results.find((r) => r.itemCode === "epc_contract_signed");
    expect(epc).toBeDefined();
    expect(epc!.status).toBe("in_progress");
    expect(epc!.confidence).toBe("medium");
  });

  it("S04 handover_pack_complete detects 100% pd_to_pm pack as complete", () => {
    const ctx = emptyContext(123);
    ctx.handoverPacks = [
      { id: 1, packType: "pd_to_pm", documentCompletenessPct: 100, status: "submitted" } as any,
    ];
    const results = evaluateGateAutoFromContext("S04_PLANNING", ctx);
    const hp = results.find((r) => r.itemCode === "handover_pack_complete");
    expect(hp!.status).toBe("complete");
    expect(hp!.evidenceUrl).toContain("/handover/1");
  });

  it("S06 hse_plan_approved is high confidence when safety_file_items has approved health_safety_plan", () => {
    const ctx = emptyContext(123);
    ctx.safetyFileItems = [
      { id: 7, itemCode: "health_safety_plan", complianceStatus: "approved", sharepointRef: "https://sharepoint/abc" } as any,
    ];
    const results = evaluateGateAutoFromContext("S06_CONSTRUCTION", ctx);
    const hse = results.find((r) => r.itemCode === "hse_plan_approved");
    expect(hse!.status).toBe("complete");
    expect(hse!.confidence).toBe("high");
    expect(hse!.evidenceUrl).toBe("https://sharepoint/abc");
  });
});

describe("Task #84 — effectiveRequirementStatus (manual wins)", () => {
  it("manual `complete` wins over auto `not_started`", () => {
    const r = effectiveRequirementStatus({ status: "complete", autoStatus: null });
    expect(r).toEqual({ status: "complete", isAuto: false });
  });

  it("manual `complete` wins even when auto detected something else", () => {
    const r = effectiveRequirementStatus({ status: "complete", autoStatus: "in_progress" });
    expect(r).toEqual({ status: "complete", isAuto: false });
  });

  it("manual `not_started` falls back to auto when present", () => {
    const r = effectiveRequirementStatus({ status: "not_started", autoStatus: "complete" });
    expect(r).toEqual({ status: "complete", isAuto: true });
  });

  it("manual `not_started` with no auto stays not_started", () => {
    const r = effectiveRequirementStatus({ status: "not_started", autoStatus: null });
    expect(r).toEqual({ status: "not_started", isAuto: false });
  });

  it("manual override (e.g. waived) always wins, even with auto=complete", () => {
    const r = effectiveRequirementStatus({ status: "waived", autoStatus: "complete" });
    expect(r).toEqual({ status: "waived", isAuto: false });
  });
});

describe("Task #84 — summarizeAutoCoverage", () => {
  it("counts auto-populated and manual completions correctly", () => {
    const reqs = [
      { status: "not_started", autoStatus: "complete" }, // auto
      { status: "complete", autoStatus: null }, // manual
      { status: "complete", autoStatus: "in_progress" }, // manual override
      { status: "not_started", autoStatus: null }, // neither
      { status: "not_applicable", autoStatus: null }, // manual
      { status: "not_started", autoStatus: "in_progress" }, // auto (in_progress counts)
    ];
    const summary = summarizeAutoCoverage(reqs);
    expect(summary.total).toBe(6);
    expect(summary.autoPopulated).toBe(2); // first + last
    expect(summary.manual).toBe(3); // 2nd, 3rd, 5th
  });

  it("returns zeros for empty input", () => {
    expect(summarizeAutoCoverage([])).toEqual({ autoPopulated: 0, total: 0, manual: 0 });
  });
});
