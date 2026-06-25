// Finance / Analysis routes — read-only analytical endpoints used by the
// /cashflow/analysis and /cos/analysis pages.
//
// All snapshot reads are guarded by `isNull(effectiveTo)` inside the
// finance-analysis-repository — see the finance-snapshot-queries skill.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../departments/shared-middleware";
import { requirePermission } from "../permission-middleware";
import { getEffectiveUser } from "../auth-context";
import { badRequest, sendError, unauthorized } from "../lib/api-error";
import { withTrust } from "../lib/finance-trust/envelope";
import {
  computeDsoDpoTrend,
  listCashflowPointsForRange,
  listCounterpartyMonthlyCos,
  listOutstandingCostLines,
  listOutstandingRevenueLines,
  listProjectCosRows,
  loadCosToleranceBandsByProject,
  loadProjectName,
  upsertCosToleranceBand,
} from "../repositories/finance-analysis-repository";
import {
  AGING_BUCKET_KEYS,
  AGING_BUCKET_LABELS,
  bucketForDaysOverdue,
  computeEarnedVsInvoiced,
  daysOverdueOn,
  emptyAgingCounts,
  parseIsoDate,
  resolveDueDate,
  rollupAging,
  topNConcentration,
  totalOutstanding,
  type AgingBucketCounts,
  type AgingBucketKey,
  type OverdueMode,
} from "@shared/lib/financeAnalysis";

// RBAC: gates align with the entity registry in shared/permissions/registry.ts.
// Reads use the `cashflow`/`cos`/`financials` view permission; the tolerance-
// band PUT uses `cos:override` (registry: COO, CEO, CFO, PFM — matches the
// old hardcoded TOLERANCE_WRITE_ROLES list exactly).

const DEFAULT_TOLERANCE_BAND_PCT = 10;

const overdueModeQuery = z.enum(["expected_date", "payment_terms"]).default("expected_date");
const positiveInt = z.coerce.number().int().positive();

