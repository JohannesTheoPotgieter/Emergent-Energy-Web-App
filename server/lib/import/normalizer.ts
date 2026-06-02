import type ExcelJS from "exceljs";
import type { DetectionResult } from "./detector";
import type { MappingResult } from "./mapper";
import { worksheetToArray, parseDate, parseNumber, parsePercent, parseStatus, daysBetween } from "./utils";

/**
 * Per-cell formatting captured from the source workbook, keyed by canonical
 * field name. The Tracker uses font and fill colour to encode meaning
 * (red font = unconfirmed, yellow fill = risk, etc.) — preserving these in
 * a JSONB blob lets downstream UI render the same visual cues without
 * needing access to the original file.
 */
export type CellFormatMap = Record<string, { font?: string; fill?: string; bold?: boolean }>;

export interface NormalizationResult {
  planTasks: Array<{
    taskName: string;
    taskNo: string | null;
    phase: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    actualDurationDays: number | null;
    owner: string | null;
    status: string | null;
    pctComplete: number | null;
    expectedPctComplete: number | null;
    comment: string | null;
    isMilestone: boolean;
    parentTaskNo: string | null;
    indentLevel: number;
    sourceSheet: string;
    sourceRow: number;
    subProjectName: string | null;
    // Tracker columns wired in PR2A — see synonyms.ts comments. All optional;
    // older trackers without these columns import unchanged.
    lead: string | null;
    resource1: string | null;
    resource2: string | null;
    trackerComments: string | null;
    workDays: number | null;
    /** Per-cell font/fill colour, keyed by canonical field name. */
    cellFormat: CellFormatMap | null;
  }>;
  revenueLines: Array<{
    description: string | null;
    milestoneName: string | null;
    milestoneNo: string | null;
    milestonePercent: string | null;
    amountExVat: string | null;
    vat: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    invoiceDateFontColor: string | null;
    invoiceDateConfirmed: boolean | null;
    expectedPaymentDate: string | null;
    paidDate: string | null;
    paidDateFontColor: string | null;
    paidDateConfirmed: boolean | null;
    inBankDate: string | null;
    status: "PLANNED" | "INVOICED" | "PAID" | "IN_BANK" | "REALISED";
    sourceSheet: string;
    sourceRow: number;
    turnaroundDays: number | null;
    subProjectName: string | null;
    // Tracker col R — Milestone Notes & Comments (PR2A wiring).
    milestoneNotes: string | null;
    /** Per-cell font/fill colour, keyed by canonical field name. */
    cellFormat: CellFormatMap | null;
  }>;
  costLines: Array<{
    costCategory: string | null;
    /** Canonical numbered category key, e.g. "1. Panels". Always includes numeric prefix. */
    categoryKey: string | null;
    counterpartyName: string | null;
    description: string | null;
    amountExVat: string | null;
    budgetQty: string | null;
    budgetRate: string | null;
    budgetTotal: string | null;
    budgetCos: string | null;
    actualCos: string | null;
    revenueRecognitionAmount: string | null;
    forecastPaymentDate: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    invoiceDateFontColor: string | null;
    invoiceDateConfirmed: boolean | null;
    approvedDate: string | null;
    paidDate: string | null;
    paidDateFontColor: string | null;
    paidDateConfirmed: boolean | null;
    poNumber: string | null;
    cosRealised: boolean | null;
    cashflowConfirmed: boolean | null;
    status: "PLANNED" | "INVOICED" | "APPROVED" | "PAID";
    sourceSheet: string;
    sourceRow: number;
    turnaroundDays: number | null;
    subProjectName: string | null;
    // Tracker columns wired in PR2A. Numeric fields stored as text (matches
    // the existing budgetTotal/amountExVat pattern — actual numeric coercion
    // happens at insert time).
    actualQty: string | null;
    actualRate: string | null;
    comments: string | null;
    checkFlag: string | null;
    savingOverrun: string | null;
    usdExchangeRate: string | null;
    pricePerWatt: string | null;
    /** Per-cell font/fill colour, keyed by canonical field name. */
    cellFormat: CellFormatMap | null;
  }>;
  /**
   * 1:N actual-line entries from the Expenditure Breakdown's right-hand
   * pane. The Tracker pairs costed items with their actual invoices; when
   * a costed line settles across multiple invoice batches the actual side
   * has more rows than the costed side, and these orphan actual rows used
   * to be silently dropped. Each entry links back to its parent costed
   * line by `parentSourceRow` (matched in the executor) and gets its own
   * row in `normalized_cost_line_actuals`.
   */
  actualLineRows: Array<{
    parentCategoryKey: string | null;
    parentSourceRow: number;
    actualNo: number;
    description: string | null;
    qty: string | null;
    rate: string | null;
    actualTotal: string | null;
    poNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    revenueRecognitionAmount: string | null;
    financePaymentDate: string | null;
    comments: string | null;
    checkFlag: string | null;
    savingOverrun: string | null;
    cellFormat: CellFormatMap | null;
    sourceSheet: string;
    sourceRow: number;
  }>;
  executionPhases: Array<{
    phaseName: string;
    phaseDate: string | null;
  }>;
  counterpartyNames: string[];
  /** Per-category revenue allocation values (J_cat) extracted from the budget pane. */
  categoryAllocations: Array<{
    categoryNumber: string;
    categoryName: string;
    categoryKey: string;
    categorySortOrder: number;
    revenueAllocation: number | null;
    cosTotalCosted: number | null;
    budgetTotal: number | null;
    allocationSource: "DIRECT_EXTRACTION" | "HEADER_ERROR_POSITIONAL" | "NOT_FOUND";
    sourceSheet: string;
    sourceRow: number;
  }>;
  costedSummary: {
    plannedRevenue: number | null;
    plannedExpenditure: number | null;
    plannedProfit: number | null;
    plannedMargin: number | null;
    actualRevenue: number | null;
    actualExpenditure: number | null;
    actualProfit: number | null;
    actualMargin: number | null;
  } | null;
  /**
   * Top-of-sheet metadata block from the Project Plan tab (rows 1–7).
   * The values are scalar per-project (one row per import in
   * `tracker_project_metadata`). When the workbook doesn't contain
   * the labels, this is left null and the writer skips gracefully.
   */
  projectPlanMetadata: {
    baselineCompletionDate: string | null;
    forecastedCompletionDate: string | null;
    projectStartDate: string | null;
    durationMonthsFromSiteEstab: number | null;
    durationMonthsToCapacityTest: number | null;
    sourceSheet: string | null;
    cellFormat: CellFormatMap | null;
  } | null;
  /**
   * Source sheet for the costedSummary values (Revenue Tracking sheet) —
   * captured so the writer for `tracker_revenue_summary` can record where
   * the values came from. Null when no Revenue section was detected.
   */
  costedSummarySource: { sourceSheet: string; cellFormat: CellFormatMap | null } | null;
  issues: Array<{
    severity: "INFO" | "WARNING" | "BLOCKER";
    section: "PLAN" | "REVENUE" | "EXPENDITURE" | "GENERAL";
    message: string;
    suggestedAction: string | null;
    issueType: string;
    issueFingerprint: string;
    payloadJson: any;
  }>;
}

type SectionType = "PLAN" | "REVENUE" | "EXPENDITURE";
type IssueEntry = NormalizationResult["issues"][number];
type CategoryAllocationEntry = NormalizationResult["categoryAllocations"][number];

// ---------------------------------------------------------------------------
// Placeholder invoice blocklist (S07)
// These values in the invoice number field do NOT indicate a captured supplier invoice.
// ---------------------------------------------------------------------------
const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd",
]);

/**
 * Returns true if an invoice number is a real captured supplier invoice,
 * not a placeholder or empty value.
 */
export function isValidInvoiceNumber(invoiceNumber: string | null | undefined): boolean {
  if (!invoiceNumber) return false;
  const trimmed = invoiceNumber.trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_INVOICES.has(trimmed.toLowerCase());
}

/**
 * Normalize a category key to canonical "N. Name" format.
 * Handles: "1. Panels", "1.Panels", "1 Panels", "7.BESS" → "N. Name".
 */
export function normalizeCategoryKey(raw: string): string {
  const match = raw.match(/^(\d+)\.?\s*(.*)/);
  if (!match) return raw.trim();
  const num = match[1];
  const name = match[2].trim();
  return `${num}. ${name}`;
}

function makeFingerprint(issueType: string, section: string, key: string): string {
  return `${issueType}::${section}::${key}`;
}

function extractCostedSummary(
  data: any[][],
  headerRowIndex: number
): NormalizationResult["costedSummary"] {
  let plannedRevenue: number | null = null;
  let plannedExpenditure: number | null = null;
  let plannedProfit: number | null = null;
  let plannedMargin: number | null = null;
  let actualRevenue: number | null = null;
  let actualExpenditure: number | null = null;
  let actualProfit: number | null = null;
  let actualMargin: number | null = null;

  const scanEnd = Math.min(headerRowIndex, data.length);
  for (let i = 0; i < scanEnd; i++) {
    const row = data[i];
    if (!row) continue;

    for (let c = 0; c < Math.min(row.length, 6); c++) {
      const cellVal = String(row[c] || "").toLowerCase().trim();
      if (!cellVal) continue;

      // Planned/costed value: first numeric value after the label (column D)
      const valueCol = findNumericValueInRow(row, c + 1);
      // Actual value: look further right (column F, typically c+3 or c+4)
      const actualCol = findNumericValueInRow(row, c + 3);

      if (cellVal.includes("planned revenue") || (cellVal.includes("planned") && cellVal.includes("revenue")) || cellVal === "revenue") {
        if (valueCol !== null) plannedRevenue = valueCol;
        if (actualCol !== null) actualRevenue = actualCol;
      } else if (cellVal.includes("planned expenditure") || (cellVal.includes("planned") && cellVal.includes("expend")) || cellVal === "expenditure") {
        if (valueCol !== null) plannedExpenditure = valueCol;
        if (actualCol !== null) actualExpenditure = actualCol;
      } else if (cellVal.includes("planned profit") || (cellVal.includes("planned") && cellVal.includes("profit")) || cellVal === "profit") {
        if (valueCol !== null) plannedProfit = valueCol;
        if (actualCol !== null) actualProfit = actualCol;
      } else if (cellVal.includes("planned margin") || (cellVal.includes("planned") && cellVal.includes("margin")) || cellVal === "margin") {
        if (valueCol !== null) plannedMargin = valueCol;
        if (actualCol !== null) actualMargin = actualCol;
      }
    }
  }

  if (plannedRevenue === null && plannedExpenditure === null) return null;

  if (plannedRevenue !== null && plannedExpenditure !== null) {
    if (plannedProfit === null) {
      plannedProfit = plannedRevenue - plannedExpenditure;
    }
    if (plannedMargin === null && plannedRevenue > 0) {
      plannedMargin = (plannedRevenue - plannedExpenditure) / plannedRevenue;
    }
  }

  if (actualRevenue !== null && actualExpenditure !== null) {
    if (actualProfit === null) {
      actualProfit = actualRevenue - actualExpenditure;
    }
    if (actualMargin === null && actualRevenue > 0) {
      actualMargin = (actualRevenue - actualExpenditure) / actualRevenue;
    }
  }

  return { plannedRevenue, plannedExpenditure, plannedProfit, plannedMargin, actualRevenue, actualExpenditure, actualProfit, actualMargin };
}

