import ExcelJS from "exceljs";
import { normalizeWithLegacy } from "@shared/utils/status-normalization";

// Excel formula error values — these should be treated as null
const EXCEL_ERRORS = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?", "#NULL!", "#NUM!"]);

function isExcelError(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "object") {
    const err = (value as { error?: unknown }).error;
    if (typeof err === "string" && EXCEL_ERRORS.has(err)) return true;
  }
  if (typeof value === "string" && EXCEL_ERRORS.has(value.trim())) return true;
  return false;
}

function excelSerialToDate(serial: number): { y: number; m: number; d: number } | null {
  if (serial < 1) return null;
  if (serial > 59) serial -= 1;
  const epoch = new Date(1899, 11, 31);
  const date = new Date(epoch.getTime() + serial * 86400000);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function isDateLike(v: unknown): v is Date {
  return v != null && Object.prototype.toString.call(v) === "[object Date]" && !isNaN((v as Date).getTime());
}

export function parseDate(value: unknown): string | null {
  if (!value) return null;
  if (isExcelError(value)) return null;

  // ExcelJS returns formula cells as { formula, result } or { sharedFormula, result }.
  // Unwrap to the cached result before any further checks. Cross-realm safe via toString.
  if (typeof value === "object" && !isDateLike(value) && "result" in value) {
    value = (value as { result?: unknown }).result;
    if (!value) return null;
    if (isExcelError(value)) return null;
  }

  if (isDateLike(value)) {
    return (value as Date).toISOString().split("T")[0];
  }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "number") {
    try {
      const date = excelSerialToDate(value);
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
      }
    } catch {
      return null;
    }
  }

  if (typeof value === "string") {
    // Match canonical date-only forms first to avoid local-timezone drift
    // from `new Date(...)` interpreting "YYYY-MM-DD" as UTC midnight.
    const yyyymmdd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (yyyymmdd) {
      return value.substring(0, 10);
    }

    const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsed.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

/**
 * Replicates the workbook formula `IF(W>1, EOMONTH(W,0), "")` used for
 * INVOICE RAISED DATE on the Expenditure Breakdown sheet. When a workbook is
 * saved without cached formula results, the invoice date cell may be empty.
 * This derives the same end-of-month value from the payment date so the
 * importer matches the Finance-COS pivot regardless of cache state.
 */
export function lastDayOfMonthFromDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const [y, m] = dateStr.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  const eom = new Date(Date.UTC(y, m, 0));
  if (isNaN(eom.getTime())) return null;
  return eom.toISOString().split("T")[0];
}

export function parseNumber(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (isExcelError(value)) return null;
  const num = parseFloat(String(value).replace(/[,$]/g, ""));
  return isNaN(num) ? null : String(num);
}

export function parsePercent(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  let num = parseFloat(String(value).replace(/%/g, ""));
  if (isNaN(num)) return null;
  if (num > 1 && num <= 100) num = num / 100;
  return String(num);
}

