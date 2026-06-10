/**
 * Exploratory analyzer — discover the realisation rule that ties the standalone
 * tracker maths to the 08/06 oracle. READ-ONLY. No app importer/derivation code.
 *
 * Expenditure Breakdown actual pane (verified columns):
 *   Q(17) Actual Total  = line COS
 *   S(19) Invoice Number
 *   T(20) Invoice Raised Date  (font colour = realisation signal)
 *   U(21) Revenue Recognition Amount = (Q/X)*J
 *   X(24) category COS total (SUM of Q in the category block)
 */
import ExcelJS from "exceljs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), "qa/golden-oracle/.cache");

const ORACLE: Record<string, { rev: number; cos: number; gp: number }> = {
  Mondi: { rev: 50222621.62, cos: 46258307.86, gp: 3964313.76 },
  Coega: { rev: 13730976.65, cos: 10492741.49, gp: 3238235.16 },
  Seshego: { rev: 10447228.82, cos: 7626862.68, gp: 2820366.13 },
  "De Drift": { rev: 5542316.91, cos: 4553804.89, gp: 988512.02 },
  Unitrans: { rev: 4499896.88, cos: 3734959.55, gp: 764937.33 },
};
const PLACEHOLDER = new Set(["tbc", "tba", "pending", "n/a", "to follow", "to be confirmed", "000", "0", "na", "none", "-", "tbd", ""]);

function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object") { if ("result" in v) return num((v as any).result); return 0; }
  const s = String(v).replace(/[R,\s]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s); return Number.isFinite(n) ? n : 0;
}
function str(v: any): string {
  if (v == null) return "";
  if (typeof v === "object") { if ("result" in v) return str((v as any).result); if ("text" in v) return String((v as any).text); if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join(""); return ""; }
  return String(v).trim();
}
function colourOf(cell: ExcelJS.Cell): "red" | "black" | "none" | "other" {
  const font: any = cell.font; const color = font && font.color;
  if (!color) return "none";
  let hex: string | null = null;
  if (typeof color.argb === "string") hex = color.argb.length === 8 ? color.argb.slice(2) : color.argb;
  else if (typeof color.rgb === "string") hex = color.rgb;
  else if (typeof color.theme === "number") { if (color.theme === 0 || color.theme === 1) return "black"; return "other"; }
  if (!hex) return "other";
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(isNaN)) return "other";
  if (r > 150 && g < 80 && b < 80) return "red";
  if (r < 60 && g < 60 && b < 60) return "black";
  return "other";
}

function findKey(file: string): string {
  const f = file.toLowerCase();
  if (f.includes("mondi")) return "Mondi";
  if (f.includes("coega")) return "Coega";
  if (f.includes("seshego")) return "Seshego";
  if (f.includes("drift")) return "De Drift";
  if (f.includes("unitrans")) return "Unitrans";
  return file;
}

async function main() {
  const files = readdirSync(CACHE).filter((f) => /\.(xlsx|xlsm)$/i.test(f)).sort();
  for (const f of files) {
    const key = findKey(f);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(CACHE, f));
    const ws = wb.worksheets.find((w) => /expenditure breakdown/i.test(w.name));
    if (!ws) { console.log(`${key}: NO Expenditure Breakdown`); continue; }
    // header row = row where Q(17) === "Actual Total"
    let hdr = 0;
    for (let r = 1; r <= 15; r++) if (/actual total/i.test(str(ws.getRow(r).getCell(17).value))) { hdr = r; break; }
    if (!hdr) { console.log(`${key}: no Actual Total header`); continue; }

    const buckets: Record<string, { cos: number; rev: number; n: number }> = {};
    const add = (k: string, cos: number, rev: number) => { (buckets[k] ||= { cos: 0, rev: 0, n: 0 }); buckets[k].cos += cos; buckets[k].rev += rev; buckets[k].n++; };
    const colourHist: Record<string, number> = { red: 0, black: 0, none: 0, other: 0 };

    let blanks = 0;
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const q = num(row.getCell(17).value);
      const u = num(row.getCell(21).value);
      const desc = str(row.getCell(14).value);
      const cat = str(row.getCell(13).value);
      if (!desc && !cat && q === 0 && u === 0) { if (++blanks > 40) break; continue; }
      blanks = 0;
      if (/^total/i.test(desc) || /^total/i.test(cat)) continue; // skip total rows
      if (q === 0 && u === 0) continue;
      const inv = str(row.getCell(19).value);
      const hasInv = !!inv && !PLACEHOLDER.has(inv.toLowerCase());
      const col = colourOf(row.getCell(20));
      colourHist[col]++;
      add("ALL", q, u);
      if (hasInv) add("INV", q, u);
      if (hasInv && col !== "red") add("INV_notRed", q, u);
      if (hasInv && (col === "black" || col === "none")) add("INV_blackOrNone", q, u);
      if (hasInv && col === "black") add("INV_blackOnly", q, u);
      if (col !== "red") add("notRed", q, u);
    }
    const o = ORACLE[key];
    console.log(`\n### ${key}  (header r${hdr})  oracle REV=${o.rev} COS=${o.cos} GP=${o.gp}`);
    console.log(`  T-colour hist:`, colourHist);
    for (const [k, v] of Object.entries(buckets)) {
      const dC = v.cos - o.cos, dR = v.rev - o.rev;
      const tie = Math.abs(dC) < 1 && Math.abs(dR) < 1 ? "  <-- TIES" : "";
      console.log(`  ${k.padEnd(16)} n=${String(v.n).padStart(4)} COS=${v.cos.toFixed(2).padStart(16)} (Δ${dC.toFixed(0)})  REV=${v.rev.toFixed(2).padStart(16)} (Δ${dR.toFixed(0)})${tie}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
