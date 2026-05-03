/**
 * Deterministic row identity for the Smart Import 3-way merge engine.
 *
 * Every imported row gets a SHA-256-based `row_hash` derived from its
 * identity columns. The same logical row in the source workbook produces
 * the same hash on every re-import, so the merge engine can match an
 * incoming row to its existing DB row in O(log n) via the partial
 * index `(project_id, row_hash) WHERE <active>`.
 *
 * **Versioning rule:** if the recipe for a section's identity changes
 * (e.g. you decide invoice_number is no longer part of expenditure
 * identity), bump that section's `HASH_VERSION_*` constant. The
 * version is included in the hash input so the new recipe produces a
 * disjoint hash space; old rows keep their old hashes and are matched
 * either via fallback heuristics or rebuilt on next import.
 *
 * **Normalization rules** (applied to every identity field before
 * concatenation):
 *   - null / undefined / empty string  → "" (collapsed to a single token)
 *   - leading/trailing whitespace      → trimmed
 *   - case                             → lowercased
 *   - internal runs of whitespace      → single space
 *
 * Identity fields are joined with `` (ASCII unit separator) so
 * a value containing the separator can't collide with the next field.
 * The version + section name are prepended so cross-section collisions
 * are impossible.
 */

import { createHash } from "node:crypto";

const HASH_VERSION_PLAN = 1;
const HASH_VERSION_REVENUE = 1;
const HASH_VERSION_EXPENDITURE = 1;
const HASH_VERSION_ACTUAL = 1;

const FIELD_SEPARATOR = "";

function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim().toLowerCase();
  if (!s) return "";
  // Collapse internal whitespace runs.
  return s.replace(/\s+/g, " ");
}

function hashIdentity(version: number, section: string, parts: unknown[]): string {
  const normalized = parts.map(normalize);
  const payload = [String(version), section, ...normalized].join(FIELD_SEPARATOR);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * PLAN identity = (project_id, WBS code, title fallback).
 *
 * Tracker col A (WBS) is the primary key when present — the workbook
 * convention is that "1.2.3" is a stable identifier for that node.
 * Falls back to title when WBS is missing (some legacy trackers omit it).
 */
export function hashPlanRow(input: {
  projectId: number | string;
  wbsCode?: string | null;
  outlineNumber?: string | null;
  externalRef?: string | null;
  title?: string | null;
}): string {
  const wbs = input.wbsCode || input.outlineNumber || input.externalRef || "";
  return hashIdentity(HASH_VERSION_PLAN, "PLAN", [
    input.projectId,
    wbs,
    // Title is a tiebreaker only when WBS is empty. Including it
    // unconditionally would make a WBS-stable row's hash flip every
    // time someone clarifies the task name in the workbook.
    wbs ? "" : (input.title ?? ""),
  ]);
}

/**
 * REVENUE identity = (project_id, milestone_no, milestone_name fallback,
 * amount_ex_vat fallback).
 *
 * Milestone numbers (Tracker col B) are the canonical key. When the
 * workbook omits a number for a milestone, we fall back to the
 * (name, amount) pair which is the natural identifier in that case.
 */
export function hashRevenueRow(input: {
  projectId: number | string;
  milestoneNo?: string | null;
  milestoneName?: string | null;
  amountExVat?: string | number | null;
}): string {
  const no = normalize(input.milestoneNo);
  return hashIdentity(HASH_VERSION_REVENUE, "REVENUE", [
    input.projectId,
    no,
    no ? "" : (input.milestoneName ?? ""),
    no ? "" : (input.amountExVat ?? ""),
  ]);
}

/**
 * EXPENDITURE identity = (project_id, category_key, description,
 * invoice_number fallback).
 *
 * Cost lines are identified by category + description in the costed
 * pane. Invoice number is added as a tiebreaker because the same
 * description can repeat across batched invoices. PO number is
 * intentionally NOT in the identity — it's manually edited frequently
 * and would cause spurious mismatches.
 */
export function hashExpenditureRow(input: {
  projectId: number | string;
  categoryKey?: string | null;
  costCategory?: string | null;
  description?: string | null;
  invoiceNumber?: string | null;
}): string {
  return hashIdentity(HASH_VERSION_EXPENDITURE, "EXPENDITURE", [
    input.projectId,
    input.categoryKey || input.costCategory || "",
    input.description ?? "",
    input.invoiceNumber ?? "",
  ]);
}

/**
 * ACTUAL-row identity = (cost_line_id, actual_no, invoice_number,
 * invoice_date).
 *
 * One costed line can have N actual entries (multiple invoice batches).
 * The pair (actual_no, invoice_number) is the natural identifier within
 * the parent costed line; date is added so the same invoice number
 * issued in different periods doesn't collide.
 */
export function hashActualRow(input: {
  costLineId: number | string;
  actualNo: number | string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
}): string {
  return hashIdentity(HASH_VERSION_ACTUAL, "ACTUAL", [
    input.costLineId,
    input.actualNo,
    input.invoiceNumber ?? "",
    input.invoiceDate ?? "",
  ]);
}