/**
 * Extract the top-of-sheet metadata block on the Project Plan tab (rows
 * 1..headerRowIndex). The Tracker convention is a label-in-one-cell,
 * value-in-an-adjacent-cell layout, e.g.:
 *   Row 1, col A: "Baseline Completion Date:"   col B/C: <date>
 *   Row 2, col A: "Forecasted Completion Date:" col B/C: <date>
 *   ...
 * Labels can have varying punctuation/whitespace and the value can sit
 * one to three columns to the right. We scan the first few columns for
 * label matches and pick the nearest non-empty cell on the right.
 *
 * Returns null when no labels were found at all (graceful degrade for
 * trackers that don't have the metadata block).
 */
function extractProjectPlanMetadata(
  data: any[][],
  headerRowIndex: number,
): {
  baselineCompletionDate: string | null;
  forecastedCompletionDate: string | null;
  projectStartDate: string | null;
  durationMonthsFromSiteEstab: number | null;
  durationMonthsToCapacityTest: number | null;
  /** 1-indexed row indices keyed by metadata field, for cellFormat lookup. */
  rowByField: Record<string, number>;
  /** 0-indexed column index of the value cell, keyed by metadata field. */
  colByField: Record<string, number>;
  /** True when at least one label was matched. */
  hasAny: boolean;
} {
  let baselineCompletionDate: string | null = null;
  let forecastedCompletionDate: string | null = null;
  let projectStartDate: string | null = null;
  let durationMonthsFromSiteEstab: number | null = null;
  let durationMonthsToCapacityTest: number | null = null;
  const rowByField: Record<string, number> = {};
  const colByField: Record<string, number> = {};
  let hasAny = false;

  // Locate the value cell adjacent to a label. Returns { value, colIndex }.
  function findAdjacent(row: any[], labelCol: number): { value: any; colIndex: number } | null {
    for (let c = labelCol + 1; c < Math.min(row.length, labelCol + 6); c++) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      const sv = typeof v === "string" ? v.trim() : v;
      if (sv === "" || sv === null || sv === undefined) continue;
      if (getExcelError(v) !== null) continue;
      return { value: v, colIndex: c };
    }
    return null;
  }

  const scanEnd = Math.min(headerRowIndex, data.length);
  for (let i = 0; i < scanEnd; i++) {
    const row = data[i];
    if (!row) continue;

    for (let c = 0; c < Math.min(row.length, 4); c++) {
      const labelRaw = row[c];
      if (labelRaw == null) continue;
      const label = String(labelRaw).toLowerCase().trim();
      if (!label) continue;

      // Baseline / forecasted completion date (allow optional colon).
      if (
        baselineCompletionDate === null &&
        (label.startsWith("baseline completion date") || label === "baseline completion")
      ) {
        const adj = findAdjacent(row, c);
        if (adj) {
          const parsed = parseDate(adj.value);
          if (parsed) {
            baselineCompletionDate = parsed;
            rowByField.baselineCompletionDate = i + 1;
            colByField.baselineCompletionDate = adj.colIndex;
            hasAny = true;
          }
        }
        continue;
      }
      if (
        forecastedCompletionDate === null &&
        (label.startsWith("forecasted completion date") || label === "forecasted completion" ||
         label.startsWith("forecast completion date") || label === "forecast completion")
      ) {
        const adj = findAdjacent(row, c);
        if (adj) {
          const parsed = parseDate(adj.value);
          if (parsed) {
            forecastedCompletionDate = parsed;
            rowByField.forecastedCompletionDate = i + 1;
            colByField.forecastedCompletionDate = adj.colIndex;
            hasAny = true;
          }
        }
        continue;
      }
      if (
        projectStartDate === null &&
        (label.startsWith("project start date") || label === "project start")
      ) {
        const adj = findAdjacent(row, c);
        if (adj) {
          const parsed = parseDate(adj.value);
          if (parsed) {
            projectStartDate = parsed;
            rowByField.projectStartDate = i + 1;
            colByField.projectStartDate = adj.colIndex;
            hasAny = true;
          }
        }
        continue;
      }
      if (
        durationMonthsFromSiteEstab === null &&
        (label.startsWith("project duration from site establishment") ||
         label.startsWith("project duration from site estab") ||
         label.includes("duration from site establishment"))
      ) {
        const adj = findAdjacent(row, c);
        if (adj != null) {
          const num = typeof adj.value === "number"
            ? adj.value
            : parseFloat(String(adj.value).replace(/[\s,R]/g, ""));
          if (!isNaN(num)) {
            durationMonthsFromSiteEstab = num;
            rowByField.durationMonthsFromSiteEstab = i + 1;
            colByField.durationMonthsFromSiteEstab = adj.colIndex;
            hasAny = true;
          }
        }
        continue;
      }
      if (
        durationMonthsToCapacityTest === null &&
        (label.startsWith("duration to capacity test") ||
         label.includes("duration to capacity test"))
      ) {
        const adj = findAdjacent(row, c);
        if (adj != null) {
          const num = typeof adj.value === "number"
            ? adj.value
            : parseFloat(String(adj.value).replace(/[\s,R]/g, ""));
          if (!isNaN(num)) {
            durationMonthsToCapacityTest = num;
            rowByField.durationMonthsToCapacityTest = i + 1;
            colByField.durationMonthsToCapacityTest = adj.colIndex;
            hasAny = true;
          }
        }
        continue;
      }
    }
  }

  return {
    baselineCompletionDate,
    forecastedCompletionDate,
    projectStartDate,
    durationMonthsFromSiteEstab,
    durationMonthsToCapacityTest,
    rowByField,
    colByField,
    hasAny,
  };
}

// Excel formula error values — these corrupt data and should be replaced with null
const EXCEL_ERROR_VALUES = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?", "#NULL!", "#NUM!"]);

/**
 * Check if a cell value is an Excel error. Returns the error string if so, null otherwise.
 * Also handles ExcelJS error object format: { error: "#REF!" }
 */
function getExcelError(value: any): string | null {
  if (value == null) return null;
  // ExcelJS error object format
  if (typeof value === "object" && value.error && typeof value.error === "string") {
    if (EXCEL_ERROR_VALUES.has(value.error)) return value.error;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (EXCEL_ERROR_VALUES.has(trimmed)) return trimmed;
  }
  return null;
}

function findNumericValueInRow(row: any[], startCol: number): number | null {
  for (let c = startCol; c < Math.min(row.length, startCol + 5); c++) {
    const v = row[c];
    if (v == null) continue;
    if (getExcelError(v) !== null) continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[\s,R]/g, ""));
    if (!isNaN(n) && n !== 0) return n;
  }
  return null;
}

function getColIndex(mappings: MappingResult, canonicalField: string): number {
  const mapping = mappings.mappings.find(m => m.canonicalField === canonicalField);
  return mapping ? mapping.colIndex : -1;
}

function cellStr(row: any[], colIndex: number): string | null {
  if (colIndex < 0 || colIndex >= row.length) return null;
  const v = row[colIndex];
  if (v == null || String(v).trim() === "") return null;
  if (getExcelError(v) !== null) return null;
  const raw = typeof v === "object"
    && Object.prototype.toString.call(v) !== "[object Date]"
    && "result" in v
    ? (v as any).result
    : v;
  const dateValue = parseDate(v);
  if (dateValue && Object.prototype.toString.call(raw) === "[object Date]") return dateValue;
  return String(v).trim();
}

/**
 * Robust font color extraction with fallback chain.
 * Handles: direct ARGB, direct RGB, theme colors, themed objects, and edge cases.
 * Returns null/unconfirmed as safe default when color can't be resolved.
 */
function extractFontColorHex(fontColor: any): string | null {
  if (!fontColor) return null;
  // Direct ARGB: "FFFF0000" → strip alpha → "FF0000"
  if (fontColor.argb && typeof fontColor.argb === "string") {
    const argb = fontColor.argb;
    return argb.length === 8 ? argb.substring(2).toLowerCase() : argb.toLowerCase();
  }
  // Direct RGB: "FF0000"
  if (fontColor.rgb && typeof fontColor.rgb === "string") {
    return fontColor.rgb.toLowerCase();
  }
  // Theme color resolution — standard Excel theme defaults:
  // theme 0 = window background, theme 1 = window text (black)
  // Legacy parser treated both theme 0 and theme 1 as black/confirmed.
  // In practice, tracker spreadsheets use theme 1 for confirmed (black) dates
  // and explicit red ARGB for unconfirmed dates. Tinted variants of theme 1
  // (e.g. tint 0.35 = dark grey) are still "confirmed" — only explicit red is not.
  if (fontColor.theme != null && typeof fontColor.theme === "number") {
    if (fontColor.theme === 1 || fontColor.theme === 0) return "000000"; // black — matches legacy parser
    // Cannot reliably resolve accent/other theme colors without workbook theme XML.
    // Default to black since tracker text is black unless explicitly red.
    return "000000";
  }
  return null;
}

function classifyColorHex(hex: string | null): { color: string | null; isBlack: boolean } {
  if (!hex) return { color: null, isBlack: false };
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { color: null, isBlack: false };
  const isBlack = (r < 40 && g < 40 && b < 40);
  const isRedish = r > 150 && g < 80 && b < 80;
  const isBlueish = b > 150 && r < 80 && g < 80;
  if (isBlack) return { color: "black", isBlack: true };
  if (isRedish) return { color: "red", isBlack: false };
  if (isBlueish) return { color: "blue", isBlack: false };
  return { color: hex, isBlack: false };
}

function getCellFontColor(ws: ExcelJS.Worksheet, rowIdx: number, colIdx: number): { color: string | null; isBlack: boolean } {
  try {
    const cell = ws.getRow(rowIdx + 1).getCell(colIdx + 1);
    if (!cell || !cell.value) return { color: null, isBlack: false };
    const font = cell.font;
    // No font or no color specified → Excel default = black
    if (!font || !font.color) {
      return { color: "black", isBlack: true };
    }
    const hex = extractFontColorHex(font.color);
    if (hex === null) {
      // Unresolvable color → default to black/confirmed.
      // Tracker convention: only explicitly red text means unconfirmed.
      // Matches legacy excelParser behaviour which treated theme 0/1 as black.
      return { color: "black", isBlack: true };
    }
    return classifyColorHex(hex);
  } catch {
    // Extraction error → default to black/confirmed (matches legacy parser).
    return { color: "black", isBlack: true };
  }
}

/**
 * Extract the fill (background) colour for a cell. Mirrors the ARGB→RGB
 * normalization used by extractFontColorHex. Returns null when the cell
 * has no explicit pattern fill (Excel's default "no fill" state) or the
 * fill type is something other than a solid pattern. Theme-only fills
 * cannot be resolved without the workbook theme XML; callers treat
 * `null` as "no fill captured".
 */
