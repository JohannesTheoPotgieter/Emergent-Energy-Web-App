import { describe, expect, it } from "vitest";

import { chooseProgressPercent, toDisplayProgressPercent } from "../../../server/lib/priorities/progress-percent";

describe("priority progress percent selection", () => {
  it("normalizes canonical 0..1 task progress to display percent", () => {
    expect(toDisplayProgressPercent(0.413)).toBe(41);
    expect(toDisplayProgressPercent(1)).toBe(100);
    expect(toDisplayProgressPercent(73.6)).toBe(74);
  });

  it("uses live task progress when cached derived project KPI is missing", () => {
    expect(chooseProgressPercent({ cachedPct: null, liveAvgPct: 0.413, liveTaskCount: 192 })).toMatchObject({
      value: 41,
      source: "live",
    });
  });

  it("treats cached zero as a cache miss when live task progress exists", () => {
    expect(chooseProgressPercent({ cachedPct: 0, liveAvgPct: 0.9, liveTaskCount: 15 })).toMatchObject({
      value: 90,
      source: "live",
    });
  });

  it("keeps a real cached progress value ahead of the live fallback", () => {
    expect(chooseProgressPercent({ cachedPct: 73.6, liveAvgPct: 0.9, liveTaskCount: 15 })).toMatchObject({
      value: 74,
      source: "cache",
    });
  });

  it("keeps cached zero when there are no live tasks to fall back to", () => {
    expect(chooseProgressPercent({ cachedPct: 0, liveAvgPct: null, liveTaskCount: 0 })).toMatchObject({
      value: 0,
      source: "cache",
    });
  });
});
