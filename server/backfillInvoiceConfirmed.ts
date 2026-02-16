import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";

function getColumnIndex(colMap: Record<string, number>, names: string[]): number {
  for (const name of names) {
    if (colMap[name] !== undefined) return colMap[name];
  }
  return -1;
}

function detectFontColor(row: ExcelJS.Row, col: number): { confirmed: boolean; color: string | null } {
  const cell = row.getCell(col);
  if (cell && cell.value) {
    const font = cell.font;
    const argb = font?.color?.argb || "";
    const isRed = argb.toUpperCase().includes("FF0000") || argb.toUpperCase().endsWith("FF0000");
    return { confirmed: !isRed, color: isRed ? "red" : "black" };
  }
  return { confirmed: false, color: null };
}

function getCellVal(cell: ExcelJS.Cell | undefined): any {
  if (!cell) return null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if ("result" in v) return (v as any).result;
    if ("richText" in v) return (v as any).richText?.map((r: any) => r.text).join("") || null;
    if (v instanceof Date) return v;
  }
  return v;
}

function worksheetToArray(ws: ExcelJS.Worksheet): any[][] {
  const data: any[][] = [];
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const rowData: any[] = [];
    for (let c = 1; c <= colCount; c++) {
      rowData.push(getCellVal(row.getCell(c)));
    }
    data.push(rowData);
  }
  return data;
}

export async function backfillInvoiceDateConfirmed(): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const uploadDir = path.join(process.cwd(), "uploads");
  const errors: string[] = [];
  let totalUpdated = 0;
  let totalSkipped = 0;

  if (!fs.existsSync(uploadDir)) {
    return { updated: 0, skipped: 0, errors: ["uploads directory not found"] };
  }

  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    return { updated: 0, skipped: 0, errors: ["DATABASE_URL not set"] };
  }

  const pool = new pg.Pool({ connectionString: connStr });

  const files = fs.readdirSync(uploadDir).filter(f => f.endsWith(".xlsx") || f.endsWith(".xlsm"));

  const latestByProject = new Map<string, string>();
  for (const f of files) {
    const parts = f.split("_");
    const rest = parts.slice(1).join("_");
    const projectName = rest.replace(/\.(xlsx|xlsm|xls)$/i, "");
    
    const existing = latestByProject.get(projectName);
    if (!existing || f > existing) {
      latestByProject.set(projectName, f);
    }
  }

  const entries = Array.from(latestByProject.entries());
  for (const [projectName, fileName] of entries) {
    const filePath = path.join(uploadDir, fileName);
    if (!fs.existsSync(filePath)) {
      errors.push(`File not found: ${fileName}`);
      continue;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const sheetNames = workbook.worksheets.map(ws => ws.name);
      if (!sheetNames.includes("Expenditure Breakdown")) {
        totalSkipped++;
        continue;
      }

      const sheet = workbook.getWorksheet("Expenditure Breakdown")!;
      const data = worksheetToArray(sheet);

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(data.length, 20); i++) {
        const row = data[i];
        if (!row) continue;
        const rowStr = row.map((c: any) => String(c || "").toLowerCase()).join("|");
        if (rowStr.includes("invoice raised date") || rowStr.includes("invoice number")) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx < 0) {
        totalSkipped++;
        continue;
      }

      const headerRow = data[headerRowIdx];
      const colMap: Record<string, number> = {};
      for (let c = 0; c < headerRow.length; c++) {
        if (headerRow[c]) {
          colMap[String(headerRow[c]).toLowerCase().trim()] = c;
        }
      }

      const invoiceDateCol = getColumnIndex(colMap, ["invoice raised date"]);
      const invoiceCol = getColumnIndex(colMap, ["invoice number"]);
      const paymentDateCol = getColumnIndex(colMap, ["finance payment date", "payment date"]);

      if (invoiceDateCol < 0 && paymentDateCol < 0) {
        totalSkipped++;
        continue;
      }

      let dataStartRow = headerRowIdx + 1;
      if (data[headerRowIdx + 1]) {
        const firstRowStr = String(data[headerRowIdx + 1].join(" ")).toLowerCase();
        if (firstRowStr.includes("category") || firstRowStr.includes("line item") || firstRowStr.length < 5) {
          dataStartRow = headerRowIdx + 2;
        }
      }

      for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;

        const rowNum = rowIdx + 1;
        const updates: string[] = [];
        const params: any[] = [projectName, rowNum];
        let paramIdx = 3;

        const excelRow = sheet.getRow(rowIdx + 1);

        if (invoiceDateCol >= 0 && row[invoiceDateCol] != null && String(row[invoiceDateCol]).trim() !== "") {
          const { confirmed, color } = detectFontColor(excelRow, invoiceDateCol + 1);
          updates.push(`invoice_date_confirmed = $${paramIdx}`);
          params.push(confirmed);
          paramIdx++;
          updates.push(`invoice_date_font_color = $${paramIdx}`);
          params.push(color);
          paramIdx++;
        }

        if (paymentDateCol >= 0 && row[paymentDateCol] != null && String(row[paymentDateCol]).trim() !== "") {
          const { confirmed, color } = detectFontColor(excelRow, paymentDateCol + 1);
          updates.push(`payment_date_confirmed = $${paramIdx}`);
          params.push(confirmed);
          paramIdx++;
          updates.push(`payment_date_font_color = $${paramIdx}`);
          params.push(color);
          paramIdx++;
        }

        if (updates.length > 0) {
          await pool.query(
            `UPDATE program_expense SET ${updates.join(", ")} WHERE project_name = $1 AND row_number = $2`,
            params
          );
          totalUpdated++;
        }
      }
    } catch (err: any) {
      errors.push(`Error processing ${fileName}: ${err.message}`);
    }
  }

  await pool.end();
  return { updated: totalUpdated, skipped: totalSkipped, errors };
}

const isMain = process.argv[1]?.includes("backfillInvoiceConfirmed");
if (isMain) {
  backfillInvoiceDateConfirmed()
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
