/**
 * Tracker-vs-QuickBooks GAP consumer (P2.3).
 *
 * Produces the per (project × fiscal period) gap the reconciliation board needs,
 * by CONSUMING the existing QB comparison primitives — the same project
 * resolvers, line parsers and tracker-line match rule the COS/Revenue gap
 * reports use. It does NOT rebuild the comparison and NEVER adjusts a tracker
 * figure: the app compares and flags; the tracker stays the source of truth.
 *
 * The gap = QuickBooks bills/invoices resolved to a project that have NO matching
 * tracker line (within R1), EXCLUDING active recon-ignores (which the detail
 * surfaces separately, with reason). Bucketed by the QB transaction date's
 * fiscal period.
 *
 * Best-effort: if QuickBooks is unavailable the fetch throws and we return an
 * empty map (the refresh writes nothing) rather than failing the request.
 */

import { and, isNull } from "drizzle-orm";

import { db } from "../db";
import { qbReconIgnores, qbRevenueReconIgnores, fiscalPeriods } from "@shared/schema";
import { normalizedRevenueLines } from "@shared/schema/finance";
import { projectInfo } from "@shared/schema/projects";
import {
  buildQbProjectResolver,
  buildRevenueProjectResolver,
  billRawToLineRows,
  invoiceRawToLineRows,
  normalizeProjectKey,
} from "./quickbooks-reconciliation-service";
import { getBills, getInvoices } from "./quickbooks-service";
import { FinanceExpenseEngineRepository } from "../repositories/finance-expense-engine-repository";
import {
  resolvePeriodIdForDate,
  type FiscalPeriodRow,
} from "../scripts/backfill-fiscal-period";
import type { TrackerVsQbGap } from "./reconciliation-service";

const MATCH_TOLERANCE = 1; // R1 — same as the gap report's closest-match filter.

interface TrackerLine {
  projectKey: string;
  amount: number;
}

/** Group tracker lines by normalised project key for the closest-match lookup. */
function indexTrackerLines(
  lines: Array<{ projectName: string | null; amountExVat: string | number | null }>,
): Map<string, TrackerLine[]> {
  const byKey = new Map<string, TrackerLine[]>();
  for (const l of lines) {
    if (!l.projectName) continue;
    const key = normalizeProjectKey(l.projectName);
    const amount = l.amountExVat == null ? 0 : Number(l.amountExVat);
    const arr = byKey.get(key) ?? [];
    arr.push({ projectKey: key, amount });
    byKey.set(key, arr);
  }
  return byKey;
}

/** Has a tracker line within R1 of the target amount for this project? (matched) */
function hasCloseMatch(
  candidates: TrackerLine[] | undefined,
  target: number,
): boolean {
  if (!candidates) return false;
  return candidates.some((c) => Math.abs(c.amount - target) <= MATCH_TOLERANCE);
}

/**
 * Compute the per (projectId × fiscalPeriodId) tracker-vs-QB gap for the given
 * date window. Returns an empty map when QuickBooks is unavailable.
 */
