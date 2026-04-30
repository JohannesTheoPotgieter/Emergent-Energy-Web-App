/**
 * Tracker Replica integration tests.
 *
 * Wires the merge engine + row hasher + conflict policy together to
 * pin the cross-module contracts. These are NOT pure-function tests
 * (those live in merge-engine.test.ts and row-hasher.test.ts) — they
 * verify the seams:
 *
 *   1. The same logical row across two imports produces the same
 *      hash, so the merge engine matches them.
 *   2. import_snapshot from import N is the ancestor for the merge
 *      against import N+1.
 *   3. valuesEqual semantics line up with how the conflict-policy
 *      module compares fields.
 *   4. The PR2A canonical fields are present on every section's
 *      compare list (so a manual edit on them surfaces a conflict).
 *   5. Route registry exposes the tracker-replica + manual-overrides
 *      paths.
 */

import { describe, it, expect } from "vitest";
import {
  hashPlanRow,
  hashRevenueRow,
  hashExpenditureRow,
  hashActualRow,
} from "../../../server/lib/import/row-hasher";
import {
  mergeRow,
  applyResolutions,
  updateManualOverrides,
  valuesEqual,
} from "../../../server/lib/import/merge-engine";
import {
  PLAN_COMPARE_FIELDS,
  REVENUE_COMPARE_FIELDS,
  EXPENDITURE_COMPARE_FIELDS,
} from "../../../server/lib/import/row-matcher";
import { detectConflicts } from "../../../server/imports/import-conflict-policy";
import { threeWayMergeEnabled, newImportMetrics } from "../../../server/lib/import/feature-flags";
import fs from "node:fs";

