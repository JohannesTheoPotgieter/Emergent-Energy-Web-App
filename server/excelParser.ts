import * as XLSX from "xlsx";
import type { 
  InsertProjectInfo, 
  InsertProgramExpense, 
  InsertProgramInflows, 
  InsertProjectPlan,
  InsertCashflowPoint,
  InsertFinanceRevenueMonthly,
  InsertFinanceCosMonthly
} from "@shared/schema";

export interface ParseResult {
  projectName: string;
  projectInfo: InsertProjectInfo | null;
  expenses: InsertProgramExpense[];
  inflows: InsertProgramInflows[];
  planItems: InsertProjectPlan[];
  cashflowPoints: InsertCashflowPoint[];
  financeRevenueMonthly: InsertFinanceRevenueMonthly[];
  financeCosMonthly: InsertFinanceCosMonthly[];
  warnings: string[];
  expensesParsed: number;
  inflowsParsed: number;
  planParsed: number;
  infoParsed: boolean;
  cashflowParsed: number;
  financeRevenueParsed: number;
  financeCosParsed: number;
}

function parseDate(value: any): string | null {
  if (!value) return null;
  
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  
  if (typeof value === "number") {
    try {
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
      }
    } catch {
      return null;
    }
  }
  
  if (typeof value === "string") {
    // Try parsing with JavaScript Date (handles many formats including "7-Jul-25", "Jul 7, 2025", etc.)
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    
    // Legacy patterns for explicit formats
    const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    
    const yyyymmdd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (yyyymmdd) {
      return value.substring(0, 10);
    }
  }
  
  return null;
}

function parseNumber(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = parseFloat(String(value).replace(/[,$]/g, ""));
  return isNaN(num) ? null : String(num);
}

function parsePercent(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  let num = parseFloat(String(value).replace(/%/g, ""));
  if (isNaN(num)) return null;
  if (num > 1 && num <= 100) num = num / 100;
  return String(num);
}

