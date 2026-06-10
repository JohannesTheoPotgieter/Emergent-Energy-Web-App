import ExcelJS from "exceljs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), "qa/golden-oracle/.cache");

function colLetter(n: number): string {
  let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s;
}

async function main() {
  const files = readdirSync(CACHE).filter((f) => /\.(xlsx|xlsm)$/i.test(f)).sort();
  const only = process.argv[2];
  for (const f of files) {
    if (only && !f.toLowerCase().includes(only.toLowerCase())) continue;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(join(CACHE, f));
    } catch (e: any) {
      console.log(`\n### ${f} — READ FAILED: ${e.message}`);
      continue;
    }
    console.log(`\n### ${f}`);
    wb.eachSheet((ws) => {
      console.log(`  sheet="${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount}`);
    });
    if (only) {
      const ws = wb.worksheets.find((w) => /expenditure breakdown/i.test(w.name)) || wb.worksheets[0];
      console.log(`\n--- "${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount} ---`);
      const headRows = Number(process.argv[3] || 12);
      // Per-column concatenated header text across the first headRows rows
      console.log("--- COLUMN HEADER MAP (concat rows 1.." + headRows + ") ---");
      for (let c = 1; c <= ws.columnCount; c++) {
        const parts: string[] = [];
        for (let r = 1; r <= headRows; r++) {
          const v = ws.getRow(r).getCell(c).value;
          const s = v == null ? "" : (typeof v === "object" ? (v as any).result ?? (v as any).formula ?? JSON.stringify(v) : String(v));
          if (s && String(s).trim()) parts.push(String(s).trim());
        }
        if (parts.length) console.log(`  ${colLetter(c)}(${c}): ${parts.join(" ⋮ ").slice(0, 90)}`);
      }
      // sample a mid data row
      const sampleR = Number(process.argv[4] || 0);
      if (sampleR) {
        console.log(`--- SAMPLE ROW ${sampleR} ---`);
        for (let c = 1; c <= ws.columnCount; c++) {
          const cell = ws.getRow(sampleR).getCell(c);
          const v = cell.value;
          if (v != null && String(v).trim?.() !== "") {
            const fc = (cell.font && (cell.font as any).color) || null;
            console.log(`  ${colLetter(c)}(${c})=${String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 30)}  font=${JSON.stringify(fc)}`);
          }
        }
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
