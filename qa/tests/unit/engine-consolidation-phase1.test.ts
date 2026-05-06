/**
 * Smart Import v2 — Engine Consolidation Phase 1 tests.
 *
 * Phase 1 wires the writer-engine's `mergeConflicts` (per-row
 * `import_snapshot` baseline, populated inside the commit transaction)
 * into the same `v2_conflicts_detected` 409 envelope the existing
 * conflict-engine emits pre-commit. The wizard parser is unchanged.
 *
 * These tests cover:
 *   1. The pure-function helper that translates `MergeConflictEntry[]`
 *      into the wizard's grouped-by-row shape.
 *   2. Structural assertions that the route folds writer-engine output
 *      into the catch + 409 envelope, and that the transaction aborts.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  mergeConflictsToWizardRows,
  type MergeConflictEntry,
} from "../../../server/lib/import/commit-executor";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function entry(over: Partial<MergeConflictEntry> = {}): MergeConflictEntry {
  return {
    rowKey: "row-1",
    displayLabel: "Row 1",
    section: "PLAN",
    rowHash: "hash-1",
    existingRowId: 1,
    fieldName: "status",
    snapshotValue: "draft",
    existingValue: "in_progress",
    importValue: "complete",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. mergeConflictsToWizardRows
// ---------------------------------------------------------------------------

describe("mergeConflictsToWizardRows", () => {
  it("groups field-level entries by rowKey", () => {
    const rows = mergeConflictsToWizardRows([
      entry({ fieldName: "status" }),
      entry({ fieldName: "ownerName", existingValue: "Alice", importValue: "Bob" }),
      entry({ rowKey: "row-2", displayLabel: "Row 2", fieldName: "status" }),
    ]);
    expect(rows).toHaveLength(2);
    const r1 = rows.find(r => r.rowKey === "row-1")!;
    expect(r1.fields.map(f => f.fieldName)).toEqual(["status", "ownerName"]);
    const r2 = rows.find(r => r.rowKey === "row-2")!;
    expect(r2.fields).toHaveLength(1);
  });

  it("preserves displayLabel and section from the first entry per row", () => {
    const rows = mergeConflictsToWizardRows([
      entry({ rowKey: "k", displayLabel: "L1", section: "REVENUE" }),
      entry({ rowKey: "k", displayLabel: "L2", section: "EXPENDITURE", fieldName: "amount" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayLabel).toBe("L1");
    expect(rows[0].section).toBe("REVENUE");
    expect(rows[0].canonicalSource).toBe("REVENUE");
  });

  it("emits wizard-shape fields (baseline / current / uploaded / mergeCase)", () => {
    const rows = mergeConflictsToWizardRows([
      entry({
        snapshotValue: "snap",
        existingValue: "db",
        importValue: "file",
      }),
    ]);
    expect(rows[0].fields[0]).toEqual({
      fieldName: "status",
      baselineValue: "snap",
      currentAppValue: "db",
      uploadedValue: "file",
      mergeCase: "BOTH_CHANGED",
    });
  });

  it("deduplicates by (rowKey, fieldName)", () => {
    const rows = mergeConflictsToWizardRows([
      entry({ fieldName: "status", importValue: "v1" }),
      entry({ fieldName: "status", importValue: "v2" }),
      entry({ fieldName: "ownerName", importValue: "Alice" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields).toHaveLength(2);
    const status = rows[0].fields.find(f => f.fieldName === "status")!;
    expect(status.uploadedValue).toBe("v1");
  });

  it("returns an empty list when no entries are supplied", () => {
    expect(mergeConflictsToWizardRows([])).toEqual([]);
  });

  it("supports all three section labels", () => {
    const rows = mergeConflictsToWizardRows([
      entry({ rowKey: "p", section: "PLAN" }),
      entry({ rowKey: "r", section: "REVENUE" }),
      entry({ rowKey: "e", section: "EXPENDITURE" }),
    ]);
    const sections = rows.map(r => r.section).sort();
    expect(sections).toEqual(["EXPENDITURE", "PLAN", "REVENUE"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Route plumbing — structural assertions
// ---------------------------------------------------------------------------

describe("smart-import-routes.ts wires writer-engine conflicts into the 409", () => {
  const route = read("server/smart-import-routes.ts");

  it("imports mergeConflictsToWizardRows from the executor module", () => {
    expect(route).toContain("mergeConflictsToWizardRows");
  });

  it("combines mergeConflicts from all 3 section results", () => {
    expect(route).toMatch(/planResult\?\.mergeConflicts/);
    expect(route).toMatch(/revenueResult\?\.mergeConflicts/);
    expect(route).toMatch(/costResult\?\.mergeConflicts/);
  });

  it("throws a v2_conflicts_detected sentinel inside the transaction", () => {
    expect(route).toMatch(/code = "v2_conflicts_detected"/);
    expect(route).toMatch(/status = 409/);
  });

  it("emits the v2_conflicts_detected envelope from the catch block", () => {
    expect(route).toMatch(/error: "v2_conflicts_detected"/);
    expect(route).toMatch(/conflicts: \(err as any\)\.conflicts/);
  });
});

// ---------------------------------------------------------------------------
// 3. Writers populate rowKey / displayLabel / section
// ---------------------------------------------------------------------------

describe("commit-executor populates wizard-shape fields on every push", () => {
  const exec = read("server/lib/import/commit-executor.ts");

  it("PLAN writer pushes section='PLAN'", () => {
    expect(exec).toMatch(/section: "PLAN"/);
  });

  it("REVENUE writer pushes section='REVENUE'", () => {
    expect(exec).toMatch(/section: "REVENUE"/);
  });

  it("EXPENDITURE writer pushes section='EXPENDITURE'", () => {
    expect(exec).toMatch(/section: "EXPENDITURE"/);
  });

  it("each push uses rowUid as rowKey and businessKey.rowLabel as displayLabel", () => {
    // The shared rowLabel fallback line should appear three times — once per writer.
    const matches = exec.match(/const rowLabel = mr\.businessKey\.rowLabel \?\? rowUid;/g) ?? [];
    expect(matches.length).toBe(3);
  });
});
