/**
 * Report revalidation helper.
 *
 * When finance-affecting changes happen (manual edits, Smart Imports,
 * admin overrides, tracker writes), downstream snapshot-style reports
 * (PM monthly, GP tracker, company overview) can drift until they are
 * refreshed. This helper inspects `change_sets` for recent finance events
 * and returns a short list of reports that likely need manual
 * revalidation.
 *
 * Strictly read-only. Does NOT trigger report regeneration — the existing
 * dashboard-refresh-service owns that side of the system.
 */
import { sql, and, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { changeSets } from "@shared/schema";

export interface RevalidationSuggestion {
  report: string;
  reason: string;
  severity: "info" | "warn" | "high";
  lastAffectedChangeAt: string | null;
}

export interface FinanceRevalidationStatus {
  generatedAt: string;
  windowHours: number;
  recentChangeSetCount: number;
  reportsNeedingRevalidation: RevalidationSuggestion[];
}

/** Entity types that touch finance KPIs downstream. */
const FINANCE_AFFECTING_ENTITY_TYPES = [
  "normalized_cost_lines",
  "normalized_revenue_lines",
  "cashflow_weekly_manual",
  "tracker_monthly_manual",
  "opex_budget_monthly",
  "available_payment_overrides",
  "category_revenue_allocations",
  "finance_cos_monthly",
  "finance_revenue_monthly",
  "quickbooks_invoice_link",
  "quickbooks_customer_mapping",
] as const;

/**
 * Report the set of downstream reports that likely need manual
 * revalidation because of recent finance-affecting edits in the window.
 */
export async function getFinanceRevalidationStatus(
  windowHours = 24,
): Promise<FinanceRevalidationStatus> {
  const safeHours = Math.max(1, Math.min(24 * 30, Math.trunc(windowHours)));
  const since = new Date(Date.now() - safeHours * 60 * 60 * 1000);

  const recentChanges = await db
    .select({
      id: changeSets.id,
      entityType: changeSets.entityType,
      action: changeSets.action,
      createdAt: changeSets.createdAt,
      source: changeSets.source,
    })
    .from(changeSets)
    .where(
      and(
        gte(changeSets.createdAt, since),
        inArray(
          changeSets.entityType,
          FINANCE_AFFECTING_ENTITY_TYPES as unknown as string[],
        ),
      ),
    )
    .limit(500);

  // Bucket by entity type → report.
  const lastAffectedByReport = new Map<string, Date>();
  const reasonByReport = new Map<string, string>();
  const severityByReport = new Map<string, RevalidationSuggestion["severity"]>();

  function note(
    report: string,
    reason: string,
    severity: RevalidationSuggestion["severity"],
    at: Date | null,
  ) {
    if (!reasonByReport.has(report)) {
      reasonByReport.set(report, reason);
      severityByReport.set(report, severity);
    }
    if (at) {
      const prev = lastAffectedByReport.get(report);
      if (!prev || at.getTime() > prev.getTime()) {
        lastAffectedByReport.set(report, at);
      }
    }
  }

  for (const change of recentChanges) {
    const at = change.createdAt ? new Date(change.createdAt) : null;
    const et = change.entityType;
    switch (et) {
      case "normalized_cost_lines":
      case "finance_cos_monthly":
        note("gp-tracker", "Cost lines changed since the last refresh.", "high", at);
        note("cos-tracker", "Cost lines changed since the last refresh.", "high", at);
        note("pm-monthly-report", "Cost inputs changed since monthly snapshot.", "high", at);
        note("company-overview", "Finance inputs changed since last snapshot.", "warn", at);
        break;
      case "normalized_revenue_lines":
      case "finance_revenue_monthly":
      case "category_revenue_allocations":
        note("revenue-tracker", "Revenue lines changed since the last refresh.", "high", at);
        note("gp-tracker", "Revenue lines changed since the last refresh.", "high", at);
        note("pm-monthly-report", "Revenue inputs changed since monthly snapshot.", "high", at);
        note("company-overview", "Finance inputs changed since last snapshot.", "warn", at);
        break;
      case "cashflow_weekly_manual":
      case "opex_budget_monthly":
      case "available_payment_overrides":
        note("weekly-cashflow", "Manual cashflow controls changed.", "warn", at);
        break;
      case "tracker_monthly_manual":
        note("gp-tracker", "Tracker monthly manual entries changed.", "warn", at);
        note("pm-monthly-report", "Tracker monthly manual entries changed.", "warn", at);
        break;
      case "quickbooks_invoice_link":
      case "quickbooks_customer_mapping":
        note(
          "quickbooks-reconciliation",
          "QuickBooks links or mappings changed — re-check reconciliation view.",
          "info",
          at,
        );
        break;
      default:
        break;
    }
  }

  const reportsNeedingRevalidation: RevalidationSuggestion[] = Array.from(
    reasonByReport.keys(),
  ).map((report) => ({
    report,
    reason: reasonByReport.get(report)!,
    severity: severityByReport.get(report) ?? "info",
    lastAffectedChangeAt:
      lastAffectedByReport.get(report)?.toISOString() ?? null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    windowHours: safeHours,
    recentChangeSetCount: recentChanges.length,
    reportsNeedingRevalidation,
  };
}

// Suppress unused-import false-positive — sql is kept for future raw
// aggregations (e.g. grouping by day once the window is large).
void sql;
