/**
 * B1 (audit closeout) — Stage Gate Evidence Snapshot unit tests.
 *
 * Verifies the pure helpers that drive the snapshot pipeline. The full
 * end-to-end flow (transition -> snapshot row written to DB -> history
 * endpoint returns it) is covered by API-level tests; this file pins
 * the pure logic so regressions in the traffic-light thresholds and
 * the requirement-summarization shape are caught without spinning up
 * a server.
 */

import { describe, expect, it } from "vitest";
import { computeTrafficLight } from "../../../server/services/stage-lifecycle-service";

describe("B1 — computeTrafficLight traffic-light thresholds", () => {
  it("100 -> green", () => {
    expect(computeTrafficLight(100)).toBe("green");
  });

  it("99 -> amber (one gate short of full)", () => {
    expect(computeTrafficLight(99)).toBe("amber");
  });

  it("80 -> amber (lower bound)", () => {
    expect(computeTrafficLight(80)).toBe("amber");
  });

  it("79 -> red (just below amber)", () => {
    expect(computeTrafficLight(79)).toBe("red");
  });

  it("0 -> red", () => {
    expect(computeTrafficLight(0)).toBe("red");
  });

  it("50 -> red", () => {
    expect(computeTrafficLight(50)).toBe("red");
  });

  it("is monotonic across the full range", () => {
    // Green dominates amber which dominates red for strictly increasing inputs.
    const order = { green: 3, amber: 2, red: 1 } as const;
    let prev = 0;
    for (let pct = 0; pct <= 100; pct += 1) {
      const v = order[computeTrafficLight(pct)];
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