function extractFillColorHex(fill: any): string | null {
  if (!fill) return null;
  // ExcelJS exposes solid pattern fills as { type: "pattern", pattern: "solid", fgColor: { argb } }.
  // We only capture solid fills; gradient / striped / etc. are surfaced as null.
  if (fill.type !== "pattern") return null;
  const fg = fill.fgColor;
  if (!fg) return null;
  if (typeof fg.argb === "string") {
    const argb = fg.argb;
    // Strip alpha when present (Excel stores ARGB; UI cares about RGB).
    return argb.length === 8 ? argb.substring(2).toLowerCase() : argb.toLowerCase();
  }
  if (typeof fg.rgb === "string") {
    return fg.rgb.toLowerCase();
  }
  return null;
}

/**
 * Capture font, fill, and bold flags for a single cell. Returns `undefined`
 * when the cell has nothing worth recording (no value AND no formatting),
 * so the caller can skip allocating an entry on the cellFormat map. This
 * keeps the JSONB blob compact for unformatted rows.
 */
function extractCellFormat(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  colIdx: number,
): { font?: string; fill?: string; bold?: boolean } | undefined {
  try {
    const cell = ws.getRow(rowIdx + 1).getCell(colIdx + 1);
    if (!cell) return undefined;
    const out: { font?: string; fill?: string; bold?: boolean } = {};
    const font = cell.font;
    if (font) {
      const hex = extractFontColorHex(font.color);
      if (hex) out.font = `#${hex.toUpperCase()}`;
      if (font.bold === true) out.bold = true;
    }
    const fillHex = extractFillColorHex(cell.fill);
    if (fillHex) out.fill = `#${fillHex.toUpperCase()}`;
    if (out.font === undefined && out.fill === undefined && out.bold === undefined) {
      return undefined;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Build a CellFormatMap by sampling each canonical field's column on a
 * specific row. Skips fields whose colIndex is < 0 (column not present in
 * this workbook) and skips fields with no formatting to record. Returns
 * `null` when no field had any formatting captured.
 */
function buildRowCellFormat(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  fieldColIndexes: Record<string, number>,
): CellFormatMap | null {
  const out: CellFormatMap = {};
  let hasAny = false;
  for (const [fieldName, colIdx] of Object.entries(fieldColIndexes)) {
    if (colIdx == null || colIdx < 0) continue;
    const fmt = extractCellFormat(ws, rowIdx, colIdx);
    if (fmt) {
      out[fieldName] = fmt;
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

function deriveRevenueStatus(
  invoiceNumber: string | null,
  invoiceDate: string | null,
  paidDate: string | null,
  inBankDate: string | null
): "PLANNED" | "INVOICED" | "PAID" | "IN_BANK" | "REALISED" {
  if (paidDate && inBankDate) return "REALISED";
  if (inBankDate) return "IN_BANK";
  if (paidDate) return "PAID";
  if (invoiceNumber || invoiceDate) return "INVOICED";
  return "PLANNED";
}

function deriveCostStatus(
  invoiceNumber: string | null,
  invoiceDate: string | null,
  approvedDate: string | null,
  paidDate: string | null
): "PLANNED" | "INVOICED" | "APPROVED" | "PAID" {
  if (paidDate) return "PAID";
  if (approvedDate) return "APPROVED";
  if (invoiceNumber || invoiceDate) return "INVOICED";
  return "PLANNED";
}

function normalizeTaskNo(raw: string): string {
  const trimmed = raw.trim();
  // First: handle raw numeric values (from Excel) that may have floating-point drift.
  // E.g. 1.2000000000000002 → "1.2", 2.3000000000000003 → "2.3"
  // We do this BEFORE dot-splitting so "1.2000000000000002" doesn't get split wrong.
  const numVal = parseFloat(trimmed);
  if (!isNaN(numVal) && isFinite(numVal) && String(numVal) === trimmed) {
    // This was a plain number (not a multi-level WBS like "1.2.3")
    return parseFloat(numVal.toFixed(10)).toString();
  }
  // Multi-level dot-separated WBS codes like "1.2.3" or "10.1.2"
  if (/^\d+(\.\d+)*$/.test(trimmed)) {
    const parts = trimmed.split(".");
    return parts.map(p => {
      const n = parseInt(p, 10);
      return isNaN(n) ? p : String(n);
    }).join(".");
  }
  return trimmed;
}

function deriveParentTaskNo(taskNo: string): string | null {
  if (!taskNo) return null;
  if (taskNo.includes(".")) {
    const parts = taskNo.split(".");
    parts.pop();
    const parent = parts.join(".");
    return parent || null;
  }
  return null;
}

function deriveIndentLevel(taskNo: string): number {
  if (!taskNo) return 0;
  if (taskNo.includes(".")) {
    return taskNo.split(".").length - 1;
  }
  return 0;
}

function extractPlanTasks(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  isMultiProject: boolean = false,
  ws?: ExcelJS.Worksheet,
): { tasks: NormalizationResult["planTasks"]; phases: NormalizationResult["executionPhases"] } {
  const rawTasks: Array<{
    taskName: string;
    taskNo: string | null;
    phase: string | null;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    actualDurationDays: number | null;
    owner: string | null;
    status: string | null;
    pctComplete: number | null;
    expectedPctComplete: number | null;
    comment: string | null;
    sourceSheet: string;
    sourceRow: number;
    subProjectName: string | null;
    lead: string | null;
    resource1: string | null;
    resource2: string | null;
    trackerComments: string | null;
    workDays: number | null;
    cellFormat: CellFormatMap | null;
  }> = [];
  const phases: NormalizationResult["executionPhases"] = [];

  const taskNameCol = getColIndex(mapping, "task_name");
  const taskNoCol = getColIndex(mapping, "task_no");
  const startDateCol = getColIndex(mapping, "start_date");
  const endDateCol = getColIndex(mapping, "end_date");
  const durationCol = getColIndex(mapping, "duration");
  const actualStartCol = getColIndex(mapping, "actual_start");
  const actualEndCol = getColIndex(mapping, "actual_end");
  const actualDurationCol = getColIndex(mapping, "actual_duration");
  const pctCompleteCol = getColIndex(mapping, "pct_complete");
  const expectedPctCol = getColIndex(mapping, "expected_pct");
  const ownerCol = getColIndex(mapping, "owner");
  // 2026-05-18 — phase removed from Excel import. We deliberately ignore
  // any "Phase" column in the file so it cannot leak free-text phase labels
  // into work_items or downstream consumers. Project phase is owned by the
  // canonical lifecycle (lifecycle-routes.ts).
  const phaseCol = -1;
  // The legacy `comment` synonym was renamed to `tracker_comments` in PR1
  // (it was previously conflated with Resource 2). We resolve via the new
  // canonical name and dual-write into the existing `comment` field
  // (preserved for downstream readers) AND the new `trackerComments` field.
  const commentCol = getColIndex(mapping, "tracker_comments");
  const leadCol = getColIndex(mapping, "lead");
  const resource1Col = getColIndex(mapping, "resource_1");
  const resource2Col = getColIndex(mapping, "resource_2");
  const workDaysCol = getColIndex(mapping, "work_days");

  let currentPhase: string | null = null;
  let currentSubProject: string | null = null;
  const subProjectPattern = /^project\s+activit(?:y|ies)\s*[-–—:]\s*(.+)/i;

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    const taskName = cellStr(row, taskNameCol);
    let taskNo = cellStr(row, taskNoCol);

    if (!taskName && !taskNo) continue;

    if (taskNo && (taskNo.toLowerCase() === "no." || taskNo.toLowerCase() === "no")) continue;
    if (taskName && (taskName.toLowerCase() === "high level programme" || taskName.toLowerCase() === "high level program")) continue;
    if (taskName && taskName.toLowerCase().includes("end of sheet")) continue;

    // Detect sub-project parent rows in multi-project trackers
    if (isMultiProject && taskName) {
      const spMatch = taskName.match(subProjectPattern);
      if (spMatch) {
        currentSubProject = spMatch[1].trim();
      }
    }

    if (taskNo) {
      // In multi-project mode, prefix WBS codes to prevent collisions
      taskNo = normalizeTaskNo(taskNo);
      if (isMultiProject && currentSubProject) {
        taskNo = `${currentSubProject}::${taskNo}`;
      }
    }

    if (phaseCol >= 0) {
      const phaseVal = cellStr(row, phaseCol);
      if (phaseVal) currentPhase = phaseVal;
    }

    const startDate = startDateCol >= 0 ? parseDate(row[startDateCol]) : null;
    const endDate = endDateCol >= 0 ? parseDate(row[endDateCol]) : null;
    const actualStartDate = actualStartCol >= 0 ? parseDate(row[actualStartCol]) : null;
    const actualEndDate = actualEndCol >= 0 ? parseDate(row[actualEndCol]) : null;

    const hasWbs = !!(taskNo && taskNo.trim());
    const hasPlanOrActualDate = !!(startDate || endDate || actualStartDate || actualEndDate);

    // Planned-only rows are valid programme rows. Actual dates can remain
    // blank until work starts or completes; rows still need a WBS and at least
    // one plan/actual schedule date so summary headers do not pollute work_items.
    if (!hasWbs || !hasPlanOrActualDate) continue;

    let durationDays: number | null = null;
    if (durationCol >= 0 && row[durationCol] != null) {
      const parsed = parseInt(String(row[durationCol]));
      if (!isNaN(parsed)) durationDays = parsed;
    }

    let actualDurationDays: number | null = null;
    if (actualDurationCol >= 0 && row[actualDurationCol] != null) {
      const parsed = parseInt(String(row[actualDurationCol]));
      if (!isNaN(parsed)) actualDurationDays = parsed;
    }

    const pctRaw = pctCompleteCol >= 0 ? parseStatus(row[pctCompleteCol]) : null;
    const expectedPctRaw = expectedPctCol >= 0 ? parseStatus(row[expectedPctCol]) : null;

    let statusStr: string | null = null;
    if (pctRaw !== null) {
      if (pctRaw >= 1) statusStr = "Complete";
      else if (pctRaw > 0) statusStr = "In Progress";
      else statusStr = "Not Started";
    }

    const trackerCommentVal = commentCol >= 0 ? cellStr(row, commentCol) : null;

    let workDaysVal: number | null = null;
    if (workDaysCol >= 0 && row[workDaysCol] != null) {
      const parsed = parseInt(String(row[workDaysCol]));
      if (!isNaN(parsed)) workDaysVal = parsed;
    }

    // Capture per-cell formatting (font, fill, bold) for every canonical
    // PLAN field that has a column in this workbook. Skipped when no
    // worksheet handle is provided (legacy callers / unit-test paths).
    const cellFormat = ws ? buildRowCellFormat(ws, i, {
      task_name: taskNameCol,
      task_no: taskNoCol,
      phase: phaseCol,
      start_date: startDateCol,
      end_date: endDateCol,
      duration: durationCol,
      actual_start: actualStartCol,
      actual_end: actualEndCol,
      actual_duration: actualDurationCol,
      pct_complete: pctCompleteCol,
      expected_pct: expectedPctCol,
      owner: ownerCol,
      tracker_comments: commentCol,
      lead: leadCol,
      resource_1: resource1Col,
      resource_2: resource2Col,
      work_days: workDaysCol,
    }) : null;

    rawTasks.push({
      taskName: taskName || taskNo || "",
      taskNo: taskNo || null,
      phase: currentPhase,
      startDate,
      endDate,
      durationDays,
      actualStartDate,
      actualEndDate,
      actualDurationDays,
      owner: ownerCol >= 0 ? cellStr(row, ownerCol) : null,
      status: statusStr,
      pctComplete: pctRaw,
      expectedPctComplete: expectedPctRaw,
      // Dual-write tracker comments: keep the existing `comment` field
      // populated for downstream readers that haven't migrated yet, AND
      // surface it on the new `trackerComments` field so the executor
      // can write to work_items.tracker_comments.
      comment: trackerCommentVal,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      subProjectName: currentSubProject,
      lead: leadCol >= 0 ? cellStr(row, leadCol) : null,
      resource1: resource1Col >= 0 ? cellStr(row, resource1Col) : null,
      resource2: resource2Col >= 0 ? cellStr(row, resource2Col) : null,
      trackerComments: trackerCommentVal,
      workDays: workDaysVal,
      cellFormat,
    });
  }

  const allTaskNos = new Set<string>();
  const childPrefixes = new Set<string>();
  for (const t of rawTasks) {
    if (t.taskNo) {
      allTaskNos.add(t.taskNo);
      const parent = deriveParentTaskNo(t.taskNo);
      if (parent) childPrefixes.add(parent);
    }
  }

  const milestoneKeywords = ["milestone", "commissioning", "practical completion", "site establishment", "handover", "energisation", "cod"];

  const tasks: NormalizationResult["planTasks"] = rawTasks.map(t => {
    const taskNo = t.taskNo;
    let isMilestone = false;
    let parentTaskNo: string | null = null;
    let indentLevel = 0;

    if (taskNo) {
      parentTaskNo = deriveParentTaskNo(taskNo);
      indentLevel = deriveIndentLevel(taskNo);

      if (!taskNo.includes(".") && /^\d+$/.test(taskNo) && childPrefixes.has(taskNo)) {
        isMilestone = true;
      }
    }

    const isSubtask = parentTaskNo !== null || indentLevel > 0;

    if (!isSubtask) {
      const nameLower = (t.taskName || "").toLowerCase();
      for (const kw of milestoneKeywords) {
        if (nameLower.includes(kw)) {
          isMilestone = true;
          break;
        }
      }
    }

    if (!isSubtask && t.startDate && t.endDate && t.startDate === t.endDate && !isMilestone) {
      isMilestone = true;
    }

    if (parentTaskNo && !allTaskNos.has(parentTaskNo)) {
      parentTaskNo = null;
    }

    return {
      ...t,
      isMilestone,
      parentTaskNo,
      indentLevel,
    };
  });

  return { tasks, phases };
}

function extractRevenueLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[],
  ws?: ExcelJS.Worksheet,
  isMultiProject: boolean = false
): NormalizationResult["revenueLines"] {
  const lines: NormalizationResult["revenueLines"] = [];

  const milestoneNameCol = getColIndex(mapping, "milestone_name");
  const milestoneNoCol = getColIndex(mapping, "milestone_no");
  const milestonePercentCol = getColIndex(mapping, "percent");
  const amountCol = getColIndex(mapping, "amount_ex_vat");
  const vatCol = getColIndex(mapping, "vat");
  const invoiceNumCol = getColIndex(mapping, "invoice_number");
  const invoiceDateCol = getColIndex(mapping, "invoice_date");
  const plannedDateCol = getColIndex(mapping, "planned_payment_date");
  const paidDateCol = getColIndex(mapping, "payment_received_date");
  const inBankDateCol = getColIndex(mapping, "in_bank_date");
  // Tracker col R "MILESTONE NOTES & COMMENTS" (PR2A wiring).
  const milestoneNotesCol = getColIndex(mapping, "milestone_notes");

  const invoiceNumbers = new Set<string>();

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    // Scan for Excel formula errors in this row and generate warnings
    for (let c = 0; c < row.length; c++) {
      const errVal = getExcelError(row[c]);
      if (errVal) {
        issues.push({
          severity: "WARNING",
          section: "REVENUE",
          message: `Excel formula error '${errVal}' found at ${sheetName} row ${i + 1}, col ${c + 1}. Value replaced with null.`,
          suggestedAction: "Review the original spreadsheet for broken formulas",
          issueType: "EXCEL_ERROR",
          issueFingerprint: makeFingerprint("EXCEL_ERROR", "REVENUE", `R${i + 1}C${c + 1}`),
          payloadJson: { row: i + 1, col: c + 1, error: errVal },
        });
      }
    }

    const milestoneName = cellStr(row, milestoneNameCol);
    if (!milestoneName) continue;

    const trimmedName = milestoneName.trim();
    if (trimmedName === "-" || trimmedName === "—" || trimmedName === "") continue;

    const lowerName = milestoneName.toLowerCase();
    if (lowerName.includes("end of sheet") || lowerName.startsWith("key") || lowerName.includes("red font") || lowerName.includes("contains an error")) break;

    // Skip zero-revenue placeholders: "SubProject - No Revenue" with R0
    if (lowerName.includes("no revenue")) {
      if (isMultiProject) {
        const spName = milestoneName.split(/\s*[-–—]\s*/)[0].trim();
        issues.push({
          severity: "INFO",
          section: "REVENUE",
          message: `Sub-project '${spName}' has no revenue — skipped. Revenue lines will only be created when milestones with values are added to the tracker.`,
          suggestedAction: null,
          issueType: "ZERO_REVENUE_SUBPROJECT",
          issueFingerprint: makeFingerprint("ZERO_REVENUE_SUBPROJECT", "REVENUE", spName),
          payloadJson: { subProjectName: spName, row: i + 1 },
        });
      }
      continue;
    }

    const amountExVat = amountCol >= 0 ? parseNumber(row[amountCol]) : null;
    const vat = vatCol >= 0 ? parseNumber(row[vatCol]) : null;
    const milestoneNo = cellStr(row, milestoneNoCol);
    const milestonePercent = milestonePercentCol >= 0 ? parseNumber(row[milestonePercentCol]) : null;
    const invoiceNumber = cellStr(row, invoiceNumCol);
    const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
    const expectedPaymentDate = plannedDateCol >= 0 ? parseDate(row[plannedDateCol]) : null;
    const paidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
    const inBankDate = inBankDateCol >= 0 ? parseDate(row[inBankDateCol]) : null;

    const hasRevAmount = amountExVat !== null && amountExVat !== "0" && amountExVat !== "0.00" && parseFloat(String(amountExVat)) !== 0;
    const hasRevDate = !!(invoiceDate || paidDate || inBankDate || expectedPaymentDate);
    const hasRevRef = !!invoiceNumber;
    if (!hasRevAmount && !hasRevDate && !hasRevRef) {
      continue;
    }

    const status = deriveRevenueStatus(invoiceNumber, invoiceDate, paidDate, inBankDate);

    let turnaroundDays: number | null = null;
    if (invoiceDate) {
      const endDate = inBankDate || paidDate;
      if (endDate) {
        turnaroundDays = daysBetween(invoiceDate, endDate);
      }
    }

    if (invoiceNumber) {
      if (invoiceNumbers.has(invoiceNumber)) {
        issues.push({
          severity: "WARNING",
          section: "REVENUE",
          message: `Duplicate invoice number "${invoiceNumber}" in revenue section`,
          suggestedAction: "Verify whether these are distinct invoices or duplicates",
          issueType: "DUPLICATE_INVOICE",
          issueFingerprint: makeFingerprint("DUPLICATE_INVOICE", "REVENUE", invoiceNumber),
          payloadJson: { invoiceNumber, row: i + 1 },
        });
      }
      invoiceNumbers.add(invoiceNumber);
    }

    if (invoiceDate && paidDate) {
      const days = daysBetween(invoiceDate, paidDate);
      if (days !== null && days < 0) {
        issues.push({
          severity: "WARNING",
          section: "REVENUE",
          message: `Invoice date (${invoiceDate}) is after paid date (${paidDate}) on row ${i + 1}`,
          suggestedAction: "Check if dates are swapped",
          issueType: "DATE_ORDER_VIOLATION",
          issueFingerprint: makeFingerprint("DATE_ORDER_VIOLATION", "REVENUE", invoiceNumber || `${invoiceDate}_${paidDate}`),
          payloadJson: { invoiceDate, paidDate, row: i + 1 },
        });
      }
    }

    if (!amountExVat && status !== "PLANNED") {
      issues.push({
        severity: "BLOCKER",
        section: "REVENUE",
        message: `Missing amount on revenue line "${milestoneName}" (row ${i + 1})`,
        suggestedAction: "Add the financial amount for this milestone",
        issueType: "MISSING_AMOUNT",
        issueFingerprint: makeFingerprint("MISSING_AMOUNT", "REVENUE", milestoneName || `row_${i + 1}`),
        payloadJson: { milestoneName, row: i + 1 },
      });
    }

    let invoiceDateFontColor: string | null = null;
    let invoiceDateConfirmed: boolean | null = null;
    let paidDateFontColor: string | null = null;
    let paidDateConfirmed: boolean | null = null;

    if (ws && invoiceDate) {
      const fc = getCellFontColor(ws, i, invoiceDateCol);
      invoiceDateFontColor = fc.color;
      invoiceDateConfirmed = fc.isBlack;
    }
    if (ws && paidDate) {
      const fc = getCellFontColor(ws, i, paidDateCol);
      paidDateFontColor = fc.color;
      paidDateConfirmed = fc.isBlack;
    }

    // Extract sub-project name from milestone: "SubProject - Milestone" → SubProject
    let subProjectName: string | null = null;
    if (isMultiProject && milestoneName) {
      const parts = milestoneName.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        subProjectName = parts[0].trim();
      }
    }

    const milestoneNotes = milestoneNotesCol >= 0 ? cellStr(row, milestoneNotesCol) : null;

    // Capture per-cell formatting for every REVENUE field present.
    const cellFormat = ws ? buildRowCellFormat(ws, i, {
      milestone_name: milestoneNameCol,
      milestone_no: milestoneNoCol,
      percent: milestonePercentCol,
      amount_ex_vat: amountCol,
      vat: vatCol,
      invoice_number: invoiceNumCol,
      invoice_date: invoiceDateCol,
      planned_payment_date: plannedDateCol,
      payment_received_date: paidDateCol,
      in_bank_date: inBankDateCol,
      milestone_notes: milestoneNotesCol,
    }) : null;

    lines.push({
      description: milestoneName,
      milestoneName,
      milestoneNo,
      milestonePercent,
      amountExVat,
      vat,
      invoiceNumber,
      invoiceDate,
      invoiceDateFontColor,
      invoiceDateConfirmed,
      expectedPaymentDate,
      paidDate,
      paidDateFontColor,
      paidDateConfirmed,
      inBankDate,
      status,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      turnaroundDays,
      subProjectName,
      milestoneNotes,
      cellFormat,
    });
  }

  return lines;
}

function getBudgetColIndex(budgetMappings: MappingResult["budgetMappings"], field: string): number {
  if (!budgetMappings) return -1;
  const m = budgetMappings.find(bm => bm.canonicalField === field);
  return m ? m.colIndex : -1;
}

/**
 * Extracts sub-project name from a category string like "1. Products - Magic Co"
 * Returns null if no sub-project pattern is found.
 */
function extractSubProjectFromCategory(category: string | null): string | null {
  if (!category) return null;
  // Pattern: "{number}. {category} - {subProjectName}"
  const match = category.match(/^\d+\.?\s*[^-–—]+\s*[-–—]\s*(.+)/);
  if (match) return match[1].trim();
  return null;
}

/** Exported for unit testing. Internal — public API is `normalizeData`. */
export function extractCostLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[],
  ws?: ExcelJS.Worksheet,
  isMultiProject: boolean = false
): {
  lines: NormalizationResult["costLines"];
  counterparties: string[];
  categoryAllocations: CategoryAllocationEntry[];
  actualLineRows: NormalizationResult["actualLineRows"];
} {
  const lines: NormalizationResult["costLines"] = [];
  const counterpartySet = new Set<string>();
  const categoryAllocations: CategoryAllocationEntry[] = [];
  // 1:N actual-line rows (right-hand pane only — costed-side empty).
  // Each entry has zero or more "extra" actual rows; we link them back to
  // the most recent costed parent by `parentSourceRow` for the executor.
  const actualLineRows: NormalizationResult["actualLineRows"] = [];

  const categoryCol = getColIndex(mapping, "cost_category");
  const descCol = getColIndex(mapping, "description");
  const counterpartyCol = getColIndex(mapping, "counterparty");
  const amountCol = getColIndex(mapping, "amount_ex_vat");
  const actualTotalCol = getColIndex(mapping, "actual_total");
  const invoiceNumCol = getColIndex(mapping, "invoice_number");
  const invoiceDateCol = getColIndex(mapping, "invoice_date");
  const approvedDateCol = getColIndex(mapping, "approved_date");
  const paidDateCol = getColIndex(mapping, "payment_date");
  const poCol = getColIndex(mapping, "po_number");
  const actualCosCol = getColIndex(mapping, "actual_cos");
  const revenueRecogCol = getColIndex(mapping, "revenue_recognition_amount");
  // Tracker columns wired in PR2A — see synonyms.ts comments.
  const actualQtyCol = getColIndex(mapping, "actual_qty");
  const actualRateCol = getColIndex(mapping, "actual_rate");
  const commentsCol = getColIndex(mapping, "comments");
  const checkFlagCol = getColIndex(mapping, "check_flag");
  const savingOverrunCol = getColIndex(mapping, "saving_overrun");
  const usdExchangeRateCol = getColIndex(mapping, "usd_exchange_rate");
  const pricePerWattCol = getColIndex(mapping, "price_per_watt");

  const bm = mapping.budgetMappings;
  const budgetQtyCol = getBudgetColIndex(bm, "budget_qty") >= 0 ? getBudgetColIndex(bm, "budget_qty") : getColIndex(mapping, "budget_qty");
  const budgetRateCol = getBudgetColIndex(bm, "budget_rate") >= 0 ? getBudgetColIndex(bm, "budget_rate") : getColIndex(mapping, "budget_rate");
  const budgetTotalCol = getBudgetColIndex(bm, "budget_total") >= 0 ? getBudgetColIndex(bm, "budget_total") : getColIndex(mapping, "budget_total");
  const budgetCosCol = getBudgetColIndex(bm, "budget_cos") >= 0 ? getBudgetColIndex(bm, "budget_cos") : getColIndex(mapping, "budget_cos");
  const forecastPayDateCol = getBudgetColIndex(bm, "forecast_payment_date") >= 0 ? getBudgetColIndex(bm, "forecast_payment_date") : getColIndex(mapping, "forecast_payment_date");

  // S06: Detect J_cat column ("Total Revenue") and X_cat column ("Total COS") in the budget pane.
  let jCatCol = getBudgetColIndex(bm, "category_revenue_allocation");
  let xCatCol = getBudgetColIndex(bm, "category_cos_total");
  let jCatSource: "DIRECT_EXTRACTION" | "HEADER_ERROR_POSITIONAL" | "NOT_FOUND" = jCatCol >= 0 ? "DIRECT_EXTRACTION" : "NOT_FOUND";

  // Positional fallback: if "Total Revenue" synonym not matched, try the rightmost budget pane column.
  // This handles "ERROR on REV" or other broken headers where the column position is still correct.
  if (jCatCol < 0 && bm && bm.length > 0) {
    // The rightmost budget pane column by position (highest colIndex) that we haven't already mapped.
    const mappedBudgetCols = new Set(bm.map((m: any) => m.colIndex));
    // Also check if there's a column to the right of the highest mapped column.
    const maxMappedCol = Math.max(...bm.map((m: any) => m.colIndex));

    // Look at the raw budget headers from the section detection for unmapped columns.
    // The J_cat column is typically the rightmost populated budget-pane column.
    // We check if the column right of "Total COS" (if found) has numeric data on row 2 (grand total).
    if (xCatCol >= 0) {
      // J_cat is expected to be the next column after "Total COS" or the one after that.
      const candidateCol = xCatCol + 1;
      if (data.length > 1) {
        const r2val = data[1]?.[candidateCol]; // Row 2 (0-indexed row 1) has grand totals
        if (r2val != null && typeof r2val === "number" && r2val !== 0) {
          jCatCol = candidateCol;
          jCatSource = "HEADER_ERROR_POSITIONAL";
          issues.push({
            severity: "WARNING",
            section: "EXPENDITURE",
            message: `Revenue allocation column header not matched by synonym. Using positional detection (column ${candidateCol + 1}, adjacent to "Total COS"). Grand total value found: ${r2val.toLocaleString()}.`,
            suggestedAction: "Verify the revenue allocation column is correct in the Expenditure Breakdown",
            issueType: "JCAT_POSITIONAL_FALLBACK",
            issueFingerprint: makeFingerprint("JCAT_POSITIONAL_FALLBACK", "EXPENDITURE", "positional"),
            payloadJson: { column: candidateCol + 1, grandTotal: r2val },
          });
        }
      }
    }
  }

  if (jCatCol < 0) {
    issues.push({
      severity: "WARNING",
      section: "EXPENDITURE",
      message: "Revenue allocation column ('Total Revenue') not found in the budget pane. Category-level revenue recognition will be unavailable until this project is re-imported with a tracker that includes this column.",
      suggestedAction: "Ensure the Expenditure Breakdown budget pane has a 'Total Revenue' column",
      issueType: "JCAT_COLUMN_MISSING",
      issueFingerprint: makeFingerprint("JCAT_COLUMN_MISSING", "EXPENDITURE", "missing"),
      payloadJson: { budgetMappingCount: bm?.length || 0 },
    });
  }

  const effectiveAmountCol = amountCol >= 0 ? amountCol : actualTotalCol;

  const invoiceNumbers = new Set<string>();
  let currentCategoryKey: string | null = null;
  let currentCategoryNumber: string | null = null;
  let currentCategoryName: string | null = null;
  const seenCategoryNumbers = new Set<string>();

  // 1:N actual extraction state: track the most recently emitted costed
  // parent so orphan actual rows (right-pane only) can link back to it.
  // `lastParentSourceRow` is the 1-indexed source row of the parent costed
  // line; `lastParentCategoryKey` mirrors the parent's categoryKey for
  // diagnostic context. The actualNo counter resets every time a new
  // costed parent is emitted.
  let lastParentSourceRow: number | null = null;
  let lastParentCategoryKey: string | null = null;
  let actualNoForCurrentParent = 0;

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    // Scan for Excel formula errors in this row and generate warnings
    for (let c = 0; c < row.length; c++) {
      const errVal = getExcelError(row[c]);
      if (errVal) {
        issues.push({
          severity: "WARNING",
          section: "EXPENDITURE",
          message: `Excel formula error '${errVal}' found at ${sheetName} row ${i + 1}, col ${c + 1}. Value replaced with null.`,
          suggestedAction: "Review the original spreadsheet for broken formulas",
          issueType: "EXCEL_ERROR",
          issueFingerprint: makeFingerprint("EXCEL_ERROR", "EXPENDITURE", `R${i + 1}C${c + 1}`),
          payloadJson: { row: i + 1, col: c + 1, error: errVal },
        });
      }
    }

    const rawCategory = cellStr(row, categoryCol);
    const description = cellStr(row, descCol);
    const counterparty = cellStr(row, counterpartyCol);

    const amountExVat = effectiveAmountCol >= 0 ? parseNumber(row[effectiveAmountCol]) : null;
    const parsedAmount = amountExVat !== null ? parseFloat(String(amountExVat)) : NaN;
    const hasAmount = !isNaN(parsedAmount) && parsedAmount !== 0;

    // 1:N orphan-actual detection. When the costed-side columns are empty
    // but the actual-pane columns carry data (qty, rate, total, invoice
    // number, invoice date, etc.), the row is an extra invoice batch
    // attached to the most recent costed parent line. These rows used to
    // be silently dropped by the early `continue` below; now they're
    // captured into `actualLineRows` so the executor can write them into
    // `normalized_cost_line_actuals`.
    if (!rawCategory && !description && !counterparty && !hasAmount && lastParentSourceRow != null) {
      const orphanQty = actualQtyCol >= 0 ? cellStr(row, actualQtyCol) : null;
      const orphanRate = actualRateCol >= 0 ? cellStr(row, actualRateCol) : null;
      const orphanActualTotal = actualTotalCol >= 0 ? parseNumber(row[actualTotalCol]) : null;
      const orphanInvoiceNo = invoiceNumCol >= 0 ? cellStr(row, invoiceNumCol) : null;
      const orphanInvoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
      const orphanPaidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
      // Owner rule 2026-06 (Root Cause A): recognition month = INVOICE RAISED
      // DATE only; no EOMONTH(finance payment date) inference. Blank invoice
      // dates on amount-bearing rows are flagged as blockers below.
      const orphanInvoiceDateResolved = orphanInvoiceDate;
      const orphanPo = poCol >= 0 ? cellStr(row, poCol) : null;
      const orphanRevRecog = revenueRecogCol >= 0 ? parseNumber(row[revenueRecogCol]) : null;
      const orphanComments = commentsCol >= 0 ? cellStr(row, commentsCol) : null;
      const orphanCheckFlag = checkFlagCol >= 0 ? cellStr(row, checkFlagCol) : null;
      const orphanSavingOverrun = savingOverrunCol >= 0 ? parseNumber(row[savingOverrunCol]) : null;

      const orphanHasData =
        !!orphanQty || !!orphanRate || orphanActualTotal !== null ||
        !!orphanInvoiceNo || !!orphanInvoiceDateResolved || !!orphanPaidDate ||
        !!orphanPo || orphanRevRecog !== null || !!orphanComments;

      if (orphanHasData) {
        // Owner rule 2026-06: an amount-bearing actual line must carry an
        // INVOICE RAISED DATE. Flag (do not guess) when it is missing.
        if (orphanActualTotal != null && Number(orphanActualTotal) !== 0 && !orphanInvoiceDateResolved) {
          issues.push({
            severity: "BLOCKER",
            section: "EXPENDITURE",
            message: `Actual invoice line on row ${i + 1} has an amount but no INVOICE RAISED DATE — it cannot be recognised in a month until this is fixed.`,
            suggestedAction: "Enter the INVOICE RAISED DATE (col T) for this line in the tracker.",
            issueType: "MISSING_INVOICE_DATE",
            issueFingerprint: makeFingerprint("MISSING_INVOICE_DATE", "EXPENDITURE", `orphan_${i + 1}`),
            payloadJson: { row: i + 1 },
          });
        }
        const orphanCellFormat = ws ? buildRowCellFormat(ws, i, {
          actual_qty: actualQtyCol,
          actual_rate: actualRateCol,
          actual_total: actualTotalCol,
          po_number: poCol,
          invoice_number: invoiceNumCol,
          invoice_date: invoiceDateCol,
          payment_date: paidDateCol,
          revenue_recognition_amount: revenueRecogCol,
          comments: commentsCol,
          check_flag: checkFlagCol,
          saving_overrun: savingOverrunCol,
        }) : null;

        actualNoForCurrentParent += 1;
        actualLineRows.push({
          parentCategoryKey: lastParentCategoryKey,
          parentSourceRow: lastParentSourceRow,
          actualNo: actualNoForCurrentParent,
          description: null,
          qty: orphanQty,
          rate: orphanRate,
          actualTotal: orphanActualTotal,
          poNumber: orphanPo,
          invoiceNumber: orphanInvoiceNo,
          invoiceDate: orphanInvoiceDateResolved,
          revenueRecognitionAmount: orphanRevRecog,
          financePaymentDate: orphanPaidDate,
          comments: orphanComments,
          checkFlag: orphanCheckFlag,
          savingOverrun: orphanSavingOverrun,
          cellFormat: orphanCellFormat,
          sourceSheet: sheetName,
          sourceRow: i + 1,
        });
      }
      continue;
    }

    if (!rawCategory && !description && !counterparty && !hasAmount) continue;

    const lowerJoined = [rawCategory, description].filter(Boolean).join(" ").toLowerCase();
    if (lowerJoined.includes("sub total") || lowerJoined.includes("end of sheet")) continue;

    // S05: Preserve numbered category key. Do NOT strip the numeric prefix.
    // The category key (e.g. "1. Panels") comes from the actual pane column which has
    // the combined "N. Name" format. The budget pane has number in one column and name
    // in another. We use rawCategory from the actual pane to detect transitions.
    if (rawCategory) {
      const catMatch = rawCategory.match(/^(\d+)\.?\s*(.*)/);
      if (catMatch) {
        const catNum = catMatch[1];
        const catName = catMatch[2].trim() || rawCategory;
        const normalizedKey = normalizeCategoryKey(rawCategory);

        // New category detected — record its allocation from the budget pane.
        if (catNum !== currentCategoryNumber && !seenCategoryNumbers.has(catNum)) {
          seenCategoryNumbers.add(catNum);
          currentCategoryNumber = catNum;
          currentCategoryName = catName;
          currentCategoryKey = normalizedKey;

          // S06: Extract J_cat and X_cat from the budget pane columns on this row.
          let revenueAllocation: number | null = null;
          let cosTotalCosted: number | null = null;
          let budgetTotalCat: number | null = null;

          if (jCatCol >= 0) {
            const jVal = row[jCatCol];
            if (jVal != null && typeof jVal === "number" && !isNaN(jVal)) {
              revenueAllocation = jVal;
            } else if (jVal != null) {
              const parsed = parseFloat(String(jVal));
              if (!isNaN(parsed) && parsed !== 0) revenueAllocation = parsed;
            }
          }
          if (xCatCol >= 0) {
            const xVal = row[xCatCol];
            if (xVal != null && typeof xVal === "number" && !isNaN(xVal)) {
              cosTotalCosted = xVal;
            } else if (xVal != null) {
              const parsed = parseFloat(String(xVal));
              if (!isNaN(parsed) && parsed !== 0) cosTotalCosted = parsed;
            }
          }
          if (budgetTotalCol >= 0) {
            const btVal = row[budgetTotalCol];
            if (btVal != null && typeof btVal === "number" && !isNaN(btVal)) {
              budgetTotalCat = btVal;
            }
          }

          categoryAllocations.push({
            categoryNumber: catNum,
            categoryName: catName,
            categoryKey: normalizedKey,
            categorySortOrder: parseInt(catNum, 10),
            revenueAllocation,
            cosTotalCosted,
            budgetTotal: budgetTotalCat,
            allocationSource: revenueAllocation != null ? jCatSource : "NOT_FOUND",
            sourceSheet: sheetName,
            sourceRow: i + 1,
          });
        } else if (catNum !== currentCategoryNumber) {
          // Same category number seen again after a different one — update tracking.
          currentCategoryNumber = catNum;
          currentCategoryKey = normalizedKey;
          currentCategoryName = catName;
        }
      } else if (!currentCategoryKey) {
        // Non-numbered category text — use as-is only if we haven't seen a numbered one yet.
        currentCategoryKey = rawCategory;
        currentCategoryName = rawCategory;
      }
    }
    const category = currentCategoryKey || rawCategory;
    const categoryKey = currentCategoryKey;
    const invoiceNumber = cellStr(row, invoiceNumCol);
    const rawInvoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
    const approvedDate = approvedDateCol >= 0 ? parseDate(row[approvedDateCol]) : null;
    let paidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
    // Owner rule 2026-06 (RECON_FINDINGS Root Cause A): the recognition month is
    // driven by INVOICE RAISED DATE (col T) ONLY. We no longer silently infer it
    // from the FINANCE PAYMENT DATE (EOMONTH) when col T is blank — that moved
    // cost/revenue into the wrong month. A blank invoice date on a line that has
    // an amount is flagged as a BLOCKER below and must be corrected in the
    // workbook (recalculate/save so col T caches, or enter the date).
    const invoiceDate = rawInvoiceDate;
    const poNumber = cellStr(row, poCol);

    const status = deriveCostStatus(invoiceNumber, invoiceDate, approvedDate, paidDate);

    let turnaroundDays: number | null = null;
    if (invoiceDate && paidDate) {
      turnaroundDays = daysBetween(invoiceDate, paidDate);
    }

    if (!hasAmount) {
      continue;
    }

    // Owner rule 2026-06: an actual cost amount MUST carry an INVOICE RAISED
    // DATE. Without it the line cannot be recognised in a month, so flag it for
    // correction rather than guessing (or silently dropping) the period.
    if (!invoiceDate) {
      issues.push({
        severity: "BLOCKER",
        section: "EXPENDITURE",
        message: `Cost line on row ${i + 1} has an actual amount but no INVOICE RAISED DATE — it cannot be recognised in a month until this is fixed.`,
        suggestedAction: "Enter the INVOICE RAISED DATE (col T) for this line in the tracker (recalculate/save so the formula caches).",
        issueType: "MISSING_INVOICE_DATE",
        issueFingerprint: makeFingerprint("MISSING_INVOICE_DATE", "EXPENDITURE", `${categoryKey ?? category ?? "row"}_${i + 1}`),
        payloadJson: { row: i + 1 },
      });
    }

    if (counterparty) {
      counterpartySet.add(counterparty);
    }

    if (invoiceNumber) {
      if (invoiceNumbers.has(invoiceNumber)) {
        issues.push({
          severity: "WARNING",
          section: "EXPENDITURE",
          message: `Duplicate invoice number "${invoiceNumber}" in expenditure section`,
          suggestedAction: "Verify whether these are distinct invoices or duplicates",
          issueType: "DUPLICATE_INVOICE",
          issueFingerprint: makeFingerprint("DUPLICATE_INVOICE", "EXPENDITURE", invoiceNumber),
          payloadJson: { invoiceNumber, row: i + 1 },
        });
      }
      invoiceNumbers.add(invoiceNumber);
    }

    if (invoiceDate && paidDate) {
      const days = daysBetween(invoiceDate, paidDate);
      if (days !== null && days < 0) {
        issues.push({
          severity: "WARNING",
          section: "EXPENDITURE",
          message: `Invoice date (${invoiceDate}) is after paid date (${paidDate}) on row ${i + 1}`,
          suggestedAction: "Check if dates are swapped",
          issueType: "DATE_ORDER_VIOLATION",
          issueFingerprint: makeFingerprint("DATE_ORDER_VIOLATION", "EXPENDITURE", invoiceNumber || `${invoiceDate}_${paidDate}`),
          payloadJson: { invoiceDate, paidDate, row: i + 1 },
        });
      }
    }

    if (counterparty) {
      issues.push({
        severity: "INFO",
        section: "EXPENDITURE",
        message: `Counterparty "${counterparty}" found on row ${i + 1}`,
        suggestedAction: null,
        issueType: "COUNTERPARTY_DETECTED",
        issueFingerprint: makeFingerprint("COUNTERPARTY_DETECTED", "EXPENDITURE", counterparty),
        payloadJson: { counterparty, row: i + 1 },
      });
    }

    let invoiceDateFontColor: string | null = null;
    let invoiceDateConfirmed: boolean | null = null;
    let paidDateFontColor: string | null = null;
    let paidDateConfirmed: boolean | null = null;

    if (ws && invoiceDate) {
      const fc = getCellFontColor(ws, i, invoiceDateCol);
      invoiceDateFontColor = fc.color;
      invoiceDateConfirmed = fc.isBlack;
    }
    if (ws && paidDate) {
      const fc = getCellFontColor(ws, i, paidDateCol);
      paidDateFontColor = fc.color;
      paidDateConfirmed = fc.isBlack;
    }

    const budgetQty = budgetQtyCol >= 0 ? parseNumber(row[budgetQtyCol]) : null;
    const budgetRate = budgetRateCol >= 0 ? parseNumber(row[budgetRateCol]) : null;
    let budgetTotal = budgetTotalCol >= 0 ? parseNumber(row[budgetTotalCol]) : null;
    if (budgetTotal == null && budgetQty != null && budgetRate != null) {
      const q = parseFloat(String(budgetQty));
      const r = parseFloat(String(budgetRate));
      if (!isNaN(q) && !isNaN(r)) budgetTotal = String(q * r);
    }
    const budgetCos = budgetCosCol >= 0 ? parseNumber(row[budgetCosCol]) : null;
    const actualCos = actualCosCol >= 0 ? parseNumber(row[actualCosCol]) : null;
    const revenueRecognitionAmount = revenueRecogCol >= 0 ? parseNumber(row[revenueRecogCol]) : null;
    const forecastPaymentDate = forecastPayDateCol >= 0 ? parseDate(row[forecastPayDateCol]) : null;

    // § 3.7 HARD: paidDate is actuals — never fall back to forecastPaymentDate.

    // S07: COS realisation requires a valid (non-placeholder) invoice AND non-zero actual amount.
    // Placeholder invoices (TBC, Pending, N/A, etc.) do not count as captured supplier invoices.
    const cosRealised = isValidInvoiceNumber(invoiceNumber) && hasAmount;
    const cashflowConfirmed = !!(invoiceNumber && poNumber && paidDateConfirmed);

    // Extract sub-project name from category in multi-project trackers
    const subProjectName = isMultiProject ? extractSubProjectFromCategory(rawCategory) : null;

    // PR2A tracker columns. Text fields stored verbatim via cellStr; numeric
    // fields go through parseNumber so the executor can pass either to a
    // decimal column without further coercion.
    const actualQty = actualQtyCol >= 0 ? cellStr(row, actualQtyCol) : null;
    const actualRate = actualRateCol >= 0 ? cellStr(row, actualRateCol) : null;
    const comments = commentsCol >= 0 ? cellStr(row, commentsCol) : null;
    const checkFlag = checkFlagCol >= 0 ? cellStr(row, checkFlagCol) : null;
    const savingOverrun = savingOverrunCol >= 0 ? parseNumber(row[savingOverrunCol]) : null;
    const usdExchangeRate = usdExchangeRateCol >= 0 ? parseNumber(row[usdExchangeRateCol]) : null;
    const pricePerWatt = pricePerWattCol >= 0 ? parseNumber(row[pricePerWattCol]) : null;

    // Capture per-cell formatting for every EXPENDITURE field present.
    const cellFormat = ws ? buildRowCellFormat(ws, i, {
      cost_category: categoryCol,
      description: descCol,
      counterparty: counterpartyCol,
      amount_ex_vat: effectiveAmountCol,
      actual_total: actualTotalCol,
      invoice_number: invoiceNumCol,
      invoice_date: invoiceDateCol,
      approved_date: approvedDateCol,
      payment_date: paidDateCol,
      po_number: poCol,
      actual_cos: actualCosCol,
      revenue_recognition_amount: revenueRecogCol,
      actual_qty: actualQtyCol,
      actual_rate: actualRateCol,
      comments: commentsCol,
      check_flag: checkFlagCol,
      saving_overrun: savingOverrunCol,
      usd_exchange_rate: usdExchangeRateCol,
      price_per_watt: pricePerWattCol,
      budget_qty: budgetQtyCol,
      budget_rate: budgetRateCol,
      budget_total: budgetTotalCol,
      budget_cos: budgetCosCol,
      forecast_payment_date: forecastPayDateCol,
    }) : null;

    lines.push({
      costCategory: category,
      categoryKey,
      counterpartyName: counterparty,
      description,
      amountExVat,
      budgetQty,
      budgetRate,
      budgetTotal,
      budgetCos,
      actualCos,
      revenueRecognitionAmount,
      forecastPaymentDate,
      invoiceNumber,
      invoiceDate,
      invoiceDateFontColor,
      invoiceDateConfirmed,
      approvedDate,
      paidDate,
      paidDateFontColor,
      paidDateConfirmed,
      poNumber,
      cosRealised,
      cashflowConfirmed,
      status,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      turnaroundDays,
      subProjectName,
      actualQty,
      actualRate,
      comments,
      checkFlag,
      savingOverrun,
      usdExchangeRate,
      pricePerWatt,
      cellFormat,
    });

    // After emitting a costed parent, reset the orphan-actual counter so
    // any subsequent right-pane-only rows attach to THIS parent.
    lastParentSourceRow = i + 1;
    lastParentCategoryKey = categoryKey ?? null;
    actualNoForCurrentParent = 0;
  }

  // S06: Reconcile J_cat grand total — SUM(revenueAllocation) vs row 2 grand total.
  if (categoryAllocations.length > 0 && jCatCol >= 0 && data.length > 1) {
    const r2val = data[1]?.[jCatCol];
    if (r2val != null && typeof r2val === "number" && r2val !== 0) {
      const sumJcat = categoryAllocations.reduce((s, c) => s + (c.revenueAllocation || 0), 0);
      const variance = Math.abs(sumJcat - r2val);
      const variancePct = Math.abs(r2val) > 0 ? (variance / Math.abs(r2val)) * 100 : 0;
      if (variancePct > 0.5) {
        issues.push({
          severity: "WARNING",
          section: "EXPENDITURE",
          message: `Category revenue allocation total (R ${sumJcat.toLocaleString()}) differs from workbook grand total (R ${r2val.toLocaleString()}) by ${variancePct.toFixed(1)}%.`,
          suggestedAction: "Review the Expenditure Breakdown costed section for missing or miscalculated categories",
          issueType: "JCAT_RECONCILIATION_VARIANCE",
          issueFingerprint: makeFingerprint("JCAT_RECONCILIATION_VARIANCE", "EXPENDITURE", "grand_total"),
          payloadJson: { sumJcat, grandTotal: r2val, variancePct },
        });
      }
    }
  }

  return { lines, counterparties: Array.from(counterpartySet), categoryAllocations, actualLineRows };
}