function parseStatus(value: any): number | null {
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

function getCellValue(sheet: XLSX.WorkSheet, col: string, row: number): any {
  const cellRef = `${col}${row}`;
  const cell = sheet[cellRef];
  return cell ? cell.v : null;
}

// Search sheet for a label and return the date value from adjacent cells
// Expanded search area to cover more tracker variants
function findLabeledDateValue(sheet: XLSX.WorkSheet, labels: string[]): string | null {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:Z50");
  const maxRow = Math.min(range.e.r, 50); // Search first 50 rows
  const maxCol = Math.min(range.e.c, 10); // Search columns A-K for labels
  
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) {
        const cellText = String(cell.v).toLowerCase().trim();
        for (const label of labels) {
          if (cellText.includes(label.toLowerCase())) {
            // Found a match, look for date in adjacent columns (right side)
            for (let dc = 1; dc <= 4; dc++) {
              if (c + dc <= range.e.c) {
                const valueCell = sheet[XLSX.utils.encode_cell({ r, c: c + dc })];
                if (valueCell && valueCell.v) {
                  const dateVal = parseDate(valueCell.v);
                  if (dateVal) return dateVal;
                }
              }
            }
            // Also check row below same column (some trackers stack label/value)
            if (r + 1 <= maxRow) {
              const belowCell = sheet[XLSX.utils.encode_cell({ r: r + 1, c })];
              if (belowCell && belowCell.v) {
                const dateVal = parseDate(belowCell.v);
                if (dateVal) return dateVal;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function normalizeHeader(header: any): string {
  return String(header || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function findHeaderRow(data: any[][], requiredTokens: string[], startRow = 0, maxRows = 30): { rowIdx: number; colMap: Map<string, number> } | null {
  for (let rowIdx = startRow; rowIdx < Math.min(data.length, startRow + maxRows); rowIdx++) {
    const row = data[rowIdx];
    if (!row) continue;
    
    // Build column map for this row
    const colMap = new Map<string, number>();
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const header = normalizeHeader(row[colIdx]);
      if (header) {
        colMap.set(header, colIdx);
      }
    }
    
    // Check if all required tokens are present
    const allTokensFound = requiredTokens.every(token => {
      const normalizedToken = token.toLowerCase().trim();
      const headers = Array.from(colMap.keys());
      for (const header of headers) {
        if (header.includes(normalizedToken)) {
          return true;
        }
      }
      return false;
    });
    
    if (allTokensFound) {
      return { rowIdx, colMap };
    }
  }
  
  return null;
}

function getColumnIndex(colMap: Map<string, number>, searchTerms: string[]): number {
  for (const term of searchTerms) {
    const normalizedTerm = term.toLowerCase().trim();
    const entries = Array.from(colMap.entries());
    for (const [header, colIdx] of entries) {
      if (header.includes(normalizedTerm)) {
        return colIdx;
      }
    }
  }
  return -1;
}

export function parseTrackerFile(buffer: Buffer, fileName: string): ParseResult {
  const projectName = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const warnings: string[] = [];
  
  const workbook = XLSX.read(buffer, { 
    type: "buffer",
    cellDates: true,
    cellNF: true,
    cellStyles: true,
    cellFormula: false  // Read formula results, not formulas
  });
  
  let projectInfo: InsertProjectInfo | null = null;
  const expenses: InsertProgramExpense[] = [];
  const inflows: InsertProgramInflows[] = [];
  const planItems: InsertProjectPlan[] = [];

  // Parse Project Plan sheet for project info and tasks
  if (workbook.SheetNames.includes("Project Plan")) {
    const sheet = workbook.Sheets["Project Plan"];
    
    // Extract project info from fixed cells
    const sizeKwp = parseNumber(getCellValue(sheet, "E", 3));
    const pd = getCellValue(sheet, "E", 4);
    const pm = getCellValue(sheet, "E", 5);
    const contractValue = parseNumber(getCellValue(sheet, "E", 6));
    const phase = getCellValue(sheet, "E", 7);
    
    // Extract date fields - look in multiple locations
    // Try column E rows 8-12 first, then search for labeled cells
    const pdHandoverDate = parseDate(getCellValue(sheet, "E", 8)) || findLabeledDateValue(sheet, ["pd handover", "handover date"]);
    const constructionStartDate = parseDate(getCellValue(sheet, "E", 9)) || findLabeledDateValue(sheet, ["construction start", "start date"]);
    const commissioningDate = parseDate(getCellValue(sheet, "E", 10)) || findLabeledDateValue(sheet, ["commissioning"]);
    const omHandoverDate = parseDate(getCellValue(sheet, "E", 11)) || findLabeledDateValue(sheet, ["o&m handover", "om handover"]);
    const clientHandoverDate = parseDate(getCellValue(sheet, "E", 12)) || findLabeledDateValue(sheet, ["client handover"]);
    
    projectInfo = {
      projectName,
      sizeKwp,
      pd: pd ? String(pd) : null,
      pm: pm ? String(pm) : null,
      contractValue,
      phase: phase ? String(phase) : null,
      pdHandoverDate,
      constructionStartDate,
      commissioningDate,
      omHandoverDate,
      clientHandoverDate,
    };
    
    // Parse task table with robust header detection
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Look for task table header
    const taskHeaderTokens = ["no.", "high level programme", "actual start", "actual end"];
    const taskHeader = findHeaderRow(data, taskHeaderTokens);
    
    if (taskHeader) {
      const { rowIdx: headerRowIdx, colMap } = taskHeader;
      
      // Find column indices
      const noCol = getColumnIndex(colMap, ["no.", "no"]);
      const programmeCol = getColumnIndex(colMap, ["high level programme", "programme"]);
      const actualStartCol = getColumnIndex(colMap, ["actual start"]);
      const durationCol = getColumnIndex(colMap, ["duration", "days"]);
      const actualEndCol = getColumnIndex(colMap, ["actual end"]);
      
      // Find status columns - prioritize "status" headers over generic "%" headers
      const statusCols: number[] = [];
      const entries = Array.from(colMap.entries());
      
      // First pass: look for explicit "status" headers
      for (const [header, colIdx] of entries) {
        if (header.includes("status")) {
          statusCols.push(colIdx);
        }
      }
      
      // If we don't have 2 status columns, look for "%" headers as fallback
      if (statusCols.length < 2) {
        for (const [header, colIdx] of entries) {
          if (header.includes("%") && !header.includes("status") && !statusCols.includes(colIdx)) {
            statusCols.push(colIdx);
            if (statusCols.length >= 2) break;
          }
        }
      }
      
      // Parse data rows (start from next row after header)
      for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;
        
        const taskNo = noCol >= 0 ? row[noCol] : null;
        const highLevelProgramme = programmeCol >= 0 ? row[programmeCol] : null;
        
        if (!taskNo && !highLevelProgramme) continue;
        
        const actualStart = actualStartCol >= 0 ? parseDate(row[actualStartCol]) : null;
        const durationDays = durationCol >= 0 && row[durationCol] ? parseInt(String(row[durationCol])) : null;
        const actualEnd = actualEndCol >= 0 ? parseDate(row[actualEndCol]) : null;
        const actualPctComplete = statusCols[0] >= 0 ? parseStatus(row[statusCols[0]]) : null;
        const expectedPctComplete = statusCols[1] >= 0 ? parseStatus(row[statusCols[1]]) : null;
        
        planItems.push({
          projectName,
          rowNumber: rowIdx + 1,
          taskNo: taskNo ? String(taskNo) : null,
          highLevelProgramme: highLevelProgramme ? String(highLevelProgramme) : null,
          actualStart,
          durationDays,
          actualEnd,
          actualPctComplete,
          expectedPctComplete,
        });
      }
    } else {
      warnings.push("Could not find task table header in Project Plan sheet");
    }
  } else {
    warnings.push("Missing 'Project Plan' sheet");
  }

  // Parse Expenditure Breakdown sheet - handles dual-table structure (Budget/Costed + Actual/Finance)
  if (workbook.SheetNames.includes("Expenditure Breakdown")) {
    const sheet = workbook.Sheets["Expenditure Breakdown"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Core header tokens to find the main expenditure table (more flexible - doesn't require all columns)
    const expenseHeaderTokens = [
      "product/ service",
      "description of work",
      "actual total",
      "po number",
      "invoice number",
      "finance payment date",
      "total cos"
    ];
    
    const expenseHeader = findHeaderRow(data, expenseHeaderTokens);
    
    if (expenseHeader) {
      const { rowIdx: headerRowIdx, colMap } = expenseHeader;
      
      // Budget/Costed side columns
      const categoryCol = getColumnIndex(colMap, ["product/ service", "product", "category"]);
      const descCol = getColumnIndex(colMap, ["description of work", "description"]);
      const budgetQtyCol = getColumnIndex(colMap, ["qty", "quantity"]);
      const budgetRateCol = getColumnIndex(colMap, ["rate / unit", "rate"]);
      const budgetTotalCol = getColumnIndex(colMap, ["budget total"]);
      const forecastPayDateCol = getColumnIndex(colMap, ["forecasted payment date", "forecast payment date", "forecast pay date"]);
      
      // Find Budget Total COS column (first "Total COS")
      let budgetCosCol = -1;
      let actualCosCol = -1;
      const cosMatches: number[] = [];
      for (const [key, idx] of Object.entries(colMap)) {
        if (key.toLowerCase().includes("total cos") || key.toLowerCase() === "cos") {
          cosMatches.push(idx as number);
        }
      }
      if (cosMatches.length >= 2) {
        budgetCosCol = Math.min(...cosMatches);
        actualCosCol = Math.max(...cosMatches);
      } else if (cosMatches.length === 1) {
        actualCosCol = cosMatches[0];
      }
      
      // Actual/Finance side columns
      const actualTotalCol = getColumnIndex(colMap, ["actual total"]);
      const poCol = getColumnIndex(colMap, ["po number"]);
      const invoiceCol = getColumnIndex(colMap, ["invoice number"]);
      const invoiceDateCol = getColumnIndex(colMap, ["invoice raised date"]);
      const paymentDateCol = getColumnIndex(colMap, ["finance payment date", "payment date"]);
      
      // Parse data rows
      let dataStartRow = headerRowIdx + 1;
      if (data[headerRowIdx + 1]) {
        const firstRowStr = String(data[headerRowIdx + 1].join(" ")).toLowerCase();
        if (firstRowStr.includes("category") || firstRowStr.includes("line item") || firstRowStr.length < 5) {
          dataStartRow = headerRowIdx + 2;
        }
      }
      
      let currentCategory = "";
      
      for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;
        
        const rawCategory = categoryCol >= 0 ? row[categoryCol] : null;
        const rawDesc = descCol >= 0 ? row[descCol] : null;
        const rawBudgetTotal = budgetTotalCol >= 0 ? row[budgetTotalCol] : null;
        const rawActualTotal = actualTotalCol >= 0 ? row[actualTotalCol] : null;
        
        // Determine row type
        let rowType = "item";
        let expenseCategory = currentCategory;
        let expenseLineItem = rawDesc ? String(rawDesc) : null;
        
        // Category header detection - STRICT: only rows with numbered category name like "1. Panels"
        // but NO description AND no actual total value (empty data columns)
        if (rawCategory && typeof rawCategory === "string") {
          const catStr = rawCategory.trim();
          // Pattern for category headers: starts with digit(s), followed by period or dot, then text
          // e.g., "1. Panels", "2. Inverters", "10. Site Logistics"
          const isCategoryHeader = /^\d+\.\s*[A-Za-z]/.test(catStr) && !rawDesc && !rawActualTotal;
          
          if (isCategoryHeader) {
            // This is a category header row
            currentCategory = catStr;
            expenseCategory = catStr;
            rowType = "category";
          } else {
            // Regular item - inherit current category, use category column value if different
            if (catStr && catStr !== currentCategory) {
              expenseCategory = currentCategory; // Keep inherited category
            }
          }
        }
        
        // Subtotal detection
        if (rawDesc && String(rawDesc).toLowerCase().includes("sub total")) {
          rowType = "subtotal";
        }
        
        // Skip completely blank rows
        if (!rawCategory && !rawDesc && !rawBudgetTotal && !rawActualTotal) continue;
        
        // Determine line status
        const poNumber = poCol >= 0 && row[poCol] ? String(row[poCol]) : null;
        const invoiceNumber = invoiceCol >= 0 && row[invoiceCol] ? String(row[invoiceCol]) : null;
        const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
        const paymentDate = paymentDateCol >= 0 ? parseDate(row[paymentDateCol]) : null;
        
        let lineStatus = "Planned";
        if (paymentDate) {
          lineStatus = "Paid";
        } else if (invoiceNumber || invoiceDate) {
          lineStatus = "Invoiced";
        } else if (poNumber) {
          lineStatus = "Committed";
        }
        
        expenses.push({
          projectName,
          rowNumber: rowIdx + 1,
          rowType,
          expenseCategory: expenseCategory || null,
          expenseLineItem,
          // Budget side
          budgetQty: budgetQtyCol >= 0 ? parseNumber(row[budgetQtyCol]) : null,
          budgetRateUnit: budgetRateCol >= 0 ? parseNumber(row[budgetRateCol]) : null,
          budgetTotal: budgetTotalCol >= 0 ? parseNumber(row[budgetTotalCol]) : null,
          forecastPaymentDate: forecastPayDateCol >= 0 ? parseDate(row[forecastPayDateCol]) : null,
          budgetCosTotal: budgetCosCol >= 0 ? parseNumber(row[budgetCosCol]) : null,
          // Actual side
          expenseQty: budgetQtyCol >= 0 ? parseNumber(row[budgetQtyCol]) : null,
          expenseRateUnit: budgetRateCol >= 0 ? parseNumber(row[budgetRateCol]) : null,
          expenseActualTotal: actualTotalCol >= 0 ? parseNumber(row[actualTotalCol]) : null,
          expensePoNumber: poNumber,
          expenseInvoiceNumber: invoiceNumber,
          expenseInvoicedDate: invoiceDate,
          expensePaymentDate: paymentDate,
          actualCosTotal: actualCosCol >= 0 ? parseNumber(row[actualCosCol]) : null,
          lineStatus,
        });
      }
    } else {
      warnings.push("Could not find expenditure table header in Expenditure Breakdown sheet");
    }
  } else {
    warnings.push("Missing 'Expenditure Breakdown' sheet");
  }

  // Parse Revenue Tracking sheet (FIRST table only)
  if (workbook.SheetNames.includes("Revenue Tracking")) {
    const sheet = workbook.Sheets["Revenue Tracking"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Look for first CONTRACT milestone table
    const revenueHeaderTokens = [
      "payment milestone",
      "%",
      "value",
      "invoice number",
      "invoice raised date",
      "payment received date"
    ];
    
    let firstTableFound = false;
    
    for (let searchRow = 0; searchRow < Math.min(data.length, 50); searchRow++) {
      const revenueHeader = findHeaderRow(data, revenueHeaderTokens, searchRow, 1);
      
      if (revenueHeader && !firstTableFound) {
        firstTableFound = true;
        const { rowIdx: headerRowIdx, colMap } = revenueHeader;
        
        // Find column indices
        const milestoneNoCol = getColumnIndex(colMap, ["no.", "no", "milestone no"]);
        const milestoneCol = getColumnIndex(colMap, ["payment milestone", "milestone"]);
        const percentCol = getColumnIndex(colMap, ["%", "percent"]);
        const valueCol = getColumnIndex(colMap, ["value", "amount"]);
        const plannedDateCol = getColumnIndex(colMap, ["planned payment date", "planned date"]);
        const invoiceCol = getColumnIndex(colMap, ["invoice number"]);
        const invoiceDateCol = getColumnIndex(colMap, ["invoice raised date", "invoice date"]);
        const paymentDateCol = getColumnIndex(colMap, ["payment received date", "received date"]);
        const requirementsCol = getColumnIndex(colMap, ["requirement", "notes"]);
        const docsCol = getColumnIndex(colMap, ["milestone documents received", "documents"]);
        
        // Parse data rows (start from next row after header)
        for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
          const row = data[rowIdx];
          if (!row) continue;
          
          const milestoneDesc = milestoneCol >= 0 ? row[milestoneCol] : null;
          
          // Stop conditions: KEY section, second header, or "end of sheet"
          if (milestoneDesc && String(milestoneDesc).toUpperCase().startsWith("KEY")) break;
          if (milestoneDesc && String(milestoneDesc).toLowerCase().includes("end of sheet")) break;
          
          // Check for second header (another table) - stop parsing
          const checkSecondHeader = milestoneDesc && 
            (String(milestoneDesc).includes("PAYMENT MILESTONE") || 
             String(milestoneDesc).includes("No."));
          if (checkSecondHeader && rowIdx > headerRowIdx + 1) break;
          
          // Skip empty rows
          if (!milestoneDesc) continue;
          
          // Try to detect inBank status from cell font color (red = not in bank, black = in bank)
          let inBankValue = 0;
          if (paymentDateCol >= 0) {
            const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: paymentDateCol });
            const cell = sheet[cellAddr];
            if (cell && cell.s && cell.s.font && cell.s.font.color) {
              // Red color typically has RGB like "FF0000" or argb "FFFF0000"
              const fontColor = cell.s.font.color.rgb || cell.s.font.color.argb || "";
              const isRed = fontColor.toLowerCase().includes("ff0000") || 
                           fontColor.toLowerCase().endsWith("ff0000");
              inBankValue = isRed ? 0 : (cell.v ? 1 : 0); // If has value and not red, assume in bank
            } else if (cell && cell.v) {
              // If payment received date exists but no color info, default to in bank
              inBankValue = 1;
            }
          }
          
          inflows.push({
            projectName,
            rowNumber: rowIdx + 1,
            milestoneNo: milestoneNoCol >= 0 && row[milestoneNoCol] ? String(row[milestoneNoCol]) : null,
            milestoneName: String(milestoneDesc),
            milestonePercent: percentCol >= 0 ? parsePercent(row[percentCol]) : null,
            milestoneAmount: valueCol >= 0 ? parseNumber(row[valueCol]) : null,
            plannedPaymentDate: plannedDateCol >= 0 ? parseDate(row[plannedDateCol]) : null,
            milestoneInvoiceNumber: invoiceCol >= 0 && row[invoiceCol] ? String(row[invoiceCol]) : null,
            invoiceRaisedDate: invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null,
            paymentReceivedDate: paymentDateCol >= 0 ? parseDate(row[paymentDateCol]) : null,
            milestoneNotes: requirementsCol >= 0 && row[requirementsCol] ? String(row[requirementsCol]) : null,
            documentsReceived: docsCol >= 0 && row[docsCol] ? String(row[docsCol]) : null,
            inBank: inBankValue,
          });
        }
        break; // Stop after parsing first table
      }
    }
    
    if (!firstTableFound) {
      warnings.push("Could not find revenue milestone table header in Revenue Tracking sheet");
    }
  } else {
    warnings.push("Missing 'Revenue Tracking' sheet");
  }

  const cashflowPoints: InsertCashflowPoint[] = [];
  const financeRevenueMonthly: InsertFinanceRevenueMonthly[] = [];
  const financeCosMonthly: InsertFinanceCosMonthly[] = [];

  // Parse Cashflow sheet (weekly time-series with robust header detection)
  if (workbook.SheetNames.includes("Cashflow")) {
    try {
      const sheet = workbook.Sheets["Cashflow"];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as any[][];
      
      if (data.length > 0) {
        // Find header row with dates (usually row 1, column F onwards)
        let dateHeaderRow = -1;
        let dateStartCol = -1;
        for (let rowIdx = 0; rowIdx < Math.min(5, data.length); rowIdx++) {
          for (let colIdx = 0; colIdx < data[rowIdx].length; colIdx++) {
            const dateVal = parseDate(data[rowIdx][colIdx]);
            if (dateVal) {
              dateHeaderRow = rowIdx;
              dateStartCol = colIdx;
              break;
            }
          }
          if (dateHeaderRow >= 0) break;
        }
        
        if (dateHeaderRow >= 0 && dateStartCol >= 0) {
          // Extract all date headers
          const dateHeaders: string[] = [];
          for (let colIdx = dateStartCol; colIdx < data[dateHeaderRow].length; colIdx++) {
            const dateVal = parseDate(data[dateHeaderRow][colIdx]);
            if (dateVal) {
              dateHeaders.push(dateVal);
            } else {
              break; // Stop at first non-date
            }
          }
          
          if (dateHeaders.length === 0) {
            warnings.push("Cashflow sheet: found potential header row but no date columns");
          }
          
          // Find series rows by searching column B (index 1) - map to canonical names
          const seriesToFind: { pattern: string; canonical: string; forHorizon: boolean }[] = [
            { pattern: "planned revenue", canonical: "Planned Revenue", forHorizon: true },
            { pattern: "planned expenditure", canonical: "Planned Expenditure", forHorizon: true },
            { pattern: "planned cashflow", canonical: "PLANNED CashFlow", forHorizon: false },
            { pattern: "actual + planned revenue", canonical: "Actual + Planned Revenue", forHorizon: true },
            { pattern: "actual + planned expenditure", canonical: "Actual + Planned Expenditure", forHorizon: true },
            { pattern: "actual cashflow", canonical: "ACTUAL CashFlow", forHorizon: false }
          ];
          
          const seriesRows: { row: number; name: string; forHorizon: boolean }[] = [];
          for (let rowIdx = dateHeaderRow + 1; rowIdx < Math.min(dateHeaderRow + 20, data.length); rowIdx++) {
            const cellB = data[rowIdx][1]; // Column B
            if (cellB) {
              const normalized = normalizeHeader(cellB);
              for (const series of seriesToFind) {
                if (normalized.includes(series.pattern)) {
                  seriesRows.push({ 
                    row: rowIdx, 
                    name: series.canonical,
                    forHorizon: series.forHorizon
                  });
                  break;
                }
              }
            }
          }
          
          // Calculate date horizon limit: lastNonZeroDate among revenue/expenditure series + 52 weeks
          let maxSignificantDate: Date | null = null;
          for (const { row, forHorizon } of seriesRows) {
            if (!forHorizon) continue; // Only use revenue/expenditure series for horizon
            
            if (data[row]) {
              for (let dateIdx = 0; dateIdx < dateHeaders.length; dateIdx++) {
                const valueColIdx = dateStartCol + dateIdx;
                const value = parseNumber(data[row][valueColIdx]);
                if (value !== null && parseFloat(value) !== 0) {
                  const currentDate = new Date(dateHeaders[dateIdx]);
                  if (!maxSignificantDate || currentDate > maxSignificantDate) {
                    maxSignificantDate = currentDate;
                  }
                }
              }
            }
          }
          
          // Add 52 weeks (364 days) buffer
          let horizonLimit: Date | null = null;
          if (maxSignificantDate) {
            horizonLimit = new Date(maxSignificantDate);
            horizonLimit.setDate(horizonLimit.getDate() + 364);
          }
          
          // Parse values for each series
          for (const { row, name } of seriesRows) {
            if (data[row]) {
              for (let dateIdx = 0; dateIdx < dateHeaders.length; dateIdx++) {
                const pointDate = dateHeaders[dateIdx];
                const pointDateObj = new Date(pointDate);
                
                // Skip dates beyond horizon limit
                if (horizonLimit && pointDateObj > horizonLimit) continue;
                
                const valueColIdx = dateStartCol + dateIdx;
                const value = parseNumber(data[row][valueColIdx]);
                
                // Store all points including zeros within horizon
                cashflowPoints.push({
                  projectName,
                  seriesName: name,
                  pointDate,
                  value: value || "0",
                });
              }
            }
          }
          
          if (seriesRows.length === 0) {
            warnings.push("Cashflow sheet: could not find any expected series labels in column B");
          }
        } else {
          warnings.push("Cashflow sheet: could not find date header row");
        }
      }
    } catch (error) {
      warnings.push(`Cashflow sheet parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    warnings.push("Missing 'Cashflow' sheet");
  }

  // Parse Finance - Revenue sheet (monthly pivot with robust header detection)
  if (workbook.SheetNames.includes("Finance - Revenue")) {
    try {
      const sheet = workbook.Sheets["Finance - Revenue"];
      // Use raw: true to get actual numeric values instead of formatted strings
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as any[][];
      
      if (data.length > 0) {
        // Find header row containing "Row Labels" in column A
        let headerRowIdx = -1;
        for (let rowIdx = 0; rowIdx < Math.min(10, data.length); rowIdx++) {
          const cellA = data[rowIdx][0];
          if (cellA && normalizeHeader(cellA) === "row labels") {
            headerRowIdx = rowIdx;
            break;
          }
        }
        
        if (headerRowIdx >= 0) {
          // Extract month headers from header row (Excel date columns only)
          const monthHeaders: string[] = [];
          const monthColIndices: number[] = [];
          for (let colIdx = 1; colIdx < data[headerRowIdx].length; colIdx++) {
            const header = normalizeHeader(data[headerRowIdx][colIdx]);
            if (header === "grand total") break;
            
            const dateVal = parseDate(data[headerRowIdx][colIdx]);
            if (dateVal) {
              monthHeaders.push(dateVal);
              monthColIndices.push(colIdx);
            }
          }
          
          if (monthHeaders.length === 0) {
            warnings.push("Finance - Revenue: found Row Labels header but no date columns");
          }
          
          // Parse category rows starting after header row
          for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
            const category = data[rowIdx][0];
            
            // Stop conditions
            if (!category) {
              // Check for multiple consecutive blank rows
              let consecutiveBlanks = 0;
              for (let checkIdx = rowIdx; checkIdx < Math.min(rowIdx + 3, data.length); checkIdx++) {
                if (!data[checkIdx][0]) consecutiveBlanks++;
              }
              if (consecutiveBlanks >= 2) break;
              continue;
            }
            
            const normalizedCategory = normalizeHeader(category);
            if (normalizedCategory === "grand total") break;
            if (normalizedCategory === "(blank)") continue; // Skip, don't break
            
            // Parse values for each month column
            for (let monthIdx = 0; monthIdx < monthHeaders.length; monthIdx++) {
              const valueColIdx = monthColIndices[monthIdx];
              const value = parseNumber(data[rowIdx][valueColIdx]);
              
              financeRevenueMonthly.push({
                projectName,
                category: String(category).trim(),
                monthEndDate: monthHeaders[monthIdx],
                value: value || "0",
              });
            }
          }
        } else {
          warnings.push("Finance - Revenue: could not find 'Row Labels' header row");
        }
      }
    } catch (error) {
      warnings.push(`Finance - Revenue sheet parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Parse Finance - COS sheet (monthly pivot with robust header detection)
  if (workbook.SheetNames.includes("Finance - COS")) {
    try {
      const sheet = workbook.Sheets["Finance - COS"];
      // Use raw: true to get actual numeric values instead of formatted strings
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as any[][];
      
      if (data.length > 0) {
        // Find header row containing "Row Labels" in column A
        let headerRowIdx = -1;
        for (let rowIdx = 0; rowIdx < Math.min(15, data.length); rowIdx++) {
          const cellA = data[rowIdx][0];
          if (cellA && normalizeHeader(cellA) === "row labels") {
            headerRowIdx = rowIdx;
            break;
          }
        }
        
        if (headerRowIdx >= 0) {
          // Extract month headers from header row (Excel date columns only)
          const monthHeaders: string[] = [];
          const monthColIndices: number[] = [];
          for (let colIdx = 1; colIdx < data[headerRowIdx].length; colIdx++) {
            const header = normalizeHeader(data[headerRowIdx][colIdx]);
            if (header === "grand total") break;
            
            const cellVal = data[headerRowIdx][colIdx];
            const dateVal = parseDate(cellVal);
            if (dateVal) {
              monthHeaders.push(dateVal);
              monthColIndices.push(colIdx);
            }
          }
          
          if (monthHeaders.length === 0) {
            warnings.push("Finance - COS: found Row Labels header but no date columns");
          }
          
          // Parse category rows starting after header row
          for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
            const category = data[rowIdx][0];
            
            // Stop conditions
            if (!category) {
              // Check for multiple consecutive blank rows
              let consecutiveBlanks = 0;
              for (let checkIdx = rowIdx; checkIdx < Math.min(rowIdx + 3, data.length); checkIdx++) {
                if (!data[checkIdx][0]) consecutiveBlanks++;
              }
              if (consecutiveBlanks >= 2) break;
              continue;
            }
            
            const normalizedCategory = normalizeHeader(category);
            if (normalizedCategory === "grand total") break;
            if (normalizedCategory === "(blank)") continue; // Skip, don't break
            
            // Parse values for each month column
            for (let monthIdx = 0; monthIdx < monthHeaders.length; monthIdx++) {
              const valueColIdx = monthColIndices[monthIdx];
              const rawValue = data[rowIdx][valueColIdx];
              const value = parseNumber(rawValue);
              
              financeCosMonthly.push({
                projectName,
                category: String(category).trim(),
                monthEndDate: monthHeaders[monthIdx],
                value: value || "0",
              });
            }
          }
        } else {
          warnings.push("Finance - COS: could not find 'Row Labels' header row");
        }
      }
    } catch (error) {
      warnings.push(`Finance - COS sheet parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return {
    projectName,
    projectInfo,
    expenses,
    inflows,
    planItems,
    cashflowPoints,
    financeRevenueMonthly,
    financeCosMonthly,
    warnings,
    expensesParsed: expenses.length,
    inflowsParsed: inflows.length,
    planParsed: planItems.length,
    infoParsed: projectInfo !== null,
    cashflowParsed: cashflowPoints.length,
    financeRevenueParsed: financeRevenueMonthly.length,
    financeCosParsed: financeCosMonthly.length,
  };
}
