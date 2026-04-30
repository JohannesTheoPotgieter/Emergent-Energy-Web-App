/**
 * Smart Import — 3-way merge engine unit tests.
 *
 * These tests pin the trust contract: manual edits in the app are never
 * silently overwritten by a re-import. The merge engine is the pure
 * function that classifies every (snapshot, db, file) triple into one
 * of four outcomes. If these tests pass, the engine is doing the right
 * thing; if any of them fails, the integration with commit-executor is
 * downstream noise — the bug is in the engine.
 */

import { describe, it, expect } from "vitest";
import {
  mergeRow,
  applyResolutions,
  updateManualOverrides,
  valuesEqual,
  type FieldValue,
} from "../../../server/lib/import/merge-engine";

describe("valuesEqual — cross-format equality", () => {
  it("treats null, undefined and empty string as equivalent", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual("", null)).toBe(true);
    expect(valuesEqual("   ", undefined)).toBe(true);
  });

  it("compares numeric strings as numbers", () => {
    expect(valuesEqual("1500.00", 1500)).toBe(true);
    expect(valuesEqual("1,500", 1500)).toBe(true);
    expect(valuesEqual("1500.001", 1500)).toBe(false);
  });

  it("absorbs whitespace and casing differences on string values", () => {
    expect(valuesEqual("Mondi", "  mondi  ")).toBe(true);
    expect(valuesEqual("MONDI", "mondi")).toBe(true);
  });

  it("treats booleans as their string forms", () => {
    expect(valuesEqual(true, "true")).toBe(true);
    expect(valuesEqual(false, "false")).toBe(true);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it("does NOT coerce arbitrary text to numbers", () => {
    // "1 box" should not parse as 1; ensures partial numeric prefix
    // doesn't cause a spurious match.
    expect(valuesEqual("1 box", 1)).toBe(false);
  });
});

