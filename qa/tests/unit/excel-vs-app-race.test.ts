/**
 * Race-condition tests for the Excel-vs-App resolve flow.
 *
 * Two concurrent-edit scenarios:
 *   1. Two operators independently call applyManualOverride on
 *      the same field. Last-write-wins is acceptable; the
 *      invariant is that the resulting row is consistent (one
 *      override entry, fromValue = original Excel-truth).
 *   2. An operator's resolve runs while a second background job
 *      writes to the same row. The transaction wrapping in
 *      excel-vs-app.routes.ts should mean the operator's bulk
 *      action either wholly succeeds or wholly rolls back, never
 *      half-applies.
 *
 * Gated on DATABASE_URL — postgres provides real concurrent
 * isolation (REPEATABLE READ); SQLite's bootstrap doesn't.
 *
 * The merge-engine's interaction with concurrent overrides (a
 * re-import while a resolve is in flight) is harder to simulate
 * in a unit test — the merge engine reads the row's import_
 * snapshot at commit-executor write time, so a parallel cell-edit
 * either lands before or after the import depending on lock
 * order. That scenario is documented in
 * docs/runbooks/excel-vs-app.md as the "concurrent re-import"
 * failure mode and is best validated by load test, not unit test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Excel-vs-App race conditions (DB-backed)", () => {
  let dbModule: typeof import("../../../server/db");
  let helpers: typeof import("../../../server/lib/manual-overrides");
  let financeSchema: typeof import("../../../shared/schema/finance");
  let projectsSchema: typeof import("../../../shared/schema/projects");

  let projectId: number;
  let costRowId: number;
  const MARKER = `__excel_vs_app_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    helpers = await import("../../../server/lib/manual-overrides");
    financeSchema = await import("../../../shared/schema/finance");
    projectsSchema = await import("../../../shared/schema/projects");

    const [p] = await dbModule.db
      .insert(projectsSchema.projectInfo)
      .values({ projectName: MARKER })
      .returning({ id: projectsSchema.projectInfo.id });
    projectId = p.id;

    const [row] = await dbModule.db
      .insert(financeSchema.normalizedCostLines)
      .values({
        projectId,
        projectName: MARKER,
        description: "Race test cost line",
        amountExVat: "1500.00",
        importSnapshot: { amountExVat: "1500.00" },
      } as any)
      .returning({ id: financeSchema.normalizedCostLines.id });
    costRowId = row.id;
  });

  afterAll(async () => {
    if (costRowId) {
      await dbModule.db
        .delete(financeSchema.normalizedCostLines)
        .where(eq(financeSchema.normalizedCostLines.id, costRowId));
    }
    if (projectId) {
      await dbModule.db
        .delete(projectsSchema.projectInfo)
        .where(eq(projectsSchema.projectInfo.id, projectId));
    }
  });

  it("two parallel applyManualOverride calls on same field: row stays consistent", async () => {
    // Both operators race to override amountExVat. The DB row should
    // end up with exactly one override entry whose value is one of the
    // two operators' values, and fromValue is the ORIGINAL Excel-truth
    // (not a value from an intermediate state).
    await Promise.all([
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: costRowId,
        fieldName: "amountExVat",
        value: "1700.00",
        editedBy: 1,
      }),
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: costRowId,
        fieldName: "amountExVat",
        value: "1900.00",
        editedBy: 2,
      }),
    ]);

    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);

    // Live column ALWAYS unchanged.
    expect(row.amountExVat).toBe("1500.00");

    const overrides = (row.manualOverrides as any) ?? {};
    expect(overrides.amountExVat).toBeDefined();
    // One of the two operator values won.
    expect(["1700.00", "1900.00"]).toContain(overrides.amountExVat.value);
    // fromValue is the original Excel-truth.
    expect(overrides.amountExVat.fromValue).toBe("1500.00");
    // editedBy is 1 or 2, whichever wrote last.
    expect([1, 2]).toContain(overrides.amountExVat.editedBy);

    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
  });

  it("parallel applyManualOverride on DIFFERENT fields: both succeed", async () => {
    // No conflict — two different fields on the same row.
    await Promise.all([
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: costRowId,
        fieldName: "amountExVat",
        value: "1700.00",
        editedBy: 1,
      }),
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: costRowId,
        fieldName: "invoiceNumber",
        value: "INV-NEW",
        editedBy: 2,
      }),
    ]);

    const overrides = await helpers.getManualOverrides("normalized_cost_lines", costRowId);
    // Both fields should be present after parallel writes. With
    // optimistic non-locked writes there's a small window where
    // a write could clobber a sibling field's entry — this test
    // catches that regression. If it fails, the helper needs a
    // SELECT…FOR UPDATE or a JSONB merge expression.
    expect(overrides.amountExVat).toBeDefined();
    expect(overrides.invoiceNumber).toBeDefined();
    expect(overrides.amountExVat.value).toBe("1700.00");
    expect(overrides.invoiceNumber.value).toBe("INV-NEW");

    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "invoiceNumber");
  });

  it("parallel apply + clear on same field: row stays consistent (last-write-wins)", async () => {
    // Seed an override.
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1700.00",
      editedBy: 1,
    });

    // One operator clears, another applies — race them.
    await Promise.all([
      helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat"),
      helpers.applyManualOverride({
        table: "normalized_cost_lines",
        rowId: costRowId,
        fieldName: "amountExVat",
        value: "1900.00",
        editedBy: 2,
      }),
    ]);

    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);

    // Live column ALWAYS unchanged regardless of who won.
    expect(row.amountExVat).toBe("1500.00");

    const overrides = (row.manualOverrides as any) ?? {};
    // Either the apply won (entry exists with value 1900) or the
    // clear won (entry absent). Both are consistent end states.
    if (overrides.amountExVat) {
      expect(overrides.amountExVat.value).toBe("1900.00");
      expect(overrides.amountExVat.fromValue).toBe("1500.00");
      await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
    }
  });
});
