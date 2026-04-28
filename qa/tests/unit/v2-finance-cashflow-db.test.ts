// Behavioral DB-backed regression test — Task #124.
//
// Companion to `v2-finance-cashflow-enum-case.test.ts` (which inspects the
// generated SQL via `.toSQL()`). This file exercises the full repository
// function against the live Postgres connection with seeded fixtures, and
// asserts that `actual` (the SUM of approved + paid amounts) is non-zero
// — the symptom the validator wanted pinned: any future regression that
// re-introduces UPPERCASE enum literals would fail HERE before the
// endpoint ever reaches a user.
//
// Strategy:
//   • Skip the test gracefully if DATABASE_URL is unset (CI without PG).
//   • Create an isolated test project + import run with a marker name so
//     parallel test runs cannot collide.
//   • Insert two normalized_cost_lines: one `approved`, one `paid`.
//   • Call `getFinanceCashflow(projectId)` and assert the aggregate row
//     for each status carries the seeded amount and that the combined
//     `actual` across approved+paid is > 0.
//   • Cleanup is unconditional: DELETE on project_info cascades to cost
//     lines, then drop the import run.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("v2 finance cashflow — DB-backed behavioral guard (Task #124)", () => {
  // Use module namespaces (not destructured snapshots) because `db` is a
  // `let` in `server/db.ts` that only gets assigned inside
  // `initializeDatabase()` — destructuring before init captures `undefined`.
  let dbModule: typeof import("../../../server/db");
  let financeSchema: typeof import("../../../shared/schema/finance");
  let importsSchema: typeof import("../../../shared/schema/imports");
  let projectsSchema: typeof import("../../../shared/schema/projects");
  let repo: typeof import("../../../server/api/v2/repositories/project-v2-repository");

  let projectId: number;
  let importRunId: number;
  const MARKER = `__task_124_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

  beforeAll(async () => {
    // Lazy imports so the module-level db connection only opens when this
    // suite actually runs (it's `describe.skip`'d when DATABASE_URL is unset).
    dbModule = await import("../../../server/db");
    financeSchema = await import("../../../shared/schema/finance");
    importsSchema = await import("../../../shared/schema/imports");
    projectsSchema = await import("../../../shared/schema/projects");
    await dbModule.initializeDatabase();
    // Re-import the repository AFTER the db module has been initialized so
    // its top-level `import { db }` binding resolves to the live drizzle
    // instance.
    repo = await import("../../../server/api/v2/repositories/project-v2-repository");

    const [p] = await dbModule.db
      .insert(projectsSchema.projectInfo)
      .values({ projectName: MARKER })
      .returning({ id: projectsSchema.projectInfo.id });
    projectId = p.id;

    const [r] = await dbModule.db
      .insert(importsSchema.smartImportRuns)
      .values({ sourceFileName: MARKER })
      .returning({ id: importsSchema.smartImportRuns.id });
    importRunId = r.id;

    await dbModule.db.insert(financeSchema.normalizedCostLines).values([
      {
        projectId,
        projectName: MARKER,
        amountExVat: "1000.00",
        status: "approved",
        importRunId,
      },
      {
        projectId,
        projectName: MARKER,
        amountExVat: "500.00",
        status: "paid",
        importRunId,
      },
      {
        // Sanity: a `planned` row should NOT contribute to `actual`.
        projectId,
        projectName: MARKER,
        amountExVat: "9999.00",
        status: "planned",
        importRunId,
      },
    ]);
  });

  afterAll(async () => {
    if (!dbModule?.db) return;
    // The Drizzle schema declares `onDelete: cascade` on
    // normalized_cost_lines.project_id, but the production FK constraint
    // does not enforce it (legacy migration). Delete children first so the
    // parent delete doesn't trip the FK and leave orphan rows behind.
    if (projectId) {
      await dbModule.db
        .delete(financeSchema.normalizedCostLines)
        .where(eq(financeSchema.normalizedCostLines.projectId, projectId));
      await dbModule.db
        .delete(projectsSchema.projectInfo)
        .where(eq(projectsSchema.projectInfo.id, projectId));
    }
    if (importRunId) {
      await dbModule.db
        .delete(importsSchema.smartImportRuns)
        .where(eq(importsSchema.smartImportRuns.id, importRunId));
    }
  });

  it("does NOT throw an enum-input error and returns aggregated rows", async () => {
    // Before the Task #124 fix, this call raised
    //   `invalid input value for enum cost_line_status: "APPROVED"`
    // which the v2 asyncHandler turned into a 500 + UI toast.
    const rows = await repo.getFinanceCashflow(projectId);
    expect(Array.isArray(rows)).toBe(true);
    // 3 distinct statuses seeded → 3 GROUP BY buckets.
    expect(rows.length).toBe(3);
  });

  it("aggregates approved + paid into non-zero actual amounts", async () => {
    const rows = await repo.getFinanceCashflow(projectId);

    const byStatus = new Map<string, { projected: number; actual: number }>();
    for (const r of rows) {
      byStatus.set(String(r.status), {
        projected: Number(r.projected),
        actual: Number(r.actual),
      });
    }

    const approved = byStatus.get("approved");
    const paid = byStatus.get("paid");
    const planned = byStatus.get("planned");

    expect(approved, "approved status row missing from aggregate").toBeDefined();
    expect(paid, "paid status row missing from aggregate").toBeDefined();
    expect(planned, "planned status row missing from aggregate").toBeDefined();

    expect(approved!.actual).toBe(1000);
    expect(paid!.actual).toBe(500);

    // The bug reported in Task #124 caused `actual` to be 0 for every row
    // (when it didn't 500 outright). Pin actual > 0 explicitly.
    const totalActual = (approved!.actual ?? 0) + (paid!.actual ?? 0);
    expect(totalActual).toBeGreaterThan(0);
    expect(totalActual).toBe(1500);

    // Sanity: `planned` must contribute to `projected` but never to `actual`.
    expect(planned!.projected).toBe(9999);
    expect(planned!.actual).toBe(0);
  });
});
