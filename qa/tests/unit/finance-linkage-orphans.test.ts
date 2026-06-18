/**
 * Finance import-linkage pins — pure unit guards.
 *
 * These pin the two pure building blocks the import/relink logic depends on,
 * independent of any database:
 *
 *   1. hashActualRow v2 identity survives parent rotation — the row hash is
 *      keyed on the workbook anchor, not the parent DB id, so a parent
 *      soft-close + re-insert cannot duplicate or orphan its children.
 *   2. Allocation match map — category key / bare name / numbered composite
 *      all resolve (case/whitespace-insensitive), and unknown categories
 *      return null rather than a guess.
 */

import { describe, expect, it } from "vitest";
import { hashActualRow } from "../../../server/lib/import/row-hasher";
import {
  buildAllocationMatchMap,
  resolveLineAllocation,
} from "../../../server/lib/import/allocation-relink";

describe("hashActualRow v2 — identity survives parent rotation", () => {
  it("is keyed on the workbook anchor, not the parent DB id", () => {
    const a = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    const b = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    expect(a).toBe(b);
  });

  it("changes when the workbook identity changes", () => {
    const base = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    expect(hashActualRow({ projectId: 7, parentSourceRow: 43, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
    expect(hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 2, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
    expect(hashActualRow({ projectId: 8, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
  });
});

describe("allocation match map — category key/name variants resolve", () => {
  const map = buildAllocationMatchMap([
    { id: 11, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1" },
    { id: 12, categoryKey: "2. Inverters", categoryName: "Inverters", categoryNumber: "2" },
  ]);

  it("matches by key, bare name, numbered composite — case/whitespace-insensitive", () => {
    expect(resolveLineAllocation({ categoryKey: "1. Panels", costCategory: null }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "Panels" }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "  panels  " }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "2.  INVERTERS" }, map)?.id).toBe(12);
    expect(resolveLineAllocation({ categoryKey: "1.   panels", costCategory: null }, map)?.id).toBe(11);
  });

  it("returns null (never a guess) for unknown categories", () => {
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "Batteries" }, map)).toBeNull();
  });
});