export function registerFinanceAnalysisRoutes(app: Express): void {
  // ------------------------------------------------------------------
  // CASHFLOW ANALYSIS
  // ------------------------------------------------------------------

  // Aging summary — AR + AP buckets in one shot for the headline cards.
  app.get(
    "/api/finance/analysis/cashflow/aging",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const mode = overdueModeQuery.parse(req.query.mode ?? "expected_date");
        const today = new Date();
        const [arRows, apRows] = await Promise.all([
          listOutstandingRevenueLines(),
          listOutstandingCostLines(),
        ]);

        const arAging = rollupAging(
          arRows.map((r) => ({
            amount: r.amount,
            daysOverdue: daysOverdueOn(today, resolveDueDate(
              { expectedDate: r.expectedDate, invoiceDate: r.invoiceDate, termsDays: r.termsDays },
              mode,
            )),
          })),
        );
        const apAging = rollupAging(
          apRows.map((r) => ({
            amount: r.amount,
            daysOverdue: daysOverdueOn(today, resolveDueDate(
              { expectedDate: r.expectedDate, invoiceDate: r.invoiceDate, termsDays: r.termsDays },
              mode,
            )),
          })),
        );

        res.json({
          mode,
          buckets: AGING_BUCKET_KEYS.map((k) => ({ key: k, label: AGING_BUCKET_LABELS[k] })),
          ar: serializeAging(arAging),
          ap: serializeAging(apAging),
          arTotal: totalOutstanding(arAging),
          apTotal: totalOutstanding(apAging),
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines, normalized_cost_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Overdue list — flat AR or AP rows past due, sortable in the UI.
  app.get(
    "/api/finance/analysis/cashflow/overdue",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const mode = overdueModeQuery.parse(req.query.mode ?? "expected_date");
        const side = z.enum(["ar", "ap", "both"]).default("both").parse(req.query.side ?? "both");
        const today = new Date();

        const ar = side === "ap" ? [] : await listOutstandingRevenueLines();
        const ap = side === "ar" ? [] : await listOutstandingCostLines();

        const arRows = ar
          .map((r) => {
            const due = resolveDueDate(
              { expectedDate: r.expectedDate, invoiceDate: r.invoiceDate, termsDays: r.termsDays },
              mode,
            );
            return {
              kind: "ar" as const,
              id: r.id,
              projectId: r.projectId,
              projectName: r.projectName,
              party: r.customer ?? r.projectName,
              amount: r.amount,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate,
              dueDate: due ? due.toISOString().slice(0, 10) : null,
              daysOverdue: daysOverdueOn(today, due),
              status: r.status,
              bucket: bucketForDaysOverdue(daysOverdueOn(today, due)),
            };
          })
          .filter((r) => r.daysOverdue > 0);

        const apRows = ap
          .map((r) => {
            const due = resolveDueDate(
              { expectedDate: r.expectedDate, invoiceDate: r.invoiceDate, termsDays: r.termsDays },
              mode,
            );
            return {
              kind: "ap" as const,
              id: r.id,
              projectId: r.projectId,
              projectName: r.projectName,
              party: r.counterpartyName ?? "Unknown",
              amount: r.amount,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate,
              dueDate: due ? due.toISOString().slice(0, 10) : null,
              daysOverdue: daysOverdueOn(today, due),
              status: r.status,
              bucket: bucketForDaysOverdue(daysOverdueOn(today, due)),
            };
          })
          .filter((r) => r.daysOverdue > 0);

        const all = [...arRows, ...apRows].sort((a, b) => b.daysOverdue - a.daysOverdue);
        res.json({
          mode,
          side,
          rows: all,
          count: all.length,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines, normalized_cost_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // DSO / DPO trend.
  app.get(
    "/api/finance/analysis/cashflow/dso-dpo",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const weeks = z.coerce.number().int().min(4).max(52).default(12).parse(req.query.weeks ?? 12);
        const points = await computeDsoDpoTrend(weeks);
        res.json({
          weeks,
          points,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines, normalized_cost_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Top-N at-risk receivables — biggest amount × oldest age.
  app.get(
    "/api/finance/analysis/cashflow/at-risk",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const mode = overdueModeQuery.parse(req.query.mode ?? "expected_date");
        const limit = z.coerce.number().int().min(1).max(50).default(10).parse(req.query.limit ?? 10);
        const today = new Date();
        const ar = await listOutstandingRevenueLines();

        const scored = ar
          .map((r) => {
            const due = resolveDueDate(
              { expectedDate: r.expectedDate, invoiceDate: r.invoiceDate, termsDays: r.termsDays },
              mode,
            );
            const days = daysOverdueOn(today, due);
            // Risk score = amount × log(1 + daysOverdue) — biases toward big-and-old.
            const riskScore = r.amount * Math.log(1 + days);
            return {
              id: r.id,
              projectId: r.projectId,
              projectName: r.projectName,
              amount: r.amount,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate,
              dueDate: due ? due.toISOString().slice(0, 10) : null,
              daysOverdue: days,
              riskScore,
            };
          })
          .filter((r) => r.daysOverdue > 0)
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, limit);

        res.json({
          mode,
          limit,
          rows: scored,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Concentration — top-5 customers by AR, top-5 suppliers by AP.
  app.get(
    "/api/finance/analysis/cashflow/concentration",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const topN = z.coerce.number().int().min(1).max(20).default(5).parse(req.query.top ?? 5);
        const [ar, ap] = await Promise.all([
          listOutstandingRevenueLines(),
          listOutstandingCostLines(),
        ]);

        const arByProject = aggregate(ar, (r) => r.projectName, (r) => r.amount);
        const apByCounterparty = aggregate(
          ap,
          (r) => r.counterpartyName ?? "Unknown",
          (r) => r.amount,
        );

        res.json({
          topN,
          arTopProjects: topNConcentration(arByProject, topN),
          apTopSuppliers: topNConcentration(apByCounterparty, topN),
          arRanked: arByProject.sort((a, b) => b.amount - a.amount).slice(0, topN),
          apRanked: apByCounterparty.sort((a, b) => b.amount - a.amount).slice(0, topN),
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_revenue_lines, normalized_cost_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Forecast vs actual cash position — cashflow points for last 8 weeks + next 4.
  app.get(
    "/api/finance/analysis/cashflow/forecast-actual",
    requireAuth,
    requirePermission("cashflow", "view"),
    async (req: Request, res: Response) => {
      try {
        const today = new Date();
        const from = new Date(today);
        from.setUTCDate(today.getUTCDate() - 8 * 7);
        const to = new Date(today);
        to.setUTCDate(today.getUTCDate() + 4 * 7);
        const points = await listCashflowPointsForRange(
          from.toISOString().slice(0, 10),
          to.toISOString().slice(0, 10),
        );
        res.json({
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          today: today.toISOString().slice(0, 10),
          points,
          trust: withTrust(res, {
            sourceLayer: "derived",
            derivedTable: "cashflow_points",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // ------------------------------------------------------------------
  // COS ANALYSIS
  // ------------------------------------------------------------------

  // Per-project earned vs invoiced.
  app.get(
    "/api/finance/analysis/cos/earned-vs-invoiced",
    requireAuth,
    requirePermission("cos", "view"),
    async (_req: Request, res: Response) => {
      try {
        const [rows, tolerances] = await Promise.all([
          listProjectCosRows(),
          loadCosToleranceBandsByProject(),
        ]);
        const result = rows.map((r) => {
          const band = tolerances.get(r.projectId) ?? DEFAULT_TOLERANCE_BAND_PCT;
          const ev = computeEarnedVsInvoiced({
            plannedExpenditure: r.plannedExpenditure,
            pctComplete: r.pctComplete,
            invoicedToDate: r.invoicedToDate,
            toleranceBandPct: band,
          });
          return {
            projectId: r.projectId,
            projectName: r.projectName,
            plannedExpenditure: r.plannedExpenditure,
            pctComplete: r.pctComplete,
            toleranceBandPct: band,
            ...ev,
          };
        });
        res.json({
          rows: result,
          defaultToleranceBandPct: DEFAULT_TOLERANCE_BAND_PCT,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "project_revenue_summary, project_plan, normalized_cost_lines",
            overrideInEffect: tolerances.size > 0,
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Counterparty trend — monthly invoiced totals per supplier.
  app.get(
    "/api/finance/analysis/cos/counterparty-trend",
    requireAuth,
    requirePermission("cos", "view"),
    async (req: Request, res: Response) => {
      try {
        const months = z.coerce.number().int().min(1).max(24).default(6).parse(req.query.months ?? 6);
        const points = await listCounterpartyMonthlyCos(months);
        res.json({
          months,
          points,
          trust: withTrust(res, {
            sourceLayer: "canonical",
            canonicalTable: "normalized_cost_lines",
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // ------------------------------------------------------------------
  // PER-PROJECT TOLERANCE BAND
  // ------------------------------------------------------------------

  // Read every project's tolerance band (UI shows table for editing).
  app.get(
    "/api/finance/analysis/tolerance",
    requireAuth,
    requirePermission("cos", "view"),
    async (_req: Request, res: Response) => {
      try {
        const map = await loadCosToleranceBandsByProject();
        const rows = Array.from(map.entries()).map(([projectId, bandPct]) => ({ projectId, bandPct }));
        res.json({
          defaultBandPct: DEFAULT_TOLERANCE_BAND_PCT,
          rows,
          trust: withTrust(res, {
            sourceLayer: "override",
            canonicalTable: "financial_integration_rules",
            overrideInEffect: rows.length > 0,
          }),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Set a project's tolerance band.
  const toleranceBody = z.object({ bandPct: z.coerce.number().min(0).max(100) });
  app.put(
    "/api/finance/analysis/tolerance/:projectId",
    requireAuth,
    requirePermission("cos", "edit"),
    async (req: Request, res: Response) => {
      try {
        const projectId = positiveInt.parse(req.params.projectId);
        const { bandPct } = toleranceBody.parse(req.body);
        const userId = getEffectiveUser(req)?.id;
        if (!userId) throw unauthorized();

        const projectName = await loadProjectName(projectId);
        if (!projectName) throw badRequest("Project not found");

        await upsertCosToleranceBand(projectId, bandPct, userId, projectName);

        res.json({ projectId, bandPct });
      } catch (err) {
        sendError(res, err);
      }
    },
  );
}

// Helpers ------------------------------------------------------------------

function serializeAging(counts: AgingBucketCounts) {
  return AGING_BUCKET_KEYS.reduce<Record<AgingBucketKey, { count: number; amount: number }>>(
    (acc, k) => {
      acc[k] = counts[k];
      return acc;
    },
    emptyAgingCounts(),
  );
}

function aggregate<T>(
  rows: T[],
  keyFn: (row: T) => string,
  amountFn: (row: T) => number,
): Array<{ key: string; amount: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = keyFn(r);
    map.set(key, (map.get(key) ?? 0) + amountFn(r));
  }
  return Array.from(map.entries()).map(([key, amount]) => ({ key, amount }));
}

// Suppress lint nag — `parseIsoDate` is exposed for symmetry with helpers.
void parseIsoDate;