export function normalizeData(
  detection: DetectionResult,
  mappings: MappingResult[],
  workbook: ExcelJS.Workbook
): NormalizationResult {
  const issues: IssueEntry[] = [];
  let planTasks: NormalizationResult["planTasks"] = [];
  let revenueLines: NormalizationResult["revenueLines"] = [];
  let costLines: NormalizationResult["costLines"] = [];
  let actualLineRows: NormalizationResult["actualLineRows"] = [];
  let executionPhases: NormalizationResult["executionPhases"] = [];
  let counterpartyNames: string[] = [];
  let categoryAllocations: NormalizationResult["categoryAllocations"] = [];
  let costedSummary: NormalizationResult["costedSummary"] = null;
  let costedSummarySource: NormalizationResult["costedSummarySource"] = null;
  let projectPlanMetadata: NormalizationResult["projectPlanMetadata"] = null;

  const isMultiProject = detection.multiProject?.isMultiProject === true;
  const subProjects = detection.multiProject?.subProjects || [];

  // Generate INFO issue for multi-project trackers
  if (isMultiProject && subProjects.length > 0) {
    issues.push({
      severity: "INFO",
      section: "GENERAL",
      message: `This file contains ${subProjects.length} sub-projects: ${subProjects.join(", ")}. Each line will be tagged with its sub-project name.`,
      suggestedAction: null,
      issueType: "MULTI_PROJECT_DETECTED",
      issueFingerprint: makeFingerprint("MULTI_PROJECT_DETECTED", "GENERAL", "multi_project"),
      payloadJson: { subProjectCount: subProjects.length, subProjects },
    });
  }

  // Generate INFO issues for superseded sheets (e.g., Sheet1 skipped in favor of dedicated sheet)
  for (const um of detection.unmatched) {
    if (um.reason.startsWith("Superseded by dedicated")) {
      issues.push({
        severity: "INFO",
        section: "GENERAL",
        message: `Sheet '${um.sheetName}' contains legacy data but was skipped — ${um.reason}.`,
        suggestedAction: null,
        issueType: "SHEET_SUPERSEDED",
        issueFingerprint: makeFingerprint("SHEET_SUPERSEDED", "GENERAL", um.sheetName),
        payloadJson: { sheetName: um.sheetName, reason: um.reason },
      });
    }
  }

  // Generate INFO issue for Purchase Order sheets
  const poSheets = detection.unmatched.filter(u => u.reason.startsWith("Purchase Order sheet"));
  if (poSheets.length > 0) {
    const poNames = poSheets.map(u => u.sheetName).join(", ");
    issues.push({
      severity: "INFO",
      section: "GENERAL",
      message: `Found ${poSheets.length} Purchase Order sheet${poSheets.length > 1 ? "s" : ""} (${poNames}). These are not imported by Smart Import. Use the Load Purchase Order function instead.`,
      suggestedAction: "Use Load PO function to import these sheets",
      issueType: "PO_SHEETS_DETECTED",
      issueFingerprint: makeFingerprint("PO_SHEETS_DETECTED", "GENERAL", "po_sheets"),
      payloadJson: { count: poSheets.length, sheetNames: poSheets.map(u => u.sheetName) },
    });
  }

  for (const section of detection.sections) {
    const mapping = mappings.find(m => m.section === section.section);
    if (!mapping) continue;

    const ws = workbook.getWorksheet(section.sheetName);
    if (!ws) continue;

    const data = worksheetToArray(ws);

    switch (section.section) {
      case "PLAN": {
        const result = extractPlanTasks(
          data, mapping, section.sheetName,
          section.dataStartRowIndex, section.dataEndRowIndex,
          isMultiProject, ws
        );
        planTasks = result.tasks;

        // Extract top-of-sheet metadata (rows 1..headerRowIndex). The
        // labels are typically in rows 1–7 of the Project Plan sheet.
        // When the workbook doesn't have these labels, `hasAny` is false
        // and we leave projectPlanMetadata null so the writer skips it.
        if (projectPlanMetadata == null) {
          const meta = extractProjectPlanMetadata(data, section.headerRowIndex);
          if (meta.hasAny) {
            // Capture the formatting for each found metadata field.
            const metaCellFormat: CellFormatMap = {};
            let hasFmt = false;
            for (const fieldName of Object.keys(meta.colByField)) {
              const colIdx = meta.colByField[fieldName];
              const rowIdx1 = meta.rowByField[fieldName];
              if (colIdx == null || rowIdx1 == null) continue;
              const fmt = extractCellFormat(ws, rowIdx1 - 1, colIdx);
              if (fmt) {
                metaCellFormat[fieldName] = fmt;
                hasFmt = true;
              }
            }
            projectPlanMetadata = {
              baselineCompletionDate: meta.baselineCompletionDate,
              forecastedCompletionDate: meta.forecastedCompletionDate,
              projectStartDate: meta.projectStartDate,
              durationMonthsFromSiteEstab: meta.durationMonthsFromSiteEstab,
              durationMonthsToCapacityTest: meta.durationMonthsToCapacityTest,
              sourceSheet: section.sheetName,
              cellFormat: hasFmt ? metaCellFormat : null,
            };
          }
        }

        // Generate INFO issue when project metadata is missing (e.g., MONDI_LEGACY layout)
        if (detection.projectInfo) {
          const pi = detection.projectInfo;
          if (!pi.sizeKwp && !pi.pd && !pi.pm && !pi.contractValue && !pi.phase) {
            issues.push({
              severity: "INFO",
              section: "PLAN",
              message: "Project metadata (size, PD, PM, contract value, phase) not found in tracker. Please assign manually in the Section Detection step.",
              suggestedAction: "Edit project info fields",
              issueType: "MISSING_METADATA",
              issueFingerprint: makeFingerprint("MISSING_METADATA", "PLAN", "project_info"),
              payloadJson: { layoutVariant: section.layoutVariant || "UNKNOWN" },
            });
          }
        } else {
          issues.push({
            severity: "INFO",
            section: "PLAN",
            message: "Project metadata (size, PD, PM, contract value, phase) not found in tracker. Please assign manually in the Section Detection step.",
            suggestedAction: "Edit project info fields",
            issueType: "MISSING_METADATA",
            issueFingerprint: makeFingerprint("MISSING_METADATA", "PLAN", "project_info"),
            payloadJson: { layoutVariant: section.layoutVariant || "UNKNOWN" },
          });
        }

        if (detection.projectInfo) {
          const phaseLabels = [
            { name: "PD Handover", date: detection.projectInfo.pdHandoverDate },
            { name: "Construction Start", date: detection.projectInfo.constructionStartDate },
            { name: "Commissioning", date: detection.projectInfo.commissioningDate },
            { name: "Practical Completion", date: detection.projectInfo.practicalCompletionDate },
            { name: "O&M Handover", date: detection.projectInfo.omHandoverDate },
            { name: "Client Handover", date: detection.projectInfo.clientHandoverDate },
          ];
          for (const p of phaseLabels) {
            if (p.date) {
              executionPhases.push({ phaseName: p.name, phaseDate: p.date });
            }
          }
        }
        break;
      }
      case "REVENUE": {
        revenueLines = extractRevenueLines(
          data, mapping, section.sheetName,
          section.dataStartRowIndex, section.dataEndRowIndex, issues, ws,
          isMultiProject
        );
        if (!costedSummary) {
          costedSummary = extractCostedSummary(data, section.headerRowIndex);
          if (costedSummary) {
            // Capture the source sheet so the trackerRevenueSummary writer
            // can record where the values came from. Cell-level formatting
            // for the summary block is currently coarse (the labels and
            // values are in scattered cells across rows 4–7); we leave
            // cellFormat null for v1 — the schema column is nullable.
            costedSummarySource = { sourceSheet: section.sheetName, cellFormat: null };
          }
        }
        break;
      }
      case "EXPENDITURE": {
        const result = extractCostLines(
          data, mapping, section.sheetName,
          section.dataStartRowIndex, section.dataEndRowIndex, issues, ws,
          isMultiProject
        );
        costLines = result.lines;
        counterpartyNames = result.counterparties;
        categoryAllocations = result.categoryAllocations;
        actualLineRows = result.actualLineRows;
        break;
      }
    }
  }

  // Expenditure Tracking Reconciliation: compare breakdown line totals vs tracking summary
  if (costLines.length > 0) {
    reconcileExpenditureTracking(workbook, costLines, detection, issues);
  }

  return {
    planTasks,
    revenueLines,
    costLines,
    actualLineRows,
    executionPhases,
    counterpartyNames,
    categoryAllocations,
    costedSummary,
    costedSummarySource,
    projectPlanMetadata,
    issues,
  };
}

