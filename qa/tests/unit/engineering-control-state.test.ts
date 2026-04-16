import { describe, it, expect } from "vitest";
import {
  CONTROL_STATES,
  CONTROL_STATE_META,
  CONTROL_STATE_NEXT,
  CONTROL_ACTIONS,
  deriveControlState,
  canUserAct,
  type ControlState,
} from "../../../client/src/lib/engineering-control-state";
import {
  RELEASED_FOR_STATES,
  RELEASED_FOR_TRANSITIONS,
} from "../../../shared/schema/engineering";

/**
 * The client helper `engineering-control-state.ts` duplicates the
 * shared-schema transition map so that the client bundle does not
 * import drizzle/pg deps. These tests detect drift — if the schema
 * changes, the client copy must be updated.
 */

describe("engineering-control-state (client) ↔ shared/schema (server)", () => {
  it("exports the same set of states as the server schema", () => {
    expect([...CONTROL_STATES]).toEqual([...RELEASED_FOR_STATES]);
  });

  it("transition map matches the server schema exactly", () => {
    for (const state of CONTROL_STATES) {
      expect([...CONTROL_STATE_NEXT[state]]).toEqual([
        ...RELEASED_FOR_TRANSITIONS[state],
      ]);
    }
  });
});

describe("engineering-control-state: labels and safety colours", () => {
  it("every state has meta", () => {
    for (const state of CONTROL_STATES) {
      expect(CONTROL_STATE_META[state]).toBeDefined();
      expect(CONTROL_STATE_META[state].label.length).toBeGreaterThan(0);
    }
  });

  it("approved_for_review is NOT construction-safe (core guardrail)", () => {
    expect(CONTROL_STATE_META.approved_for_review.isConstructionSafe).toBe(false);
    // The label must not be a bare "Approved" — that was the exact
    // string we needed to kill.
    expect(CONTROL_STATE_META.approved_for_review.label).not.toBe("Approved");
    expect(CONTROL_STATE_META.approved_for_review.label.toLowerCase()).toContain("review");
  });

  it("approved_for_review is blue, not green (to visually separate from IFC)", () => {
    expect(CONTROL_STATE_META.approved_for_review.tone).toBe("blue");
    expect(CONTROL_STATE_META.approved_for_review.badgeClass).toMatch(/blue/);
    expect(CONTROL_STATE_META.approved_for_review.badgeClass).not.toMatch(/green|emerald/);
  });

  it("issued_for_construction and as_built are the only construction-safe states", () => {
    const safe = CONTROL_STATES.filter(
      (s) => CONTROL_STATE_META[s].isConstructionSafe,
    );
    expect(safe).toEqual(["issued_for_construction", "as_built"]);
  });

  it("issued_for_construction and as_built are green (tone)", () => {
    expect(CONTROL_STATE_META.issued_for_construction.tone).toBe("green");
    expect(CONTROL_STATE_META.as_built.tone).toBe("green");
  });

  it("draft and under_review are not construction-safe", () => {
    expect(CONTROL_STATE_META.draft.isConstructionSafe).toBe(false);
    expect(CONTROL_STATE_META.under_review.isConstructionSafe).toBe(false);
  });
});

describe("engineering-control-state: deriveControlState back-compat", () => {
  it("prefers releasedFor when present", () => {
    expect(deriveControlState({ releasedFor: "issued_for_construction" })).toBe(
      "issued_for_construction",
    );
  });

  it("falls back to approvalStatus=approved → approved_for_review (NEVER to IFC)", () => {
    expect(
      deriveControlState({ releasedFor: null, approvalStatus: "approved" }),
    ).toBe("approved_for_review");
  });

  it("falls back to approvalStatus=pending → draft", () => {
    expect(deriveControlState({ approvalStatus: "pending" })).toBe("draft");
  });

  it("falls back to approvalStatus=rejected → under_review", () => {
    expect(deriveControlState({ approvalStatus: "rejected" })).toBe("under_review");
  });

  it("ignores unknown releasedFor values and falls back", () => {
    expect(
      deriveControlState({ releasedFor: "banana" as any, approvalStatus: "approved" }),
    ).toBe("approved_for_review");
  });
});

describe("engineering-control-state: action visibility by role", () => {
  it("Issue for Construction only appears from approved_for_review", () => {
    expect(CONTROL_ACTIONS.approved_for_review?.some((a) => a.to === "issued_for_construction")).toBe(true);
    expect(CONTROL_ACTIONS.draft).toBeUndefined();
    expect(CONTROL_ACTIONS.under_review).toBeUndefined();
  });

  it("Mark As-Built only appears from issued_for_construction", () => {
    expect(CONTROL_ACTIONS.issued_for_construction?.some((a) => a.to === "as_built")).toBe(true);
    expect(CONTROL_ACTIONS.approved_for_review?.some((a) => a.to === "as_built")).toBeFalsy();
  });

  it("ENGINEER can issue for construction", () => {
    const action = CONTROL_ACTIONS.approved_for_review!.find((a) => a.to === "issued_for_construction")!;
    expect(canUserAct(action, "ENGINEER")).toBe(true);
    expect(canUserAct(action, "COO_ADMIN")).toBe(true);
  });

  it("PROJECT_MANAGER_SITE cannot issue for construction", () => {
    const action = CONTROL_ACTIONS.approved_for_review!.find((a) => a.to === "issued_for_construction")!;
    expect(canUserAct(action, "PROJECT_MANAGER_SITE")).toBe(false);
  });

  it("CONSTRUCTION_MANAGER can mark as-built", () => {
    const action = CONTROL_ACTIONS.issued_for_construction!.find((a) => a.to === "as_built")!;
    expect(canUserAct(action, "CONSTRUCTION_MANAGER")).toBe(true);
    expect(canUserAct(action, "ENGINEER")).toBe(true);
  });

  it("CONSTRUCTION_MANAGER cannot issue for construction (only engineers can)", () => {
    const action = CONTROL_ACTIONS.approved_for_review!.find((a) => a.to === "issued_for_construction")!;
    expect(canUserAct(action, "CONSTRUCTION_MANAGER")).toBe(false);
  });
});

describe("engineering-control-state: transition invariants", () => {
  it("draft cannot jump to issued_for_construction", () => {
    expect(CONTROL_STATE_NEXT.draft).not.toContain("issued_for_construction" as ControlState);
  });

  it("approved_for_review cannot jump to as_built", () => {
    expect(CONTROL_STATE_NEXT.approved_for_review).not.toContain("as_built" as ControlState);
  });

  it("superseded is terminal", () => {
    expect(CONTROL_STATE_NEXT.superseded).toEqual([]);
  });
});
