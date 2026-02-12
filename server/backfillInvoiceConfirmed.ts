import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";

function getColumnIndex(colMap: Record<string, number>, names: string[]): number {
  for (const name of names) {
    if (colMap[name] !== undefined) return colMap[name];
  }
  return -1;
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
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        cellFormula: false,
      });

      if (!workbook.SheetNames.includes("Expenditure Breakdown")) {
        totalSkipped++;
        continue;
      }

      const sheet = workbook.Sheets["Expenditure Breakdown"];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

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

      if (invoiceDateCol < 0) {
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

      const confirmedRows: number[] = [];
      const unconfirmedRows: number[] = [];

      for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row) continue;

        const hasInvoiceNumber = invoiceCol >= 0 && row[invoiceCol] && String(row[invoiceCol]).trim() !== "";
        if (!hasInvoiceNumber) continue;

        const hasInvoiceDate = row[invoiceDateCol] != null && String(row[invoiceDateCol]).trim() !== "";
        if (!hasInvoiceDate) continue;

        let isConfirmed = false;
        const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: invoiceDateCol });
        const cell = sheet[cellAddr];
        
        if (cell && cell.s && cell.s.font && cell.s.font.color) {
          const fontColor = cell.s.font.color.rgb || cell.s.font.color.argb || "";
          const isRed = fontColor.toLowerCase().includes("ff0000") || 
                       fontColor.toLowerCase().endsWith("ff0000");
          isConfirmed = !isRed;
        } else if (cell && cell.v) {
          isConfirmed = true;
        }

        if (isConfirmed) {
          confirmedRows.push(rowIdx + 1);
        } else {
          unconfirmedRows.push(rowIdx + 1);
        }
      }

      if (confirmedRows.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < confirmedRows.length; i += batchSize) {
          const batch = confirmedRows.slice(i, i + batchSize);
          const placeholders = batch.map((_, idx) => `$${idx + 2}`).join(",");
          await pool.query(
            `UPDATE program_expense SET invoice_date_confirmed = true WHERE project_name = $1 AND row_number IN (${placeholders})`,
            [projectName, ...batch]
          );
        }
        totalUpdated += confirmedRows.length;
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
