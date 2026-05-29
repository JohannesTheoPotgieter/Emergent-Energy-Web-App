/**
 * Smart Import v2 — faithful-mirror regression tests (2026-05-29).
 *
 * Reproduces and pins the fix for the production bug where a revenue
 * invoice number (and milestone %, PO numbers, Plan display fields, …)
 * was silently dropped on re-import.
 *
 * Root cause: the field was not in the section's COMPARE set, so a row
 * whose only change was that field classified UNCHANGED and was skipped;
 * and it was not in the TRACKED/MERGE set, so even on a CHANGED row the
 * 3-way merge produced `undefined` and the write fell back to the stale
 * existing value.
 *
 * These tests exercise the two seams that were broken — `compareFields`
 * (change detection → CHANGED vs UNCHANGED) and `mergeRow` (3-way merge
 * → which value the writer persists) — for the exact "blank → value on
 * an already-imported row" scenario from the bug report.
 */
import { describe, it, expect } from "vitest";
import {
  compareFields,
  REVENUE_COMPARE_FIELDS,
  EXPENDITURE_COMPARE_FIELDS,
  PLAN_COMPARE_FIELDS,
} from "../../../server/lib/import/row-matcher";
import { mergeRow } from "../../../server/lib/import/merge-engine";
import {
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";

describe("faithful mirror — REVENUE invoice number (the reported bug)", () => {
  // "Delivery of Inverters to SBG" — milestone exists from an earlier
  // import; the workbook later gains invoice number 005003.
  const dbRow = {
    id: 42,
    milestoneNo: "3",
    milestoneName: "Delivery of Inverters to SBG",
    milestonePercent: "0.1000",
    amountExVat: "533379.95",
    invoiceNumber: null, // blank — never captured on first import
    invoiceDate: "2026-05-19",
    milestoneNotes: null,
  };
  const fileRow = {
    milestoneNo: "3",
    milestoneName: "Delivery of Inverters to SBG",
    milestonePercent: 0.1,
    amountExVat: 533379.95,
    invoiceNumber: "005003", // added in the workbook
    invoiceDate: "2026-05-19",
    milestoneNotes: null,
  };

  it("classifies the row as CHANGED (invoice number is now compared)", () => {
    const changed = compareFields(fileRow, dbRow, REVENUE_COMPARE_FIELDS);
    const fields = changed.map((c) => c.fieldName);
    expect(fields).toContain("invoiceNumber");
    // The amount / % / date are identical despite differing encodings
    // (number vs decimal-string), so they must NOT register as changes.
    expect(fields).not.toContain("amountExVat");
    expect(fields).not.toContain("milestonePercent");
    expect(fields).not.toContain("invoiceDate");
  });

  it("merge resolves the invoice number to the file value", () => {
    // Legacy snapshot predates invoice-number tracking → no entry for it.
    // The field-level snapshot fallback (§9.2) treats snap = db = null,
    // so the file change is `accept_file`, not a phantom conflict.
    const merge = mergeRow({
      rowHash: "rev::42",
      fileRow,
      existingRow: dbRow,
      importSnapshot: { amountExVat: "533379.95", invoiceDate: "2026-05-19" },
      fields: [...REVENUE_TRACKED_FIELDS],
    });
    expect(merge.hasConflicts).toBe(false);
    expect(merge.outcomes.invoiceNumber.type).toBe("accept_file");
    expect((merge.outcomes.invoiceNumber as any).to).toBe("005003");
    expect(merge.hasMaterialChanges).toBe(true);
  });

  it("milestone % and notes also mirror on re-import", () => {
    const withChanges = {
      ...fileRow,
      milestonePercent: 0.15,
      milestoneNotes: "Confirmed by client 2026-05-20",
    };
    const changed = compareFields(withChanges, dbRow, REVENUE_COMPARE_FIELDS).map(
      (c) => c.fieldName,
    );
    expect(changed).toContain("milestonePercent");
    expect(changed).toContain("milestoneNotes");

    const merge = mergeRow({
      rowHash: "rev::42",
      fileRow: withChanges,
      existingRow: dbRow,
      importSnapshot: {},
      fields: [...REVENUE_TRACKED_FIELDS],
    });
    expect((merge.outcomes.milestonePercent as any).to).toBe(0.15);
    expect((merge.outcomes.milestoneNotes as any).to).toBe(
      "Confirmed by client 2026-05-20",
    );
  });

  it("preserves a manual app edit to the invoice number (no clobber)", () => {
    // App was manually corrected to 005099; the file still says 005003.
    // The snapshot (last import) had 005003, so db diverged → keep_db.
    const merge = mergeRow({
      rowHash: "rev::42",
      fileRow: { ...fileRow, invoiceNumber: "005003" },
      existingRow: { ...dbRow, invoiceNumber: "005099" },
      importSnapshot: { invoiceNumber: "005003" },
      fields: [...REVENUE_TRACKED_FIELDS],
    });
    expect(merge.outcomes.invoiceNumber.type).toBe("keep_db");
    expect(merge.hasConflicts).toBe(false);
  });

  it("an unchanged row stays UNCHANGED (no false-positive churn)", () => {
    const changed = compareFields(
      { ...fileRow, invoiceNumber: "005003" },
      { ...dbRow, invoiceNumber: "005003" },
      REVENUE_COMPARE_FIELDS,
    );
    expect(changed).toHaveLength(0);
  });
});

describe("faithful mirror — EXPENDITURE PO number", () => {
  const dbRow = {
    id: 7,
    description: "Inverter supply",
    costCategory: "2. Equipment",
    amountExVat: "120000.00",
    invoiceNumber: "INV-88",
    poNumber: null,
    comments: null,
  };
  const fileRow = {
    description: "Inverter supply",
    costCategory: "2. Equipment",
    amountExVat: 120000,
    invoiceNumber: "INV-88",
    poNumber: "PO-1234",
    comments: "rev B",
  };

  it("classifies CHANGED and merges PO number + comments from file", () => {
    const changed = compareFields(fileRow, dbRow, EXPENDITURE_COMPARE_FIELDS).map(
      (c) => c.fieldName,
    );
    expect(changed).toContain("poNumber");
    expect(changed).toContain("comments");

    const merge = mergeRow({
      rowHash: "exp::7",
      fileRow,
      existingRow: dbRow,
      importSnapshot: { amountExVat: "120000.00" },
      fields: [...EXPENDITURE_TRACKED_FIELDS],
    });
    expect((merge.outcomes.poNumber as any).to).toBe("PO-1234");
    expect((merge.outcomes.comments as any).to).toBe("rev B");
  });

  it("category / supplier are compared so a re-categorise refreshes", () => {
    const recategorised = { ...fileRow, costCategory: "3. Installation" };
    const changed = compareFields(
      recategorised,
      dbRow,
      EXPENDITURE_COMPARE_FIELDS,
    ).map((c) => c.fieldName);
    expect(changed).toContain("costCategory");
  });
});

describe("faithful mirror — PLAN display fields", () => {
  const dbRow = {
    id: 5,
    taskNo: "1.2",
    taskName: "Install panels",
    owner: "A. Smith",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    durationDays: 30,
    comment: "phase 1",
    workDays: 22,
  };

  it("detects a title / owner / workDays / progress change as CHANGED", () => {
    const fileRow = {
      ...dbRow,
      taskName: "Install panels (north array)",
      owner: "B. Jones",
      workDays: 25,
      pctComplete: 0.75, // progress-only updates mirror too (0..1 scale)
    };
    const changed = compareFields(
      fileRow,
      { ...dbRow, pctComplete: 0.5 },
      PLAN_COMPARE_FIELDS,
    ).map((c) => c.fieldName);
    expect(changed).toContain("taskName");
    expect(changed).toContain("owner");
    expect(changed).toContain("workDays");
    expect(changed).toContain("pctComplete");
  });

  it("identical plan row stays UNCHANGED", () => {
    const changed = compareFields({ ...dbRow }, dbRow, PLAN_COMPARE_FIELDS);
    expect(changed).toHaveLength(0);
  });
});
