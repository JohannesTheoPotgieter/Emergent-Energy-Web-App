/**
 * Smart Import v2 — structural invariants (§5)
 *
 * Pins the three invariants that were still unguarded after Replit's
 * recent Smart Import work:
 *
 *   1. The new preflight-validator (161 lines of pure logic added by
 *      Replit in d5064288) — runtime tests covering its three warning
 *      codes: DUPLICATE_PLANNED_REF, BLANK_OUTLINE_MILESTONE,
 *      MISSING_SOURCE_COORDINATES.
 *
 *   2. commit-executor.ts single-project scope — no code path should
 *      commit writes for a second project inside the same run. Today
 *      this is implicit; these source-text assertions catch anyone
 *      adding a multi-project write path by accident.
 *
 *   3. Scenario-table isolation — commit-executor must write to the
 *      canonical baseline tables (work_items, normalizedCostLines,
 *      normalizedRevenueLines) ONLY. The workingPlanScenario / scenario
 *      what-if tables are a separate concern and must not be touched by
 *      a Smart Import commit.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runPreflightValidator } from "../../../server/lib/import/preflight-validator";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("§5 preflight validator — runtime behaviour", () => {
  it("returns an empty result when given no tasks", () => {
    const r = runPreflightValidator(1, []);
    expect(r.warnings).toEqual([]);
    expect(r.plannedRefs).toEqual([]);
    expect(r.counts.totalPlannedRows).toBe(0);
    expect(r.counts.duplicatePlannedRefs).toBe(0);
    expect(r.counts.blankOutlineMilestones).toBe(0);
    expect(r.counts.missingSourceCoordinates).toBe(0);
  });

  it("tolerates null / undefined / non-array task input", () => {
    const empty = runPreflightValidator(1, null);
    expect(empty.counts.totalPlannedRows).toBe(0);
    const undef = runPreflightValidator(1, undefined);
    expect(undef.counts.totalPlannedRows).toBe(0);
    const bogus = runPreflightValidator(1, "not an array" as unknown as never);
    expect(bogus.counts.totalPlannedRows).toBe(0);
  });

  it("flags rows missing sourceSheet / sourceRow as MISSING_SOURCE_COORDINATES", () => {
    const r = runPreflightValidator(1, [
      { taskName: "No coords", taskNo: "1.1" },
      { taskName: "Only sheet", sourceSheet: "Sheet1" },
      { taskName: "Only row", sourceRow: 5 },
      { taskName: "Full", taskNo: "1.2", sourceSheet: "Sheet1", sourceRow: 3 },
    ]);
    expect(r.counts.missingSourceCoordinates).toBe(3);
    expect(r.warnings.some((w) => w.code === "MISSING_SOURCE_COORDINATES")).toBe(true);
    expect(r.plannedRefs).toHaveLength(1);
    expect(r.plannedRefs[0].taskName).toBe("Full");
  });

  it("flags milestone rows with no taskNo as BLANK_OUTLINE_MILESTONE", () => {
    const r = runPreflightValidator(1, [
      { taskName: "Milestone without number", isMilestone: true, sourceSheet: "S", sourceRow: 1 },
      { taskName: "Milestone with number", taskNo: "1.M", isMilestone: true, sourceSheet: "S", sourceRow: 2 },
      { taskName: "Regular task", taskNo: "1.1", isMilestone: false, sourceSheet: "S", sourceRow: 3 },
    ]);
    expect(r.counts.blankOutlineMilestones).toBe(1);
    const blanks = r.warnings.filter((w) => w.code === "BLANK_OUTLINE_MILESTONE");
    expect(blanks).toHaveLength(1);
    expect(blanks[0].taskName).toBe("Milestone without number");
  });

  it("flags duplicate planned refs as DUPLICATE_PLANNED_REF", () => {
    const r = runPreflightValidator(1, [
      { taskName: "A", taskNo: "1.1", sourceSheet: "S", sourceRow: 1 },
      { taskName: "B", taskNo: "1.1", sourceSheet: "S", sourceRow: 1 },
      { taskName: "C", taskNo: "1.2", sourceSheet: "S", sourceRow: 2 },
    ]);
    expect(r.counts.duplicatePlannedRefs).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.code === "DUPLICATE_PLANNED_REF")).toBe(true);
  });

  it("caps sampled warnings per code at the documented max (25)", () => {
    // 30 rows that all share the same planned ref → should produce one
    // DUPLICATE_PLANNED_REF warning (not 30). The counts.duplicatePlannedRefs
    // still reflects the raw count.
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      taskName: `Dup ${i}`,
      taskNo: "1.1",
      sourceSheet: "S",
      sourceRow: 1,
    }));
    const r = runPreflightValidator(1, tasks);
    expect(r.counts.duplicatePlannedRefs).toBe(30);
    const dupWarnings = r.warnings.filter((w) => w.code === "DUPLICATE_PLANNED_REF");
    expect(dupWarnings.length).toBeGreaterThan(0);
    expect(dupWarnings.length).toBeLessThanOrEqual(25);
  });

  it("counts.totalPlannedRows matches the input length, including unvalidatable rows", () => {
    const r = runPreflightValidator(1, [
      { taskName: "Good", taskNo: "1.1", sourceSheet: "S", sourceRow: 1 },
      { taskName: "Bad" },
      { taskName: "Bad 2" },
    ]);
    expect(r.counts.totalPlannedRows).toBe(3);
    expect(r.plannedRefs).toHaveLength(1);
  });

  it("accepts numeric string sourceRow values", () => {
    const r = runPreflightValidator(1, [
      { taskName: "Numeric string", taskNo: "1.1", sourceSheet: "S", sourceRow: "7" as any },
    ]);
    expect(r.counts.missingSourceCoordinates).toBe(0);
    expect(r.plannedRefs).toHaveLength(1);
  });
});

describe("§5 commit-executor — single-project write scope", () => {
  const src = read("server/lib/import/commit-executor.ts");

  it("every transaction insert into canonical tables is in a projectId-anchored block", () => {
    // Canonical tables Smart Import writes to:
    const canonical = ["workItems", "normalizedCostLines", "normalizedRevenueLines"];
    for (const table of canonical) {
      const pattern = new RegExp(
        String.raw`tx\.insert\(${table}\)\.values\(\{[\s\S]{0,400}?projectId`,
        "g",
      );
      const matches = src.match(pattern);
      const inserts = src.match(new RegExp(String.raw`tx\.insert\(${table}\)\.values\(`, "g"));
      if (inserts && inserts.length > 0) {
        expect(matches, `${table}: every values(...) block should reference projectId`).not.toBeNull();
        expect(matches!.length).toBe(inserts.length);
      }
    }
  });

  it("PR2C — missing rows are soft-closed via the hash-cleanup sweep, not hard-deleted", () => {
    // PR2C replaced the "keep missing rows indefinitely" policy with a
    // hash-based end-of-pass sweep that soft-closes any active row whose
    // row_hash is no longer in the workbook. Soft-close means
    // effectiveTo / deletedAt — never tx.delete().
    expect(src).toMatch(/end-of-pass cleanup/i);
    expect(src).toMatch(/seenRowHashes/);
    expect(src).not.toMatch(/tx\.delete\(workItems\)/);
    expect(src).not.toMatch(/tx\.delete\(normalizedCostLines\)/);
    expect(src).not.toMatch(/tx\.delete\(normalizedRevenueLines\)/);
  });

  it("temporal tables are soft-closed with effectiveTo, never hard-deleted", () => {
    expect(src).toMatch(/normalizedCostLines[\s\S]{0,300}effectiveTo:\s*commitTimestamp/);
    expect(src).toMatch(/normalizedRevenueLines[\s\S]{0,300}effectiveTo:\s*commitTimestamp/);
    // Guard against a regression: no tx.delete(normalizedCostLines) or similar.
    expect(src).not.toMatch(/tx\.delete\(normalizedCostLines\)/);
    expect(src).not.toMatch(/tx\.delete\(normalizedRevenueLines\)/);
  });

  it("commit-executor does not import or reference the what-if scenario tables", () => {
    // workingPlanScenario and its child tables are for scenario analysis,
    // NOT for Smart Import writes. Importing them would be the canary.
    expect(src).not.toMatch(/workingPlanScenario/);
    expect(src).not.toMatch(/scenario_id/);
    expect(src).not.toMatch(/from\s+["']@shared\/schema\/scenarios/);
  });

  it("EXPENDITURE row hash uses invoice-line identity before duplicate skips", () => {
    expect(src).toMatch(/amountExVat:\s*f\.amountExVat/);
    expect(src).toMatch(/invoiceDate:\s*f\.invoiceDate/);
    expect(src).toMatch(/same description, invoice amount, invoice number, and invoice date/);
    expect(src).toMatch(/shouldRefreshUnchangedExpenditure/);
    expect(src).toMatch(/needsMetadataRefresh/);
    expect(src).toMatch(/mr\.classification === "UNCHANGED"/);
  });
});

describe("§5 scenario-table isolation across import pipeline", () => {
  const pipelineFiles = [
    "server/lib/import/commit-executor.ts",
    "server/lib/import/planner.ts",
    "server/lib/import/row-matcher.ts",
    "server/lib/import/normalizer.ts",
    "server/lib/import/conflict-engine.ts",
    "server/lib/import/derivative-materializer.ts",
    "server/lib/import/preflight-validator.ts",
    "server/smart-import-routes.ts",
  ];

  it("no import-pipeline file touches workingPlanScenario", () => {
    for (const p of pipelineFiles) {
      const text = read(p);
      expect(text, `${p} must not reference workingPlanScenario`).not.toMatch(/workingPlanScenario/);
    }
  });
});
