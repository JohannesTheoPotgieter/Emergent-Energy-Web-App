import ExcelJS from "exceljs";
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

function excelSerialToDate(serial: number): { y: number; m: number; d: number } | null {
  if (serial < 1) return null;
  if (serial > 59) serial -= 1;
  const epoch = new Date(1899, 11, 31);
  const date = new Date(epoch.getTime() + serial * 86400000);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function parseDate(value: any): string | null {
  if (!value) return null;
  
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
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    
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

function getCellRawValue(cell: ExcelJS.Cell): any {
  if (!cell || !cell.value) return null;
  const v = cell.value;
  if (typeof v === "object" && v !== null) {
    if ("result" in v) return (v as any).result;
    if ("error" in v) return null;
    if (v instanceof Date) return v;
    if ("richText" in v) {
      return (v as any).richText.map((rt: any) => rt.text).join("");
    }
    if ("text" in v) return (v as any).text;
  }
  return v;
}

function worksheetToArray(ws: ExcelJS.Worksheet, opts?: { raw?: boolean }): any[][] {
  const data: any[][] = [];
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const rowData: any[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      rowData.push(getCellRawValue(cell));
    }
    data.push(rowData);
  }
  return data;
}

function getCellValue(ws: ExcelJS.Worksheet, col: string, row: number): any {
  const cell = ws.getCell(`${col}${row}`);
  return getCellRawValue(cell);
}

function findLabeledDateValue(ws: ExcelJS.Worksheet, labels: string[]): string | null {
  const maxRow = Math.min(ws.rowCount, 50);
  const maxCol = Math.min(ws.columnCount, 11);
  
  for (let r = 1; r <= maxRow; r++) {
    const wsRow = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const cellVal = getCellRawValue(wsRow.getCell(c));
      if (cellVal) {
        const cellText = String(cellVal).toLowerCase().trim();
        for (const label of labels) {
          if (cellText.includes(label.toLowerCase())) {
            for (let dc = 1; dc <= 4; dc++) {
              if (c + dc <= ws.columnCount) {
                const valueCell = getCellRawValue(wsRow.getCell(c + dc));
                if (valueCell) {
                  const dateVal = parseDate(valueCell);
                  if (dateVal) return dateVal;
                }
              }
            }
            if (r + 1 <= maxRow) {
              const belowRow = ws.getRow(r + 1);
              const belowVal = getCellRawValue(belowRow.getCell(c));
              if (belowVal) {
                const dateVal = parseDate(belowVal);
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
    
    const colMap = new Map<string, number>();
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const header = normalizeHeader(row[colIdx]);
      if (header) {
        colMap.set(header, colIdx);
      }
    }
    
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

export async function parseTrackerFile(buffer: Buffer, fileName: string): Promise<ParseResult> {
  const projectName = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const warnings: string[] = [];
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  
  let projectInfo: InsertProjectInfo | null = null;
  const expenses: InsertProgramExpense[] = [];
  const inflows: InsertProgramInflows[] = [];
  const planItems: InsertProjectPlan[] = [];

  const sheetNames = workbook.worksheets.map(ws => ws.name);

  if (sheetNames.includes("Project Plan")) {
    const sheet = workbook.getWorksheet("Project Plan")!;
    
    const sizeKwp = parseNumber(getCellValue(sheet, "E", 3));
    const pd = getCellValue(sheet, "E", 4);
    const pm = getCellValue(sheet, "E", 5);
    const contractValue = parseNumber(getCellValue(sheet, "E", 6));
    const rawPhase = getCellValue(sheet, "E", 7);
    const VALID_PHASES = [
      "DLP", "Financial Close", "Planning", "Construction", "QA",
      "Handover", "Commercial Close Out", "Commercial Close out",
      "Compliance Handover", "Hold", "TBC"
    ];
    const phaseStr = rawPhase ? String(rawPhase).trim() : null;
    const phase = phaseStr && VALID_PHASES.some(vp => vp.toLowerCase() === phaseStr.toLowerCase()) ? phaseStr : null;
    
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
    
    const data = worksheetToArray(sheet);
    
    const taskHeaderTokens = ["no.", "high level programme", "actual start", "actual end"];
    const taskHeader = findHeaderRow(data, taskHeaderTokens);
    
    if (taskHeader) {
      const { rowIdx: headerRowIdx, colMap } = taskHeader;
      
      const noCol = getColumnIndex(colMap, ["no.", "no"]);
      const programmeCol = getColumnIndex(colMap, ["high level programme", "programme"]);
      const actualStartCol = getColumnIndex(colMap, ["actual start"]);
      const durationCol = getColumnIndex(colMap, ["duration", "days"]);
      const actualEndCol = getColumnIndex(colMap, ["actual end"]);
      
      const statusCols: number[] = [];
      const entries = Array.from(colMap.entries());
      
      for (const [header, colIdx] of entries) {
        if (header.includes("status")) {
          statusCols.push(colIdx);
        }
      }
      
      if (statusCols.length < 2) {
        for (const [header, colIdx] of entries) {
          if (header.includes("%") && !header.includes("status") && !statusCols.includes(colIdx)) {
            statusCols.push(colIdx);
            if (statusCols.length >= 2) break;
          }
        }
      }
      
      for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;
        
        const taskNo = noCol >= 0 ? row[noCol] : null;
        const highLevelProgramme = programmeCol >= 0 ? row[programmeCol] : null;
        
        if (!taskNo && !highLevelProgramme) continue;
        
        const actualStart = actualStartCol >= 0 ? parseDate(row[actualStartCol]) : null;
        const rawDuration = durationCol >= 0 && row[durationCol] ? parseInt(String(row[durationCol])) : null;
        const durationDays = rawDuration !== null && !isNaN(rawDuration) ? rawDuration : null;
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

  if (sheetNames.includes("Expenditure Breakdown")) {
    const sheet = workbook.getWorksheet("Expenditure Breakdown")!;
    const data = worksheetToArray(sheet);
    
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
      
      const categoryCol = getColumnIndex(colMap, ["product/ service", "product", "category"]);
      const descCol = getColumnIndex(colMap, ["description of work", "description"]);
      const budgetQtyCol = getColumnIndex(colMap, ["qty", "quantity"]);
      const budgetRateCol = getColumnIndex(colMap, ["rate / unit", "rate"]);
      const budgetTotalCol = getColumnIndex(colMap, ["budget total"]);
      const forecastPayDateCol = getColumnIndex(colMap, ["forecasted payment date", "forecast payment date", "forecast pay date"]);
      
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
      
      const actualTotalCol = getColumnIndex(colMap, ["actual total"]);
      const poCol = getColumnIndex(colMap, ["po number"]);
      const invoiceCol = getColumnIndex(colMap, ["invoice number"]);
      const invoiceDateCol = getColumnIndex(colMap, ["invoice raised date"]);
      const paymentDateCol = getColumnIndex(colMap, ["finance payment date", "payment date"]);
      
      let dataStartRow = headerRowIdx + 1;
      if (data[headerRowIdx + 1]) {
        const firstRowStr = String(data[headerRowIdx + 1].join(" ")).toLowerCase();
        if (firstRowStr.includes("category") || firstRowStr.includes("line item") || firstRowStr.length < 5) {
          dataStartRow = headerRowIdx + 2;
        }
      }
      
      let currentCategory = "";
      const emittedCategories = new Set<string>();
      
      for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;
        
        const rawCategory = categoryCol >= 0 ? row[categoryCol] : null;
        const rawDesc = descCol >= 0 ? row[descCol] : null;
        const rawBudgetTotal = budgetTotalCol >= 0 ? row[budgetTotalCol] : null;
        const rawActualTotal = actualTotalCol >= 0 ? row[actualTotalCol] : null;
        
        let rowType = "item";
        let expenseCategory = currentCategory;
        let expenseLineItem = rawDesc ? String(rawDesc) : null;
        
        if (rawCategory && typeof rawCategory === "string") {
          const catStr = rawCategory.trim();
          const isCategoryPattern = /^\d+\.?\s*[A-Za-z]/.test(catStr);
          
          if (isCategoryPattern) {
            if (catStr !== currentCategory) {
              currentCategory = catStr;
            }
            expenseCategory = currentCategory;
            
            if (!rawDesc && !rawActualTotal) {
              const hasPO = poCol >= 0 && row[poCol] && String(row[poCol]).trim();
              const hasInvoice = invoiceCol >= 0 && row[invoiceCol] && String(row[invoiceCol]).trim();
              const hasInvoiceDate = invoiceDateCol >= 0 && row[invoiceDateCol];
              const hasPaymentDate = paymentDateCol >= 0 && row[paymentDateCol];
              const hasBudget = rawBudgetTotal && parseFloat(String(rawBudgetTotal)) !== 0;
              
              if (hasPO || hasInvoice || hasInvoiceDate || hasPaymentDate || hasBudget) {
                rowType = "item";
              } else if (!emittedCategories.has(currentCategory)) {
                emittedCategories.add(currentCategory);
                rowType = "category";
              } else {
                continue;
              }
            }
          }
        }
        
        if (rawDesc && String(rawDesc).toLowerCase().includes("sub total")) {
          rowType = "subtotal";
        }
        
        if (!rawCategory && !rawDesc && !rawBudgetTotal && !rawActualTotal) continue;
        
        const poNumber = poCol >= 0 && row[poCol] ? String(row[poCol]) : null;
        const invoiceNumber = invoiceCol >= 0 && row[invoiceCol] ? String(row[invoiceCol]) : null;
        const invoiceDate = invoiceDateCol >= 0 ? parseDate(row[invoiceDateCol]) : null;
        const paymentDate = paymentDateCol >= 0 ? parseDate(row[paymentDateCol]) : null;
        
        let invoiceDateConfirmed = false;
        let invoiceDateFontColor: string | null = null;
        let paymentDateConfirmed = false;
        let paymentDateFontColor: string | null = null;

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
          budgetQty: budgetQtyCol >= 0 ? parseNumber(row[budgetQtyCol]) : null,
          budgetRateUnit: budgetRateCol >= 0 ? parseNumber(row[budgetRateCol]) : null,
          budgetTotal: budgetTotalCol >= 0 ? parseNumber(row[budgetTotalCol]) : null,
          forecastPaymentDate: forecastPayDateCol >= 0 ? parseDate(row[forecastPayDateCol]) : null,
          budgetCosTotal: budgetCosCol >= 0 ? parseNumber(row[budgetCosCol]) : null,
          expenseQty: budgetQtyCol >= 0 ? parseNumber(row[budgetQtyCol]) : null,
          expenseRateUnit: budgetRateCol >= 0 ? parseNumber(row[budgetRateCol]) : null,
          expenseActualTotal: actualTotalCol >= 0 ? parseNumber(row[actualTotalCol]) : null,
          expensePoNumber: poNumber,
          expenseInvoiceNumber: invoiceNumber,
          expenseInvoicedDate: invoiceDate,
          invoiceDateConfirmed,
          invoiceDateFontColor,
          expensePaymentDate: paymentDate,
          paymentDateConfirmed,
          paymentDateFontColor,
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

  if (sheetNames.includes("Revenue Tracking")) {
    const sheet = workbook.getWorksheet("Revenue Tracking")!;
    const data = worksheetToArray(sheet);
    
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
        
        for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
          const row = data[rowIdx];
          if (!row) continue;
          
          const milestoneDesc = milestoneCol >= 0 ? row[milestoneCol] : null;
          
          if (milestoneDesc && String(milestoneDesc).toUpperCase().startsWith("KEY")) break;
          if (milestoneDesc && String(milestoneDesc).toLowerCase().includes("end of sheet")) break;
          
          const checkSecondHeader = milestoneDesc && 
            (String(milestoneDesc).includes("PAYMENT MILESTONE") || 
             String(milestoneDesc).includes("No."));
          if (checkSecondHeader && rowIdx > headerRowIdx + 1) break;
          
          if (!milestoneDesc) continue;
          
          let inBankValue = 0;
          if (paymentDateCol >= 0) {
            const excelRow = rowIdx + 1;
            const excelCol = paymentDateCol + 1;
            const cell = sheet.getRow(excelRow).getCell(excelCol);
            if (cell && cell.value) {
              const font = cell.font;
              if (font && font.color && font.color.argb) {
                const fontColor = font.color.argb;
                const isRed = fontColor.toLowerCase().includes("ff0000") || 
                             fontColor.toLowerCase().endsWith("ff0000");
                inBankValue = isRed ? 0 : 1;
              } else {
                inBankValue = 1;
              }
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
        break;
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

  if (sheetNames.includes("Cashflow")) {
    try {
      const sheet = workbook.getWorksheet("Cashflow")!;
      const data = worksheetToArray(sheet);
      
      if (data.length > 0) {
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
          const dateHeaders: string[] = [];
          for (let colIdx = dateStartCol; colIdx < data[dateHeaderRow].length; colIdx++) {
            const dateVal = parseDate(data[dateHeaderRow][colIdx]);
            if (dateVal) {
              dateHeaders.push(dateVal);
            } else {
              break;
            }
          }
          
          if (dateHeaders.length === 0) {
            warnings.push("Cashflow sheet: found potential header row but no date columns");
          }
          
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
            const cellB = data[rowIdx][1];
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
          
          let maxSignificantDate: Date | null = null;
          for (const { row, forHorizon } of seriesRows) {
            if (!forHorizon) continue;
            
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
          
          let horizonLimit: Date | null = null;
          if (maxSignificantDate) {
            horizonLimit = new Date(maxSignificantDate);
            horizonLimit.setDate(horizonLimit.getDate() + 364);
          }
          
          for (const { row, name } of seriesRows) {
            if (data[row]) {
              for (let dateIdx = 0; dateIdx < dateHeaders.length; dateIdx++) {
                const pointDate = dateHeaders[dateIdx];
                const pointDateObj = new Date(pointDate);
                
                if (horizonLimit && pointDateObj > horizonLimit) continue;
                
                const valueColIdx = dateStartCol + dateIdx;
                const value = parseNumber(data[row][valueColIdx]);
                
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

  if (sheetNames.includes("Finance - Revenue")) {
    try {
      const sheet = workbook.getWorksheet("Finance - Revenue")!;
      const data = worksheetToArray(sheet, { raw: true });
      
      if (data.length > 0) {
        let headerRowIdx = -1;
        for (let rowIdx = 0; rowIdx < Math.min(10, data.length); rowIdx++) {
          const cellA = data[rowIdx][0];
          if (cellA && normalizeHeader(cellA) === "row labels") {
            headerRowIdx = rowIdx;
            break;
          }
        }
        
        if (headerRowIdx >= 0) {
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
          
          for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
            const category = data[rowIdx][0];
            
            if (!category) {
              let consecutiveBlanks = 0;
              for (let checkIdx = rowIdx; checkIdx < Math.min(rowIdx + 3, data.length); checkIdx++) {
                if (!data[checkIdx][0]) consecutiveBlanks++;
              }
              if (consecutiveBlanks >= 2) break;
              continue;
            }
            
            const normalizedCategory = normalizeHeader(category);
            if (normalizedCategory === "grand total") break;
            if (normalizedCategory === "(blank)") continue;
            
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

  if (sheetNames.includes("Finance - COS")) {
    try {
      const sheet = workbook.getWorksheet("Finance - COS")!;
      const data = worksheetToArray(sheet, { raw: true });
      
      if (data.length > 0) {
        let headerRowIdx = -1;
        for (let rowIdx = 0; rowIdx < Math.min(15, data.length); rowIdx++) {
          const cellA = data[rowIdx][0];
          if (cellA && normalizeHeader(cellA) === "row labels") {
            headerRowIdx = rowIdx;
            break;
          }
        }
        
        if (headerRowIdx >= 0) {
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
          
          for (let rowIdx = headerRowIdx + 1; rowIdx < data.length; rowIdx++) {
            const category = data[rowIdx][0];
            
            if (!category) {
              let consecutiveBlanks = 0;
              for (let checkIdx = rowIdx; checkIdx < Math.min(rowIdx + 3, data.length); checkIdx++) {
                if (!data[checkIdx][0]) consecutiveBlanks++;
              }
              if (consecutiveBlanks >= 2) break;
              continue;
            }
            
            const normalizedCategory = normalizeHeader(category);
            if (normalizedCategory === "grand total") break;
            if (normalizedCategory === "(blank)") continue;
            
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

function isRedColor(argb: string): boolean {
  if (!argb) return false;
  const upper = argb.toUpperCase();
  if (upper.length === 8) {
    const rgb = upper.substring(2);
    return rgb === "FF0000";
  }
  if (upper.length === 6) {
    return upper === "FF0000";
  }
  return false;
}

export async function extractFontColors(buffer: Buffer): Promise<Map<string, { invoiceColor: string | null; paymentColor: string | null }>> {
  const colorMap = new Map<string, { invoiceColor: string | null; paymentColor: string | null }>();
  
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    
    const ws = workbook.getWorksheet("Expenditure Breakdown");
    if (!ws) return colorMap;
    
    let invoiceDateCol = -1;
    let paymentDateCol = -1;
    
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (invoiceDateCol < 0 || paymentDateCol < 0) {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const val = String(cell.value || "").toLowerCase().trim();
          if (val.includes("invoice raised date") || val === "invoice date") {
            invoiceDateCol = colNumber;
          }
          if (val.includes("finance payment date") || val === "payment date") {
            paymentDateCol = colNumber;
          }
        });
        if (invoiceDateCol < 0 && paymentDateCol < 0) return;
      }
      
      let invoiceColor: string | null = null;
      let paymentColor: string | null = null;
      
      if (invoiceDateCol > 0) {
        const cell = row.getCell(invoiceDateCol);
        if (cell.value) {
          const font = cell.font;
          const argb = font?.color?.argb || "";
          invoiceColor = isRedColor(argb) ? "red" : "black";
        }
      }
      
      if (paymentDateCol > 0) {
        const cell = row.getCell(paymentDateCol);
        if (cell.value) {
          const font = cell.font;
          const argb = font?.color?.argb || "";
          paymentColor = isRedColor(argb) ? "red" : "black";
        }
      }
      
      if (invoiceColor || paymentColor) {
        colorMap.set(String(rowNumber), { invoiceColor, paymentColor });
      }
    });
  } catch (err) {
    console.error("ExcelJS font color extraction error:", err);
  }
  
  return colorMap;
}

export async function applyFontColors(expenses: InsertProgramExpense[], buffer: Buffer): Promise<InsertProgramExpense[]> {
  const colorMap = await extractFontColors(buffer);
  
  for (const exp of expenses) {
    const rowKey = String(exp.rowNumber);
    const colors = colorMap.get(rowKey);
    if (colors) {
      if (colors.invoiceColor && exp.expenseInvoicedDate) {
        (exp as any).invoiceDateFontColor = colors.invoiceColor;
        (exp as any).invoiceDateConfirmed = colors.invoiceColor !== "red";
      }
      if (colors.paymentColor && exp.expensePaymentDate) {
        (exp as any).paymentDateFontColor = colors.paymentColor;
        (exp as any).paymentDateConfirmed = colors.paymentColor !== "red";
      }
    }
  }
  
  return expenses;
}
