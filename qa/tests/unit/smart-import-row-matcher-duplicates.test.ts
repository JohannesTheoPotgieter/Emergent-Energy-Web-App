/**
 * Smart Import v2 — row-matcher duplicate-key pairing tests
 *
 * Exercises the group-pairing behaviour that was introduced to fix the
 * `work_items_external_ref_key` 23505 collisions seen in production when
 * a Project Plan sheet contains multiple rows sharing the same business
 * key (duplicate WBS codes, blank taskNo rows, etc.).
 *
 * Core invariants under test:
 *
 *   1. For singleton groups, matchRows still emits the legacy shape:
 *      classification UNCHANGED/CHANGED/NEW/MISSING, bare business key as
 *      rowUid, bare canonical external_ref.
 *
 *   2. For N file rows vs M DB rows sharing a key, the matcher pairs by
 *      content similarity. Surplus file rows become NEW; surplus DB rows
 *      become MISSING_FROM_UPLOAD. No rows silently disappear.
 *
 *   3. Each emitted MatchedRow carries a unique-within-section rowUid.
 *      Paired rows get `#pk<existingId>` so identity is stable across
 *      commits; unmatched NEW rows get `#new-<fileIdx>` which the
 *      executor rewrites to `#pk<id>` post-insert.
 *
 *   4. canonicalExternalRef is PLAN-only and encodes the rowUid so the
 *      commit executor can write it directly without any suffix logic.
 *
 *   5. Pairing is deterministic: re-running the matcher with the same
 *      inputs produces identical output.
 */

import { describe, expect, it } from "vitest";

