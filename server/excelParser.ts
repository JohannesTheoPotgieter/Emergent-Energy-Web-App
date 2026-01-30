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
    
    projectInfo = {
      projectName,
      sizeKwp,
      pd: pd ? String(pd) : null,
      pm: pm ? String(pm) : null,
      contractValue,
      phase: phase ? String(phase) : null,
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

  // Parse Expenditure Breakdown sheet
  if (workbook.SheetNames.includes("Expenditure Breakdown")) {
    const sheet = workbook.Sheets["Expenditure Breakdown"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Look for "ACTUAL EXPENDITURE BREAKDOWN" table header
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
      
      // Find column indices
      const categoryCol = getColumnIndex(colMap, ["product/ service", "product", "category"]);
      const descCol = getColumnIndex(colMap, ["description of work", "description"]);
      const qtyCol = getColumnIndex(colMap, ["qty", "quantity"]);
      const rateCol = getColumnIndex(colMap, ["rate / unit", "rate"]);
      const actualTotalCol = getColumnIndex(colMap, ["actual total"]);
      const poCol = getColumnIndex(colMap, ["po number"]);
      const invoiceCol = getColumnIndex(colMap, ["invoice number"]);
      const invoiceDateCol = getColumnIndex(colMap, ["invoice raised date"]);
      const revenueCol = getColumnIndex(colMap, ["revenue recognition amount", "revenue"]);
      const paymentDateCol = getColumnIndex(colMap, ["finance payment date", "payment date"]);
      const cosCol = getColumnIndex(colMap, ["total cos", "cos"]);
      
      // Parse data rows (check first row after header for subheader, otherwise start immediately)
      let dataStartRow = headerRowIdx + 1;
      // Check if next row is a subheader (contains "Category", "Line Item", or other meta text)
      if (data[headerRowIdx + 1]) {
        const firstRowStr = String(data[headerRowIdx + 1].join(" ")).toLowerCase();
        if (firstRowStr.includes("category") || firstRowStr.includes("line item") || firstRowStr.length < 5) {
          dataStartRow = headerRowIdx + 2;
        }
      }
      
      for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;
        
        const expenseCategory = categoryCol >= 0 ? row[categoryCol] : null;
        const expenseLineItem = descCol >= 0 ? row[descCol] : null;
        const expenseActualTotal = actualTotalCol >= 0 ? parseNumber(row[actualTotalCol]) : null;
        
        // Skip if category, description, and actual total are all blank
        if (!expenseCategory && !expenseLineItem && !expenseActualTotal) continue;
        
        expenses.push({
          projectName,
          rowNumber: rowIdx + 1,
          expenseCategory: expenseCategory ? String(expenseCategory) : null,
          expenseLineItem: expenseLineItem ? String(expenseLineItem) : null,
          expenseQty: qtyCol >= 0 ? parseNumber(row[qtyCol]) : null,
          expenseRateUnit: rateCol >= 0 ? parseNumber(row[rateCol]) : null,
          expenseActualTotal,
          expensePoNumber: poCol >= 0 && row[poCol] ? String(row[poCol]) : null,
          expenseInvoiceNumber: invoiceCol >= 0 && row[invoiceCol] ? String(row[invoiceCol]) : null,
          expenseInvoicedDate: invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null,
          revenueAmount: revenueCol >= 0 ? parseNumber(row[revenueCol]) : null,
          expensePaymentDate: paymentDateCol >= 0 ? parseDate(row[paymentDateCol]) : null,
          cosAmount: cosCol >= 0 ? parseNumber(row[cosCol]) : null,
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
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as any[][];
      
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
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as any[][];
      
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
              const value = parseNumber(data[rowIdx][valueColIdx]);
              
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