export async function computeQbTrackerGapByProject(
  startDate: string,
  endDate: string,
): Promise<Map<number, TrackerVsQbGap[]>> {
  // Shared reference data (cheap, snapshot-guarded).
  const [projects, periods, activeCostIgnores, activeRevenueIgnores] = await Promise.all([
    db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo).where(isNull(projectInfo.deletedAt)),
    db.select({ id: fiscalPeriods.id, startDate: fiscalPeriods.startDate, endDate: fiscalPeriods.endDate }).from(fiscalPeriods) as Promise<FiscalPeriodRow[]>,
    db.select({ qbBillId: qbReconIgnores.qbBillId }).from(qbReconIgnores).where(isNull(qbReconIgnores.deletedAt)),
    db.select({ qbInvoiceId: qbRevenueReconIgnores.qbInvoiceId }).from(qbRevenueReconIgnores).where(isNull(qbRevenueReconIgnores.deletedAt)),
  ]);

  const projectIdByKey = new Map<string, number>();
  const projectNames: string[] = [];
  for (const p of projects as Array<{ id: number; projectName: string }>) {
    projectIdByKey.set(normalizeProjectKey(p.projectName), p.id);
    projectNames.push(p.projectName);
  }
  const ignoredBillIds = new Set((activeCostIgnores as Array<{ qbBillId: string }>).map((r) => r.qbBillId));
  const ignoredInvoiceIds = new Set((activeRevenueIgnores as Array<{ qbInvoiceId: string }>).map((r) => r.qbInvoiceId));

  // Accumulate gap per (projectId, periodId).
  const gapByProjectPeriod = new Map<number, Map<number, number>>();
  const addGap = (projectKey: string, txnDate: string | null, amount: number) => {
    const projectId = projectIdByKey.get(projectKey);
    if (projectId == null) return;
    const periodId = resolvePeriodIdForDate(txnDate, periods);
    if (periodId == null) return;
    const byPeriod = gapByProjectPeriod.get(projectId) ?? new Map<number, number>();
    byPeriod.set(periodId, (byPeriod.get(periodId) ?? 0) + amount);
    gapByProjectPeriod.set(projectId, byPeriod);
  };

  // ── COST side: QB bills vs tracker cost lines ──
  try {
    const [billsResp, costLines] = await Promise.all([
      getBills(startDate, endDate),
      new FinanceExpenseEngineRepository().listActiveCostLinesForTrackerGap(),
    ]);
    const bills: any[] = billsResp?.QueryResponse?.Bill ?? [];
    const resolveCost = buildQbProjectResolver(projectNames);
    const trackerByKey = indexTrackerLines(costLines);
    for (const bill of bills) {
      for (const lr of billRawToLineRows(bill)) {
        if (ignoredBillIds.has(lr.billId)) continue; // suppressed → shown separately, not a gap
        const resolution = resolveCost({ classRefName: lr.classRefName, customerRefName: lr.customerRefName });
        if (!resolution.projectName) continue; // unmapped → not a per-project gap
        const key = normalizeProjectKey(resolution.projectName);
        const amount = lr.lineAmountExVat ?? 0;
        if (hasCloseMatch(trackerByKey.get(key), amount)) continue; // matched (reconciles)
        addGap(key, lr.txnDate, amount);
      }
    }
  } catch (err) {
    console.warn("[reconciliation-qb-gap] COST gap skipped (QuickBooks unavailable):", err instanceof Error ? err.message : String(err));
  }

  // ── REVENUE side: QB invoices vs tracker revenue lines ──
  try {
    const [invoicesResp, revLines] = await Promise.all([
      getInvoices(startDate, endDate),
      db
        .select({ projectName: normalizedRevenueLines.projectName, amountExVat: normalizedRevenueLines.amountExVat })
        .from(normalizedRevenueLines)
        .where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
    ]);
    const invoices: any[] = invoicesResp?.QueryResponse?.Invoice ?? [];
    const resolveRev = buildRevenueProjectResolver(projectNames);
    const trackerByKey = indexTrackerLines(revLines as Array<{ projectName: string | null; amountExVat: string | null }>);
    for (const inv of invoices) {
      for (const lr of invoiceRawToLineRows(inv)) {
        if (ignoredInvoiceIds.has(lr.invoiceId)) continue;
        const resolution = resolveRev({ classRefName: lr.classRefName, customerRefName: lr.customerName });
        if (!resolution.projectName) continue;
        const key = normalizeProjectKey(resolution.projectName);
        const amount = lr.lineAmountExVat ?? 0;
        if (hasCloseMatch(trackerByKey.get(key), amount)) continue;
        addGap(key, lr.txnDate, amount);
      }
    }
  } catch (err) {
    console.warn("[reconciliation-qb-gap] REVENUE gap skipped (QuickBooks unavailable):", err instanceof Error ? err.message : String(err));
  }

  // Shape into TrackerVsQbGap[] per project.
  const out = new Map<number, TrackerVsQbGap[]>();
  for (const [projectId, byPeriod] of gapByProjectPeriod) {
    const gaps: TrackerVsQbGap[] = [];
    for (const [fiscalPeriodId, gapDelta] of byPeriod) {
      gaps.push({ fiscalPeriodId, gapDelta: Number(gapDelta.toFixed(2)) });
    }
    out.set(projectId, gaps);
  }
  return out;
}
