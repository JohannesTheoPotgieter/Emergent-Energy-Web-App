/**
 * Reconciliation routes — Program-wide Assessment + Selected Truth Registry.
 *
 * Endpoints:
 *   GET /api/reconciliation/program-assessment
 *     → Aggregated program health, classified exceptions, KPI registry.
 *       Pulls from drift summary + finance exception queue and layers
 *       mismatch-classifier risk rules on top.
 *
 *   GET /api/reconciliation/truth-registry
 *     → Full KPI registry for rendering trust metadata on dashboards.
 *
 * RBAC:
 *   Both routes require `requireAuth` + `requirePermission("excel_vs_app","view")`.
 *   The program-assessment additionally requires `financials:view` for the
 *   finance exception queue portion (enforced via combined permission check).
 *
 * No mutations happen here. This module is strictly read-only.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { trackerReplicaRepository } from "../repositories/tracker-replica-repository";
import { getFinanceExceptionSummary, getFinanceExceptionQueue } from "../lib/finance-trust/exceptions";
import { getFinanceSyncHealth } from "../lib/finance-trust/sync-health";
import { buildTrustMeta, setFinanceTrustHeaders } from "../lib/finance-trust/envelope";
import {
  classifyFinanceException,
  classifyDriftField,
  STALE_EXCEL_THRESHOLD_DAYS,
} from "../lib/reconciliation/mismatch-classifier";
import {
  KPI_REGISTRY,
} from "../lib/reconciliation/selected-truth-registry";
import type { RiskLevel, MismatchType } from "../lib/reconciliation/mismatch-classifier";
import type { ProgramDriftRow } from "../repositories/tracker-replica-repository";
import { db } from "../db";
import { parseIntParam } from "../lib/req-params";
import {
  getReconciliationPortfolio,
  getReconciliationDetail,
  refreshReconciliationForProjects,
  refreshTrackerVsQbForProjects,
} from "../services/reconciliation-service";
import { computeQbTrackerGapByProject } from "../services/reconciliation-qb-gap";

// ---------------------------------------------------------------------------
// Shared types surfaced in response bodies
// ---------------------------------------------------------------------------

export interface ProgramAssessmentException {
  id: string;
  projectId: number | null;
  projectName: string;
  portfolio: string | null;
  tracker: string;
  issueType: MismatchType;
  displayIssue: string;
  excelValue: string | null;
  appValue: string | null;
  variance: string | null;
  risk: RiskLevel;
  suggestedOwner: string;
  status: "open";
  lastUpdated: string | null;
  drilldownUrl: string;
  businessImpact: string;
  allowBulkClose: boolean;
  requireOwnerNote: boolean;
  sourceProof: {
    app: { table: string; field: string; recordId: number | null; value: string | null };
    excel: { sheet: string | null; value: string | null } | null;
    qb: { note: string } | null;
  };
  ruleUsed: string;
  selectedTruthSource: string;
}

// ---------------------------------------------------------------------------
// Helper: build exceptions from finance exception queue
// ---------------------------------------------------------------------------

function financeQueueToExceptions(
  queueRows: Awaited<ReturnType<typeof getFinanceExceptionQueue>>["rows"],
): ProgramAssessmentException[] {
  return queueRows.map((row, idx) => {
    const c = classifyFinanceException(row.category as Parameters<typeof classifyFinanceException>[0]);
    const id = `fin-${row.category}-${row.costLineId ?? row.revenueLineId ?? idx}`;
    const recordId = row.costLineId ?? row.revenueLineId ?? null;
    const table =
      row.costLineId != null ? "normalized_cost_lines" : "normalized_revenue_lines";

    return {
      id,
      projectId: row.projectId,
      projectName: row.projectName ?? "Unknown project",
      portfolio: null,
      tracker: row.costLineId != null ? "Cost" : "Revenue",
      issueType: c.type,
      displayIssue: c.displayLabel,
      excelValue: null,
      appValue: row.invoiceNumber ?? row.amount ?? null,
      variance: null,
      risk: c.risk,
      suggestedOwner: c.suggestedOwner,
      status: "open" as const,
      lastUpdated: row.asOfDate,
      drilldownUrl: row.projectId
        ? `/projects/${row.projectId}/excel-vs-app`
        : `/reports/program-wide-assessment`,
      businessImpact: c.businessImpact,
      allowBulkClose: c.allowBulkClose,
      requireOwnerNote: c.requireOwnerNote,
      sourceProof: {
        app: {
          table,
          field: "invoice_number",
          recordId,
          value: row.invoiceNumber,
        },
        excel: null,
        qb:
          row.category === "unmatched_cost_invoice" || row.category === "unmatched_revenue_payment"
            ? { note: "No confirmed QuickBooks bill link found." }
            : null,
      },
      ruleUsed:
        row.category === "missing_po"
          ? "Invoice must have a linked PO before COS can be realised."
          : row.category === "unmatched_cost_invoice" || row.category === "unmatched_revenue_payment"
          ? "All realised invoices must be confirmed in QuickBooks."
          : row.note ?? c.displayLabel,
      selectedTruthSource: row.category === "unmatched_cost_invoice" || row.category === "unmatched_revenue_payment"
        ? "quickbooks"
        : "canonical",
    };
  });
}

// ---------------------------------------------------------------------------
// Helper: build summary-level exceptions from program drift rows
// ---------------------------------------------------------------------------

function driftSummaryToExceptions(rows: ProgramDriftRow[]): ProgramAssessmentException[] {
  const exceptions: ProgramAssessmentException[] = [];

  for (const row of rows) {
    if (row.unverified === 0) continue;

    const sections = [
      { key: "EXPENDITURE" as const, label: "Cost" },
      { key: "REVENUE" as const, label: "Revenue" },
      { key: "PLAN" as const, label: "Plan" },
    ];

    for (const s of sections) {
      const sec = row.section[s.key];
      if (sec.unverified === 0) continue;

      // Use amount_mismatch for finance sections (conservative high-risk default
      // for program-level summary rows — per-field detail is on the project page).
      const c = classifyDriftField(
        s.key === "PLAN" ? "description" : "amountExVat",
        s.key,
        null,
        null,
      );
      const id = `drift-${row.projectId}-${s.key}`;

      exceptions.push({
        id,
        projectId: row.projectId,
        projectName: row.projectName,
        portfolio: null,
        tracker: s.label,
        issueType: s.key === "PLAN" ? "value_mismatch" : "amount_mismatch",
        displayIssue: `${sec.unverified} unverified field difference${sec.unverified !== 1 ? "s" : ""} in ${s.label} section`,
        excelValue: `${sec.unverified} field${sec.unverified !== 1 ? "s" : ""} changed in tracker`,
        appValue: `${sec.verified} verified, ${sec.unverified} unverified`,
        variance: String(sec.unverified),
        risk: s.key !== "PLAN" ? "high" : "medium",
        suggestedOwner: c.suggestedOwner,
        status: "open" as const,
        lastUpdated: null,
        drilldownUrl: `/projects/${row.projectId}/excel-vs-app`,
        businessImpact: s.key !== "PLAN"
          ? "Unverified finance field differences may affect revenue, COS, or GP reporting."
          : "Schedule or plan field differences require verification.",
        allowBulkClose: s.key === "PLAN",
        requireOwnerNote: s.key !== "PLAN",
        sourceProof: {
          app: {
            table: s.key === "EXPENDITURE" ? "normalized_cost_lines" : s.key === "REVENUE" ? "normalized_revenue_lines" : "work_items",
            field: "manual_overrides",
            recordId: null,
            value: null,
          },
          excel: { sheet: s.label, value: `${sec.unverified} changed fields` },
          qb: null,
        },
        ruleUsed: "Tracker field values must match app values or be explicitly verified (accepted or kept with reason).",
        selectedTruthSource: "excel_import",
      });
    }
  }

  return exceptions;
}

// ---------------------------------------------------------------------------
// Compute health scores
// ---------------------------------------------------------------------------

function computeProgramHealth(
  highRiskCount: number,
  syncHealthy: boolean,
): "healthy" | "degraded" | "critical" {
  if (!syncHealthy || highRiskCount > 10) return "critical";
  if (highRiskCount > 0) return "degraded";
  return "healthy";
}

function computeDataConfidence(
  totalExceptions: number,
  highRisk: number,
): number {
  // Simple heuristic: start at 100, deduct for exceptions
  const score = 100 - Math.min(100, highRisk * 10 + (totalExceptions - highRisk) * 2);
  return Math.max(0, Math.round(score));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerReconciliationRoutes(app: Express): void {
  // ── GET /api/reconciliation/program-assessment ──────────────────────────
  app.get(
    "/api/reconciliation/program-assessment",
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    async (_req: Request, res: Response) => {
      try {
        const [driftSummary, exceptionSummary, exceptionQueue, syncHealth] = await Promise.all([
          trackerReplicaRepository.getProgramDriftSummary(),
          getFinanceExceptionSummary(),
          getFinanceExceptionQueue(50),
          getFinanceSyncHealth(),
        ]);

        // Build exception lists
        const financeExceptions = financeQueueToExceptions(exceptionQueue.rows);
        const driftExceptions = driftSummaryToExceptions(driftSummary);

        // Combine and sort: high-risk first, then by project name
        const allExceptions: ProgramAssessmentException[] = [
          ...financeExceptions,
          ...driftExceptions,
        ].sort((a, b) => {
          const riskOrder = { high: 0, medium: 1, low: 2 };
          const riskDiff = riskOrder[a.risk] - riskOrder[b.risk];
          if (riskDiff !== 0) return riskDiff;
          return a.projectName.localeCompare(b.projectName);
        });

        const highRiskExceptions = allExceptions.filter((e) => e.risk === "high").length;
        const mediumRiskExceptions = allExceptions.filter((e) => e.risk === "medium").length;
        const syncIsHealthy = syncHealth.integrations.every((i) => i.health === "healthy");
        const totalDrift = driftSummary.reduce((s, r) => s + r.unverified + r.verified, 0);
        const totalUnverified = driftSummary.reduce((s, r) => s + r.unverified, 0);

        const health = {
          programHealth: computeProgramHealth(highRiskExceptions, syncIsHealthy),
          dataConfidence: computeDataConfidence(
            allExceptions.length,
            highRiskExceptions,
          ),
          syncHealth: syncIsHealthy ? "healthy" : (syncHealth.anyStale ? "degraded" : "unknown"),
        };

        const cards = {
          highRiskExceptions,
          mediumRiskExceptions,
          financeExceptions: exceptionSummary.totalExceptionCount,
          invoiceWithoutPo: exceptionSummary.missingPoInvoices,
          unmatchedCostInvoices: exceptionSummary.unmatchedCostInvoices,
          unmatchedRevenuePayments: exceptionSummary.unmatchedRevenuePayments,
          driftTotal: totalDrift,
          unverifiedDrift: totalUnverified,
          staleTrackerData: 0, // populated in future via import run age
          missingInApp: 0,     // populated via unmapped project check
          missingInExcel: 0,
        };

        const trust = buildTrustMeta({
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines,work_items",
          derivedTable: "quickbooks_invoice_links",
          refreshedAt: new Date().toISOString(),
          staleAfterSeconds: 60,
          exceptionCount: allExceptions.length,
        });

        setFinanceTrustHeaders(res, {
          sourceLayer: "canonical",
          canonicalTable: "normalized_cost_lines,normalized_revenue_lines,work_items",
          derivedTable: "quickbooks_invoice_links",
          refreshedAt: new Date().toISOString(),
          staleAfterSeconds: 60,
          exceptionCount: allExceptions.length,
        });

        res.json({
          generatedAt: new Date().toISOString(),
          trust,
          health,
          cards,
          exceptions: allExceptions,
        });
      } catch (err) {
        console.error("[reconciliation] program-assessment error:", err);
        res.status(500).json({ error: "program_assessment_failed" });
      }
    },
  );

  // ── GET /api/reconciliation/truth-registry ──────────────────────────────
  app.get(
    "/api/reconciliation/truth-registry",
    requireAuth,
    requirePermission("excel_vs_app", "view"),
    async (_req: Request, res: Response) => {
      try {
        res.json({
          generatedAt: new Date().toISOString(),
          entries: KPI_REGISTRY,
          totalEntries: KPI_REGISTRY.length,
          managementReadyCount: KPI_REGISTRY.filter((e) => !e.hasKnownGaps).length,
        });
      } catch (err) {
        console.error("[reconciliation] truth-registry error:", err);
        res.status(500).json({ error: "truth_registry_failed" });
      }
    },
  );

  // ── GET /api/finance/reconciliation ─────────────────────────────────────
  // Portfolio board: per-project app-vs-tracker status + headline deltas, for
  // every active project. Reads the persisted financial_reconciliation rows.
  app.get(
    "/api/finance/reconciliation",
    requireAuth,
    requirePermission("financials", "view"),
    async (_req: Request, res: Response) => {
      try {
        const projects = await getReconciliationPortfolio(db);
        res.json({
          generatedAt: new Date().toISOString(),
          projects,
          summary: {
            total: projects.length,
            red: projects.filter((p) => p.status === "red").length,
            amber: projects.filter((p) => p.status === "amber").length,
            green: projects.filter((p) => p.status === "green").length,
            unknown: projects.filter((p) => p.status === "unknown").length,
          },
        });
      } catch (err) {
        console.error("[reconciliation] portfolio error:", err);
        res.status(500).json({ error: "reconciliation_portfolio_failed" });
      }
    },
  );

  // ── GET /api/finance/reconciliation/:projectId ──────────────────────────
  // Detail: contributing lines with revenue_derived / revenue_stored /
  // recon_delta + source_cell, flagging the offending line(s) the drawer drills to.
  app.get(
    "/api/finance/reconciliation/:projectId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      const projectId = parseIntParam(req.params.projectId);
      if (projectId == null) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      try {
        const detail = await getReconciliationDetail(db, projectId);
        res.json({ generatedAt: new Date().toISOString(), ...detail });
      } catch (err) {
        console.error("[reconciliation] detail error:", err);
        res.status(500).json({ error: "reconciliation_detail_failed" });
      }
    },
  );

  // ── POST /api/finance/reconciliation/refresh ────────────────────────────
  // On-demand recompute (the smart-import commit triggers this automatically).
  // Recomputes + snapshot-refreshes financial_reconciliation for all active
  // projects, or the optional `projectIds` body subset.
  app.post(
    "/api/finance/reconciliation/refresh",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as { projectIds?: unknown };
        const projectIds = Array.isArray(body.projectIds)
          ? body.projectIds.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
          : null;
        const summary = await refreshReconciliationForProjects(db, projectIds);
        res.json({ refreshedAt: new Date().toISOString(), ...summary });
      } catch (err) {
        console.error("[reconciliation] refresh error:", err);
        res.status(500).json({ error: "reconciliation_refresh_failed" });
      }
    },
  );

  // ── POST /api/finance/reconciliation/refresh-qb ─────────────────────────
  // P2.3 — consume the EXISTING QuickBooks comparison (the per-project gap) and
  // write tracker_vs_qb_status / tracker_vs_qb_delta into financial_reconciliation.
  // Needs a live QuickBooks connection (not part of the import); best-effort —
  // writes nothing when QB is unavailable. NEVER adjusts a tracker figure.
  app.post(
    "/api/finance/reconciliation/refresh-qb",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as { startDate?: unknown; endDate?: unknown };
        const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
        const startDate = isIso(body.startDate) ? body.startDate : "2000-01-01";
        const endDate = isIso(body.endDate) ? body.endDate : "2100-12-31";

        const gaps = await computeQbTrackerGapByProject(startDate, endDate);
        const result = await refreshTrackerVsQbForProjects(db, gaps);
        res.json({
          refreshedAt: new Date().toISOString(),
          projectsWithGap: gaps.size,
          rowsWritten: result.rowsWritten,
        });
      } catch (err) {
        console.error("[reconciliation] refresh-qb error:", err);
        res.status(500).json({ error: "reconciliation_refresh_qb_failed" });
      }
    },
  );
}
