import type ExcelJS from "exceljs";
import type { DetectionResult } from "./detector";
import type { MappingResult } from "./mapper";
import { worksheetToArray, parseDate, parseNumber, parsePercent, parseStatus, daysBetween } from "./utils";

export interface NormalizationResult {
  planTasks: Array<{
    taskName: string;
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
    comment: string | null;
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
    expectedPaymentDate: string | null;
    paidDate: string | null;
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
    invoiceNumber: string | null;
    invoiceDate: string | null;
    approvedDate: string | null;
    paidDate: string | null;
    poNumber: string | null;
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

function extractPlanTasks(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number
): { tasks: NormalizationResult["planTasks"]; phases: NormalizationResult["executionPhases"] } {
  const tasks: NormalizationResult["planTasks"] = [];
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
    const taskNo = cellStr(row, taskNoCol);

    if (!taskName && !taskNo) continue;

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

    let statusStr: string | null = null;
    if (pctRaw !== null) {
      if (pctRaw >= 1) statusStr = "Complete";
      else if (pctRaw > 0) statusStr = "In Progress";
      else statusStr = "Not Started";
    }

    tasks.push({
      taskName: taskName || taskNo || "",
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
      comment: commentCol >= 0 ? cellStr(row, commentCol) : null,
      sourceSheet: sheetName,
      sourceRow: i + 1,
    });
  }

  return { tasks, phases };
}

function extractRevenueLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[]
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

    const lowerName = milestoneName.toLowerCase();
    if (lowerName.includes("end of sheet") || lowerName.startsWith("key")) break;

    const amountExVat = amountCol >= 0 ? parseNumber(row[amountCol]) : null;
    const vat = vatCol >= 0 ? parseNumber(row[vatCol]) : null;
    const invoiceNumber = cellStr(row, invoiceNumCol);
    const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
    const expectedPaymentDate = plannedDateCol >= 0 ? parseDate(row[plannedDateCol]) : null;
    const paidDate = paidDateCol >= 0 ? parseDate(row[paidDateCol]) : null;
    const inBankDate = inBankDateCol >= 0 ? parseDate(row[inBankDateCol]) : null;

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

    lines.push({
      description: milestoneName,
      milestoneName,
      amountExVat,
      vat,
      invoiceNumber,
      invoiceDate,
      expectedPaymentDate,
      paidDate,
      inBankDate,
      status,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      turnaroundDays,
    });
  }

  return lines;
}

function extractCostLines(
  data: any[][],
  mapping: MappingResult,
  sheetName: string,
  startRow: number,
  endRow: number,
  issues: IssueEntry[]
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

  const effectiveAmountCol = amountCol >= 0 ? amountCol : actualTotalCol;

  const invoiceNumbers = new Set<string>();

  for (let i = startRow; i < Math.min(endRow, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    const category = cellStr(row, categoryCol);
    const description = cellStr(row, descCol);
    const counterparty = cellStr(row, counterpartyCol);

    if (!category && !description && !counterparty) continue;

    const lowerJoined = [category, description].filter(Boolean).join(" ").toLowerCase();
    if (lowerJoined.includes("sub total") || lowerJoined.includes("end of sheet")) continue;

    const amountExVat = effectiveAmountCol >= 0 ? parseNumber(row[effectiveAmountCol]) : null;
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

    if (!amountExVat && (invoiceNumber || invoiceDate || paidDate)) {
      issues.push({
        severity: "BLOCKER",
        section: "EXPENDITURE",
        message: `Missing amount on cost line row ${i + 1} with invoice/payment data`,
        suggestedAction: "Add the financial amount for this cost line",
        issueType: "MISSING_AMOUNT",
        issueFingerprint: makeFingerprint("MISSING_AMOUNT", "EXPENDITURE", description || `row_${i + 1}`),
        payloadJson: { category, description, row: i + 1 },
      });
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

    lines.push({
      costCategory: category,
      counterpartyName: counterparty,
      description,
      amountExVat,
      invoiceNumber,
      invoiceDate,
      approvedDate,
      paidDate,
      poNumber,
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
          section.dataStartRowIndex, section.dataEndRowIndex, issues
        );
        break;
      }
      case "EXPENDITURE": {
        const result = extractCostLines(
          data, mapping, section.sheetName,
          section.dataStartRowIndex, section.dataEndRowIndex, issues
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
