import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines, projectInfo, type ProjectInfo } from "@shared/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { classifyExpenseState } from "./calculations/stateClassifier";
import { computeExpenseLineHash, computeInflowLineHash } from "./calculations/hashing";
import { forecastExpensePaymentDate, forecastInflowReceiptDate } from "./calculations/forecaster";
import { extractSupplierName } from "./calculations/supplierExtractor";

async function getProjectMap(): Promise<Map<string, ProjectInfo>> {
  const projects = await db.select().from(projectInfo);
  return new Map(projects.map((p: ProjectInfo) => [p.projectName, p]));
}

export async function backfillExpenseComputedFields(): Promise<{ updated: number }> {
  const costLines = await db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo));
  const projectMap = await getProjectMap();

  let updated = 0;
  const batchSize = 200;

  for (let i = 0; i < costLines.length; i += batchSize) {
    const batch = costLines.slice(i, i + batchSize);

    for (const cost of batch) {
      const supplier = extractSupplierName(cost.invoiceNumber);

      if (supplier && !cost.counterpartyName) {
        await db.update(normalizedCostLines)
          .set({ counterpartyName: supplier })
          .where(eq(normalizedCostLines.id, cost.id));
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
  const result = await db.execute(sql`
    UPDATE project_info 
    SET execution_phase = phase 
    WHERE phase IS NOT NULL 
    AND (execution_phase IS NULL OR execution_phase = '')
  `);
  return { updated: (result as any).rowCount || 0 };
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
