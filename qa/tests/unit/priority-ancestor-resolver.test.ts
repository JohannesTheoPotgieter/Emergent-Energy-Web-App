import { describe, expect, it } from "vitest";
import { collectAncestorIds } from "@shared/config/priorities";

describe("collectAncestorIds", () => {
  it("returns an empty array when the leaf has no parent", () => {
    const adjacency = [
      { id: 1, parentId: null },
      { id: 2, parentId: null },
    ];
    expect(collectAncestorIds(adjacency, 1)).toEqual([]);
  });

  it("walks a single-level chain — role → department", () => {
    const adjacency = [
      { id: 10, parentId: null },   // department
      { id: 100, parentId: 10 },    // role
    ];
    expect(collectAncestorIds(adjacency, 100)).toEqual([10]);
  });

  it("walks the full chain — role → department → company", () => {
    const adjacency = [
      { id: 1, parentId: null },    // company
      { id: 10, parentId: 1 },       // department
      { id: 100, parentId: 10 },     // role
    ];
    expect(collectAncestorIds(adjacency, 100)).toEqual([10, 1]);
  });

  it("does NOT include the leaf itself", () => {
    const adjacency = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
    ];
    expect(collectAncestorIds(adjacency, 2)).not.toContain(2);
  });

  it("is safe against self-cycles (id === parentId)", () => {
    const adjacency = [
      { id: 5, parentId: 5 },
    ];
    expect(collectAncestorIds(adjacency, 5)).toEqual([]);
  });

  it("is safe against multi-node cycles via visited set", () => {
    // A → B → A is malformed but shouldn't hang.
    const adjacency = [
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
    ];
    const result = collectAncestorIds(adjacency, 1);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("respects maxDepth so a malformed deep chain can't run forever", () => {
    // 1 → 2 → 3 → ... → 100
    const adjacency = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      parentId: (i === 0 ? null : i) as number | null,
    }));
    const shallow = collectAncestorIds(adjacency, 100, 3);
    expect(shallow.length).toBe(3);
    expect(shallow).toEqual([99, 98, 97]);
  });

  it("returns empty when the leaf id isn't in the adjacency list", () => {
    const adjacency = [{ id: 1, parentId: null }];
    expect(collectAncestorIds(adjacency, 999)).toEqual([]);
  });
});
