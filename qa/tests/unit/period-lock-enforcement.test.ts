/**
 * fix/period-lock-all-write-paths — the reusable enforcement decision that every
 * periodised-figure write path uses. The full per-path 423 / override-audit and
 * the re-import integration test live in qa/tests/api (they boot the server);
 * this unit test pins the block/override/proceed decision logic.
 */

import { describe, expect, it } from "vitest";

import { decideCosPeriodLockEnforcement } from "../../../server/lib/finance/period-lock";

describe("decideCosPeriodLockEnforcement", () => {
  it("no locked period → proceed", () => {
    expect(
      decideCosPeriodLockEnforcement({ lockedPeriods: [], canOverride: false, hasOverrideReason: false }),
    ).toEqual({ lockedPeriods: [], blocked: false, overrideAvailable: false, overriddenPeriods: [] });
  });

  it("locked + role cannot override → blocked (423)", () => {
    const r = decideCosPeriodLockEnforcement({
      lockedPeriods: ["2026-03-01"],
      canOverride: false,
      hasOverrideReason: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.overrideAvailable).toBe(false);
    expect(r.overriddenPeriods).toEqual([]);
  });

  it("locked + override role but NO reason → blocked (423), override available", () => {
    const r = decideCosPeriodLockEnforcement({
      lockedPeriods: ["2026-03-01"],
      canOverride: true,
      hasOverrideReason: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.overrideAvailable).toBe(true);
    expect(r.overriddenPeriods).toEqual([]);
  });

  it("locked + override role + reason → proceed and audit the deduped/sorted period(s)", () => {
    const r = decideCosPeriodLockEnforcement({
      lockedPeriods: ["2026-03-01", "2026-03-01", "2026-02-01"],
      canOverride: true,
      hasOverrideReason: true,
    });
    expect(r.blocked).toBe(false);
    expect(r.overrideAvailable).toBe(true);
    expect(r.overriddenPeriods).toEqual(["2026-02-01", "2026-03-01"]);
  });
});
