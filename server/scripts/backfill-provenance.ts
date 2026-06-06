#!/usr/bin/env tsx
/**
 * Backfill provenance / reconciliation columns on normalized_cost_line_actuals.
 *
 * Purpose (additive only — NO calculation change, NO endpoint behaviour change):
 *   make every per-line revenue figure traceable to its source and make drift
 *   between the pasted workbook value (Excel col U) and the canonical formula
 *   measurable.
 *
 * This is the ONE-OFF historical backfill. The same compute + persist helpers
 * now live in server/lib/finance/provenance.ts and run automatically on every
 * import/recompute (see refreshProvenanceForProjects) — this script exists to
 * populate rows imported before that hook shipped, and to re-measure on demand.
 *
 * For each LIVE actuals row (effective_to IS NULL):
 *   - revenue_derived    = canonical (Q/X)×J per AGENT_GUARDRAILS § 3.3:
 *                          (actual_total / category.totalActualTotal)
 *                          × category.revenueAllocation. Computed via the single
 *                          source of truth — deriveFinanceLinesFromRows in
 *                          server/repositories/finance-line-level-repository.ts.
 *   - revenue_stored     = the existing revenue_recognition_amount (pasted col U).
 *   - recon_delta        = revenue_stored − revenue_derived (null when no stored).
 *   - recon_exceeds      = |recon_delta| > R1 (flags the reconciliation board).
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

import { db, initializeDatabase } from "../db";
import {
  computeProvenanceUpdates,
  loadProvenanceInputs,
  writeProvenanceUpdates,
  type ProvenanceUpdate,
} from "../lib/finance/provenance";

// Re-export the canonical helper + type from their new home so existing
// importers (tests, tooling) keep working against this path.
export { computeProvenanceUpdates, type ProvenanceUpdate };

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

  const projectIds = projectFilter != null ? [projectFilter] : null;
  const { actualsRows, parentRows, allocationRows } = await loadProvenanceInputs(
    db,
    projectIds,
  );

  console.log(
    `Loaded ${actualsRows.length} actuals · ${parentRows.length} cost lines · ${allocationRows.length} category allocations.`,
  );

  const updates: ProvenanceUpdate[] = computeProvenanceUpdates(
    actualsRows,
    parentRows,
    allocationRows,
  );

  // Reconciliation summary (informational).
  let withStored = 0;
  let flagged = 0;
  let maxAbsDelta = 0;
  let sumDerived = 0;
  for (const u of updates) {
    sumDerived += Number(u.revenueDerived);
    if (u.revenueStored != null) withStored += 1;
    if (u.reconExceeds) flagged += 1;
    if (u.reconDelta != null) {
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(Number(u.reconDelta)));
    }
  }
  console.log(
    `Computed ${updates.length} rows · ${withStored} with stored col-U · ` +
      `${flagged} flagged (|Δ| > R1) · Σ derived = ${sumDerived.toFixed(2)} · ` +
      `max |recon_delta| = ${maxAbsDelta.toFixed(2)}\n`,
  );

  if (dryRun) {
    console.log("Dry run — no rows written.");
    return;
  }

  // The one-off backfill ALSO sets the importer-owned recognition_method /
  // colour_source columns for historical rows that predate the importer hook.
  const written = await writeProvenanceUpdates(db, updates, { includeMethodColumns: true });

  console.log(`\nDone. ${written} rows backfilled.`);
}

// Execute only when run directly (e.g. `tsx server/scripts/backfill-provenance.ts`).
// Guarded so the re-exported helpers above can be imported by tests without side
// effects.
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
