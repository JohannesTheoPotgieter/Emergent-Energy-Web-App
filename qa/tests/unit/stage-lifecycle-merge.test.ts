/**
 * Stage lifecycle merge invariants — option (a) confirmed by user.
 *
 *   S03_SIGNATURE_FINANCIAL_CLOSE  + S04_PD_PM_HANDOVER  -> S03 (Financial Close)
 *   S05_FINANCIAL_REVIEW                                 -> S02 (Design & Cost Proposal)
 *
 * The DB migration (20260413_stage_lifecycle_merge.sql) handles the
 * data side; this file pins the in-code invariants so a future
 * refactor can't silently re-introduce S04 or S05 as active stages.
 */

import { describe, expect, it } from "vitest";
import {
  STAGE_CODES,
  ACTIVE_STAGE_CODES,
  DEPRECATED_STAGE_CODES,
  DEPRECATED_STAGE_REPLACEMENTS,
  resolveActiveStageCode,
} from "../../../shared/schema/stage-lifecycle";
import {
  getNextStageCode,
  STAGE_SEQUENCE,
} from "../../../shared/utils/stage-state-machine";
import {
  PHASE_TO_STAGE,
  PHASE_VALUE_TO_STAGE,
  resolveStageFromPhase,
} from "../../../shared/utils/phase-to-stage-map";

describe("Stage merge — code lists", () => {
  it("STAGE_CODES still contains all 10 historical codes for back-references", () => {
    expect(STAGE_CODES).toHaveLength(10);
    expect(STAGE_CODES).toContain("S04_PD_PM_HANDOVER");
    expect(STAGE_CODES).toContain("S05_FINANCIAL_REVIEW");
  });

  it("ACTIVE_STAGE_CODES has exactly 8 entries — S04 and S05 dropped", () => {
    expect(ACTIVE_STAGE_CODES).toHaveLength(8);
    expect(ACTIVE_STAGE_CODES).not.toContain("S04_PD_PM_HANDOVER");
    expect(ACTIVE_STAGE_CODES).not.toContain("S05_FINANCIAL_REVIEW");
  });

  it("ACTIVE_STAGE_CODES preserves the original sequence order", () => {
    expect(ACTIVE_STAGE_CODES).toEqual([
      "S01_FIRST_ASSESSMENT",
      "S02_DESIGN_COST_PROPOSAL",
      "S03_SIGNATURE_FINANCIAL_CLOSE",
      "S06_CONSTRUCTION",
      "S07_COMMISSIONING",
      "S08_OM_HANDOVER",
      "S09_CLIENT_HANDOVER",
      "S10_POST_HANDOVER_REVIEW",
    ]);
  });

  it("DEPRECATED_STAGE_CODES contains exactly S04 and S05", () => {
    expect(DEPRECATED_STAGE_CODES.size).toBe(2);
    expect(DEPRECATED_STAGE_CODES.has("S04_PD_PM_HANDOVER")).toBe(true);
    expect(DEPRECATED_STAGE_CODES.has("S05_FINANCIAL_REVIEW")).toBe(true);
  });

  it("DEPRECATED_STAGE_REPLACEMENTS maps S04->S03 and S05->S02", () => {
    expect(DEPRECATED_STAGE_REPLACEMENTS.S04_PD_PM_HANDOVER).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
    expect(DEPRECATED_STAGE_REPLACEMENTS.S05_FINANCIAL_REVIEW).toBe(
      "S02_DESIGN_COST_PROPOSAL",
    );
  });
});

describe("Stage merge — resolveActiveStageCode", () => {
  it("translates S04 to S03", () => {
    expect(resolveActiveStageCode("S04_PD_PM_HANDOVER")).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
  });

  it("translates S05 to S02", () => {
    expect(resolveActiveStageCode("S05_FINANCIAL_REVIEW")).toBe(
      "S02_DESIGN_COST_PROPOSAL",
    );
  });

  it("returns active codes unchanged", () => {
    expect(resolveActiveStageCode("S01_FIRST_ASSESSMENT")).toBe("S01_FIRST_ASSESSMENT");
    expect(resolveActiveStageCode("S03_SIGNATURE_FINANCIAL_CLOSE")).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
    expect(resolveActiveStageCode("S10_POST_HANDOVER_REVIEW")).toBe(
      "S10_POST_HANDOVER_REVIEW",
    );
  });
});

