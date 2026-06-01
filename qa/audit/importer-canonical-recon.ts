/**
 * importer-canonical-recon.ts — AUDIT ARTIFACT (read-only; not wired into CI)
 * =============================================================================
 * Independent reconciliation harness for IMPORTER_AUDIT.md (Finding C1).
 *
 * It re-derives COS / Revenue / GP per line straight from the raw workbook cells
 * + invoice-date FONT COLOUR, then classifies every line TWO ways:
 *
 *   • CANONICAL      — the task brief's rule. Colour is the signal, no exceptions:
 *                        invoice + BLACK  -> Realised
 *                        invoice + RED    -> Committed
 *                        no invoice + RED + future -> Planned
 *                        no invoice (else)        -> Unrealised
 *
 *   • APP-EQUIVALENT — the rule the app's reporting paths actually use
 *                      (server/lib/finance/cos-realisation.ts:isEffectivelyRealised
 *                       + finance-line-level-repository.ts:classifyBucket):
 *                        invoice + (BLACK OR recognitionMonth < currentMonth) -> Realised
 *                        invoice + RED (current/future month)                 -> Committed
 *                        no invoice                                           -> Planned
 *
 * The per-state Δ between the two is the dollarised C1 finding for a given
 * snapshot. This file imports ONLY `exceljs` (already a dependency) — no DB, no
 * app bootstrap — so it runs anywhere with deps installed.
 *
 * Usage (in an environment that has node_modules):
 *   npx tsx qa/audit/importer-canonical-recon.ts                       # scans attached_assets/*Tracker*
 *   npx tsx qa/audit/importer-canonical-recon.ts path/to/Tracker.xlsx  # one workbook
 *   npx tsx qa/audit/importer-canonical-recon.ts --as-at 2026-06-01 --fy-start 2025-09-01 --fy-end 2026-08-31
 *
 * NOTE: this is an analysis tool, not a test. It does not assert; it prints a
 * reconciliation table. It deliberately mirrors the app's column-by-header
 * resolution and colour logic (ported verbatim from normalizer.ts) so any Δ is
 * attributable to the classification rule, not to parsing differences.
 */
import ExcelJS from "exceljs";
import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const getFlag = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const AS_AT = getFlag("as-at", "2026-06-01");           // drives the "current month" boundary
const FY_START = getFlag("fy-start", "2025-09-01");
const FY_END = getFlag("fy-end", "2026-08-31");
const CURRENT_MONTH = AS_AT.slice(0, 7);                 // "YYYY-MM"
// Positional workbook paths. Value-flags (--as-at/--fy-start/--fy-end) only ever
// take date values, which never end in .xlsx/.xlsm, so this filter is unambiguous.
const fileArgs = argv.filter((a) => !a.startsWith("--") && /\.(xlsx|xlsm)$/i.test(a));

// ---------------------------------------------------------------------------
// Colour logic — ported verbatim from server/lib/import/normalizer.ts:534-596
// ---------------------------------------------------------------------------
function extractFontColorHex(fontColor: any): string | null {
  if (!fontColor) return null;
  if (fontColor.argb && typeof fontColor.argb === "string") {
    const argb = fontColor.argb;
    return argb.length === 8 ? argb.substring(2).toLowerCase() : argb.toLowerCase();
  }
  if (fontColor.rgb && typeof fontColor.rgb === "string") return fontColor.rgb.toLowerCase();
  if (fontColor.theme != null && typeof fontColor.theme === "number") return "000000"; // theme -> black (matches app)
  return null;
}
function classifyColorHex(hex: string | null): { color: string | null; isBlack: boolean } {
  if (!hex) return { color: null, isBlack: false };
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { color: null, isBlack: false };
  if (r < 40 && g < 40 && b < 40) return { color: "black", isBlack: true };
  if (r > 150 && g < 80 && b < 80) return { color: "red", isBlack: false };
  return { color: hex, isBlack: false };
}
function getCellFontColor(ws: ExcelJS.Worksheet, row1: number, col1: number): { color: string | null; isBlack: boolean } {
  try {
    const cell = ws.getRow(row1).getCell(col1);
    if (!cell || cell.value == null) return { color: null, isBlack: false };
    const font: any = cell.font;
    if (!font || !font.color) return { color: "black", isBlack: true }; // default font -> black/confirmed
    const hex = extractFontColorHex(font.color);
    if (hex === null) return { color: "black", isBlack: true };
    return classifyColorHex(hex);
  } catch {
    return { color: "black", isBlack: true };
  }
}

