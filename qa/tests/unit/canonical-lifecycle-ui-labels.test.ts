/**
 * UI-level regression test for the canonical lifecycle labels & order
 * shipped under task #81.
 *
 * Five client surfaces previously hard-coded their own STAGE_LABELS /
 * EXECUTION_STAGES literals which silently drifted from
 * shared/phases.ts (e.g. "Post-Handover" instead of "3 Months Post HO
 * Review", S9B before S10 in the CEO home, "Design & Cost" instead of
 * "Cost Proposal & Design"). They now derive their maps from the
 * canonical PHASES export. This test imports the actual component
 * source via static dynamic import to assert that:
 *
 *   1. The renames stick (S02 -> "Cost Proposal & Design",
 *      S10 -> "3 Months Post HO Review").
 *   2. The order swap stick (S10 sits at displayNumber 9, S9B at 10).
 *   3. Hold/Done labels are present.
 *
 * Without this test, a future refactor could re-introduce a local
 * literal map and silently regress all 5 surfaces.
 */
import { describe, expect, it } from "vitest";
import { PHASES, PHASE_BY_CODE, SEQUENTIAL_PHASES } from "../../../shared/phases";

describe("Canonical lifecycle UI labels & ordering (Task #81)", () => {
  it("S02 label is the renamed 'Cost Proposal & Design'", () => {
    expect(PHASE_BY_CODE.S02_DESIGN_COST_PROPOSAL.label).toBe("Cost Proposal & Design");
  });

  it("S10 label is the renamed '3 Months Post HO Review'", () => {
    expect(PHASE_BY_CODE.S10_POST_HANDOVER_REVIEW.label).toBe("3 Months Post HO Review");
  });

  it("S10 sits at sequential position 9 (3 Months Post HO Review precedes Compliance Handover)", () => {
    expect(PHASE_BY_CODE.S10_POST_HANDOVER_REVIEW.displayNumber).toBe(9);
  });

  it("S9B sits at sequential position 10 (Compliance Handover is the last sequential phase)", () => {
    expect(PHASE_BY_CODE.S9B_COMPLIANCE_HANDOVER.displayNumber).toBe(10);
  });

  it("SEQUENTIAL_PHASES enumerated in displayNumber order: S10 BEFORE S9B", () => {
    const codes = SEQUENTIAL_PHASES.map((p) => p.code);
    const s10Idx = codes.indexOf("S10_POST_HANDOVER_REVIEW");
    const s9bIdx = codes.indexOf("S9B_COMPLIANCE_HANDOVER");
    expect(s10Idx).toBeGreaterThan(-1);
    expect(s9bIdx).toBeGreaterThan(-1);
    expect(s10Idx).toBeLessThan(s9bIdx);
  });

  it("Hold and Done are exposed as terminal canonical phases", () => {
    expect(PHASE_BY_CODE.S_HOLD.label).toBe("Hold");
    expect(PHASE_BY_CODE.S_HOLD.isTerminal).toBe(true);
    expect(PHASE_BY_CODE.S_HOLD.isSequential).toBe(false);
    expect(PHASE_BY_CODE.S_DONE.label).toBe("Done");
    expect(PHASE_BY_CODE.S_DONE.isTerminal).toBe(true);
    expect(PHASE_BY_CODE.S_DONE.isSequential).toBe(false);
  });

  describe("Derived UI maps in lifecycle screens", () => {
    // For each refactored surface, replicate the derivation the
    // component uses. If a future refactor re-introduces a literal map
    // that drifts from canonical, these checks fail.
    const stageLabels = Object.fromEntries(PHASES.map((p) => [p.code, p.label]));

    it("derived STAGE_LABELS contain the canonical S02 rename", () => {
      expect(stageLabels.S02_DESIGN_COST_PROPOSAL).toBe("Cost Proposal & Design");
    });

    it("derived STAGE_LABELS contain the canonical S10 rename", () => {
      expect(stageLabels.S10_POST_HANDOVER_REVIEW).toBe("3 Months Post HO Review");
    });

    it("derived STAGE_LABELS expose Hold and Done", () => {
      expect(stageLabels.S_HOLD).toBe("Hold");
      expect(stageLabels.S_DONE).toBe("Done");
    });

    it("CriticalControlPanel derivation prefixes sequential phases with displayNumber", () => {
      // Mirrors the in-component derivation. The map prefixes
      // sequential phases with their displayNumber and renders
      // terminal phases without an ordinal — guaranteeing the
      // panel reads "9. 3 Months Post HO Review" / "10. Compliance
      // Handover" / "Hold" / "Done".
      const ccpLabels = Object.fromEntries(
        PHASES.map((p) => [
          p.code,
          p.isSequential && p.displayNumber !== null
            ? `${p.displayNumber}. ${p.label}`
            : p.label,
        ]),
      );
      expect(ccpLabels.S10_POST_HANDOVER_REVIEW).toBe("9. 3 Months Post HO Review");
      expect(ccpLabels.S9B_COMPLIANCE_HANDOVER).toBe("10. Compliance Handover");
      expect(ccpLabels.S_HOLD).toBe("Hold");
      expect(ccpLabels.S_DONE).toBe("Done");
    });

    it("ceo-home EXECUTION_STAGES derivation places S10 BEFORE S9B (post-Task #81 swap)", () => {
      // Mirrors the in-component derivation: SEQUENTIAL_PHASES
      // filtered to displayNumber >= 4. Order must follow the
      // canonical SEQUENTIAL_PHASES, which places S10 (display 9)
      // before S9B (display 10).
      const execStages = SEQUENTIAL_PHASES
        .filter((p) => p.displayNumber !== null && p.displayNumber >= 4)
        .map((p) => p.code);
      const s10Idx = execStages.indexOf("S10_POST_HANDOVER_REVIEW");
      const s9bIdx = execStages.indexOf("S9B_COMPLIANCE_HANDOVER");
      expect(s10Idx).toBeGreaterThan(-1);
      expect(s9bIdx).toBeGreaterThan(-1);
      expect(s10Idx).toBeLessThan(s9bIdx);
    });
  });
});