describe("mergeRow — outcome classification", () => {
  const fields = ["amount_ex_vat", "milestone_notes", "paid_date"];

  function makeInput(opts: {
    snapshot: Record<string, FieldValue> | null;
    db: Record<string, FieldValue> & { id: number };
    file: Record<string, FieldValue>;
  }) {
    return {
      rowHash: "h1",
      fileRow: opts.file,
      existingRow: opts.db,
      importSnapshot: opts.snapshot,
      fields,
    };
  }

  it("returns hasMaterialChanges=true and existingId=null for a new row", () => {
    const r = mergeRow({
      rowHash: "h_new",
      fileRow: { amount_ex_vat: 100 },
      existingRow: null,
      importSnapshot: null,
      fields,
    });
    expect(r.existingId).toBeNull();
    expect(r.hasMaterialChanges).toBe(true);
    expect(r.hasConflicts).toBe(false);
  });

  it("classifies as no_change when file === db === snapshot", () => {
    const r = mergeRow(makeInput({
      snapshot: { amount_ex_vat: 100, milestone_notes: "ok", paid_date: null },
      db: { id: 1, amount_ex_vat: 100, milestone_notes: "ok", paid_date: null },
      file: { amount_ex_vat: 100, milestone_notes: "ok", paid_date: null },
    }));
    expect(r.outcomes.amount_ex_vat.type).toBe("no_change");
    expect(r.outcomes.milestone_notes.type).toBe("no_change");
    expect(r.hasMaterialChanges).toBe(false);
    expect(r.hasConflicts).toBe(false);
  });

  it("classifies as accept_file when file changed but db unchanged from snapshot", () => {
    const r = mergeRow(makeInput({
      snapshot: { amount_ex_vat: 100, milestone_notes: "old note", paid_date: null },
      db: { id: 1, amount_ex_vat: 100, milestone_notes: "old note", paid_date: null },
      file: { amount_ex_vat: 150, milestone_notes: "new note", paid_date: null },
    }));
    expect(r.outcomes.amount_ex_vat.type).toBe("accept_file");
    expect(r.outcomes.milestone_notes.type).toBe("accept_file");
    expect(r.outcomes.paid_date.type).toBe("no_change");
    expect(r.hasMaterialChanges).toBe(true);
    expect(r.hasConflicts).toBe(false);
  });

  it("classifies as keep_db when db changed but file matches snapshot", () => {
    const r = mergeRow(makeInput({
      snapshot: { amount_ex_vat: 100, milestone_notes: "imported note", paid_date: null },
      db: { id: 1, amount_ex_vat: 100, milestone_notes: "user added note", paid_date: null },
      file: { amount_ex_vat: 100, milestone_notes: "imported note", paid_date: null },
    }));
    expect(r.outcomes.milestone_notes.type).toBe("keep_db");
    expect(r.hasConflicts).toBe(false);
    // keep_db is NOT a material change — the row's effective value is
    // unchanged from what the user already saw.
    expect(r.hasMaterialChanges).toBe(false);
  });

  it("classifies as conflict when both db and file diverged differently from snapshot", () => {
    const r = mergeRow(makeInput({
      snapshot: { amount_ex_vat: 100, milestone_notes: "v1", paid_date: null },
      db: { id: 1, amount_ex_vat: 100, milestone_notes: "user note", paid_date: null },
      file: { amount_ex_vat: 100, milestone_notes: "source note", paid_date: null },
    }));
    expect(r.outcomes.milestone_notes.type).toBe("conflict");
    expect(r.hasConflicts).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({
      fieldName: "milestone_notes",
      snapshotValue: "v1",
      existingValue: "user note",
      importValue: "source note",
    });
  });

  it("coalesces both-edited-to-same-value as accept_file (not conflict)", () => {
    // The user manually edited toward the same value the source workbook
    // now has. Common in collaborative workflows; should not surface as
    // a conflict because there's nothing to disagree about.
    const r = mergeRow(makeInput({
      snapshot: { amount_ex_vat: 100, milestone_notes: "v1", paid_date: null },
      db: { id: 1, amount_ex_vat: 200, milestone_notes: "v1", paid_date: null },
      file: { amount_ex_vat: 200, milestone_notes: "v1", paid_date: null },
    }));
    expect(r.outcomes.amount_ex_vat.type).toBe("accept_file");
    expect(r.hasConflicts).toBe(false);
  });

  it("degrades to two-way (file vs db) when import_snapshot is null (legacy row)", () => {
    // A row imported before PR2B/C exists in the DB without a snapshot.
    // The engine must NOT spuriously surface conflicts on every legacy row
    // — it should treat db as the snapshot, so file divergence becomes
    // accept_file (not conflict).
    const r = mergeRow(makeInput({
      snapshot: null,
      db: { id: 1, amount_ex_vat: 100, milestone_notes: "existing", paid_date: null },
      file: { amount_ex_vat: 150, milestone_notes: "existing", paid_date: null },
    }));
    expect(r.outcomes.amount_ex_vat.type).toBe("accept_file");
    expect(r.outcomes.milestone_notes.type).toBe("no_change");
    expect(r.hasConflicts).toBe(false);
  });
});

