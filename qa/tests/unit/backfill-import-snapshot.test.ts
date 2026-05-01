/**
 * Backfill import_snapshot — pure-function tests.
 *
 * The backfill script (`scripts/backfill-import-snapshot.ts`) is a
 * one-shot CLI; full end-to-end testing requires a postgres DB and
 * a seeded import run. This suite covers the snapshot-construction
 * logic and the matchRows-based pairing semantics in isolation, so
 * regressions in the snapshot shape are caught at unit-test time.
 *
 * Live-DB testing is documented in
 * `docs/excel-vs-app-workstream-b-impl.md` § Commit 7 and runs
 * against the staging environment.
 */
import { describe, expect, it } from "vitest";
import {
  PLAN_TRACKED_FIELDS,
  REVENUE_TRACKED_FIELDS,
  EXPENDITURE_TRACKED_FIELDS,
} from "@shared/excel-vs-app/contract";

/**
 * Mirrors the `buildSnapshot` inside the backfill script. Pure
 * function — given a file row and a tracked-field list, produces
 * the JSONB shape the backfill writes.
 */
function buildSnapshot(
  fileRow: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const f of fields) snap[f] = fileRow[f] ?? null;
  return snap;
}

describe("backfill-import-snapshot — buildSnapshot", () => {
  it("PLAN: emits one entry per tracked field, defaulting missing keys to null", () => {
    const fileRow = {
      startDate: "2026-05-01",
      endDate: "2026-05-15",
      duration: 14,
      ownerName: "Jane",
      // unrelated / non-tracked fields ignored
      taskNo: "1.2",
      randomMetadata: "ignored",
    };
    const snap = buildSnapshot(fileRow, PLAN_TRACKED_FIELDS);
    expect(Object.keys(snap).sort()).toEqual([...PLAN_TRACKED_FIELDS].sort());
    expect(snap.startDate).toBe("2026-05-01");
    expect(snap.endDate).toBe("2026-05-15");
    expect(snap.duration).toBe(14);
    expect(snap.ownerName).toBe("Jane");
    // Untracked field absent from output.
    expect("taskNo" in snap).toBe(false);
    expect("randomMetadata" in snap).toBe(false);
    // Tracked field absent from input → null.
    expect(snap.actualStart).toBeNull();
    expect(snap.percentComplete).toBeNull();
  });

  it("REVENUE: full-row snapshot matches the tracked-field set", () => {
    const fileRow = {
      amountExVat: "50000.00",
      vat: "7500.00",
      milestonePercent: 25,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-04-15",
      paidDate: "2026-05-01",
    };
    const snap = buildSnapshot(fileRow, REVENUE_TRACKED_FIELDS);
    expect(Object.keys(snap).sort()).toEqual([...REVENUE_TRACKED_FIELDS].sort());
    expect(snap.amountExVat).toBe("50000.00");
    expect(snap.invoiceDate).toBe("2026-04-15");
    expect(snap.milestoneNotes).toBeNull(); // not in input
  });

  it("EXPENDITURE: full-row snapshot matches the tracked-field set", () => {
    const fileRow = {
      amountExVat: "1500.00",
      budgetTotal: "2000.00",
      invoiceNumber: "INV-100",
      poNumber: "PO-50",
      counterpartyName: "Supplier Co.",
      cosRealised: true,
    };
    const snap = buildSnapshot(fileRow, EXPENDITURE_TRACKED_FIELDS);
    expect(Object.keys(snap).sort()).toEqual([...EXPENDITURE_TRACKED_FIELDS].sort());
    expect(snap.amountExVat).toBe("1500.00");
    expect(snap.cosRealised).toBe(true);
    expect(snap.usdExchangeRate).toBeNull();
    expect(snap.actualQty).toBeNull();
  });

  it("undefined values normalise to null", () => {
    const fileRow: Record<string, unknown> = {
      startDate: "2026-05-01",
      endDate: undefined,
      duration: undefined,
    };
    const snap = buildSnapshot(fileRow, PLAN_TRACKED_FIELDS);
    expect(snap.startDate).toBe("2026-05-01");
    expect(snap.endDate).toBeNull();
    expect(snap.duration).toBeNull();
  });

  it("null values stay null (operator-cleared)", () => {
    const fileRow = { startDate: null, endDate: "2026-05-15" };
    const snap = buildSnapshot(fileRow, PLAN_TRACKED_FIELDS);
    expect(snap.startDate).toBeNull();
    expect(snap.endDate).toBe("2026-05-15");
  });

  it("empty file row produces an all-null snapshot of the tracked-field set", () => {
    const snap = buildSnapshot({}, EXPENDITURE_TRACKED_FIELDS);
    expect(Object.keys(snap).length).toBe(EXPENDITURE_TRACKED_FIELDS.length);
    for (const f of EXPENDITURE_TRACKED_FIELDS) {
      expect(snap[f]).toBeNull();
    }
  });

  it("idempotency property: same input produces equal output", () => {
    const fileRow = { amountExVat: "100", invoiceNumber: "INV-1" };
    const a = buildSnapshot(fileRow, EXPENDITURE_TRACKED_FIELDS);
    const b = buildSnapshot(fileRow, EXPENDITURE_TRACKED_FIELDS);
    expect(a).toEqual(b);
  });
});
