// Task #124 — DB-backed behavioral guard for getFinanceCashflow.
// Seeds approved/paid/planned cost lines on an isolated project, asserts
// the aggregates are correct, and cleans up. Skips if DATABASE_URL unset.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("v2 finance cashflow — DB-backed behavioral guard (Task #124)", () => {
  // Module namespaces (not destructured) — `db` in server/db.ts is a `let`
  // assigned inside initializeDatabase().
  let dbModule: typeof import("../../../server/db");
  let financeSchema: typeof import("../../../shared/schema/finance");
  let importsSchema: typeof import("../../../shared/schema/imports");
  let projectsSchema: typeof import("../../../shared/schema/projects");
  let repo: typeof import("../../../server/api/v2/repositories/project-v2-repository");

  let projectId: number;
  let importRunId: number;
  const MARKER = `__task_124_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    financeSchema = await import("../../../shared/schema/finance");
    importsSchema = await import("../../../shared/schema/imports");
    projectsSchema = await import("../../../shared/schema/projects");
    await dbModule.initializeDatabase();
    // Import repo AFTER initializeDatabase() so its `import { db }` binding
    // resolves to the live drizzle instance.
    repo = await import("../../../server/api/v2/repositories/project-v2-repository");

    const [p] = await dbModule.db
      .insert(projectsSchema.projectInfo)
      .values({ projectName: MARKER })
      .returning({ id: projectsSchema.projectInfo.id });
    projectId = p.id;

    const [r] = await dbModule.db
      .insert(importsSchema.smartImportRuns)
      .values({ sourceFileName: MARKER, projectName: MARKER })
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
    // Delete children first — production FK on normalized_cost_lines.project_id
    // does not enforce ON DELETE CASCADE despite the Drizzle declaration.
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
    const rows = await repo.getFinanceCashflow(projectId);
    expect(Array.isArray(rows)).toBe(true);
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

    const totalActual = (approved!.actual ?? 0) + (paid!.actual ?? 0);
    expect(totalActual).toBeGreaterThan(0);
    expect(totalActual).toBe(1500);

    expect(planned!.projected).toBe(9999);
    expect(planned!.actual).toBe(0);
  });
});
