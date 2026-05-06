/**
 * Unit tests for the row-grouped bulk-resolve helpers used by
 * /api/excel-vs-app/projects/:projectId/resolve. Pure JS primitives
 * only — DB-touching helpers are exercised by the existing
 * excel-vs-app-flow integration test.
 */
import { describe, it, expect } from "vitest";
import {
  chunk,
  groupByRow,
  mapWithConcurrency,
  RESOLVE_CHUNK_CONCURRENCY,
  RESOLVE_CHUNK_ROWS,
} from "../../../server/lib/excel-vs-app-bulk";

describe("excel-vs-app bulk primitives", () => {
  it("groupByRow buckets entries by (table, rowId) preserving order", () => {
    const entries = [
      { table: "work_items" as const, rowId: 1, fieldName: "startDate" },
      { table: "work_items" as const, rowId: 2, fieldName: "endDate" },
      { table: "work_items" as const, rowId: 1, fieldName: "endDate" },
      { table: "normalized_cost_lines" as const, rowId: 1, fieldName: "amount" },
    ];
    const groups = groupByRow(entries);
    expect(groups.size).toBe(3);
    const wi1 = groups.get("work_items::1")!;
    expect(wi1.entries.map((e) => e.fieldName)).toEqual(["startDate", "endDate"]);
    const wi2 = groups.get("work_items::2")!;
    expect(wi2.entries.map((e) => e.fieldName)).toEqual(["endDate"]);
    const cost1 = groups.get("normalized_cost_lines::1")!;
    expect(cost1.entries.map((e) => e.fieldName)).toEqual(["amount"]);
  });

  it("groupByRow on a 6,215-field bulk collapses to far fewer rows", () => {
    // Synthesise a realistic shape: ~5 fields per row across ~1,250 rows.
    const entries: Array<{ table: "work_items"; rowId: number; fieldName: string }> = [];
    for (let r = 1; r <= 1250; r++) {
      for (const f of ["startDate", "endDate", "status", "ownerName", "percentComplete"]) {
        entries.push({ table: "work_items", rowId: r, fieldName: f });
      }
    }
    expect(entries.length).toBe(6250);
    const groups = groupByRow(entries);
    expect(groups.size).toBe(1250);
    // Each row has 5 field ops grouped together — 1 read + 1 write
    // instead of 5 × (1 read + 1 write) under the old per-field path.
    for (const g of groups.values()) {
      expect(g.entries.length).toBe(5);
    }
  });

  it("chunk slices into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it("mapWithConcurrency preserves input order and respects concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual(items.map((n) => n * 2));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // proof we actually parallelized
  });

  it("mapWithConcurrency surfaces mapper errors", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow(/boom/);
  });

  it("tunables stay in safe operating range", () => {
    expect(RESOLVE_CHUNK_ROWS).toBeGreaterThan(0);
    expect(RESOLVE_CHUNK_ROWS).toBeLessThanOrEqual(200);
    expect(RESOLVE_CHUNK_CONCURRENCY).toBeGreaterThan(0);
    expect(RESOLVE_CHUNK_CONCURRENCY).toBeLessThanOrEqual(8);
  });

  it("end-to-end shape: a 6,215-field bulk fits in a small number of chunked transactions", () => {
    const entries: Array<{ table: "work_items"; rowId: number; fieldName: string }> = [];
    for (let r = 1; r <= 1250; r++) {
      for (const f of ["startDate", "endDate", "status", "ownerName", "percentComplete"]) {
        entries.push({ table: "work_items", rowId: r, fieldName: f });
      }
    }
    const groups = Array.from(groupByRow(entries).values());
    const chunks = chunk(groups, RESOLVE_CHUNK_ROWS);
    // Per-chunk row count ≤ tunable; total rows preserved.
    expect(chunks.length).toBe(Math.ceil(groups.length / RESOLVE_CHUNK_ROWS));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(RESOLVE_CHUNK_ROWS);
    const totalRows = chunks.reduce((s, c) => s + c.length, 0);
    expect(totalRows).toBe(groups.length);
  });
});