export function parseStatus(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return value > 1 ? value / 100 : value;
  }

  if (typeof value === "string") {
    const num = parseFloat(value.replace(/%/g, ""));
    if (!isNaN(num)) {
      return num > 1 ? num / 100 : num;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Import-time enum normalizers
//
// These map messy / legacy / mixed-case import values to the canonical
// lowercase_underscore enum values that exist in the live PostgreSQL enums.
// They are the single source of truth for any Smart Import write path and
// MUST be called at every boundary that writes to normalized_cost_lines,
// normalized_revenue_lines, category_revenue_allocations, or smart_import_runs.
//
// If you catch yourself typing a string literal like "PAID" or "PROVISIONAL"
// in runtime code, use one of these helpers instead. See also the repo-level
// invariant test at qa/tests/unit/smart-import-enum-canonical.test.ts which
// asserts these constants match the pgEnum definitions in shared/schema.
// ---------------------------------------------------------------------------

export type CostLineStatus = "planned" | "invoiced" | "approved" | "paid";

export const COST_LINE_STATUS_VALUES: readonly CostLineStatus[] = [
  "planned",
  "invoiced",
  "approved",
  "paid",
] as const;

const CANONICAL_COST_LINE_STATUSES = new Set<CostLineStatus>(COST_LINE_STATUS_VALUES);

/**
 * Normalize imported Smart Import cost line status values to the canonical
 * cost_line_status enum values. Unknown or blank values default to "planned".
 *
 * Handles: PAID / Paid / paid, APPROVED / approved, INVOICED / Invoice /
 * invoice / invoices / billed, PLANNED / planned, plus the legacy
 * lookalikes ("authorised", "authorized", "settled", "pay").
 */
export function normalizeCostLineStatus(value: unknown): CostLineStatus {
  const normalized = normalizeWithLegacy(value == null ? "" : String(value));
  if (!normalized) return "planned";
  if (CANONICAL_COST_LINE_STATUSES.has(normalized as CostLineStatus)) {
    return normalized as CostLineStatus;
  }

  if (normalized === "invoice" || normalized === "invoices" || normalized === "billed") {
    return "invoiced";
  }
  if (normalized === "approve" || normalized === "authorised" || normalized === "authorized") {
    return "approved";
  }
  if (normalized === "pay" || normalized === "settled") {
    return "paid";
  }

  return "planned";
}

export type RevenueLineStatus = "planned" | "invoiced" | "paid" | "in_bank" | "realised";

export const REVENUE_LINE_STATUS_VALUES: readonly RevenueLineStatus[] = [
  "planned",
  "invoiced",
  "paid",
  "in_bank",
  "realised",
] as const;

const CANONICAL_REVENUE_LINE_STATUSES = new Set<RevenueLineStatus>(REVENUE_LINE_STATUS_VALUES);

/**
 * Normalize imported Smart Import revenue line status values to the canonical
 * revenue_line_status enum values. Unknown or blank values default to "planned".
 */
export function normalizeRevenueLineStatus(value: unknown): RevenueLineStatus {
  const normalized = normalizeWithLegacy(value == null ? "" : String(value));
  if (!normalized) return "planned";
  if (CANONICAL_REVENUE_LINE_STATUSES.has(normalized as RevenueLineStatus)) {
    return normalized as RevenueLineStatus;
  }

  if (normalized === "invoice" || normalized === "invoices" || normalized === "billed") {
    return "invoiced";
  }
  if (normalized === "pay" || normalized === "settled") {
    return "paid";
  }
  if (normalized === "in_the_bank" || normalized === "bank" || normalized === "received") {
    return "in_bank";
  }
  if (normalized === "realized") {
    return "realised";
  }

  return "planned";
}

export type AllocationConfidence =
  | "direct"
  | "header_error_positional"
  | "provisional"
  | "manual";

export const ALLOCATION_CONFIDENCE_VALUES: readonly AllocationConfidence[] = [
  "direct",
  "header_error_positional",
  "provisional",
  "manual",
] as const;

const CANONICAL_ALLOCATION_CONFIDENCES = new Set<AllocationConfidence>(
  ALLOCATION_CONFIDENCE_VALUES,
);

/**
 * Normalize a category_revenue_allocations.allocation_confidence value to
 * the canonical lowercase enum literal. Accepts UPPERCASE / mixed-case
 * legacy inputs ("DIRECT", "Provisional", etc.) transparently. Defaults to
 * "provisional" for unknown / blank values so category allocation writes
 * never break downstream on enum_in.
 */
export function normalizeAllocationConfidence(value: unknown): AllocationConfidence {
  const normalized = normalizeWithLegacy(value == null ? "" : String(value));
  if (!normalized) return "provisional";
  if (CANONICAL_ALLOCATION_CONFIDENCES.has(normalized as AllocationConfidence)) {
    return normalized as AllocationConfidence;
  }
  // Tolerate the historical shorthand "positional" used in early parser code.
  if (normalized === "positional" || normalized === "header_positional") {
    return "header_error_positional";
  }
  if (normalized === "direct_extraction") {
    return "direct";
  }
  return "provisional";
}

export type SmartImportStatus =
  | "preview"
  | "awaiting_review"
  | "committed"
  | "rolled_back"
  | "failed"
  | "superseded";

export const SMART_IMPORT_STATUS_VALUES: readonly SmartImportStatus[] = [
  "preview",
  "awaiting_review",
  "committed",
  "rolled_back",
  "failed",
  "superseded",
] as const;

const CANONICAL_SMART_IMPORT_STATUSES = new Set<SmartImportStatus>(SMART_IMPORT_STATUS_VALUES);

/**
 * Normalize a smart_import_runs.status value to the canonical lowercase
 * enum literal. Callers must use this (or a SMART_IMPORT_STATUS_VALUES
 * constant) instead of hardcoding "FAILED" / "COMMITTED" / etc., otherwise
 * the DB will reject the value with SQLSTATE 22P02 (invalid_text_representation).
 */
export function normalizeSmartImportStatus(value: unknown): SmartImportStatus | null {
  const normalized = normalizeWithLegacy(value == null ? "" : String(value));
  if (!normalized) return null;
  if (CANONICAL_SMART_IMPORT_STATUSES.has(normalized as SmartImportStatus)) {
    return normalized as SmartImportStatus;
  }
  return null;
}

export function getCellRawValue(cell: ExcelJS.Cell): unknown {
  if (!cell || !cell.value) return null;
  const v: unknown = cell.value;
  if (typeof v === "object" && v !== null) {
    if ("result" in v) return (v as { result: unknown }).result;
    if ("error" in v) return null;
    if (v instanceof Date) return v;
    if ("richText" in v) {
      const rt = (v as { richText: Array<{ text: string }> }).richText;
      return rt.map((seg) => seg.text).join("");
    }
    if ("text" in v) return (v as { text: unknown }).text;
  }
  return v;
}

export function worksheetToArray(ws: ExcelJS.Worksheet): unknown[][] {
  const data: unknown[][] = [];
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const rowData: unknown[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      rowData.push(getCellRawValue(cell));
    }
    data.push(rowData);
  }
  return data;
}

export function normalizeHeader(header: unknown): string {
  return String(header || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, " ")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.substring(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.substring(i, i + 2));
  }

  let intersection = 0;
  for (const bg of Array.from(bigramsA)) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

export function daysBetween(dateA: string, dateB: string): number | null {
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
