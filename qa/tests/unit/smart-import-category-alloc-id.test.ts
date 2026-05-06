/**
 * Smart Import — categoryAllocationId S10 matcher tests (field-coverage gap #3).
 *
 * The bug: the original S10 had two branches where the else-if was dead code.
 * When row.categoryKey === match.key the first if was false; but then
 * !row.categoryKey was also false, so categoryAllocationId was never updated
 * for rows that already had the correct key string (e.g. after a prior import
 * set it, but category_revenue_allocations was re-inserted with a new FK id).
 *
 * The fix: consolidate into one condition:
 *   if (match && (row.categoryKey !== match.key || row.categoryAllocationId !== match.id))
 */

import { describe, expect, it } from "vitest";

type NclRow = { id: number; costCategory: string | null; categoryKey: string | null; categoryAllocationId: number | null };
type AllocMatch = { key: string; id: number };

// Mirrors the catNameToKeyId map built in smart-import-routes S10.
function buildCatNameToKeyId(allocs: Array<{ categoryName: string; categoryKey: string; id: number }>): Map<string, AllocMatch> {
  const map = new Map<string, AllocMatch>();
  for (const a of allocs) {
    map.set(a.categoryName.toLowerCase(), { key: a.categoryKey, id: a.id });
    map.set(a.categoryKey.toLowerCase(), { key: a.categoryKey, id: a.id });
  }
  return map;
}

// Mirrors the fixed condition from S10.
function needsUpdate(row: NclRow, map: Map<string, AllocMatch>): { key: string; id: number } | null {
  const catName = (row.costCategory || "").toLowerCase().trim();
  const match = map.get(catName);
  if (match && (row.categoryKey !== match.key || row.categoryAllocationId !== match.id)) {
    return { key: match.key, id: match.id };
  }
  return null;
}

describe("S10 categoryAllocationId matcher (fixed)", () => {
  const allocs = [
    { categoryName: "Panels", categoryKey: "1. Panels", id: 101 },
    { categoryName: "Inverters", categoryKey: "2. Inverters", id: 102 },
  ];
  const catMap = buildCatNameToKeyId(allocs);

  it("updates row with null categoryKey (fresh insert)", () => {
    const row: NclRow = { id: 1, costCategory: "Panels", categoryKey: null, categoryAllocationId: null };
    const update = needsUpdate(row, catMap);
    expect(update).toEqual({ key: "1. Panels", id: 101 });
  });

  it("updates row with wrong categoryKey", () => {
    const row: NclRow = { id: 2, costCategory: "Inverters", categoryKey: "1. Panels", categoryAllocationId: 101 };
    const update = needsUpdate(row, catMap);
    expect(update).toEqual({ key: "2. Inverters", id: 102 });
  });

  it("updates row with correct key but stale/null allocationId (the original bug)", () => {
    // This is the exact case that was broken before the fix.
    // row.categoryKey === match.key, but categoryAllocationId is null.
    const row: NclRow = { id: 3, costCategory: "Panels", categoryKey: "1. Panels", categoryAllocationId: null };
    const update = needsUpdate(row, catMap);
    expect(update).toEqual({ key: "1. Panels", id: 101 });
  });

  it("updates row with correct key but stale allocationId from prior import", () => {
    // Category was re-inserted with a new id (99) in this import.
    const row: NclRow = { id: 4, costCategory: "Panels", categoryKey: "1. Panels", categoryAllocationId: 50 };
    const update = needsUpdate(row, catMap);
    expect(update).toEqual({ key: "1. Panels", id: 101 });
  });

  it("skips row that is already fully up-to-date", () => {
    const row: NclRow = { id: 5, costCategory: "Panels", categoryKey: "1. Panels", categoryAllocationId: 101 };
    expect(needsUpdate(row, catMap)).toBeNull();
  });

  it("skips row with unrecognised category", () => {
    const row: NclRow = { id: 6, costCategory: "Unknown Category", categoryKey: null, categoryAllocationId: null };
    expect(needsUpdate(row, catMap)).toBeNull();
  });

  it("resolves by categoryKey string as well as categoryName", () => {
    // catMap is indexed by both name and key, so looking up by key also works.
    const row: NclRow = { id: 7, costCategory: "2. Inverters", categoryKey: null, categoryAllocationId: null };
    const update = needsUpdate(row, catMap);
    expect(update).toEqual({ key: "2. Inverters", id: 102 });
  });
});
