/**
 * Finance Policy — Single source of truth for all finance business rules.
 *
 * Every finance write, COS realisation check, and programExpense gate
 * MUST go through this module. No duplicate finance rules elsewhere.
 */

// Re-export the canonical COS realisation from its implementation
export { isCanonicalCosRealised } from "../lib/finance/cos-realisation";
export type { CosLineInput } from "../lib/finance/cos-realisation";

// ---------------------------------------------------------------------------
// Policy: Manual expenses MUST have a projectId
// ---------------------------------------------------------------------------

export class MissingProjectIdError extends Error {
  constructor() {
    super("Manual expense requires a valid projectId. Expenses without a project assignment cannot be saved.");
    this.name = "MissingProjectIdError";
  }
}

/**
 * Validates that a manual expense has a resolvable project assignment.
 * Throws MissingProjectIdError if projectId is null/undefined after resolution.
 */
export function requireProjectId(projectId: number | null | undefined): asserts projectId is number {
  if (projectId == null || projectId <= 0) {
    throw new MissingProjectIdError();
  }
}

// ---------------------------------------------------------------------------
// Policy: Finance writes require transaction boundaries
// ---------------------------------------------------------------------------

/**
 * Marker type for database transaction context.
 * Finance writes that touch multiple tables MUST accept a transaction parameter.
 */
export type FinanceTransactionContext = {
  /** True if this operation is running inside an explicit transaction */
  inTransaction: boolean;
};

/**
 * Asserts that a finance write operation is running inside a transaction.
 * Used for multi-table writes (e.g., cost line + bridge sync).
 */
export function requireTransaction(ctx: FinanceTransactionContext, operation: string): void {
  if (!ctx.inTransaction) {
    console.warn(`[finance-policy] ${operation} should run inside a transaction for data consistency`);
  }
}

// ---------------------------------------------------------------------------
// Policy: COS realisation — unified wrapper for all callers
// ---------------------------------------------------------------------------

import { isCanonicalCosRealised as _isCanonical, type CosLineInput as _Input } from "../lib/finance/cos-realisation";

/**
 * Determine if a cost line is "realised" for tracker, dashboard, and KPI purposes.
 * This is the ONLY function any caller should use for COS realisation checks.
 *
 * @param line - The cost line data (status, overrides, dates)
 * @param today - ISO date string for "today" (use actual date, not month-end)
 */
export function isCosRealised(line: {
  status: string | null;
  cosStatusOverride: string | null;
  cosRealised?: boolean | null;
  expenseInvoiceNumber?: string | null;
  expenseInvoicedDate: string | null;
  expensePoNumber?: string | null;
  paymentDate?: string | null;
}, today: string): boolean {
  return _isCanonical({
    status: line.status,
    cosStatusOverride: line.cosStatusOverride,
    cosRealised: line.cosRealised ?? null,
    expenseInvoiceNumber: line.expenseInvoiceNumber ?? null,
    expenseInvoicedDate: line.expenseInvoicedDate,
    expensePoNumber: line.expensePoNumber ?? null,
    paymentDate: line.paymentDate ?? null,
    today,
  });
}

// ---------------------------------------------------------------------------
// Policy: Finance model file paths (for release gate detection)
// ---------------------------------------------------------------------------

/**
 * File paths that constitute the "finance model".
 * Changes to these files trigger the reconciliation-status.json requirement.
 */
export const FINANCE_MODEL_PATHS = [
  "server/lib/finance/",
  "server/lib/calculations/financeUtils.ts",
  "server/services/finance-line-write-service.ts",
  "server/services/dashboard-metrics.ts",
  "server/services/project-header-kpi-service.ts",
  "server/services/canonical-dashboard-kpi-service.ts",
  "server/services/company-overview-service.ts",
  "server/services/pm-monthly-report-service.ts",
  "server/bridge/bridge-writer.ts",
  "shared/schema/finance.ts",
  "server/departments/finance-routes.ts",
  "server/departments/fye-revenue-tracking-routes.ts",
  "server/routes/cos-control-routes.ts",
] as const;

/**
 * Check if a list of changed files includes any finance model paths.
 */
export function hasFinanceModelChanges(changedFiles: string[]): boolean {
  return changedFiles.some(file =>
    FINANCE_MODEL_PATHS.some(fp => file.includes(fp))
  );
}