describe("applyResolutions — final values", () => {
  function buildMerge(): ReturnType<typeof mergeRow> {
    return mergeRow({
      rowHash: "h1",
      fileRow: { a: "from-file", b: "from-file", c: "unchanged" },
      existingRow: { id: 1, a: "from-db", b: "from-file", c: "unchanged" },
      importSnapshot: { a: "from-snapshot", b: "from-snapshot", c: "unchanged" },
      fields: ["a", "b", "c"],
    });
  }

  it("honours engine recommendations for non-conflict fields", () => {
    const merge = buildMerge();
    // a: db=from-db, file=from-file, snap=from-snapshot → conflict
    // b: db=from-file, file=from-file, snap=from-snapshot → both changed to same → accept_file
    // c: all same → no_change
    expect(merge.outcomes.b.type).toBe("accept_file");
    expect(merge.outcomes.c.type).toBe("no_change");

    const result = applyResolutions(merge, [
      { fieldName: "a", resolution: "keep_existing" },
    ]);
    expect(result.a).toBe("from-db");
    expect(result.b).toBe("from-file");
    expect(result.c).toBe("unchanged");
  });

  it("accepts the import value when conflict is resolved as accept_import", () => {
    const merge = buildMerge();
    const result = applyResolutions(merge, [
      { fieldName: "a", resolution: "accept_import" },
    ]);
    expect(result.a).toBe("from-file");
  });

  it("uses a manual override value when the user supplies one", () => {
    const merge = buildMerge();
    const result = applyResolutions(merge, [
      { fieldName: "a", resolution: "manual", value: "custom" },
    ]);
    expect(result.a).toBe("custom");
  });



  it("defaults unresolved conflicts to keep_existing (protect manual app edits)", () => {
    const merge = mergeRow({
      rowHash: "h_safe",
      fileRow: { amount: 200 },
      existingRow: { id: 10, amount: 150 },
      importSnapshot: { amount: 100 },
      fields: ["amount"],
    });
    expect(merge.outcomes.amount.type).toBe("conflict");

    const result = applyResolutions(merge, [], true);
    expect(result.amount).toBe(150);
  });
  it("throws on an unresolved conflict by default", () => {
    const merge = buildMerge();
    expect(() => applyResolutions(merge, [])).toThrow(/Unresolved conflict/);
  });

  it("falls back to keep_existing when defaultToKeepExisting=true", () => {
    const merge = buildMerge();
    const result = applyResolutions(merge, [], true);
    expect(result.a).toBe("from-db");
  });
});

describe("updateManualOverrides — lifecycle", () => {
  it("records a system-inferred override on keep_db", () => {
    const merge = mergeRow({
      rowHash: "h1",
      fileRow: { x: "v1" },
      existingRow: { id: 1, x: "user-edit" },
      importSnapshot: { x: "v1" },
      fields: ["x"],
    });
    const next = updateManualOverrides(null, merge, [], 42, new Date("2026-04-29T10:00:00Z"));
    expect(next.x).toBeDefined();
    expect(next.x.value).toBe("user-edit");
    expect(next.x.editedBy).toBe(42);
    expect(next.x.fromValue).toBe("v1");
  });

  it("removes a stale override when the source moves on (accept_file)", () => {
    const merge = mergeRow({
      rowHash: "h1",
      fileRow: { x: "v2" },
      existingRow: { id: 1, x: "v1" },
      importSnapshot: { x: "v1" },
      fields: ["x"],
    });
    const current = { x: { value: "old-edit", editedBy: 7, editedAt: "2026-01-01", fromValue: "v0" } };
    const next = updateManualOverrides(current, merge, [], 42);
    expect(next.x).toBeUndefined();
  });

  it("refreshes the override when conflict resolved as keep_existing", () => {
    const merge = mergeRow({
      rowHash: "h1",
      fileRow: { x: "from-file" },
      existingRow: { id: 1, x: "from-db" },
      importSnapshot: { x: "from-snapshot" },
      fields: ["x"],
    });
    expect(merge.outcomes.x.type).toBe("conflict");
    const next = updateManualOverrides(
      null,
      merge,
      [{ fieldName: "x", resolution: "keep_existing" }],
      42,
    );
    expect(next.x.value).toBe("from-db");
    expect(next.x.fromValue).toBe("from-snapshot");
    expect(next.x.editedBy).toBe(42);
  });

  it("removes an override when conflict resolved as accept_import or manual", () => {
    const merge = mergeRow({
      rowHash: "h1",
      fileRow: { x: "from-file" },
      existingRow: { id: 1, x: "from-db" },
      importSnapshot: { x: "from-snapshot" },
      fields: ["x"],
    });
    const current = { x: { value: "from-db", editedBy: 7, editedAt: "old", fromValue: "from-snapshot" } };
    const accepted = updateManualOverrides(current, merge, [
      { fieldName: "x", resolution: "accept_import" },
    ], 42);
    expect(accepted.x).toBeUndefined();

    const manual = updateManualOverrides(current, merge, [
      { fieldName: "x", resolution: "manual", value: "other" },
    ], 42);
    expect(manual.x).toBeUndefined();
  });
});