describe("row-matcher duplicate-business-key pairing", () => {
  let matchRows: any;

  it("can import matchRows", async () => {
    const mod = await import("../../../server/lib/import/row-matcher");
    matchRows = mod.matchRows;
    expect(matchRows).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Baseline: singleton groups still behave exactly like before
  // -------------------------------------------------------------------------

  it("singleton: new file row emits a NEW with the bare rowUid", () => {
    const file = [{ taskName: "T1", taskNo: "1.1", phase: null, subProjectName: null }];
    const result = matchRows("PLAN", 7, file, []);
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBe("NEW");
    expect(result[0].inDuplicateGroup).toBe(false);
    expect(result[0].rowUid).toBe(result[0].businessKey.key);
    expect(result[0].canonicalExternalRef).toBe(`PID-7::PLAN::BK::${result[0].businessKey.key}`);
  });

  it("singleton: matched existing row uses the bare canonical ref", () => {
    const file = [{ taskName: "T1", taskNo: "1.1", phase: null, subProjectName: null, startDate: "2026-01-01" }];
    const existing = [{ id: 42, taskName: "T1", taskNo: "1.1", phase: null, subProjectName: null, startDate: "2026-01-01" }];
    const result = matchRows("PLAN", 7, file, existing);
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBe("UNCHANGED");
    expect(result[0].existingRowId).toBe(42);
    expect(result[0].inDuplicateGroup).toBe(false);
    expect(result[0].rowUid).toBe(result[0].businessKey.key);
    expect(result[0].canonicalExternalRef).not.toMatch(/#pk|#new/);
  });

  // -------------------------------------------------------------------------
  // Duplicate groups — the core fix
  // -------------------------------------------------------------------------

  it("2 file rows + 0 DB rows at same WBS → two NEW rows with distinct rowUids", () => {
    const file = [
      { taskName: "Install AC rails", taskNo: "4.1", phase: null, subProjectName: null },
      { taskName: "Install DC rails", taskNo: "4.1", phase: null, subProjectName: null },
    ];
    const result = matchRows("PLAN", 7, file, []);
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.classification).toBe("NEW");
      expect(r.inDuplicateGroup).toBe(true);
    }
    const uids = new Set(result.map((r: any) => r.rowUid));
    expect(uids.size).toBe(2); // unique
    for (const r of result) {
      expect(r.rowUid).toMatch(/#new-\d+$/);
      expect(r.canonicalExternalRef).toBe(`PID-7::PLAN::BK::${r.rowUid}`);
    }
  });

  it("2 file rows + 2 DB rows at same WBS → two paired CHANGED/UNCHANGED rows, zero missing", () => {
    const file = [
      { taskName: "Install AC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01", endDate: "2026-01-05" },
      { taskName: "Install DC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01", endDate: "2026-02-05" },
    ];
    const existing = [
      { id: 100, taskName: "Install AC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01", endDate: "2026-01-05" },
      { id: 101, taskName: "Install DC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01", endDate: "2026-02-05" },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    expect(result).toHaveLength(2);
    const missing = result.filter((r: any) => r.classification === "MISSING_FROM_UPLOAD");
    expect(missing).toHaveLength(0);
    // Each file row should have paired with the DB row whose content matches.
    const paired = result.filter((r: any) => r.existingRowId != null);
    expect(paired).toHaveLength(2);
    const pairedIds = new Set(paired.map((r: any) => r.existingRowId));
    expect(pairedIds).toEqual(new Set([100, 101]));
    for (const r of paired) {
      expect(r.inDuplicateGroup).toBe(true);
      expect(r.rowUid).toMatch(/#pk(100|101)$/);
    }
  });

  it("similarity-based pairing: best content match wins regardless of order", () => {
    const file = [
      { taskName: "Install DC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
      { taskName: "Install AC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
    ];
    // DB rows are in the reversed order vs file
    const existing = [
      { id: 100, taskName: "Install AC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { id: 101, taskName: "Install DC rails", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    expect(result).toHaveLength(2);
    // "DC rails" in file[0] must pair with id 101 (DC rails), NOT with id 100.
    const dcFileRow = result.find((r: any) => r.fileIndex === 0);
    expect(dcFileRow.existingRowId).toBe(101);
    const acFileRow = result.find((r: any) => r.fileIndex === 1);
    expect(acFileRow.existingRowId).toBe(100);
  });

  it("3 file vs 2 DB at same key → 2 paired + 1 NEW, 0 missing", () => {
    const file = [
      { taskName: "Work A", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { taskName: "Work B", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
      { taskName: "Work C", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-03-01" },
    ];
    const existing = [
      { id: 200, taskName: "Work A", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { id: 201, taskName: "Work B", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    expect(result).toHaveLength(3);
    const news = result.filter((r: any) => r.classification === "NEW");
    const paired = result.filter((r: any) => r.classification === "UNCHANGED" || r.classification === "CHANGED");
    const missing = result.filter((r: any) => r.classification === "MISSING_FROM_UPLOAD");
    expect(news).toHaveLength(1);
    expect(paired).toHaveLength(2);
    expect(missing).toHaveLength(0);
    // All three rowUids are unique.
    const uids = new Set(result.map((r: any) => r.rowUid));
    expect(uids.size).toBe(3);
  });

  it("2 file vs 3 DB at same key → 2 paired + 1 MISSING_FROM_UPLOAD", () => {
    const file = [
      { taskName: "Work A", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { taskName: "Work B", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
    ];
    const existing = [
      { id: 200, taskName: "Work A", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { id: 201, taskName: "Work B", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
      { id: 202, taskName: "Work C (dropped from file)", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-03-01" },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    expect(result).toHaveLength(3);
    const missing = result.filter((r: any) => r.classification === "MISSING_FROM_UPLOAD");
    expect(missing).toHaveLength(1);
    expect(missing[0].existingRowId).toBe(202);
    expect(missing[0].rowUid).toBe(`${missing[0].businessKey.key}#pk202`);
  });

  // -------------------------------------------------------------------------
  // Determinism: same input → same output
  // -------------------------------------------------------------------------

  it("pairing is deterministic across invocations", () => {
    const file = [
      { taskName: "Alpha", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { taskName: "Beta", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
      { taskName: "Gamma", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-03-01" },
    ];
    const existing = [
      { id: 500, taskName: "Alpha", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { id: 501, taskName: "Beta", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
      { id: 502, taskName: "Gamma", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-03-01" },
    ];
    const first = matchRows("PLAN", 7, file, existing);
    const second = matchRows("PLAN", 7, file, existing);
    const firstFingerprint = first.map((r: any) => `${r.classification}|${r.rowUid}|${r.existingRowId ?? ""}|${r.fileIndex ?? ""}`).join(";");
    const secondFingerprint = second.map((r: any) => `${r.classification}|${r.rowUid}|${r.existingRowId ?? ""}|${r.fileIndex ?? ""}`).join(";");
    expect(secondFingerprint).toBe(firstFingerprint);
  });

  // -------------------------------------------------------------------------
  // Canonical external_ref scheme
  // -------------------------------------------------------------------------

  it("canonicalExternalRef is PLAN-only", () => {
    const file = [{ milestoneName: "M1", milestoneNo: "1", subProjectName: null, description: null }];
    const resultRev = matchRows("REVENUE", 7, file, []);
    expect(resultRev[0].canonicalExternalRef).toBeUndefined();

    const fileCost = [{ description: "Panels", costCategory: "Equipment", counterpartyName: "SMA", invoiceNumber: null, subProjectName: null }];
    const resultExp = matchRows("EXPENDITURE", 7, fileCost, []);
    expect(resultExp[0].canonicalExternalRef).toBeUndefined();
  });

  it("canonicalExternalRef encodes the rowUid for PLAN duplicates", () => {
    const file = [
      { taskName: "A", taskNo: "4.1", phase: null, subProjectName: null },
      { taskName: "B", taskNo: "4.1", phase: null, subProjectName: null },
    ];
    const existing = [
      { id: 900, taskName: "A", taskNo: "4.1", phase: null, subProjectName: null },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    const paired = result.find((r: any) => r.existingRowId === 900);
    expect(paired.canonicalExternalRef).toBe(`PID-7::PLAN::BK::${paired.rowUid}`);
    expect(paired.canonicalExternalRef).toContain("#pk900");
    const unpaired = result.find((r: any) => r.classification === "NEW");
    expect(unpaired.canonicalExternalRef).toBe(`PID-7::PLAN::BK::${unpaired.rowUid}`);
    expect(unpaired.canonicalExternalRef).toMatch(/#new-\d+$/);
  });

  // -------------------------------------------------------------------------
  // REVENUE / EXPENDITURE duplicate handling
  // -------------------------------------------------------------------------

  it("REVENUE: duplicate milestoneName file rows are not silently collapsed", () => {
    const file = [
      { milestoneName: "Milestone 1", description: null, milestoneNo: "1", amountExVat: "100", subProjectName: null },
      { milestoneName: "Milestone 1", description: null, milestoneNo: "1", amountExVat: "250", subProjectName: null },
    ];
    const existing = [
      { id: 700, milestoneName: "Milestone 1", description: null, milestoneNo: "1", amountExVat: "100", subProjectName: null },
      { id: 701, milestoneName: "Milestone 1", description: null, milestoneNo: "1", amountExVat: "250", subProjectName: null },
    ];
    const result = matchRows("REVENUE", 7, file, existing);
    expect(result).toHaveLength(2);
    const ids = new Set(result.map((r: any) => r.existingRowId));
    expect(ids).toEqual(new Set([700, 701]));
    const missing = result.filter((r: any) => r.classification === "MISSING_FROM_UPLOAD");
    expect(missing).toHaveLength(0);
  });

  it("EXPENDITURE: duplicate no-invoice file rows are not silently collapsed", () => {
    const file = [
      { description: "Bolts", costCategory: "Hardware", counterpartyName: "Acme", invoiceNumber: null, amountExVat: "100", subProjectName: null },
      { description: "Bolts", costCategory: "Hardware", counterpartyName: "Acme", invoiceNumber: null, amountExVat: "500", subProjectName: null },
    ];
    const existing = [
      { id: 800, description: "Bolts", costCategory: "Hardware", counterpartyName: "Acme", invoiceNumber: null, amountExVat: "100", subProjectName: null },
      { id: 801, description: "Bolts", costCategory: "Hardware", counterpartyName: "Acme", invoiceNumber: null, amountExVat: "500", subProjectName: null },
    ];
    const result = matchRows("EXPENDITURE", 7, file, existing);
    expect(result).toHaveLength(2);
    const ids = new Set(result.map((r: any) => r.existingRowId));
    expect(ids).toEqual(new Set([800, 801]));
  });

  it("EXPENDITURE: identity is description + amount + invoice number + invoice date", async () => {
    const { expenditureBusinessKey } = await import("../../../server/lib/import/row-matcher");
    const a = expenditureBusinessKey(7, {
      description: "Due diligence",
      amountExVat: "1000.00",
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-30",
      costCategory: "11. Due Dilligence",
      counterpartyName: "Supplier A",
      subProjectName: "Phase 1",
    });
    const b = expenditureBusinessKey(7, {
      description: "Due diligence",
      amountExVat: 1000,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-30T00:00:00.000Z",
      costCategory: "Different category",
      counterpartyName: "Supplier B",
      subProjectName: "Phase 2",
    });
    const c = expenditureBusinessKey(7, {
      description: "Due diligence",
      amountExVat: "1000.01",
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-30",
      costCategory: "11. Due Dilligence",
      counterpartyName: "Supplier A",
      subProjectName: "Phase 1",
    });

    expect(a.key).toBe(b.key);
    expect(a.keyType).toBe("PRIMARY");
    expect(a.key).not.toBe(c.key);
  });

  // -------------------------------------------------------------------------
  // Legacy #pk<id> identity hint: preserves stable pairing
  // -------------------------------------------------------------------------

  it("existing #pk<id> external_ref anchors identity on re-pairing", () => {
    // Two file rows at the same WBS; one DB row was previously stamped
    // with #pk201. That DB row should pair with whichever file row has
    // the same content, not drift.
    const file = [
      { taskName: "Alpha task", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-01-01" },
      { taskName: "Beta task", taskNo: "4.1", phase: null, subProjectName: null, startDate: "2026-02-01" },
    ];
    const existing = [
      {
        id: 201,
        taskName: "Beta task",
        taskNo: "4.1",
        phase: null,
        subProjectName: null,
        startDate: "2026-02-01",
        externalRef: "PID-7::PLAN::BK::7||||4.1#pk201",
      },
    ];
    const result = matchRows("PLAN", 7, file, existing);
    const paired = result.find((r: any) => r.existingRowId === 201);
    // Paired DB row must correspond to "Beta task" (best content match).
    expect(paired.fileRow.taskName).toBe("Beta task");
  });
});
