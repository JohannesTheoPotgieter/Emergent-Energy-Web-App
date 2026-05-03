import { describe, expect, it } from "vitest";
import { collectDescendantIds } from "@shared/config/priorities";

describe("collectDescendantIds", () => {
  it("returns an empty array when the root has no children", () => {
    const adjacency = [
      { id: 1, parentId: null },
      { id: 2, parentId: null },
      { id: 3, parentId: null },
    ];
    expect(collectDescendantIds(adjacency, 1)).toEqual([]);
  });

  it("collects direct children only when there are no grandchildren", () => {
    const adjacency = [
      { id: 1, parentId: null },
      { id: 10, parentId: 1 },
      { id: 11, parentId: 1 },
      { id: 99, parentId: null },
    ];
    expect(collectDescendantIds(adjacency, 1).sort()).toEqual([10, 11]);
  });

  it("walks deep trees — company → department → role", () => {
    const adjacency = [
      { id: 1, parentId: null },              // company
      { id: 10, parentId: 1 },                // department
      { id: 11, parentId: 1 },                // department
      { id: 100, parentId: 10 },              // role under dept 10
      { id: 101, parentId: 10 },              // role under dept 10
      { id: 110, parentId: 11 },              // role under dept 11
    ];
    expect(collectDescendantIds(adjacency, 1).sort((a, b) => a - b))
      .toEqual([10, 11, 100, 101, 110]);
  });

  it("does NOT include the root itself", () => {
    const adjacency = [
      { id: 5, parentId: null },
      { id: 6, parentId: 5 },
    ];
    expect(collectDescendantIds(adjacency, 5)).not.toContain(5);
  });

  it("ignores rows whose parentId points back to the same id (self-cycle)", () => {
    const adjacency = [
      { id: 1, parentId: 1 },
      { id: 2, parentId: 1 },
    ];
    // `1 → 1` self-loop must be skipped so we don't infinite-loop;
    // `2 → 1` still links correctly.
    expect(collectDescendantIds(adjacency, 1)).toEqual([2]);
  });

  it("is safe against multi-node cycles via a visited set", () => {
    // A ← B ← A is malformed but shouldn't hang.
    const adjacency = [
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 1 },
    ];
    const result = collectDescendantIds(adjacency, 1);
    // 2 is descendant of 1, 3 is descendant of 1. 1 is filtered out (root).
    expect(result.sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("handles sibling overlaps cleanly — a priority can't have two parents, but we dedupe anyway", () => {
    const adjacency = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
      // Duplicate row — shouldn't blow up.
      { id: 3, parentId: 2 },
    ];
    expect(collectDescendantIds(adjacency, 1).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("respects the maxDepth guard so a malformed deep chain doesn't run forever", () => {
    // Build a chain 1 → 2 → 3 → ... → 100
    const adjacency = Array.from({ length: 100 }, (_, i) => ({
      id: i + 2,
      parentId: (i + 1) as number | null,
    }));
    adjacency.push({ id: 1, parentId: null });

    const shallow = collectDescendantIds(adjacency, 1, 3);
    // Depth 3 means we follow 3 levels: 2, 3, 4.
    expect(shallow.sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });
});