describe("hash + merge — same logical row across two imports", () => {
  it("PLAN: a re-import of an unchanged row matches by hash and produces no material change", () => {
    const projectId = 7;
    const row1 = { projectId, wbsCode: "1.2.3", title: "Install panels" };
    const row2 = { projectId, wbsCode: "1.2.3", title: "Install panels (typo fixed)" };

    expect(hashPlanRow(row1)).toBe(hashPlanRow(row2)); // title is tie-breaker only when WBS missing

    // After import N: snapshot captured.
    const snapshot = { startDate: "2026-04-01", endDate: "2026-04-30", duration: 30 };
    // Import N+1: same workbook reloaded — file row identical, db row identical.
    const merge = mergeRow({
      rowHash: hashPlanRow(row1),
      fileRow: { ...snapshot },
      existingRow: { id: 99, ...snapshot },
      importSnapshot: snapshot,
      fields: ["startDate", "endDate", "duration"],
    });

    expect(merge.hasMaterialChanges).toBe(false);
    expect(merge.hasConflicts).toBe(false);
    expect(merge.outcomes.startDate.type).toBe("no_change");
  });

  it("REVENUE: idempotent re-import keeps the same hash and skips writes", () => {
    const a = hashRevenueRow({ projectId: 5, milestoneNo: "3" });
    const b = hashRevenueRow({ projectId: 5, milestoneNo: "3" });
    expect(a).toBe(b);
    expect(a).not.toBe(hashRevenueRow({ projectId: 5, milestoneNo: "4" }));
  });

  it("EXPENDITURE: stable hash across re-imports survives invoice-batch matching", () => {
    const ident = { projectId: 7, categoryKey: "1. Panels", description: "Panels Budget", invoiceNumber: "INV-001" };
    expect(hashExpenditureRow(ident)).toBe(hashExpenditureRow(ident));
  });

  it("ACTUAL: 1:N batches each get a distinct hash under the same parent", () => {
    const a = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV-A", invoiceDate: "2026-04-01" });
    const b = hashActualRow({ costLineId: 100, actualNo: 2, invoiceNumber: "INV-A", invoiceDate: "2026-04-01" });
    const c = hashActualRow({ costLineId: 100, actualNo: 1, invoiceNumber: "INV-A", invoiceDate: "2026-05-01" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("snapshot lineage — N+1 sees N's snapshot as ancestor", () => {
  it("manual edit on a previously-imported field becomes keep_db on next import", () => {
    // Import N writes amount=100 to db; snapshot captures amount=100.
    const snapshot = { amount: 100, notes: null };
    // User manually edits amount=150 in app between imports.
    const dbAfterEdit = { id: 1, amount: 150, notes: null };
    // Import N+1: file unchanged (still 100).
    const merge = mergeRow({
      rowHash: "h",
      fileRow: { amount: 100, notes: null },
      existingRow: dbAfterEdit,
      importSnapshot: snapshot,
      fields: ["amount", "notes"],
    });
    expect(merge.outcomes.amount.type).toBe("keep_db");
    expect(merge.hasConflicts).toBe(false);
    expect(merge.hasMaterialChanges).toBe(false);
  });

  it("manual edit + workbook change on the same field surfaces a conflict", () => {
    const snapshot = { amount: 100 };
    const dbAfterEdit = { id: 1, amount: 150 };
    const merge = mergeRow({
      rowHash: "h",
      fileRow: { amount: 200 },
      existingRow: dbAfterEdit,
      importSnapshot: snapshot,
      fields: ["amount"],
    });
    expect(merge.hasConflicts).toBe(true);
    expect(merge.outcomes.amount).toEqual({
      type: "conflict",
      snapshot: 100,
      db: 150,
      file: 200,
    });
  });
});

describe("valuesEqual semantics align with conflict-policy", () => {
  it("string-vs-number comparison is symmetric", () => {
    expect(valuesEqual("100.00", 100)).toBe(valuesEqual(100, "100.00"));
  });
  it("trim + casing absorbed both ways", () => {
    expect(valuesEqual("  Mondi  ", "MONDI")).toBe(true);
  });
  it("conflict-policy detectConflicts uses the same equality (smoke)", () => {
    // Pre-existing API: returns ImportConflict[] when values differ.
    const conflicts = detectConflicts(
      [{ id: 1, amount: "100.00" }],
      [{ id: 1, amount: 100, updatedAt: new Date() }] as any,
      new Date(0),
      ["id"],
      ["amount"],
      "normalized_revenue_lines",
    );
    // amount is "100.00" vs 100 — these should be EQUAL under merge-engine
    // semantics, so detectConflicts wraps via mergeRow and returns no conflict.
    expect(conflicts).toEqual([]);
  });
});

describe("PR2A canonical fields participate in conflict detection", () => {
  it("PLAN compare list includes lead, resource_1, resource_2, tracker_comments, work_days", () => {
    expect(PLAN_COMPARE_FIELDS).toContain("lead");
    expect(PLAN_COMPARE_FIELDS).toContain("resource1");
    expect(PLAN_COMPARE_FIELDS).toContain("resource2");
    expect(PLAN_COMPARE_FIELDS).toContain("trackerComments");
    expect(PLAN_COMPARE_FIELDS).toContain("workDays");
  });
  it("REVENUE compare list includes milestoneNotes", () => {
    expect(REVENUE_COMPARE_FIELDS).toContain("milestoneNotes");
  });
  it("EXPENDITURE compare list includes actualQty, actualRate, comments, checkFlag, savingOverrun, usdExchangeRate, pricePerWatt", () => {
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("actualQty");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("actualRate");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("comments");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("checkFlag");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("savingOverrun");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("usdExchangeRate");
    expect(EXPENDITURE_COMPARE_FIELDS).toContain("pricePerWatt");
  });
});

describe("route registry exposes the new endpoints", () => {
  // Source-level pin — confirms the orphan-routes fix in
  // register-all-routes.ts didn't regress, and the tracker-replica + manual-
  // overrides paths are reachable from the bootstrap.
  const routeRegistry = fs.readFileSync("server/routes/register-all-routes.ts", "utf8");
  const trackerReplicaRoutes = fs.readFileSync("server/routes/tracker-replica.routes.ts", "utf8");
  const indexRoutes = fs.readFileSync("server/routes/index.ts", "utf8");

  it("register-all-routes routes through the orphan registry (not the legacy shell directly)", () => {
    expect(routeRegistry).toMatch(/from\s+["']\.\/index["']/);
  });

  it("orphan registry imports + calls registerTrackerReplicaRoutes", () => {
    expect(indexRoutes).toMatch(/registerTrackerReplicaRoutes/);
  });

  it("tracker-replica routes file exposes the 4 expected paths", () => {
    expect(trackerReplicaRoutes).toContain("/api/tracker-replica/:projectId/revenue-tracking");
    expect(trackerReplicaRoutes).toContain("/api/tracker-replica/:projectId/expenditure-breakdown");
    expect(trackerReplicaRoutes).toContain("/api/tracker-replica/:projectId/program-plan");
    expect(trackerReplicaRoutes).toContain("/api/tracker-replica/:projectId/manual-overrides");
  });

  it("every route is auth-gated via requireAuth", () => {
    const matches = trackerReplicaRoutes.match(/app\.get\(/g);
    const requireAuthCount = (trackerReplicaRoutes.match(/requireAuth/g) ?? []).length;
    expect(matches?.length).toBeGreaterThan(0);
    expect(requireAuthCount).toBeGreaterThanOrEqual(matches!.length);
  });
});

describe("feature flag + metrics", () => {
  it("threeWayMergeEnabled defaults to ON", () => {
    const prev = process.env.USE_THREE_WAY_MERGE;
    delete process.env.USE_THREE_WAY_MERGE;
    expect(threeWayMergeEnabled()).toBe(true);
    if (prev !== undefined) process.env.USE_THREE_WAY_MERGE = prev;
  });
  it("threeWayMergeEnabled honours USE_THREE_WAY_MERGE=false", () => {
    const prev = process.env.USE_THREE_WAY_MERGE;
    process.env.USE_THREE_WAY_MERGE = "false";
    expect(threeWayMergeEnabled()).toBe(false);
    process.env.USE_THREE_WAY_MERGE = "0";
    expect(threeWayMergeEnabled()).toBe(false);
    process.env.USE_THREE_WAY_MERGE = "no";
    expect(threeWayMergeEnabled()).toBe(false);
    if (prev === undefined) delete process.env.USE_THREE_WAY_MERGE;
    else process.env.USE_THREE_WAY_MERGE = prev;
  });
  it("newImportMetrics produces a counter shape ready for emission", () => {
    const m = newImportMetrics(42, 7);
    expect(m.importRunId).toBe(42);
    expect(m.projectId).toBe(7);
    expect(m.plan.inserted).toBe(0);
    expect(m.actuals.inserted).toBe(0);
    expect(typeof m.threeWayMergeEnabled).toBe("boolean");
  });
});

describe("apply + override lifecycle (round-trip)", () => {
  it("conflict resolved as keep_existing produces the db value AND records a manual override", () => {
    const merge = mergeRow({
      rowHash: "h",
      fileRow: { x: "FILE" },
      existingRow: { id: 1, x: "DB" },
      importSnapshot: { x: "SNAP" },
      fields: ["x"],
    });
    const final = applyResolutions(merge, [{ fieldName: "x", resolution: "keep_existing" }]);
    expect(final.x).toBe("DB");

    const overrides = updateManualOverrides(
      null,
      merge,
      [{ fieldName: "x", resolution: "keep_existing" }],
      99,
      new Date("2026-04-29T10:00:00Z"),
    );
    expect(overrides.x).toMatchObject({
      value: "DB",
      editedBy: 99,
      fromValue: "SNAP",
    });
  });
});
