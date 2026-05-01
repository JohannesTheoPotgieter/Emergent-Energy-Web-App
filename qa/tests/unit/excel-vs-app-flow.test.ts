/**
 * Excel-vs-App end-to-end flow — DB-backed integration test.
 *
 * Exercises the full life cycle in one suite:
 *   1. Seed a project + a normalized_cost_lines row with an
 *      import_snapshot ("the import already happened").
 *   2. Operator cell-edit — applyManualOverride — and assert the
 *      live column is unchanged + manual_overrides JSONB is set.
 *   3. getDriftDetail surfaces the row as `verified` drift.
 *   4. clearManualOverride (= "Accept Excel" path on the diff
 *      page) clears the entry; getDriftDetail sees `none` again.
 *   5. Re-apply the override, then a second cell-edit on the same
 *      field — assert fromValue stays the ORIGINAL Excel-truth.
 *
 * Gated on `DATABASE_URL` because the SQLite dev fallback's
 * bootstrap DDL omits columns the seed insert needs. Runs against
 * postgres dev / staging.
 *
 * The 5-step shape mirrors the manual smoke checklist in PR #760's
 * test plan; this test catches the same regressions automatically.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Excel-vs-App flow — end-to-end (DB-backed)", () => {
  let dbModule: typeof import("../../../server/db");
  let helpers: typeof import("../../../server/lib/manual-overrides");
  let financeSchema: typeof import("../../../shared/schema/finance");
  let projectsSchema: typeof import("../../../shared/schema/projects");
  let trackerReplicaRepository: typeof import("../../../server/repositories/tracker-replica-repository").trackerReplicaRepository;

  let projectId: number;
  let costRowId: number;
  const MARKER = `__excel_vs_app_flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    helpers = await import("../../../server/lib/manual-overrides");
    financeSchema = await import("../../../shared/schema/finance");
    projectsSchema = await import("../../../shared/schema/projects");
    trackerReplicaRepository = (await import("../../../server/repositories/tracker-replica-repository")).trackerReplicaRepository;

    const [p] = await dbModule.db
      .insert(projectsSchema.projectInfo)
      .values({ projectName: MARKER })
      .returning({ id: projectsSchema.projectInfo.id });
    projectId = p.id;

    const importSnapshot = {
      amountExVat: "1500.00",
      invoiceNumber: "INV-100",
      status: "approved",
    };

    const [row] = await dbModule.db
      .insert(financeSchema.normalizedCostLines)
      .values({
        projectId,
        projectName: MARKER,
        description: "Test cost line",
        amountExVat: "1500.00",
        invoiceNumber: "INV-100",
        status: "approved",
        importSnapshot,
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

  it("step 1: seed row reads as no-drift initially", async () => {
    const detail = await trackerReplicaRepository.getDriftDetail(projectId);
    const myRow = detail.costLines.find(r => r.id === costRowId);
    expect(myRow).toBeDefined();
    const amountField = myRow!.fields.find(f => f.fieldName === "amountExVat");
    expect(amountField?.drift).toBe("none");
    expect(amountField?.liveValue).toBe("1500.00");
    expect(amountField?.snapshotValue).toBe("1500.00");
    expect(amountField?.overrideValue).toBeNull();
    // Backfill counter is zero for this project's cost section.
    expect(detail.legacyRowsWithoutSnapshot.EXPENDITURE).toBe(0);
  });

  it("step 2: applyManualOverride leaves live column intact and populates JSONB", async () => {
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1700.00",
      editedBy: 1,
    });
    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);
    expect(row.amountExVat).toBe("1500.00"); // live column unchanged
    expect((row.manualOverrides as any).amountExVat.value).toBe("1700.00");
    expect((row.manualOverrides as any).amountExVat.fromValue).toBe("1500.00");
  });

  it("step 3: getDriftDetail classifies as verified drift", async () => {
    const detail = await trackerReplicaRepository.getDriftDetail(projectId);
    const myRow = detail.costLines.find(r => r.id === costRowId);
    const amountField = myRow!.fields.find(f => f.fieldName === "amountExVat");
    expect(amountField?.drift).toBe("verified");
    expect(amountField?.overrideValue).toBe("1700.00");
    expect(detail.summary.EXPENDITURE.verified).toBeGreaterThanOrEqual(1);
  });

  it("step 4: clearManualOverride reverts row to none drift", async () => {
    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
    const detail = await trackerReplicaRepository.getDriftDetail(projectId);
    const myRow = detail.costLines.find(r => r.id === costRowId);
    const amountField = myRow!.fields.find(f => f.fieldName === "amountExVat");
    expect(amountField?.drift).toBe("none");
    expect(amountField?.overrideValue).toBeNull();
    expect(amountField?.liveValue).toBe("1500.00");
  });

  it("step 5: repeat override preserves original fromValue across edits", async () => {
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1700.00",
      editedBy: 1,
    });
    await new Promise(r => setTimeout(r, 5));
    await helpers.applyManualOverride({
      table: "normalized_cost_lines",
      rowId: costRowId,
      fieldName: "amountExVat",
      value: "1900.00",
      editedBy: 2,
      note: "Operator confirmed via email",
    });
    const overrides = await helpers.getManualOverrides("normalized_cost_lines", costRowId);
    expect(overrides.amountExVat.value).toBe("1900.00");
    expect(overrides.amountExVat.editedBy).toBe(2);
    expect(overrides.amountExVat.note).toBe("Operator confirmed via email");
    // fromValue STILL the original Excel-truth, not the prior override.
    expect(overrides.amountExVat.fromValue).toBe("1500.00");

    // Live column STILL untouched.
    const [row] = await dbModule.db
      .select()
      .from(financeSchema.normalizedCostLines)
      .where(eq(financeSchema.normalizedCostLines.id, costRowId))
      .limit(1);
    expect(row.amountExVat).toBe("1500.00");

    // Cleanup so the suite is idempotent.
    await helpers.clearManualOverride("normalized_cost_lines", costRowId, "amountExVat");
  });

  it("step 6: row with NULL import_snapshot is counted as legacy in the diff response", async () => {
    // Create a second row without import_snapshot to verify the
    // backfill-pending counter.
    const [legacyRow] = await dbModule.db
      .insert(financeSchema.normalizedCostLines)
      .values({
        projectId,
        projectName: MARKER,
        description: "Legacy row, no snapshot",
        amountExVat: "999.00",
        // importSnapshot deliberately omitted
      } as any)
      .returning({ id: financeSchema.normalizedCostLines.id });
    try {
      const detail = await trackerReplicaRepository.getDriftDetail(projectId);
      expect(detail.legacyRowsWithoutSnapshot.EXPENDITURE).toBeGreaterThanOrEqual(1);
    } finally {
      await dbModule.db
        .delete(financeSchema.normalizedCostLines)
        .where(eq(financeSchema.normalizedCostLines.id, legacyRow.id));
    }
  });
});
