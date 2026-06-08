/**
 * DEPRECATED (R2) — per-project tracker-vs-QuickBooks gap.
 *
 * Project-keyed QB reconciliation has been RETIRED. QuickBooks cost bills are
 * not project-tagged (no Class/Customer), so resolving QB transactions to a
 * project via classRefName/customerRefName produced "QB: No data" for every
 * project. The company-wide engine — server/services/qb-tracker-reconcile.ts
 * (qb_recon_line / qb_recon_summary) — replaces it: invoice-number + ex-VAT
 * matching at the company grain, no project dimension.
 *
 * This stub remains only so the legacy `POST /api/finance/reconciliation/
 * refresh-qb` route still compiles. It resolves NO QB transaction to any
 * project and returns an empty gap map, so nothing is keyed to a project and
 * nothing is written. The app never adjusts a tracker (§ 3.4).
 * `financial_reconciliation.tracker_vs_qb_*` is left in place for a later
 * cleanup (it belongs to the separate app-vs-tracker board).
 */

import type { TrackerVsQbGap } from "./reconciliation-service";

/**
 * @deprecated Project-keyed QB recon retired — use the company-wide engine in
 * server/services/qb-tracker-reconcile.ts. Always returns an empty map.
 */
export async function computeQbTrackerGapByProject(
  _startDate: string,
  _endDate: string,
): Promise<Map<number, TrackerVsQbGap[]>> {
  return new Map();
}
