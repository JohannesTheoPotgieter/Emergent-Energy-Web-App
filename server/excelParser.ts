import * as XLSX from "xlsx";
import type { InsertProjectInfo, InsertProgramExpense, InsertProgramInflows, InsertProjectPlan } from "@shared/schema";

export interface ParseResult {
  projectName: string;
  projectInfo: InsertProjectInfo | null;
  expenses: InsertProgramExpense[];
  inflows: InsertProgramInflows[];
  planItems: InsertProjectPlan[];
  warnings: string[];
  expensesParsed: number;
  inflowsParsed: number;
  planParsed: number;
  infoParsed: boolean;
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

export function parseTrackerFile(buffer: Buffer, fileName: string): ParseResult {
  const projectName = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const warnings: string[] = [];
  
  const workbook = XLSX.read(buffer, { 
    type: "buffer",
    cellDates: true,
    cellNF: true,
    cellStyles: true
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
    
    // Parse task rows starting from row 9 (header at row 8)
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    let statusCol1 = -1;
    let statusCol2 = -1;
    
    // Find status columns in header row (row 8 = index 7)
    if (data[7]) {
      for (let i = 0; i < data[7].length; i++) {
        const header = String(data[7][i] || "").toLowerCase();
        if (header === "status" || header === "expected status") {
          if (statusCol1 === -1) {
            statusCol1 = i;
          } else {
            statusCol2 = i;
            break;
          }
        }
      }
    }
    
    // Parse task rows (starting from row 9 = index 8)
    for (let rowIdx = 8; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      if (!row) continue;
      
      const taskNo = row[1];
      const highLevelProgramme = row[2];
      
      if (!taskNo && !highLevelProgramme) continue;
      
      const actualStart = parseDate(row[8]);
      const durationDays = row[9] ? parseInt(String(row[9])) : null;
      const actualEnd = parseDate(row[10]);
      const actualPctComplete = statusCol1 >= 0 ? parseStatus(row[statusCol1]) : null;
      const expectedPctComplete = statusCol2 >= 0 ? parseStatus(row[statusCol2]) : null;
      
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
    warnings.push("Missing 'Project Plan' sheet");
  }

  // Parse Expenditure Breakdown sheet
  if (workbook.SheetNames.includes("Expenditure Breakdown")) {
    const sheet = workbook.Sheets["Expenditure Breakdown"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Data starts at row 6 (index 5), headers at row 4 (index 3)
    // Columns L=11, M=12, N=13, O=14, P=15, Q=16, R=17, S=18, T=19, U=20, W=22, X=23
    for (let rowIdx = 5; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      if (!row) continue;
      
      const expenseCategory = row[12];
      const expenseLineItem = row[13];
      const expenseActualTotal = parseNumber(row[16]);
      
      // Skip if M, N, Q are all blank
      if (!expenseCategory && !expenseLineItem && !expenseActualTotal) continue;
      
      expenses.push({
        projectName,
        rowNumber: rowIdx + 1,
        expenseCategory: expenseCategory ? String(expenseCategory) : null,
        expenseLineItem: expenseLineItem ? String(expenseLineItem) : null,
        expenseQty: parseNumber(row[14]),
        expenseRateUnit: parseNumber(row[15]),
        expenseActualTotal,
        expensePoNumber: row[17] ? String(row[17]) : null,
        expenseInvoiceNumber: row[18] ? String(row[18]) : null,
        expenseInvoicedDate: parseDate(row[19]),
        revenueAmount: parseNumber(row[20]),
        expensePaymentDate: parseDate(row[22]),
        cosAmount: parseNumber(row[23]),
      });
    }
  } else {
    warnings.push("Missing 'Expenditure Breakdown' sheet");
  }

  // Parse Revenue Tracking sheet
  if (workbook.SheetNames.includes("Revenue Tracking")) {
    const sheet = workbook.Sheets["Revenue Tracking"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    
    // Header row is row 12 (index 11), data starts at row 13 (index 12)
    // B=1, C=2, E=4, F=5, H=7, L=11, N=13, P=15, R=17, S=18
    let foundFirstHeader = false;
    
    for (let rowIdx = 12; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      if (!row) continue;
      
      const colB = row[1];
      const colC = row[2];
      
      // Check for end conditions
      if (colB && String(colB).toUpperCase().startsWith("KEY")) break;
      if (colC && String(colC).toLowerCase().includes("end of sheet")) break;
      
      // Check for second header (stop parsing)
      if (colB === "No." && colC && String(colC).includes("PAYMENT MILESTONE")) {
        if (foundFirstHeader) break;
        foundFirstHeader = true;
        continue;
      }
      
      // Skip empty rows
      if (!colB && !colC) continue;
      
      const milestoneAmount = parseNumber(row[5]);
      
      inflows.push({
        projectName,
        rowNumber: rowIdx + 1,
        milestoneNo: colB ? String(colB) : null,
        milestoneName: colC ? String(colC) : null,
        milestonePercent: parsePercent(row[4]),
        milestoneAmount,
        plannedPaymentDate: parseDate(row[7]),
        milestoneInvoiceNumber: row[11] ? String(row[11]) : null,
        invoiceRaisedDate: parseDate(row[13]),
        paymentReceivedDate: parseDate(row[15]),
        milestoneNotes: row[17] ? String(row[17]) : null,
        documentsReceived: row[18] ? String(row[18]) : null,
      });
    }
  } else {
    warnings.push("Missing 'Revenue Tracking' sheet");
  }

  return {
    projectName,
    projectInfo,
    expenses,
    inflows,
    planItems,
    warnings,
    expensesParsed: expenses.length,
    inflowsParsed: inflows.length,
    planParsed: planItems.length,
    infoParsed: projectInfo !== null,
  };
}