describe("Stage merge — getNextStageCode skips deprecated stages", () => {
  it("S03 -> S06 (not S04)", () => {
    expect(getNextStageCode("S03_SIGNATURE_FINANCIAL_CLOSE")).toBe("S06_CONSTRUCTION");
  });

  it("S02 -> S03 (not S05)", () => {
    expect(getNextStageCode("S02_DESIGN_COST_PROPOSAL")).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
  });

  it("S04 (legacy) -> S06 — translates through S03 first", () => {
    expect(getNextStageCode("S04_PD_PM_HANDOVER")).toBe("S06_CONSTRUCTION");
  });

  it("S05 (legacy) -> S03 — translates through S02 first", () => {
    expect(getNextStageCode("S05_FINANCIAL_REVIEW")).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
  });

  it("S10 returns null (final stage)", () => {
    expect(getNextStageCode("S10_POST_HANDOVER_REVIEW")).toBeNull();
  });

  it("walking the active sequence end-to-end produces 8 stages", () => {
    const visited: string[] = [];
    let current: string | null = "S01_FIRST_ASSESSMENT";
    while (current) {
      visited.push(current);
      current = getNextStageCode(current as any);
      // safety: prevent infinite loop on regression
      if (visited.length > 20) throw new Error("walk did not terminate");
    }
    expect(visited).toHaveLength(8);
    expect(visited).not.toContain("S04_PD_PM_HANDOVER");
    expect(visited).not.toContain("S05_FINANCIAL_REVIEW");
  });
});

describe("Stage merge — phase-to-stage map", () => {
  it("'Planning' now maps to S02 (not S05)", () => {
    expect(PHASE_TO_STAGE["Planning"]).toBe("S02_DESIGN_COST_PROPOSAL");
    expect(PHASE_VALUE_TO_STAGE["Planning"]).toBe("S02_DESIGN_COST_PROPOSAL");
  });

  it("'PD-PM Handover' now maps to S03 (not S04)", () => {
    expect(PHASE_VALUE_TO_STAGE["PD-PM Handover"]).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
  });

  it("'Financial Review' now maps to S02 (not S05)", () => {
    expect(PHASE_VALUE_TO_STAGE["Financial Review"]).toBe(
      "S02_DESIGN_COST_PROPOSAL",
    );
  });

  it("legacy P-codes resolve through the merge", () => {
    expect(PHASE_VALUE_TO_STAGE["P2_PD_PM_HANDOVER"]).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
    expect(PHASE_VALUE_TO_STAGE["P3_DETAILED_DESIGN_PROC_RELEASE"]).toBe(
      "S02_DESIGN_COST_PROPOSAL",
    );
  });

  it("direct stage code lookups for S04/S05 resolve to the merged target", () => {
    expect(PHASE_VALUE_TO_STAGE["S04_PD_PM_HANDOVER"]).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
    expect(PHASE_VALUE_TO_STAGE["S05_FINANCIAL_REVIEW"]).toBe(
      "S02_DESIGN_COST_PROPOSAL",
    );
  });

  it("resolveStageFromPhase is case-insensitive and respects the merge", () => {
    expect(resolveStageFromPhase("planning")).toBe("S02_DESIGN_COST_PROPOSAL");
    expect(resolveStageFromPhase("PD-PM HANDOVER")).toBe(
      "S03_SIGNATURE_FINANCIAL_CLOSE",
    );
  });
});

describe("Stage merge — STAGE_SEQUENCE legacy mapping", () => {
  it("legacy S04 sequence equals S03 sequence (so ordering still works)", () => {
    expect(STAGE_SEQUENCE.S04_PD_PM_HANDOVER).toBe(
      STAGE_SEQUENCE.S03_SIGNATURE_FINANCIAL_CLOSE,
    );
  });

  it("legacy S05 sequence equals S02 sequence", () => {
    expect(STAGE_SEQUENCE.S05_FINANCIAL_REVIEW).toBe(
      STAGE_SEQUENCE.S02_DESIGN_COST_PROPOSAL,
    );
  });

  it("active sequence runs 1..8 with no gaps", () => {
    const activeSeqs = ACTIVE_STAGE_CODES.map((c) => STAGE_SEQUENCE[c]);
    expect(activeSeqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