/**
 * Read the "Expenditure Tracking" summary sheet and compare its category totals
 * against the imported Expenditure Breakdown line totals. Generates advisory issues
 * for any mismatches to flag potential missed rows or mapping errors.
 */
function reconcileExpenditureTracking(
  workbook: ExcelJS.Workbook,
  costLines: NormalizationResult["costLines"],
  detection: DetectionResult,
  issues: IssueEntry[]
): void {
  // Find the "Expenditure Tracking" sheet — it's the summary sheet, not the breakdown
  const expSection = detection.sections.find(s => s.section === "EXPENDITURE");
  const breakdownSheetName = expSection?.sheetName || "";

  // Look for a separate "Expenditure Tracking" sheet (not the one used for breakdown)
  const trackingSheetNames = ["expenditure tracking", "expenditure summary"];
  let trackingWs: ExcelJS.Worksheet | undefined;
  for (const ws of workbook.worksheets) {
    const lowerName = ws.name.toLowerCase().trim();
    if (lowerName === breakdownSheetName.toLowerCase()) continue; // skip breakdown sheet
    if (trackingSheetNames.some(n => lowerName === n || lowerName.includes("expenditure tracking"))) {
      trackingWs = ws;
      break;
    }
  }
  if (!trackingWs) return; // No tracking sheet found — skip gracefully

  const data = worksheetToArray(trackingWs);
  if (data.length < 5) return;

  // Read category totals from tracking sheet (rows 9-23 typically)
  // Format: B=number, D=category name, H or F=actual total
  const trackingCategories = new Map<string, { name: string; total: number }>();
  let trackingGrandTotal: number | null = null;

  // First, try to find the grand total (usually around row 5 or a row labeled "Total")
  for (let i = 0; i < Math.min(data.length, 30); i++) {
    const row = data[i];
    if (!row) continue;

    for (let c = 0; c < Math.min(row.length, 10); c++) {
      const cellVal = String(row[c] || "").toLowerCase().trim();
      if (cellVal === "total" || cellVal === "grand total" || cellVal.includes("total expenditure")) {
        // Look for numeric total in columns to the right
        for (let nc = c + 1; nc < Math.min(row.length, c + 8); nc++) {
          const val = row[nc];
          if (val != null && typeof val === "number" && val !== 0) {
            trackingGrandTotal = val;
            break;
          }
          if (val != null && typeof val === "string") {
            const parsed = parseFloat(String(val).replace(/[\s,R$]/g, ""));
            if (!isNaN(parsed) && parsed !== 0) {
              trackingGrandTotal = parsed;
              break;
            }
          }
        }
      }
    }

    // Category rows: look for numbered categories like "1. Panels", "2. Inverters"
    for (let c = 0; c < Math.min(row.length, 6); c++) {
      const cellVal = String(row[c] || "").trim();
      const catMatch = cellVal.match(/^(\d+)\.\s*(.+)/);
      if (catMatch) {
        const catNum = catMatch[1];
        const catName = cellVal;
        // Find amount in the row (scan right for numeric value)
        let amount: number | null = null;
        for (let nc = c + 1; nc < Math.min(row.length, c + 10); nc++) {
          const val = row[nc];
          if (val != null && typeof val === "number" && val !== 0) {
            amount = val;
            break;
          }
        }
        if (amount !== null) {
          trackingCategories.set(catNum, { name: catName, total: amount });
        }
      }
    }
  }

  if (trackingCategories.size === 0 && trackingGrandTotal === null) return;

  // Group breakdown lines by category and sum amounts
  const breakdownByCategory = new Map<string, { name: string; total: number }>();
  let breakdownGrandTotal = 0;

  for (const line of costLines) {
    const amount = parseFloat(String(line.amountExVat || 0));
    if (isNaN(amount)) continue;
    breakdownGrandTotal += amount;

    const catName = line.costCategory || "Uncategorized";
    const catNumMatch = catName.match(/^(\d+)/);
    const catKey = catNumMatch ? catNumMatch[1] : catName;

    if (breakdownByCategory.has(catKey)) {
      breakdownByCategory.get(catKey)!.total += amount;
    } else {
      breakdownByCategory.set(catKey, { name: catName, total: amount });
    }
  }

  // Compare category totals
  for (const [catNum, tracking] of trackingCategories) {
    const breakdown = breakdownByCategory.get(catNum);
    if (!breakdown) {
      issues.push({
        severity: "WARNING",
        section: "EXPENDITURE",
        message: `Expenditure category '${tracking.name}' found in Tracking summary (R ${tracking.total.toLocaleString()}) but no matching lines in Breakdown.`,
        suggestedAction: "Verify the category exists in Expenditure Breakdown",
        issueType: "RECONCILIATION_MISSING_CATEGORY",
        issueFingerprint: makeFingerprint("RECONCILIATION_MISSING_CATEGORY", "EXPENDITURE", catNum),
        payloadJson: { category: tracking.name, trackingTotal: tracking.total },
      });
      continue;
    }

    const variance = Math.abs(breakdown.total - tracking.total);
    const variancePct = tracking.total !== 0 ? (variance / Math.abs(tracking.total)) * 100 : 0;

    if (variancePct > 1) {
      issues.push({
        severity: "WARNING",
        section: "EXPENDITURE",
        message: `Expenditure category '${tracking.name}' breakdown total (R ${breakdown.total.toLocaleString()}) differs from tracking summary (R ${tracking.total.toLocaleString()}) by R ${variance.toLocaleString()} (${variancePct.toFixed(1)}%). Verify no rows were missed.`,
        suggestedAction: "Compare the Expenditure Breakdown lines against the Tracking summary",
        issueType: "RECONCILIATION_VARIANCE",
        issueFingerprint: makeFingerprint("RECONCILIATION_VARIANCE", "EXPENDITURE", catNum),
        payloadJson: { category: tracking.name, breakdownTotal: breakdown.total, trackingTotal: tracking.total, variancePct },
      });
    } else if (variance > 0) {
      issues.push({
        severity: "INFO",
        section: "EXPENDITURE",
        message: `Expenditure category '${tracking.name}' has minor rounding difference: breakdown R ${breakdown.total.toLocaleString()} vs tracking R ${tracking.total.toLocaleString()}.`,
        suggestedAction: null,
        issueType: "RECONCILIATION_ROUNDING",
        issueFingerprint: makeFingerprint("RECONCILIATION_ROUNDING", "EXPENDITURE", catNum),
        payloadJson: { category: tracking.name, breakdownTotal: breakdown.total, trackingTotal: tracking.total },
      });
    }
  }

  // Compare grand totals
  if (trackingGrandTotal !== null) {
    const grandVariance = Math.abs(breakdownGrandTotal - trackingGrandTotal);
    const grandPct = trackingGrandTotal !== 0 ? (grandVariance / Math.abs(trackingGrandTotal)) * 100 : 0;

    if (grandPct > 1) {
      issues.push({
        severity: "WARNING",
        section: "EXPENDITURE",
        message: `Expenditure grand total from Breakdown (R ${breakdownGrandTotal.toLocaleString()}) differs from Tracking summary (R ${trackingGrandTotal.toLocaleString()}) by R ${grandVariance.toLocaleString()} (${grandPct.toFixed(1)}%). Some rows may have been missed.`,
        suggestedAction: "Review the Expenditure Breakdown for missed or skipped rows",
        issueType: "RECONCILIATION_GRAND_TOTAL",
        issueFingerprint: makeFingerprint("RECONCILIATION_GRAND_TOTAL", "EXPENDITURE", "grand_total"),
        payloadJson: { breakdownTotal: breakdownGrandTotal, trackingTotal: trackingGrandTotal, variancePct: grandPct },
      });
    } else if (grandVariance > 0) {
      issues.push({
        severity: "INFO",
        section: "EXPENDITURE",
        message: `Expenditure grand totals have minor rounding difference: breakdown R ${breakdownGrandTotal.toLocaleString()} vs tracking R ${trackingGrandTotal.toLocaleString()}.`,
        suggestedAction: null,
        issueType: "RECONCILIATION_GRAND_TOTAL_OK",
        issueFingerprint: makeFingerprint("RECONCILIATION_GRAND_TOTAL_OK", "EXPENDITURE", "grand_total"),
        payloadJson: { breakdownTotal: breakdownGrandTotal, trackingTotal: trackingGrandTotal },
      });
    }
  }
}
