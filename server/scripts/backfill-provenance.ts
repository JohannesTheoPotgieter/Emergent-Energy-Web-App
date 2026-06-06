#!/usr/bin/env tsx
/**
 * Backfill provenance / reconciliation columns on normalized_cost_line_actuals.
 *
 * Purpose (additive only — NO calculation change, NO endpoint behaviour change):
 *   make every per-line revenue figure traceable to its source and make drift
 *   between the pasted workbook value (Excel col U) and the canonical formula
 *   measurable.
 *
 * For each LIVE actuals row (effective_to IS NULL):
 *   - revenue_derived    = canonical (Q/X)×J per AGENT_GUARDRAILS § 3.3:
 *                          (actual_total / category.totalActualTotal)
 *                          × category.revenueAllocation. Computed via the single
 *                          source of truth — deriveFinanceLinesFromRows in
 *                          server/repositories/finance-line-level-repository.ts.
 *   - revenue_stored     = the existing revenue_recognition_amount (pasted col U).
 *   - recon_delta        = revenue_stored − revenue_derived (null when no stored).
 *   - recognition_method = inferred from importer-recorded signals, else null:
 *                          'true_invoice'   → an invoice number is present,
 *                          'payment_derived'→ no invoice but a finance payment
 *                                             date is present.
 *   - colour_source      = inferred, else null:
 *                          'read'      → the invoice-date colour (§ 3.7) was read,
 *                          'defaulted' → an invoice exists but no colour was read.
 *   - source_file_hash / source_cell are left untouched (null) — they are
 *     importer-populated going forward; historical rows have no value to backfill.
 *
 * `revenue_derived` is the STRICT § 3.3 formula: the category total X is summed
 * over actuals rows only (no parent synthesis), exactly as the guardrail defines
 * it. col U is nulled on the inputs so the derivation never short-circuits to the
 * persisted value — that is the whole point of the cross-check.
 *
 * Idempotent: re-running recomputes the same values. Snapshot-guarded: only
 * effective_to IS NULL rows are touched, so temporal history is preserved.
 *
 * Usage:
 *   tsx server/scripts/backfill-provenance.ts [--dry-run] [--project=<id>]
 */

import { pathToFileURL } from "node:url";

import { and, eq, isNull } from "drizzle-orm";

