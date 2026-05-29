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

// 2026-05-29 — faithful-mirror reversal (COO instruction, this session):
//   "Should be a full faithful mirror on the Revenue tracker sheet, Plan
//    sheet and Expenditure breakdown sheet — we use the import for
//    reporting so it must be identical to the file."
//
// This widens the field set the import re-applies on every re-import so
// the app's data stays identical to the workbook. It reverses the
// 2026-05-07 narrowing below (kept for history). The trigger was a
// confirmed bug: a revenue invoice number added to a milestone AFTER its
// row first imported was silently dropped, because `invoiceNumber` was
// not in the tracked/compared set — so the re-import classified the row
// UNCHANGED and skipped it. Same class of drop hit milestone %, PO
// numbers, and the Plan display fields.
//
// Two controls, deliberately separated (see also row-matcher.ts):
//   - TRACKED_FIELDS (this file) = the 3-way-merge / drift set. These
//     participate in conflict detection on the diff page and are
//     edit-protected (a manual app edit is preserved / surfaces a
//     conflict rather than being clobbered by the file).
//   - *_COMPARE_FIELDS (row-matcher.ts) = the change-detection set that
//     decides CHANGED vs UNCHANGED. It is a SUPERSET of the tracked set:
//     it also carries file-owned, non-edited fields (e.g. costCategory,
//     counterpartyName, Plan title/owner/resources) that must refresh
//     from the file but do not need conflict resolution. Invariant:
//     every TRACKED field is also a COMPARE field, so a tracked-field
//     change can never be missed by classification.
//
// What stays OUT of the tracked set on purpose: DERIVED fields (status,
// cosRealised, cashflowConfirmed are recomputed from their inputs),
// row-identity fields (milestoneNo / milestoneName, expenditure
// description+invoice — a change there is a new/renamed row, handled by
// the matcher), and app-owned override columns (admin/cos overrides,
// noRevenueLinked, task links) which the merge already protects.
//
// 2026-05-07 — narrowing per COO instruction (SUPERSEDED 2026-05-29):
//   "On the Excel-vs-App comparison only things to compare are dates,
//    amounts, deleted entries vs added entries, date colour (confirms
//    payment or realisation)."
//   At the time, text / identifier / status / derived metadata
//   (invoiceNumber, poNumber, milestonePercent, costCategory, notes,
//   etc.) were dropped to keep the diff page quiet. The reporting-trust
//   requirement above outranks the quiet-diff goal, so the data fields
//   are back in.
//
// What date-colour comparison maps to:
//   - In the Tracker, a date cell is RED when the date is unconfirmed
//     (planned / forecast) and BLACK when the date is confirmed
//     (paid / realised). The normaliser already encodes that signal
//     into the `*Confirmed` boolean columns
//     (`paidDateConfirmed`, `invoiceDateConfirmed`, `cosRealised`,
//     `cashflowConfirmed` — see normalizer.ts:classifyColorHex), so
//     comparing those flags IS comparing the colour. They stay in
//     the tracked list for that reason — they are the date-colour.
//
// Row add / delete (workbook vs app):
//   - The planner already tracks "missing from upload" rows and the
//     diff page already exposes added rows as new-row entries. No
//     changes needed for that here — it isn't a per-field drift, it's
//     a row-level operation.

/** Plan-section tracked fields (work_items) — DATES ONLY. */
export const PLAN_TRACKED_FIELDS = [
  // Primary (actual ?? planned) — what the rest of the app displays.
  "startDate",
  "endDate",
  // Planned values, preserved by the import (see commit-executor.ts
  // 2026-05-07 product change). Tracked so the diff catches workbook
  // edits to planned dates.
  "baselineStart",
  "baselineEnd",
  // Pure-actual columns from the workbook.
  "actualStart",
  "actualEnd",
] as const;

/** Revenue-section tracked fields (normalized_revenue_lines) —
 *  AMOUNTS + DATES + DATE-COLOUR (= *Confirmed flags) + FAITHFUL-MIRROR
 *  DATA (invoice number, milestone %, milestone notes — 2026-05-29). */
export const REVENUE_TRACKED_FIELDS = [
  // Amounts.
  "amountExVat",
  "vat",
  // Faithful-mirror data fields (2026-05-29): identifiers / structured
  // values the reporting layer relies on. Previously dropped on re-import.
  "invoiceNumber",
  "milestonePercent",
  "milestoneNotes",
  // Dates.
  "invoiceDate",
  "expectedPaymentDate",
  "paidDate",
  "inBankDate",
  // Date-colour signal: black = confirmed/realised, red = unconfirmed.
  "invoiceDateConfirmed",
  "paidDateConfirmed",
] as const;

/** Expenditure-section tracked fields (normalized_cost_lines) —
 *  AMOUNTS + DATES + DATE-COLOUR (= *Confirmed flags) + FAITHFUL-MIRROR
 *  DATA (PO number, comments, check flag, FX rate, etc. — 2026-05-29).
 *  Note: invoiceNumber + description are part of the expenditure row
 *  identity (see row-hasher.ts), so a change there is a new/renamed row,
 *  not a tracked-field drift — they are intentionally absent here. */
export const EXPENDITURE_TRACKED_FIELDS = [
  // Amounts (incl. budget components and qty/rate that resolve to
  // monetary line totals).
  "amountExVat",
  "budgetQty",
  "budgetRate",
  "budgetTotal",
  "budgetCos",
  "actualQty",
  "actualRate",
  "revenueRecognitionAmount",
  // Faithful-mirror data fields (2026-05-29): identifiers / structured
  // values the reporting layer relies on. Previously dropped on re-import.
  "poNumber",
  "comments",
  "checkFlag",
  "savingOverrun",
  "usdExchangeRate",
  "pricePerWatt",
  // Dates.
  "invoiceDate",
  "approvedDate",
  "paidDate",
  "forecastPaymentDate",
  // Date-colour signal: black = confirmed/realised, red = unconfirmed.
  "invoiceDateConfirmed",
  "paidDateConfirmed",
  "cosRealised",
  "cashflowConfirmed",
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
