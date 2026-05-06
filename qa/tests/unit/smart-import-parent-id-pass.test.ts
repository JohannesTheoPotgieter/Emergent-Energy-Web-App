/**
 * Smart Import — parentId outline-number pass tests (field-coverage gap #5).
 *
 * Tests the post-import pass inside writePlanIncremental that walks work-item
 * rows ordered by outlineNumber and sets parentId to the nearest row whose
 * outlineNumber is a strict dot-prefix of the child's.
 */

import { describe, expect, it } from "vitest";

type PlanRow = { id: number; outlineNumber: string; parentId: number | null };

// Mirrors the sort + parent-resolve logic from writePlanIncremental.

function parseOutline(s: string): number[] {
  return s.split(".").map(n => parseInt(n, 10) || 0);
}
function cmpOutline(a: string, b: string): number {
  const pa = parseOutline(a), pb = parseOutline(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveParentIds(
  rows: Array<{ id: number; outlineNumber: string | null; parentId: number | null }>,
): Map<number, number | null> {
  const sorted = rows
    .filter(r => r.outlineNumber)
    .sort((a, b) => cmpOutline(a.outlineNumber!, b.outlineNumber!));

  const outlineToId = new Map<string, number>();
  const result = new Map<number, number | null>();
  for (const row of sorted) {
    const outline = row.outlineNumber!;
    const lastDot = outline.lastIndexOf(".");
    const parentOutline = lastDot >= 0 ? outline.slice(0, lastDot) : null;
    const resolvedParentId = parentOutline ? (outlineToId.get(parentOutline) ?? null) : null;
    result.set(row.id, resolvedParentId);
    outlineToId.set(outline, row.id);
  }
  return result;
}

describe("parentId outline-number pass", () => {
  it("root-level rows get parentId = null", () => {
    const rows: PlanRow[] = [
      { id: 1, outlineNumber: "1", parentId: null },
      { id: 2, outlineNumber: "2", parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.get(1)).toBeNull();
    expect(result.get(2)).toBeNull();
  });

  it("one level of nesting", () => {
    const rows: PlanRow[] = [
      { id: 1, outlineNumber: "1", parentId: null },
      { id: 2, outlineNumber: "1.1", parentId: null },
      { id: 3, outlineNumber: "1.2", parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.get(1)).toBeNull();
    expect(result.get(2)).toBe(1);
    expect(result.get(3)).toBe(1);
  });

  it("two levels of nesting", () => {
    const rows: PlanRow[] = [
      { id: 1, outlineNumber: "1", parentId: null },
      { id: 2, outlineNumber: "1.1", parentId: null },
      { id: 3, outlineNumber: "1.1.1", parentId: null },
      { id: 4, outlineNumber: "1.1.2", parentId: null },
      { id: 5, outlineNumber: "1.2", parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.get(3)).toBe(2); // 1.1.1 → 1.1
    expect(result.get(4)).toBe(2); // 1.1.2 → 1.1
    expect(result.get(5)).toBe(1); // 1.2   → 1
  });

  it("sorts numeric segments correctly so 2.10 comes after 2.9", () => {
    const rows: PlanRow[] = [
      { id: 1, outlineNumber: "2", parentId: null },
      { id: 9, outlineNumber: "2.9", parentId: null },
      { id: 10, outlineNumber: "2.10", parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.get(9)).toBe(1);
    expect(result.get(10)).toBe(1);
    // Both 2.9 and 2.10 are direct children of "2"
    const outlineToId = new Map<string, number>();
    // Verify sort order: 2 < 2.9 < 2.10 (numeric, not lexicographic)
    const sorted = rows
      .filter(r => r.outlineNumber)
      .sort((a, b) => cmpOutline(a.outlineNumber, b.outlineNumber));
    expect(sorted.map(r => r.outlineNumber)).toEqual(["2", "2.9", "2.10"]);
  });

  it("returns null for orphaned child whose parent outline is absent", () => {
    const rows: PlanRow[] = [
      // "1.1" exists but "1" is missing (e.g. deleted row)
      { id: 2, outlineNumber: "1.1", parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.get(2)).toBeNull();
  });

  it("handles rows without outlineNumber (skips them)", () => {
    const rows = [
      { id: 1, outlineNumber: "1", parentId: null },
      { id: 2, outlineNumber: null, parentId: null },
    ];
    const result = resolveParentIds(rows);
    expect(result.has(1)).toBe(true);
    // Row without outlineNumber is not in result
    expect(result.has(2)).toBe(false);
  });

  it("idempotent: running twice with same data produces same result", () => {
    const rows: PlanRow[] = [
      { id: 1, outlineNumber: "1", parentId: null },
      { id: 2, outlineNumber: "1.1", parentId: 1 },
      { id: 3, outlineNumber: "1.2", parentId: 1 },
    ];
    const first = resolveParentIds(rows);
    // Simulate re-import: update parentIds from first pass then run again
    const updated = rows.map(r => ({ ...r, parentId: first.get(r.id) ?? null }));
    const second = resolveParentIds(updated);
    expect(first).toEqual(second);
  });
});
