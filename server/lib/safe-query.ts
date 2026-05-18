/**
 * Safe query helpers that enforce soft-delete filtering and query limits.
 *
 * Addresses:
 * - Missing `deletedAt IS NULL` filters on SELECT queries
 * - Unbounded result sets (missing .limit())
 * - Consistent soft-delete checking across the codebase
 */

import { isNull, SQL, type SQLWrapper } from "drizzle-orm";

/** Default maximum rows for list queries that don't specify a limit. */
export const DEFAULT_QUERY_LIMIT = 5000;

/**
 * Build a soft-delete filter condition for a table that has a `deletedAt` column.
 * Use in .where() clauses:
 *
 *   db.select().from(myTable).where(and(notDeleted(myTable.deletedAt), ...otherConditions))
 */
export function notDeleted(deletedAtColumn: SQLWrapper): SQL {
  return isNull(deletedAtColumn);
}

/**
 * Validate and clamp a user-supplied limit value.
 * Returns a safe integer between 1 and maxLimit.
 */
export function safeLimit(
  userLimit: unknown,
  defaultLimit: number = 50,
  maxLimit: number = DEFAULT_QUERY_LIMIT,
): number {
  const n = typeof userLimit === "string" ? parseInt(userLimit, 10) : Number(userLimit);
  if (!Number.isFinite(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}

/**
 * List of table names that have a deletedAt column.
 * Used for runtime checks and documentation.
 * Keep in sync with schema definitions.
 */
export const TABLES_WITH_SOFT_DELETE = new Set([
  // collaboration
  "meeting_summaries",
  "approvals",
  "feedback_tickets",
  "collaboration_stages",
  // collaboration-workflow
  // commissioning-source
  "commissioning_source_data",
  // construction
  "site_activities",
  "snags",
  "site_inspections",
  "contractor_assignments",
  // engineering
  "eng_stages",
  "eng_task_instances",
  // finance
  "program_expense",
  "program_inflows",
  "normalized_cost_lines",
  "normalized_revenue_lines",
  "cost_lines",
  "revenue_lines",
  "manual_balances",
  "opex_budgets",
  "opex_weekly_overrides",
  // handover
  "sseg_items",
  "lessons_learnt",
  "handover_stakeholders",
  // hse
  "hse_incidents",
  "corrective_actions",
  // imports
  "sp_files",
  // projects
  "project_execution_state",
  "project_info",
  // quality
  "qc_checklists",
  "deliverables",
  // tasks
  "work_items",
]);
