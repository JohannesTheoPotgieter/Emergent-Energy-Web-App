import { db } from "../db";
import { normalizedCostLines } from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { extractSupplierName } from "./calculations/supplierExtractor";

export async function backfillExpenseComputedFields(): Promise<{ updated: number }> {
  const costLines = await db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));

  let updated = 0;
  const batchSize = 200;

  for (let i = 0; i < costLines.length; i += batchSize) {
    const batch = costLines.slice(i, i + batchSize);

    for (const cost of batch) {
      const supplier = extractSupplierName(cost.invoiceNumber);

      if (supplier && !cost.counterpartyName) {
        await db.update(normalizedCostLines)
          .set({ counterpartyName: supplier })
          .where(and(
            eq(normalizedCostLines.id, cost.id),
            isNull(normalizedCostLines.effectiveTo),
          ));
        updated++;
      }
    }
  }

  return { updated };
}

export async function backfillInflowComputedFields(): Promise<{ updated: number }> {
  let updated = 0;
  return { updated };
}

async function backfillExecutionPhase(): Promise<{ updated: number }> {
  const result: unknown = await db.execute(sql`
    UPDATE project_info
    SET execution_phase = phase
    WHERE phase IS NOT NULL
    AND (execution_phase IS NULL OR execution_phase = '')
  `);
  // pg QueryResult exposes rowCount; the dev SQLite path lacks it (defaults to 0).
  const rowCount =
    result && typeof result === "object" && "rowCount" in result
      ? Number((result as { rowCount: number | null }).rowCount)
      : 0;
  return { updated: Number.isFinite(rowCount) ? rowCount : 0 };
}

export async function runBackfill(): Promise<void> {
  try {
    console.log('[Backfill] Starting computed field backfill...');
    const expResult = await backfillExpenseComputedFields();
    console.log(`[Backfill] Updated ${expResult.updated} cost line rows`);
    const infResult = await backfillInflowComputedFields();
    console.log(`[Backfill] Updated ${infResult.updated} revenue line rows`);
    const phaseResult = await backfillExecutionPhase();
    if (phaseResult.updated > 0) {
      console.log(`[Backfill] Synced ${phaseResult.updated} execution_phase rows from phase`);
    }
    console.log('[Backfill] Complete');
  } catch (err) {
    console.error('[Backfill] Error:', err);
  }
}