// ---------------------------------------------------------------------------
// Header resolution — by header text, mirroring detector.ts + mapper.ts
// ---------------------------------------------------------------------------
const norm = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Subset of EXPENDITURE_SYNONYMS (server/lib/import/synonyms.ts) we need.
const SYN: Record<string, string[]> = {
  cost_category: ["product/ service", "product / service", "product", "category", "cost category"],
  actual_total: ["actual total", "actual amount", "actual cost"],
  invoice_number: ["invoice number", "invoice no", "inv no", "invoice #"],
  invoice_date: ["invoice raised date", "invoice date", "date invoiced"],
  finance_payment_date: ["finance payment date", "payment date", "paid date", "date paid"],
  revenue_recognition_amount: ["revenue recognition amount", "revenue recognition", "rev recognition"],
  category_revenue_allocation: ["total revenue", "revenue allocation", "category revenue", "costed revenue"],
};
const EXP_ANCHORS = ["actual total", "invoice number", "finance payment", "product/service", "description of work", "po number"];

function cellText(ws: ExcelJS.Worksheet, row1: number, col1: number): string {
  const v = ws.getRow(row1).getCell(col1).value as any;
  if (v == null) return "";
  if (typeof v === "object" && "result" in v) return String((v as any).result ?? "");
  if (typeof v === "object" && "richText" in v) return (v.richText as any[]).map((t) => t.text).join("");
  return String(v);
}
function toIso(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return toIso((v as any).result);
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "object" && "result" in v) return toNum((v as any).result);
  const cleaned = String(v).replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function lastDayOfMonth(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function findExpenditureSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  let best: ExcelJS.Worksheet | null = null;
  wb.eachSheet((ws) => {
    const n = norm(ws.name);
    if (n.includes("expenditure") || n.includes("cost breakdown")) best = ws;
  });
  return best;
}

function resolveColumns(ws: ExcelJS.Worksheet): { headerRow: number; cols: Record<string, number> } | null {
  let headerRow = -1, bestScore = 0;
  const maxScan = Math.min(60, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    let score = 0;
    const lastCol = Math.min(ws.columnCount, 60);
    for (let c = 1; c <= lastCol; c++) {
      const t = norm(cellText(ws, r, c));
      if (!t) continue;
      for (const a of EXP_ANCHORS) if (t.includes(a)) score++;
    }
    if (score > bestScore) { bestScore = score; headerRow = r; }
  }
  if (headerRow < 0) return null;
  const cols: Record<string, number> = {};
  const lastCol = Math.min(ws.columnCount, 80);
  for (const [field, syns] of Object.entries(SYN)) {
    let found = -1;
    // exact first, then substring — same precedence as mapper.findBestMatch
    for (let c = 1; c <= lastCol && found < 0; c++) {
      const t = norm(cellText(ws, headerRow, c));
      if (t && syns.some((s) => t === s)) found = c;
    }
    for (let c = 1; c <= lastCol && found < 0; c++) {
      const t = norm(cellText(ws, headerRow, c));
      if (t && syns.some((s) => t.includes(s) || s.includes(t))) found = c;
    }
    cols[field] = found;
  }
  return { headerRow, cols };
}

// ---------------------------------------------------------------------------
// Per-line extraction + dual classification
// ---------------------------------------------------------------------------
type State = "realised" | "committed" | "planned" | "unrealised";
interface Line {
  project: string; sourceRow: number; category: string;
  cos: number; rev: number; gp: number;
  invoiceNo: string; invoiceMonth: string | null; colour: string; isBlack: boolean;
  canonical: State; app: State; inFy: boolean;
}

