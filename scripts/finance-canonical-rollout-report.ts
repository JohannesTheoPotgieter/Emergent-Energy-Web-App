import { and, eq, isNull } from "drizzle-orm";
import { db } from "../server/db";
import { normalizedCostLines, programExpense } from "@shared/schema";
import { getCanonicalProjectCostLines } from "../server/services/project-cost-line-read-service";

function parseProjectIds(argv: string[]): number[] {
  const arg = argv.find((v) => v.startsWith("--projectIds="));
  if (!arg) return [];
  return arg
    .split("=")[1]
    .split(",")
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v));
}

function sumExpense(rows: any[]): number {
  return rows.reduce((sum, row) => sum + (parseFloat(String(row.expenseActualTotal || row.amountExVat || "0")) || 0), 0);
}

async function run(): Promise<void> {
  const projectIds = parseProjectIds(process.argv.slice(2));
  if (projectIds.length === 0) {
    console.error("Usage: tsx scripts/finance-canonical-rollout-report.ts --projectIds=101,202,303");
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const report = [] as Array<Record<string, unknown>>;

  for (const projectId of projectIds) {
    const [canonicalRows, normalizedActiveRows, legacyProgramExpenseRows] = await Promise.all([
      getCanonicalProjectCostLines(projectId),
      db.select().from(normalizedCostLines).where(and(eq(normalizedCostLines.projectId, projectId), isNull(normalizedCostLines.effectiveTo))),
      db.select().from(programExpense).where(and(eq(programExpense.projectId, projectId), isNull(programExpense.effectiveTo))),
    ]);

    const canonicalTotal = sumExpense(canonicalRows as any[]);
    const normalizedRawTotal = sumExpense(normalizedActiveRows as any[]);
    const legacyTotal = sumExpense(legacyProgramExpenseRows as any[]);

    report.push({
      projectId,
      before: {
        normalizedActiveRawRows: normalizedActiveRows.length,
        normalizedActiveRawTotal: normalizedRawTotal,
        programExpenseActiveRows: legacyProgramExpenseRows.length,
        programExpenseActiveTotal: legacyTotal,
      },
      after: {
        canonicalRows: canonicalRows.length,
        canonicalTotal,
      },
      delta: {
        canonicalVsNormalizedRawRows: canonicalRows.length - normalizedActiveRows.length,
        canonicalVsNormalizedRawTotal: canonicalTotal - normalizedRawTotal,
        canonicalVsProgramExpenseRows: canonicalRows.length - legacyProgramExpenseRows.length,
        canonicalVsProgramExpenseTotal: canonicalTotal - legacyTotal,
      },
    });
  }

  const payload = { generatedAt, projectIds, report };
  console.log(JSON.stringify(payload, null, 2));
}

run().catch((error) => {
  console.error("[finance-canonical-rollout-report] failed", error);
  process.exit(1);
});
