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
}
