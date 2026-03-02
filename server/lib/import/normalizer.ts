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
  }>;
  revenueLines: Array<{
    description: string | null;
    milestoneName: string | null;
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
  }>;
  costLines: Array<{
    costCategory: string | null;
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
  }>;
  executionPhases: Array<{
    phaseName: string;
    phaseDate: string | null;
  }>;
  counterpartyNames: string[];
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

function makeFingerprint(issueType: string, section: string, key: string): string {
  return `${issueType}::${section}::${key}`;
}

function getColIndex(mappings: MappingResult, canonicalField: string): number {
  const mapping = mappings.mappings.find(m => m.canonicalField === canonicalField);
  return mapping ? mapping.colIndex : -1;
}

function cellStr(row: any[], colIndex: number): string | null {
  if (colIndex < 0 || colIndex >= row.length) return null;
  const v = row[colIndex];
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function getCellFontColor(ws: ExcelJS.Worksheet, rowIdx: number, colIdx: number): { color: string | null; isBlack: boolean } {
  try {
    const cell = ws.getRow(rowIdx + 1).getCell(colIdx + 1);
    if (!cell || !cell.value) return { color: null, isBlack: false };
    const font = cell.font;
    if (!font || !font.color) {
      return { color: "black", isBlack: true };
    }
    if (font.color.theme !== undefined && !font.color.argb) {
      if (font.color.theme === 1 || font.color.theme === 0) {
        return { color: "black", isBlack: true };
      }
    }
    const argb = (font.color.argb || "").toLowerCase();
    if (!argb) return { color: "black", isBlack: true };
    const colorHex = argb.length === 8 ? argb.substring(2) : argb;
    const isBlack = colorHex === "000000" || argb === "ff000000";
    const r = parseInt(colorHex.substring(0, 2), 16);
    const g = parseInt(colorHex.substring(2, 4), 16);
    const b = parseInt(colorHex.substring(4, 6), 16);
    const isRedish = r > 150 && g < 80 && b < 80;
    const isBlueish = b > 150 && r < 80 && g < 80;
    const isDark = r < 40 && g < 40 && b < 40;
    if (isBlack || isDark) return { color: "black", isBlack: true };
    if (isRedish) return { color: "red", isBlack: false };
    if (isBlueish) return { color: "blue", isBlack: false };
    return { color: argb, isBlack: false };
  } catch {
    return { color: null, isBlack: false };
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
  if (/^\d+(\.\d+)*$/.test(trimmed)) {
    const parts = trimmed.split(".");
    return parts.map(p => {
      const n = parseInt(p, 10);
      return isNaN(n) ? p : String(n);
    }).join(".");
  }
  const numVal = parseFloat(trimmed);
  if (!isNaN(numVal) && isFinite(numVal)) {
    return parseFloat(numVal.toFixed(10)).toString();
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
  endRow: number
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

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    const taskName = cellStr(row, taskNameCol);
    let taskNo = cellStr(row, taskNoCol);

    if (!taskName && !taskNo) continue;

    if (taskNo && (taskNo.toLowerCase() === "no." || taskNo.toLowerCase() === "no")) continue;
    if (taskName && (taskName.toLowerCase() === "high level programme" || taskName.toLowerCase() === "high level program")) continue;
    if (taskName && taskName.toLowerCase().includes("end of sheet")) continue;

    if (taskNo) {
      taskNo = normalizeTaskNo(taskNo);
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

    const nameLower = (t.taskName || "").toLowerCase();
    for (const kw of milestoneKeywords) {
      if (nameLower.includes(kw)) {
        isMilestone = true;
        break;
      }
    }

    if (t.startDate && t.endDate && t.startDate === t.endDate && !isMilestone) {
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
  ws?: ExcelJS.Worksheet
): NormalizationResult["revenueLines"] {
  const lines: NormalizationResult["revenueLines"] = [];

  const milestoneNameCol = getColIndex(mapping, "milestone_name");
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

    const milestoneName = cellStr(row, milestoneNameCol);
    if (!milestoneName) continue;

    const trimmedName = milestoneName.trim();
    if (trimmedName === "-" || trimmedName === "—" || trimmedName === "") continue;

    const lowerName = milestoneName.toLowerCase();
    if (lowerName.includes("end of sheet") || lowerName.startsWith("key") || lowerName.includes("red font") || lowerName.includes("contains an error")) break;

    const amountExVat = amountCol >= 0 ? parseNumber(row[amountCol]) : null;
    const vat = vatCol >= 0 ? parseNumber(row[vatCol]) : null;
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

    lines.push({
      description: milestoneName,
      milestoneName,
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
    });
  }

  return lines;
}

function getBudgetColIndex(budgetMappings: MappingResult["budgetMappings"], field: string): number {
  if (!budgetMappings) return -1;
  const m = budgetMappings.find(bm => bm.canonicalField === field);
  return m ? m.colIndex : -1;
}

function extractCostLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[],
  ws?: ExcelJS.Worksheet
): { lines: NormalizationResult["costLines"]; counterparties: string[] } {
  const lines: NormalizationResult["costLines"] = [];
  const counterpartySet = new Set<string>();

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

  const effectiveAmountCol = amountCol >= 0 ? amountCol : actualTotalCol;

  const invoiceNumbers = new Set<string>();
  let currentCategory: string | null = null;

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    const rawCategory = cellStr(row, categoryCol);
    const description = cellStr(row, descCol);
    const counterparty = cellStr(row, counterpartyCol);

    const amountExVat = effectiveAmountCol >= 0 ? parseNumber(row[effectiveAmountCol]) : null;
    const parsedAmount = amountExVat !== null ? parseFloat(String(amountExVat)) : NaN;
    const hasAmount = !isNaN(parsedAmount) && parsedAmount !== 0;

    if (!rawCategory && !description && !counterparty && !hasAmount) continue;

    const lowerJoined = [rawCategory, description].filter(Boolean).join(" ").toLowerCase();
    if (lowerJoined.includes("sub total") || lowerJoined.includes("end of sheet")) continue;

    if (rawCategory) {
      const isCategoryPattern = /^\d+\.?\s*[A-Za-z]/.test(rawCategory);
      if (isCategoryPattern) {
        const cleanCat = rawCategory.replace(/^\d+\.?\s*/, "").trim();
        currentCategory = cleanCat || rawCategory;
      } else if (!currentCategory) {
        currentCategory = rawCategory;
      }
    }
    const category = currentCategory || rawCategory;
    const invoiceNumber = cellStr(row, invoiceNumCol);
    const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
    const approvedDate = approvedDateCol >= 0 ? parseDate(row[approvedDateCol]) : null;
    const paidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
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

    const cosRealised = !!(invoiceNumber && invoiceDateConfirmed);
    const cashflowConfirmed = !!(invoiceNumber && poNumber && paidDateConfirmed);

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

    lines.push({
      costCategory: category,
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
    });
  }

  return { lines, counterparties: Array.from(counterpartySet) };
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
          section.dataStartRowIndex, section.dataEndRowIndex
        );
        planTasks = result.tasks;

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
          section.dataStartRowIndex, section.dataEndRowIndex, issues, ws
        );
        break;
      }
      case "EXPENDITURE": {
        const result = extractCostLines(
          data, mapping, section.sheetName,
          section.dataStartRowIndex, section.dataEndRowIndex, issues, ws
        );
        costLines = result.lines;
        counterpartyNames = result.counterparties;
        break;
      }
    }
  }

  return {
    planTasks,
    revenueLines,
    costLines,
    executionPhases,
    counterpartyNames,
    issues,
  };
}
