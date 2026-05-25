import { describe, expect, it } from "vitest";

import {
  areGateBlockersSatisfied,
  getUnsatisfiedGateClosureRequirements,
  normalizeStageStatus,
} from "../../../shared/utils/stage-state-machine";

describe("stage gate closure evidence rules", () => {
  it("normalizes legacy uppercase stage statuses to canonical lowercase", () => {
    expect(normalizeStageStatus("IN_PROGRESS")).toBe("in_progress");
    expect(normalizeStageStatus("PROGRESSED")).toBe("progressed");
  });

  it("requires blocking requirements to be complete and evidence-backed", () => {
    const blockers = getUnsatisfiedGateClosureRequirements([
      { itemName: "IFC pack", status: "complete", blocksGate: true, evidenceAttached: false },
      { itemName: "Optional note", status: "not_started", blocksGate: false },
    ]);

    expect(blockers).toEqual([{ itemName: "IFC pack", reason: "missing_evidence" }]);
    expect(areGateBlockersSatisfied([
      { itemName: "IFC pack", status: "complete", blocksGate: true, evidenceAttached: false },
    ])).toBe(false);
  });

  it("accepts linked manual evidence for complete blockers", () => {
    expect(areGateBlockersSatisfied([
      { itemName: "Signed gate sheet", status: "COMPLETE", blocksGate: true, evidenceUrl: "https://sharepoint.example/doc" },
    ])).toBe(true);
  });

  it("accepts auto-detected completion only when auto evidence is present", () => {
    expect(areGateBlockersSatisfied([
      { itemName: "Client handover pack", status: "not_started", autoStatus: "complete", blocksGate: true, autoEvidenceUrl: "https://sharepoint.example/auto" },
    ])).toBe(true);

    expect(getUnsatisfiedGateClosureRequirements([
      { itemName: "Client handover pack", status: "not_started", autoStatus: "complete", blocksGate: true },
    ])).toEqual([{ itemName: "Client handover pack", reason: "missing_evidence" }]);
  });
});
