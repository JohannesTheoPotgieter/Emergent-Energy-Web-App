import { describe, it, expect } from "vitest";

import { buildChainComplete } from "../../../server/services/milestone-tracker-service";

// Activity Planning's chain-aware "ready to invoice": a task is chain-complete
// only when it is 100% AND every predecessor (transitively) is chain-complete.
// percentComplete is stored 0..1 (pctTo100 scales it); deps are predecessor→successor.

type Task = Parameters<typeof buildChainComplete>[0][number];
const task = (id: number, pct: number): Task => ({
  id, projectId: 1, taskNo: String(id), title: `T${id}`, workstream: "PM", phase: null,
  startDate: null, endDate: null, actualStart: null, actualEnd: null,
  percentComplete: pct, isMilestone: false,
});
const dep = (predecessorId: number, successorId: number, source = "MANUAL") => ({ predecessorId, successorId, source });

describe("buildChainComplete", () => {
  it("a task with no predecessors is chain-complete iff it is 100%", () => {
    const m = buildChainComplete([task(1, 1), task(2, 0.5)], []);
    expect(m.get(1)).toBe(true);
    expect(m.get(2)).toBe(false);
  });

  it("a 100% task is NOT chain-complete if a predecessor is incomplete", () => {
    // 1 (done) → 2 (done) but 2 also waits on 3 (not done)
    const m = buildChainComplete([task(1, 1), task(2, 1), task(3, 0)], [dep(1, 2), dep(3, 2)]);
    expect(m.get(2)).toBe(false); // blocked by 3
    expect(m.get(1)).toBe(true);
  });

  it("a chain of complete predecessors makes the successor chain-complete", () => {
    // 1 → 2 → 3, all 100%
    const m = buildChainComplete([task(1, 1), task(2, 1), task(3, 1)], [dep(1, 2), dep(2, 3)]);
    expect(m.get(3)).toBe(true);
  });

  it("a deep incomplete predecessor blocks the whole chain", () => {
    // 1 (0%) → 2 (100%) → 3 (100%): 3 is blocked because 1 isn't done
    const m = buildChainComplete([task(1, 0), task(2, 1), task(3, 1)], [dep(1, 2), dep(2, 3)]);
    expect(m.get(2)).toBe(false);
    expect(m.get(3)).toBe(false);
  });

  it("does not infinite-loop on a dependency cycle", () => {
    // 1 ↔ 2 cycle, both 100% — cycle-guarded, resolves without hanging
    const m = buildChainComplete([task(1, 1), task(2, 1)], [dep(1, 2), dep(2, 1)]);
    expect(m.get(1)).toBe(true);
    expect(m.get(2)).toBe(true);
  });
});
