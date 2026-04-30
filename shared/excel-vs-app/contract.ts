/**
 * Excel-vs-App contract — single source of truth.
 *
 * Three facts that determined drift detection used to live in three
 * separate places:
 *   1. Which fields participate in 3-way merge (the merge-field lists,
 *      previously `PLAN_MERGE_FIELDS` etc. in
 *      `server/lib/import/commit-executor.ts`).
 *   2. The shape of `manual_overrides` JSONB (previously the
 *      `ManualOverrideEntry` interface in
 *      `server/lib/import/merge-engine.ts`).
 *   3. The per-section roles that may resolve drift on the diff page
 *      (previously hard-coded inside `requirePermission` calls in the
 *      finance route files).
 *
 * Every consumer now reads from this module so the three facts cannot
 * silently drift apart. The failure mode of a divergence is not a
 * TypeScript error — it's a wrong drift count on the Excel-vs-App
 * diff page, or a UI that lets the wrong role resolve a drift. Hard
 * to detect at runtime, easy to detect by pinning the contract here.
 *
 * Sibling docs:
 *   - docs/excel-vs-app-diff-plan.md           — design (locked).
 *   - docs/excel-vs-app-workstream-b-impl.md   — file-by-file plan.
 *   - docs/reporting-audit-2026-04.md          — workstream A output.
 */
import { z } from "zod";
import type { CompanyRole } from "@shared/schema/users";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export type DiffSection = "PLAN" | "REVENUE" | "EXPENDITURE";

// ---------------------------------------------------------------------------
// Tracked field lists
// ---------------------------------------------------------------------------
//
// These are the fields that participate in the 3-way merge / drift
// detection. They are the canonical list — the import engine, the
// cell-edit override helper, and the diff page all use them.
//
// Adding a tracked field is an explicit decision: update the list and
// the snapshot test in `qa/tests/unit/excel-vs-app-contract.test.ts`
// will fail until you accept the new fixture.

/** Plan-section tracked fields (work_items). Includes the PR2A
 *  tracker columns alongside the legacy compare list. */
export const PLAN_TRACKED_FIELDS = [
  "startDate",
  "endDate",
  "duration",
  "actualStart",
  "actualEnd",
  "actualDuration",
  "ownerName",
  "status",
  "percentComplete",
  "expectedPctComplete",
  "description",
  "isMilestone",
  "outlineNumber",
  // PR2A tracker columns.
  "lead",
  "resource1",
  "resource2",
  "trackerComments",
  "workDays",
] as const;

/** Revenue-section tracked fields (normalized_revenue_lines). Manual-
 *  flag protection (`*Confirmed`) MUST flow through the merge engine
 *  so manual edits become conflicts when the workbook would change
 *  them. */
export const REVENUE_TRACKED_FIELDS = [
  "amountExVat",
  "vat",
  "milestonePercent",
  "invoiceNumber",
  "invoiceDate",
  "expectedPaymentDate",
  "paidDate",
  "inBankDate",
  "status",
  "invoiceDateConfirmed",
  "paidDateConfirmed",
  // PR2A tracker column.
  "milestoneNotes",
] as const;

/** Expenditure-section tracked fields (normalized_cost_lines). */
export const EXPENDITURE_TRACKED_FIELDS = [
  "amountExVat",
  "budgetQty",
  "budgetRate",
  "budgetTotal",
  "budgetCos",
  "invoiceNumber",
  "invoiceDate",
  "approvedDate",
  "paidDate",
  "forecastPaymentDate",
  "poNumber",
  "costCategory",
  "status",
  "counterpartyName",
  "revenueRecognitionAmount",
  // Manual-flag protection — see REVENUE_TRACKED_FIELDS comment.
  "invoiceDateConfirmed",
  "paidDateConfirmed",
  "cosRealised",
  "cashflowConfirmed",
  "noRevenueLinked",
  // PR2A tracker columns.
  "actualQty",
  "actualRate",
  "comments",
  "checkFlag",
  "savingOverrun",
  "usdExchangeRate",
  "pricePerWatt",
] as const;

export const TRACKED_FIELDS_BY_SECTION: Record<DiffSection, readonly string[]> = {
  PLAN: PLAN_TRACKED_FIELDS,
  REVENUE: REVENUE_TRACKED_FIELDS,
  EXPENDITURE: EXPENDITURE_TRACKED_FIELDS,
};

// ---------------------------------------------------------------------------
// Drift resolver roles
// ---------------------------------------------------------------------------
//
// Roles that may resolve a drift entry on a given section via the
// Excel-vs-App diff page. Mirrors the per-field edit middleware on
// the operational tabs. Server-side enforcement still happens via
// `requirePermission` on each endpoint; this list is the data the
// gates consume so there is no second copy of the role mapping.
//
// PLAN drift on a specific work item is also resolvable by the
// item's owner (`assignedToUserId == actor`) — that owner check is
// performed at the route layer because it depends on row data, not
// on the actor's role alone.

export const DRIFT_RESOLVER_ROLES: Record<DiffSection, readonly CompanyRole[]> = {
  PLAN: ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
  REVENUE: ["PROGRAM_FINANCE_MANAGER", "CCO", "CFO", "COO_ADMIN", "CEO_ADMIN"],
  EXPENDITURE: ["PROGRAM_FINANCE_MANAGER", "CFO", "COO_ADMIN", "CEO_ADMIN"],
};

// ---------------------------------------------------------------------------
// manual_overrides JSONB shape
// ---------------------------------------------------------------------------
//
// The single zod schema validates JSONB writes on every code path:
//   - The import engine on conflict resolution
//     (`server/lib/import/merge-engine.ts:updateManualOverrides`).
//   - The cell-edit helper introduced in workstream B
//     (`server/lib/manual-overrides.ts:applyManualOverride`).
//   - Future readers that want to validate row state before relying
//     on it.
//
// Drift between writers is impossible because both parse through this
// schema before the row write.

const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const manualOverrideEntrySchema = z.object({
  /** The value the user kept (the override). */
  value: fieldValueSchema,
  /** User id who made the edit (null for system-inferred entries). */
  editedBy: z.number().int().nullable(),
  /** ISO timestamp. */
  editedAt: z.string(),
  /** What the entry overrode — the live (Excel-truth) value at the
   *  time the override was first recorded. NEVER shifts on repeat
   *  edits; preserves the original Excel-truth so a "Reset to Excel"
   *  affordance can recover it. */
  fromValue: fieldValueSchema,
  /** Optional operator-supplied reason (Keep app + reason flow). */
  note: z.string().optional(),
});

export const manualOverridesMapSchema = z.record(manualOverrideEntrySchema);

export type ManualOverrideEntry = z.infer<typeof manualOverrideEntrySchema>;
export type ManualOverridesMap = z.infer<typeof manualOverridesMapSchema>;
