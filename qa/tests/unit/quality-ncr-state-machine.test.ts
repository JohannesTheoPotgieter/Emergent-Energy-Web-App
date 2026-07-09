/**
 * Task 0.5 — NCR state-machine behavioural tests.
 *
 * Exercises the real `canTransition` function (pure module, shared with the
 * NCR update route) — NOT source-text assertions. Covers every legal
 * transition, illegal transitions, terminal states blocking re-open, and the
 * `waived`-from-any-non-terminal branch.
 */
import { describe, expect, it } from "vitest";
import {
  canTransition,
  NCR_STATUS_ORDER,
  NCR_TERMINAL_STATUSES,
} from "../../../server/lib/quality-ncr-state-machine";

const ALL_STATES = ["open", "investigating", "corrective_action", "verification", "closed", "waived"];

describe("NCR canTransition — legal forward chain", () => {
  const legal: Array<[string, string]> = [
    ["open", "investigating"],
    ["investigating", "corrective_action"],
    ["corrective_action", "verification"],
    ["verification", "closed"],
  ];
  it.each(legal)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("treats a no-op transition (same state) as allowed", () => {
    for (const s of ALL_STATES) expect(canTransition(s, s)).toBe(true);
  });
});

describe("NCR canTransition — illegal transitions rejected", () => {
  it("rejects skipping a step (open → corrective_action)", () => {
    expect(canTransition("open", "corrective_action")).toBe(false);
    expect(canTransition("open", "verification")).toBe(false);
    expect(canTransition("open", "closed")).toBe(false);
  });

  it("rejects moving backwards (verification → open)", () => {
    expect(canTransition("verification", "investigating")).toBe(false);
    expect(canTransition("corrective_action", "open")).toBe(false);
  });

  it("rejects unknown states", () => {
    expect(canTransition("open", "bogus")).toBe(false);
    expect(canTransition("bogus", "open")).toBe(false);
  });
});

describe("NCR canTransition — terminal states block re-open", () => {
  it("closed cannot transition anywhere except itself", () => {
    for (const to of ALL_STATES) {
      if (to === "closed") continue;
      expect(canTransition("closed", to)).toBe(false);
    }
  });

  it("waived cannot transition anywhere except itself", () => {
    for (const to of ALL_STATES) {
      if (to === "waived") continue;
      expect(canTransition("waived", to)).toBe(false);
    }
  });

  it("a terminal state cannot even be waived again", () => {
    expect(canTransition("closed", "waived")).toBe(false);
    expect(canTransition("waived", "closed")).toBe(false);
  });

  it("exposes exactly closed + waived as terminal", () => {
    expect([...NCR_TERMINAL_STATUSES].sort()).toEqual(["closed", "waived"]);
  });
});

describe("NCR canTransition — waived from any non-terminal state", () => {
  it("allows waiving from every non-terminal state", () => {
    for (const from of ["open", "investigating", "corrective_action", "verification"]) {
      expect(canTransition(from, "waived")).toBe(true);
    }
  });

  it("does not allow waiving from a terminal state", () => {
    expect(canTransition("closed", "waived")).toBe(false);
  });
});

describe("NCR_STATUS_ORDER integrity", () => {
  it("is the linear chain ending in closed", () => {
    expect(NCR_STATUS_ORDER[0]).toBe("open");
    expect(NCR_STATUS_ORDER[NCR_STATUS_ORDER.length - 1]).toBe("closed");
    // Every adjacent pair is a legal step.
    for (let i = 0; i < NCR_STATUS_ORDER.length - 1; i++) {
      expect(canTransition(NCR_STATUS_ORDER[i], NCR_STATUS_ORDER[i + 1])).toBe(true);
    }
  });
});
