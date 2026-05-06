import { describe, expect, it } from "vitest";
import {
  PHASES,
  PHASE_BY_CODE,
  PHASE_LABELS,
  PHASE_CODES,
  SEQUENTIAL_PHASES,
  TERMINAL_PHASES,
  resolveCanonicalCode,
  resolveCanonicalPhase,
  nextPhase,
  prevPhase,
  isTerminalPhase,
  isSequentialPhase,
  terminalCodeForStatus,
} from "../../../shared/phases";
import {
  STAGE_CODES,
  TERMINAL_STAGE_CODES,
  SEQUENTIAL_STAGE_CODES,
} from "../../../shared/schema/stage-lifecycle";
import { resolveStageFromPhase } from "../../../shared/utils/phase-to-stage-map";
import { STAGE_SEQUENCE, getNextStageCode } from "../../../shared/utils/stage-state-machine";

describe("Canonical lifecycle phases v2 (12-phase model)", () => {
  describe("Renames", () => {
    it("S02 label is 'Cost Proposal & Design' (renamed from 'Design & Cost Proposal')", () => {
      expect(PHASE_BY_CODE.S02_DESIGN_COST_PROPOSAL.label).toBe("Cost Proposal & Design");
    });

    it("S10 label is '3 Months Post HO Review' (renamed from 'Post-Handover Review')", () => {
      expect(PHASE_BY_CODE.S10_POST_HANDOVER_REVIEW.label).toBe("3 Months Post HO Review");
    });

    it("legacy 'Design & Cost Proposal' alias resolves to S02", () => {
      expect(resolveCanonicalCode("Design & Cost Proposal")).toBe("S02_DESIGN_COST_PROPOSAL");
    });

    it("legacy 'Post-Handover Review' alias resolves to S10", () => {
      expect(resolveCanonicalCode("Post-Handover Review")).toBe("S10_POST_HANDOVER_REVIEW");
    });

    it("new 'Cost Proposal & Design' label resolves to S02", () => {
      expect(resolveCanonicalCode("Cost Proposal & Design")).toBe("S02_DESIGN_COST_PROPOSAL");
    });

    it("new '3 Months Post HO Review' label resolves to S10", () => {
      expect(resolveCanonicalCode("3 Months Post HO Review")).toBe("S10_POST_HANDOVER_REVIEW");
    });
  });

  describe("Order swap (S10 = 9, S9B = 10)", () => {
    it("S10 (3 Months Post HO Review) sits at displayNumber 9", () => {
      expect(PHASE_BY_CODE.S10_POST_HANDOVER_REVIEW.displayNumber).toBe(9);
    });

    it("S9B (Compliance Handover) sits at displayNumber 10", () => {
      expect(PHASE_BY_CODE.S9B_COMPLIANCE_HANDOVER.displayNumber).toBe(10);
    });

    it("STAGE_SEQUENCE places S10 before S9B", () => {
      expect(STAGE_SEQUENCE.S10_POST_HANDOVER_REVIEW).toBe(9);
      expect(STAGE_SEQUENCE.S9B_COMPLIANCE_HANDOVER).toBe(10);
    });

    it("nextPhase(S09) advances to S10 (3MPHO Review)", () => {
      expect(nextPhase("S09_CLIENT_HANDOVER")?.code).toBe("S10_POST_HANDOVER_REVIEW");
    });

    it("nextPhase(S10) advances to S9B (Compliance Handover)", () => {
      expect(nextPhase("S10_POST_HANDOVER_REVIEW")?.code).toBe("S9B_COMPLIANCE_HANDOVER");
    });

    it("nextPhase(S9B) returns null (end of sequence)", () => {
      expect(nextPhase("S9B_COMPLIANCE_HANDOVER")).toBeNull();
    });

    it("prevPhase(S9B) is S10", () => {
      expect(prevPhase("S9B_COMPLIANCE_HANDOVER")?.code).toBe("S10_POST_HANDOVER_REVIEW");
    });

    it("SEQUENTIAL_PHASES has S10 immediately before S9B", () => {
      const codes = SEQUENTIAL_PHASES.map((p) => p.code);
      const s10Idx = codes.indexOf("S10_POST_HANDOVER_REVIEW");
      const s9bIdx = codes.indexOf("S9B_COMPLIANCE_HANDOVER");
      expect(s10Idx).toBeGreaterThanOrEqual(0);
      expect(s9bIdx).toBe(s10Idx + 1);
    });
  });

  describe("Terminal branches (Hold + Done)", () => {
    it("S_HOLD is registered as a terminal phase", () => {
      expect(PHASE_BY_CODE.S_HOLD).toBeDefined();
      expect(PHASE_BY_CODE.S_HOLD.label).toBe("Hold");
      expect(PHASE_BY_CODE.S_HOLD.isTerminal).toBe(true);
      expect(PHASE_BY_CODE.S_HOLD.isSequential).toBe(false);
      expect(isTerminalPhase("S_HOLD")).toBe(true);
      expect(isSequentialPhase("S_HOLD")).toBe(false);
    });

    it("S_DONE is registered as a terminal phase", () => {
      expect(PHASE_BY_CODE.S_DONE).toBeDefined();
      expect(PHASE_BY_CODE.S_DONE.label).toBe("Done");
      expect(PHASE_BY_CODE.S_DONE.isTerminal).toBe(true);
      expect(PHASE_BY_CODE.S_DONE.isSequential).toBe(false);
      expect(isTerminalPhase("S_DONE")).toBe(true);
    });

    it("nextPhase(S_HOLD) returns null (terminal stays terminal)", () => {
      // S_HOLD is not in SEQUENTIAL_PHASES, so findIndex returns -1 and nextPhase returns null
      expect(nextPhase("S_HOLD")).toBeNull();
    });

    it("nextPhase(S_DONE) returns null (terminal stays terminal)", () => {
      expect(nextPhase("S_DONE")).toBeNull();
    });

    it("SEQUENTIAL_PHASES excludes S_HOLD and S_DONE", () => {
      const codes = SEQUENTIAL_PHASES.map((p) => p.code);
      expect(codes).not.toContain("S_HOLD");
      expect(codes).not.toContain("S_DONE");
    });

    it("TERMINAL_PHASES contains exactly S_HOLD and S_DONE", () => {
      const codes = new Set(TERMINAL_PHASES.map((p) => p.code));
      expect(codes.has("S_HOLD")).toBe(true);
      expect(codes.has("S_DONE")).toBe(true);
      expect(codes.size).toBe(2);
    });

    it("getNextStageCode skips terminal codes when advancing from S09", () => {
      expect(getNextStageCode("S09_CLIENT_HANDOVER")).toBe("S10_POST_HANDOVER_REVIEW");
    });

    it("getNextStageCode returns null for S9B (end of sequence)", () => {
      expect(getNextStageCode("S9B_COMPLIANCE_HANDOVER")).toBeNull();
    });
  });

  describe("Status → terminal stage backfill", () => {
    it("project_status='hold' resolves to S_HOLD", () => {
      expect(terminalCodeForStatus("hold")).toBe("S_HOLD");
    });

    it("project_status='closed' resolves to S_DONE", () => {
      expect(terminalCodeForStatus("closed")).toBe("S_DONE");
    });

    it("project_status='active' returns null (no terminal mapping)", () => {
      expect(terminalCodeForStatus("active")).toBeNull();
    });

    it("project_status='internal' / 'tbc' return null", () => {
      expect(terminalCodeForStatus("internal")).toBeNull();
      expect(terminalCodeForStatus("tbc")).toBeNull();
    });
  });

  describe("Hold/Done aliases", () => {
    it("'On Hold' / 'Parked' / 'on-hold' resolve to S_HOLD", () => {
      expect(resolveCanonicalCode("On Hold")).toBe("S_HOLD");
      expect(resolveCanonicalCode("Parked")).toBe("S_HOLD");
      expect(resolveCanonicalCode("on-hold")).toBe("S_HOLD");
    });

    it("'Closed' / 'Gone' / 'Cancelled' / 'Completed' resolve to S_DONE", () => {
      expect(resolveCanonicalCode("Closed")).toBe("S_DONE");
      expect(resolveCanonicalCode("Gone")).toBe("S_DONE");
      expect(resolveCanonicalCode("Cancelled")).toBe("S_DONE");
      expect(resolveCanonicalCode("Completed")).toBe("S_DONE");
    });

    it("resolveStageFromPhase routes 'Hold' → S_HOLD and 'Done'/'Closed' → S_DONE", () => {
      expect(resolveStageFromPhase("Hold")).toBe("S_HOLD");
      expect(resolveStageFromPhase("Done")).toBe("S_DONE");
      expect(resolveStageFromPhase("Closed")).toBe("S_DONE");
    });

    it("resolveCanonicalPhase('Hold') returns the S_HOLD canonical entry", () => {
      const phase = resolveCanonicalPhase("Hold");
      expect(phase?.code).toBe("S_HOLD");
      expect(phase?.isTerminal).toBe(true);
    });
  });

  describe("Schema-level constants", () => {
    it("STAGE_CODES includes the new terminal codes", () => {
      expect(STAGE_CODES).toContain("S_HOLD");
      expect(STAGE_CODES).toContain("S_DONE");
    });

    it("TERMINAL_STAGE_CODES is exactly { S_HOLD, S_DONE }", () => {
      expect(TERMINAL_STAGE_CODES.has("S_HOLD")).toBe(true);
      expect(TERMINAL_STAGE_CODES.has("S_DONE")).toBe(true);
      expect(TERMINAL_STAGE_CODES.size).toBe(2);
    });

    it("SEQUENTIAL_STAGE_CODES filters out terminal codes", () => {
      expect(SEQUENTIAL_STAGE_CODES).not.toContain("S_HOLD");
      expect(SEQUENTIAL_STAGE_CODES).not.toContain("S_DONE");
    });
  });

  describe("Total count of phases", () => {
    it("PHASES has exactly 12 entries (10 sequential + 2 terminal)", () => {
      expect(PHASES.length).toBe(12);
      expect(SEQUENTIAL_PHASES.length).toBe(10);
      expect(TERMINAL_PHASES.length).toBe(2);
    });

    it("PHASE_LABELS contains both renamed labels and the terminal labels", () => {
      expect(PHASE_LABELS).toContain("Cost Proposal & Design");
      expect(PHASE_LABELS).toContain("3 Months Post HO Review");
      expect(PHASE_LABELS).toContain("Hold");
      expect(PHASE_LABELS).toContain("Done");
    });

    it("PHASE_CODES contains S_HOLD and S_DONE", () => {
      expect(PHASE_CODES).toContain("S_HOLD");
      expect(PHASE_CODES).toContain("S_DONE");
    });
  });
});