import { db, initializeDatabase } from "../db";
import {
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
} from "@shared/schema/finance";
import {
  deriveFinanceLinesFromRows,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../repositories/finance-line-level-repository";

export interface ProvenanceUpdate {
  id: number;
  revenueDerived: string;
  revenueStored: string | null;
  reconDelta: string | null;
  recognitionMethod: string | null;
  colourSource: string | null;
}

/**
 * Pure computation — given the three live row arrays for a scope, produce the
 * provenance update payload for every actuals row. Reuses the canonical § 3.3
 * derivation; no formula is re-implemented here.
 */
export function computeProvenanceUpdates(
  actualsRows: FinanceLineActualsRowInput[],
  parentRows: FinanceLineParentRowInput[],
  allocationRows: FinanceLineAllocationRowInput[],
): ProvenanceUpdate[] {
  // Null col U on copies so deriveFinanceLinesFromRows always computes the
  // (Q/X)×J value rather than preferring the persisted col-U figure. No parent
  // synthesis — § 3.3 sums X over actuals rows only.
  const actualsForDerivation: FinanceLineActualsRowInput[] = actualsRows.map((r) => ({
    ...r,
    revenueRecognitionAmount: null,
  }));
  const parentsForDerivation: FinanceLineParentRowInput[] = parentRows.map((p) => ({
    ...p,
    revenueRecognitionAmount: null,
  }));

  const lines = deriveFinanceLinesFromRows(
    actualsForDerivation,
    parentsForDerivation,
    allocationRows,
  );
  const derivedById = new Map<number, number>();
  for (const line of lines) derivedById.set(line.lineId, line.perLineRevenue);

  const updates: ProvenanceUpdate[] = [];
  for (const a of actualsRows) {
    const derived = derivedById.get(a.id) ?? 0;

    const storedRaw = a.revenueRecognitionAmount;
    const parsedStored =
      storedRaw == null || storedRaw === "" ? null : Number(storedRaw);
    const storedNum =
      parsedStored != null && Number.isFinite(parsedStored) ? parsedStored : null;

    const revenueDerived = derived.toFixed(2);
    const revenueStored = storedNum != null ? String(storedRaw) : null;
    const reconDelta = storedNum != null ? (storedNum - derived).toFixed(2) : null;

    const hasInvoice = !!(a.invoiceNumber && String(a.invoiceNumber).trim());
    const hasPaymentDate = !!a.financePaymentDate;
    const recognitionMethod = hasInvoice
      ? "true_invoice"
      : hasPaymentDate
        ? "payment_derived"
        : null;

    const colour = a.invoiceDateFontColor;
    const colourRead = colour != null && String(colour).trim() !== "";
    const colourSource = colourRead ? "read" : hasInvoice ? "defaulted" : null;

    updates.push({
      id: a.id,
      revenueDerived,
      revenueStored,
      reconDelta,
      recognitionMethod,
      colourSource,
    });
  }
  return updates;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const projectArg = process.argv.find((a) => a.startsWith("--project="));
  const projectFilter = projectArg ? Number(projectArg.split("=")[1]) : null;

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║ Backfill provenance / reconciliation columns     ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(
    `Mode: ${dryRun ? "DRY RUN (no writes)" : "WRITE"}${
      projectFilter != null ? ` · project=${projectFilter}` : ""
    }\n`,
  );

  await initializeDatabase();

  // Live, snapshot-guarded rows (effective_to IS NULL; deleted_at IS NULL to
  // match the canonical read path in finance-line-level-repository.ts).
  const actualsConds = [
    isNull(normalizedCostLineActuals.effectiveTo),
    isNull(normalizedCostLineActuals.deletedAt),
  ];
  if (projectFilter != null) {
    actualsConds.push(eq(normalizedCostLineActuals.projectId, projectFilter));
  }
  const actualsRows = (await db
    .select({
      id: normalizedCostLineActuals.id,
      costLineId: normalizedCostLineActuals.costLineId,
      projectId: normalizedCostLineActuals.projectId,
      actualTotal: normalizedCostLineActuals.actualTotal,
      poNumber: normalizedCostLineActuals.poNumber,
      invoiceNumber: normalizedCostLineActuals.invoiceNumber,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      invoiceDateFontColor: normalizedCostLineActuals.invoiceDateFontColor,
      invoiceDateConfirmed: normalizedCostLineActuals.invoiceDateConfirmed,
      financePaymentDate: normalizedCostLineActuals.financePaymentDate,
      description: normalizedCostLineActuals.description,
      qty: normalizedCostLineActuals.qty,
      rate: normalizedCostLineActuals.rate,
      revenueRecognitionAmount: normalizedCostLineActuals.revenueRecognitionAmount,
    })
    .from(normalizedCostLineActuals)
    .where(and(...actualsConds))) as FinanceLineActualsRowInput[];

  const parentConds = [
    isNull(normalizedCostLines.effectiveTo),
    isNull(normalizedCostLines.deletedAt),
  ];
  if (projectFilter != null) {
    parentConds.push(eq(normalizedCostLines.projectId, projectFilter));
  }
  const parentRows = (await db
    .select({
      id: normalizedCostLines.id,
      projectId: normalizedCostLines.projectId,
      categoryAllocationId: normalizedCostLines.categoryAllocationId,
      categoryKey: normalizedCostLines.categoryKey,
      costCategory: normalizedCostLines.costCategory,
      description: normalizedCostLines.description,
      budgetTotal: normalizedCostLines.budgetTotal,
      forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
      paidDate: normalizedCostLines.paidDate,
      paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
    })
    .from(normalizedCostLines)
    .where(and(...parentConds))) as FinanceLineParentRowInput[];

  const allocationConds = [isNull(categoryRevenueAllocations.effectiveTo)];
  if (projectFilter != null) {
    allocationConds.push(eq(categoryRevenueAllocations.projectId, projectFilter));
  }
  const allocationRows = (await db
    .select({
      id: categoryRevenueAllocations.id,
      projectId: categoryRevenueAllocations.projectId,
      categoryKey: categoryRevenueAllocations.categoryKey,
      categoryName: categoryRevenueAllocations.categoryName,
      categoryNumber: categoryRevenueAllocations.categoryNumber,
      revenueAllocation: categoryRevenueAllocations.revenueAllocation,
      budgetTotal: categoryRevenueAllocations.budgetTotal,
    })
    .from(categoryRevenueAllocations)
    .where(and(...allocationConds))) as FinanceLineAllocationRowInput[];

  console.log(
    `Loaded ${actualsRows.length} actuals · ${parentRows.length} cost lines · ${allocationRows.length} category allocations.`,
  );

  const updates = computeProvenanceUpdates(actualsRows, parentRows, allocationRows);

  // Reconciliation summary (informational).
  let withStored = 0;
  let maxAbsDelta = 0;
  let sumDerived = 0;
  for (const u of updates) {
    sumDerived += Number(u.revenueDerived);
    if (u.revenueStored != null) withStored += 1;
    if (u.reconDelta != null) {
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(Number(u.reconDelta)));
    }
  }
  console.log(
    `Computed ${updates.length} rows · ${withStored} with stored col-U · ` +
      `Σ derived = ${sumDerived.toFixed(2)} · max |recon_delta| = ${maxAbsDelta.toFixed(2)}\n`,
  );

  if (dryRun) {
    console.log("Dry run — no rows written.");
    return;
  }

  const CHUNK = 100;
  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((u) =>
        db
          .update(normalizedCostLineActuals)
          .set({
            revenueDerived: u.revenueDerived,
            revenueStored: u.revenueStored,
            reconDelta: u.reconDelta,
            recognitionMethod: u.recognitionMethod,
            colourSource: u.colourSource,
          })
          .where(
            and(
              eq(normalizedCostLineActuals.id, u.id),
              isNull(normalizedCostLineActuals.effectiveTo),
            ),
          ),
      ),
    );
    written += chunk.length;
    console.log(`  updated ${written}/${updates.length}`);
  }

  console.log(`\nDone. ${written} rows backfilled.`);
}

// Execute only when run directly (e.g. `tsx server/scripts/backfill-provenance.ts`).
// Guarded so the pure helper above can be imported by tests without side effects.
const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
