import type ExcelJS from "exceljs";
import type { DetectionResult } from "./detector";
import type { MappingResult } from "./mapper";
import { worksheetToArray, parseDate, parseNumber, parsePercent, parseStatus, daysBetween } from "./utils";

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
function isValidInvoiceNumber(invoiceNumber: string | null | undefined): boolean {
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
  isMultiProject: boolean = false
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
  const phaseCol = getColIndex(mapping, "phase");
  const commentCol = getColIndex(mapping, "comment");

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
      comment: commentCol >= 0 ? cellStr(row, commentCol) : null,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      subProjectName: currentSubProject,
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

function extractCostLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[],
  ws?: ExcelJS.Worksheet,
  isMultiProject: boolean = false
): { lines: NormalizationResult["costLines"]; counterparties: string[]; categoryAllocations: CategoryAllocationEntry[] } {
  const lines: NormalizationResult["costLines"] = [];
  const counterpartySet = new Set<string>();
  const categoryAllocations: CategoryAllocationEntry[] = [];

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
    const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
    const approvedDate = approvedDateCol >= 0 ? parseDate(row[approvedDateCol]) : null;
    let paidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
    const poNumber = cellStr(row, poCol);

    const status = deriveCostStatus(invoiceNumber, invoiceDate, approvedDate, paidDate);

    let turnaroundDays: number | null = null;
    if (invoiceDate && paidDate) {
      turnaroundDays = daysBetween(invoiceDate, paidDate);
    }

    if (!hasAmount) {
      continue;
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

    if (!paidDate && forecastPaymentDate) {
      paidDate = forecastPaymentDate;
      if (ws && forecastPayDateCol >= 0) {
        const fc = getCellFontColor(ws, i, forecastPayDateCol);
        paidDateFontColor = fc.color;
        paidDateConfirmed = fc.isBlack;
      }
    }

    // S07: COS realisation requires a valid (non-placeholder) invoice AND non-zero actual amount.
    // Placeholder invoices (TBC, Pending, N/A, etc.) do not count as captured supplier invoices.
    const cosRealised = isValidInvoiceNumber(invoiceNumber) && hasAmount;
    const cashflowConfirmed = !!(invoiceNumber && poNumber && paidDateConfirmed);

    // Extract sub-project name from category in multi-project trackers
    const subProjectName = isMultiProject ? extractSubProjectFromCategory(rawCategory) : null;

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
    });
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

  return { lines, counterparties: Array.from(counterpartySet), categoryAllocations };
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
  let executionPhases: NormalizationResult["executionPhases"] = [];
  let counterpartyNames: string[] = [];
  let categoryAllocations: NormalizationResult["categoryAllocations"] = [];
  let costedSummary: NormalizationResult["costedSummary"] = null;

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
          isMultiProject
        );
        planTasks = result.tasks;

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
    executionPhases,
    counterpartyNames,
    categoryAllocations,
    costedSummary,
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
