/**
 * Task 0.5 — Commissioning state-machine + Handover-Pack gate tests.
 *
 * Exercises the real pure functions shared with the commissioning update
 * route (canTransitionCommissioning, isCommissioningStartBlocked,
 * isHandoverPackStageComplete) — NOT source-text assertions.
 */
import { describe, expect, it } from "vitest";
import {
  COMMISSIONING_VALID_TRANSITIONS,
  canTransitionCommissioning,
  isCommissioningStartBlocked,
  isHandoverPackStageComplete,
} from "../../../server/lib/commissioning-state-machine";

const STATES = ["not_started", "in_progress", "ready_for_review", "approved", "closed"];

describe("commissioning canTransition — legal transitions", () => {
  const legal: Array<[string, string]> = [
    ["not_started", "in_progress"],
    ["in_progress", "ready_for_review"],
    ["in_progress", "not_started"], // rollback
    ["ready_for_review", "approved"],
    ["ready_for_review", "in_progress"], // rollback
    ["approved", "closed"],
  ];
  it.each(legal)("allows %s → %s", (from, to) => {
    expect(canTransitionCommissioning(from, to)).toBe(true);
  });
});

describe("commissioning canTransition — illegal transitions rejected", () => {
  it("rejects skipping the review/approval steps", () => {
    expect(canTransitionCommissioning("not_started", "ready_for_review")).toBe(false);
    expect(canTransitionCommissioning("not_started", "approved")).toBe(false);
    expect(canTransitionCommissioning("in_progress", "approved")).toBe(false);
    expect(canTransitionCommissioning("in_progress", "closed")).toBe(false);
  });

  it("closed is terminal — no outgoing transitions", () => {
    for (const to of STATES) {
      expect(canTransitionCommissioning("closed", to)).toBe(false);
    }
    expect(COMMISSIONING_VALID_TRANSITIONS.closed).toEqual([]);
  });

  it("rejects unknown states", () => {
    expect(canTransitionCommissioning("bogus", "in_progress")).toBe(false);
    expect(canTransitionCommissioning("approved", "bogus")).toBe(false);
  });

  it("approved can only advance to closed (no rollback)", () => {
    expect(canTransitionCommissioning("approved", "ready_for_review")).toBe(false);
    expect(canTransitionCommissioning("approved", "closed")).toBe(true);
  });
});

describe("Handover-Pack gate", () => {
  it("stage is complete only when its status is exactly 'complete'", () => {
    expect(isHandoverPackStageComplete("complete")).toBe(true);
    expect(isHandoverPackStageComplete("in_progress")).toBe(false);
    expect(isHandoverPackStageComplete("not_found")).toBe(false);
    expect(isHandoverPackStageComplete(null)).toBe(false);
    expect(isHandoverPackStageComplete(undefined)).toBe(false);
  });

  it("blocks starting commissioning when Handover Pack is NOT complete", () => {
    expect(isCommissioningStartBlocked("not_started", "in_progress", false)).toBe(true);
  });

  it("allows starting commissioning once Handover Pack is complete", () => {
    expect(isCommissioningStartBlocked("not_started", "in_progress", true)).toBe(false);
  });

  it("does not gate any transition other than the start transition", () => {
    // Even with an incomplete handover pack, non-start transitions aren't
    // blocked by THIS rule.
    expect(isCommissioningStartBlocked("in_progress", "ready_for_review", false)).toBe(false);
    expect(isCommissioningStartBlocked("ready_for_review", "approved", false)).toBe(false);
    expect(isCommissioningStartBlocked("approved", "closed", false)).toBe(false);
    expect(isCommissioningStartBlocked("in_progress", "not_started", false)).toBe(false);
  });
});
