import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { quickbooksCostAllocations, quickbooksDocuments } from "@shared/schema";

export async function getAssignedEvidenceByCostLineIds(costLineIds: number[]): Promise<Map<number, number>> {
  const ids = costLineIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      costLineId: quickbooksCostAllocations.costLineId,
      assignedExVat: sql<number>`COALESCE(SUM(CAST(${quickbooksCostAllocations.amountExVat} AS NUMERIC)), 0)`,
    })
    .from(quickbooksCostAllocations)
    .innerJoin(
      quickbooksDocuments,
      eq(quickbooksDocuments.id, quickbooksCostAllocations.quickbooksDocumentId),
    )
    .where(
      and(
        inArray(quickbooksCostAllocations.costLineId, ids),
        isNull(quickbooksCostAllocations.deletedAt),
        isNull(quickbooksDocuments.deletedAt),
      ),
    )
    .groupBy(quickbooksCostAllocations.costLineId);

  const out = new Map<number, number>();
  for (const row of rows as any[]) {
    const id = Number(row.costLineId);
    const amt = Number(row.assignedExVat || 0);
    if (!Number.isFinite(id)) continue;
    out.set(id, Number(amt.toFixed(2)));
  }
  return out;
}