function classifyCanonical(hasInv: boolean, isBlack: boolean, red: boolean, month: string | null): State {
  if (hasInv) return isBlack ? "realised" : "committed";              // black->realised, red->committed
  if (red && month != null && month > CURRENT_MONTH) return "planned"; // no invoice + red + future
  return "unrealised";                                                 // no invoice otherwise
}
function classifyApp(hasInv: boolean, isBlack: boolean, month: string | null): State {
  if (!hasInv) return "planned";                                       // classifyBucket: no invoice -> planned
  const pastMonth = month != null && month < CURRENT_MONTH;
  return isBlack || pastMonth ? "realised" : "committed";              // past month -> realised regardless of colour
}

function analyse(wb: ExcelJS.Workbook, path: string, lines: Line[], flags: string[]): void {
  const project = basename(path).replace(/\.(xlsx|xlsm)$/i, "");
  const ws = findExpenditureSheet(wb);
  if (!ws) { flags.push(`${project}: NO_EXPENDITURE_SHEET (skipped — likely HSE/template)`); return; }
  const res = resolveColumns(ws);
  if (!res) { flags.push(`${project}: NO_HEADER_ROW`); return; }
  const { headerRow, cols } = res;
  if (cols.invoice_date < 0) flags.push(`${project}: COL_T_MISSING (cannot classify — old template, exclude not guess)`);
  if (cols.revenue_recognition_amount < 0) flags.push(`${project}: COL_U_MISSING (revenue falls back to POC / 0)`);
  if (cols.actual_total < 0) { flags.push(`${project}: COL_ACTUAL_TOTAL_MISSING`); return; }

  // For POC fallback we need category X (ΣQ) + J. First pass collects them.
  let curCat = "";
  const catActual = new Map<string, number>();
  const catJ = new Map<string, number>();
  const rows: { r: number; cat: string }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const catCell = cols.cost_category > 0 ? cellText(ws, r, cols.cost_category).trim() : "";
    if (catCell) curCat = catCell;
    const at = toNum(ws.getRow(r).getCell(cols.actual_total).value);
    if (at !== 0) catActual.set(curCat, (catActual.get(curCat) ?? 0) + at);
    if (cols.category_revenue_allocation > 0) {
      const j = toNum(ws.getRow(r).getCell(cols.category_revenue_allocation).value);
      if (j !== 0 && !catJ.has(curCat)) catJ.set(curCat, j);
    }
    rows.push({ r, cat: curCat });
  }

  const dupKey = new Map<string, Set<string>>(); // invoiceNo+amount -> set of months
  for (const { r, cat } of rows) {
    const cos = toNum(ws.getRow(r).getCell(cols.actual_total).value);
    if (cos === 0) continue;
    const invoiceNo = cols.invoice_number > 0 ? cellText(ws, r, cols.invoice_number).trim() : "";
    const rawInvDate = cols.invoice_date > 0 ? toIso(ws.getRow(r).getCell(cols.invoice_date).value) : null;
    const payDate = cols.finance_payment_date > 0 ? toIso(ws.getRow(r).getCell(cols.finance_payment_date).value) : null;
    const invDate = rawInvDate ?? lastDayOfMonth(payDate); // EOMONTH(payment) replica, normalizer.ts:1534
    const month = invDate ? invDate.slice(0, 7) : null;

    // colour read from the INVOICE DATE cell (normalizer.ts:1600)
    const fc = cols.invoice_date > 0 && invDate ? getCellFontColor(ws, r, cols.invoice_date) : { color: null, isBlack: false };
    const red = fc.color === "red";

    // REV: col U if present, else POC (Q/X)*J
    let rev = 0;
    if (cols.revenue_recognition_amount > 0) {
      rev = toNum(ws.getRow(r).getCell(cols.revenue_recognition_amount).value);
    }
    if (rev === 0) {
      const X = catActual.get(cat) ?? 0, J = catJ.get(cat) ?? 0;
      if (X > 0 && J > 0) rev = (cos / X) * J;
    }

    const hasInv = !!invoiceNo && !["tbc", "tba", "n/a", "na", "none", "-", "pending", "0", "000", "tbd"].includes(invoiceNo.toLowerCase());
    const inFy = invDate != null && invDate >= FY_START && invDate <= FY_END;

    if (hasInv) {
      const k = `${invoiceNo}::${Math.round(cos)}`;
      const set = dupKey.get(k) ?? new Set<string>();
      if (month) set.add(month);
      dupKey.set(k, set);
    }

    lines.push({
      project, sourceRow: r, category: cat, cos, rev, gp: rev - cos,
      invoiceNo, invoiceMonth: month, colour: fc.color ?? "(none)", isBlack: fc.isBlack,
      canonical: classifyCanonical(hasInv, fc.isBlack, red, month),
      app: classifyApp(hasInv, fc.isBlack, month),
      inFy,
    });
  }

  for (const [k, months] of dupKey) if (months.size > 1) flags.push(`${project}: CROSS_PERIOD_DUP ${k} in months ${[...months].join(",")}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function rands(n: number): string {
  return "R" + (n / 1_000_000).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "m";
}
function bucketTotals(lines: Line[], key: "canonical" | "app", fyOnly: boolean) {
  const t: Record<State, { cos: number; rev: number }> = {
    realised: { cos: 0, rev: 0 }, committed: { cos: 0, rev: 0 }, planned: { cos: 0, rev: 0 }, unrealised: { cos: 0, rev: 0 },
  };
  for (const l of lines) {
    if (fyOnly && !l.inFy) continue;
    t[l[key]].cos += l.cos; t[l[key]].rev += l.rev;
  }
  return t;
}

async function main() {
  const targets: string[] = fileArgs.length
    ? fileArgs
    : (() => {
        const dir = join(process.cwd(), "attached_assets");
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter((f) => /tracker/i.test(f) && /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith("~$") && !/conflicted copy/i.test(f)).map((f) => join(dir, f));
      })();

  if (!targets.length) {
    console.error("No workbooks found. Pass a path or place *Tracker*.xlsx in attached_assets/.");
    process.exit(1);
  }

  console.log(`\nCANONICAL vs APP reconciliation  (as-at ${AS_AT}, current month ${CURRENT_MONTH}, FY ${FY_START}..${FY_END})`);
  console.log(`Workbooks: ${targets.length}\n`);

  const lines: Line[] = [];
  const flags: string[] = [];
  for (const p of targets) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.readFile(p); analyse(wb, p, lines, flags); }
    catch (e) { flags.push(`${basename(p)}: READ_ERROR ${(e as Error).message}`); }
  }

  for (const fyOnly of [false, true]) {
    const can = bucketTotals(lines, "canonical", fyOnly);
    const app = bucketTotals(lines, "app", fyOnly);
    const states: State[] = ["realised", "committed", "planned", "unrealised"];
    console.log(`================ ${fyOnly ? "FY-WINDOWED" : "ALL DATES"} ================`);
    console.log("state        | canonical COS | app COS       | Δ COS         | canonical REV | app REV       | Δ REV");
    for (const s of states) {
      const dCos = app[s].cos - can[s].cos, dRev = app[s].rev - can[s].rev;
      console.log(
        `${s.padEnd(12)} | ${rands(can[s].cos).padStart(13)} | ${rands(app[s].cos).padStart(13)} | ${rands(dCos).padStart(13)} | ` +
        `${rands(can[s].rev).padStart(13)} | ${rands(app[s].rev).padStart(13)} | ${rands(dRev).padStart(13)}`,
      );
    }
    const cTot = states.reduce((s, k) => s + can[k].cos, 0);
    console.log(`TOTAL COS    | ${rands(cTot).padStart(13)}  (preserved across both rules — only attribution moves)\n`);
  }

  if (flags.length) {
    console.log("---------------- HYGIENE FLAGS ----------------");
    for (const f of [...new Set(flags)]) console.log("  " + f);
  }
  console.log(
    "\nInterpretation: a positive Δ on `realised` COS that mirrors a negative Δ on `committed` IS Finding C1 —\n" +
    "the app's past-month auto-realise rule reclassifying RED (committed) closed-month lines as realised.\n",
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
