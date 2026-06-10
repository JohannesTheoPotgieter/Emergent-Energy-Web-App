/**
 * STANDALONE golden tracker reader — applies the tracker maths directly from
 * the Expenditure Breakdown sheet. Deliberately imports NO app importer or
 * finance-derivation code (no server/lib/import/*, no repositories/*) so it is
 * an independent oracle. READ-ONLY.
 *
 * Verified Expenditure Breakdown layout (both panes share rows):
 *   COSTED pane:  B(2)=cat No.  C(3)=cat name  I(9)=cat Total COS  J(10)=cat Total Revenue (allocation)
 *   ACTUAL pane:  M(13)="<n>. <name>"  N(14)=description  Q(17)=Actual Total (line COS)
 *                 S(19)=invoice no.  T(20)=invoice raised date (+font colour)  X(24)=cat Total COS (ΣQ)
 *
 * Maths (matches the canonical repo formula, reimplemented independently):
 *   X  = Σ Q over every actual line in the category (all rows, not realised-only)
 *   J  = category revenue allocation (costed pane col J)
 *   perLineRevenue = (Q / X) × J
 *   realised  ⇔ invoice present (non-placeholder) ∧ font≠red ∧ Q≠0
 *               ∧ invoice-date in FY window ∧ invoice-month ≤ as-at month
 *   Realised COS = Σ Q over realised lines; Realised REV = Σ perLineRevenue;  GP = REV − COS.
 */
import ExcelJS from "exceljs";

export const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd", "",
]);

export type Bucket = "realised" | "out_of_window" | "future_month" | "no_invoice" | "zero_amount" | "red_unconfirmed";

export interface GoldenLine {
  row: number;
  categoryNumber: number | null;
  categoryName: string | null;
  description: string;
  actualTotal: number;            // Q
  invoiceNumber: string;          // S
  invoiceRaisedDate: string | null; // T (ISO yyyy-mm-dd)
  invoiceMonth: string | null;    // yyyy-mm
  invoiceDateFontColor: "red" | "black"; // normaliser parity: non-red => black
  categoryTotalActualTotal: number; // X
  categoryRevenueAllocation: number | null; // J
  perLineRevenue: number;
  perLineGp: number;
  bucket: Bucket;
}

export interface MonthBucket { rev: number; cos: number; gp: number; }
export interface GoldenProject {
  projectId: number;
  projectName: string;
  fileName: string;
  sheet: string;
  asAt: string;
  fyStart: string;
  fyEnd: string;
  categories: { number: number | null; name: string | null; X: number; J: number | null; sheetX: number | null }[];
  lines: GoldenLine[];
  totals: { realisedRev: number; realisedCos: number; realisedGp: number; lineCount: number; realisedCount: number };
  monthly: Record<string, MonthBucket>;
}

export function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object") { if ("result" in v) return num((v as any).result); return 0; }
  const s = String(v).replace(/[R\s,]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s); return Number.isFinite(n) ? n : 0;
}
export function str(v: any): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v) return str((v as any).result);
    if ("text" in v) return String((v as any).text);
    if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join("");
    return "";
  }
  return String(v).trim();
}
function isoDate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") { if ("result" in v) return isoDate((v as any).result); return null; }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
/** Normaliser parity: red iff r>150 & g<80 & b<80; everything else => black. */
export function fontColour(cell: ExcelJS.Cell): "red" | "black" {
  const color: any = cell.font && (cell.font as any).color;
  if (!color) return "black";
  let hex: string | null = null;
  if (typeof color.argb === "string") hex = color.argb.length === 8 ? color.argb.slice(2) : color.argb;
  else if (typeof color.rgb === "string") hex = color.rgb;
  else return "black"; // theme/indexed default => treat as confirmed (non-red)
  if (!hex || hex.length < 6) return "black";
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(isNaN)) return "black";
  return r > 150 && g < 80 && b < 80 ? "red" : "black";
}

const COL = { catNo: 2, catName: 3, costedRev: 10, aCat: 13, aDesc: 14, aQ: 17, aInv: 19, aDate: 20, aX: 24 };

export interface ParseOpts { asAt: string; fyStart: string; fyEnd: string; }

export async function parseTracker(
  filePath: string,
  meta: { projectId: number; projectName: string; fileName: string },
  opts: ParseOpts,
): Promise<GoldenProject> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets.find((w) => /expenditure breakdown/i.test(w.name));
  if (!ws) throw new Error(`${meta.fileName}: no Expenditure Breakdown sheet`);

  // header row = row where Q(17) === "Actual Total"
  let hdr = 0;
  for (let r = 1; r <= 15; r++) if (/actual total/i.test(str(ws.getRow(r).getCell(COL.aQ).value))) { hdr = r; break; }
  if (!hdr) throw new Error(`${meta.fileName}: no "Actual Total" header found`);

  // J (category revenue allocation) + name per category number, from costed pane.
  const Jmap = new Map<number, number>();
  const nameMap = new Map<number, string>();
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const b = ws.getRow(r).getCell(COL.catNo).value;
    const bn = typeof b === "number" ? b : (typeof b === "string" && /^\d+$/.test(b.trim()) ? Number(b) : null);
    if (bn == null) continue;
    const j = num(ws.getRow(r).getCell(COL.costedRev).value);
    if (j !== 0 && !Jmap.has(bn)) Jmap.set(bn, j);
    const nm = str(ws.getRow(r).getCell(COL.catName).value);
    if (nm && !nameMap.has(bn)) nameMap.set(bn, nm);
  }

  // First pass: collect raw actual lines + per-category X (Σ Q over ALL lines).
  interface Raw { row: number; cat: number | null; desc: string; q: number; inv: string; date: string | null; colour: "red" | "black"; sheetX: number; }
  const raw: Raw[] = [];
  const Xmap = new Map<number, number>();
  const sheetXmap = new Map<number, number>();
  let blanks = 0;
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const mCell = str(row.getCell(COL.aCat).value);
    const desc = str(row.getCell(COL.aDesc).value);
    const q = num(row.getCell(COL.aQ).value);
    const inv = str(row.getCell(COL.aInv).value);
    const dateRaw = row.getCell(COL.aDate).value;
    if (!mCell && !desc && q === 0 && !inv) { if (++blanks > 60) break; continue; }
    blanks = 0;
    if (!mCell) continue;                       // not an actual line
    if (/^total/i.test(mCell) || /^total/i.test(desc)) continue;
    const cm = mCell.match(/^(\d+)/);
    const cat = cm ? Number(cm[1]) : null;
    if (q === 0 && !inv && !desc) continue;
    const colour = fontColour(row.getCell(COL.aDate));
    raw.push({ row: r, cat, desc, q, inv, date: isoDate(dateRaw), colour, sheetX: num(row.getCell(COL.aX).value) });
    if (cat != null) {
      Xmap.set(cat, (Xmap.get(cat) ?? 0) + q);
      if (!sheetXmap.has(cat)) sheetXmap.set(cat, num(row.getCell(COL.aX).value));
    }
  }

  const fyS = opts.fyStart, fyE = opts.fyEnd;
  const asAtDate = new Date(opts.asAt + "T00:00:00Z");
  const nextMonthStart = Date.UTC(asAtDate.getUTCFullYear(), asAtDate.getUTCMonth() + 1, 1);

  const lines: GoldenLine[] = [];
  for (const rw of raw) {
    const X = rw.cat != null ? (Xmap.get(rw.cat) ?? 0) : 0;
    const J = rw.cat != null ? (Jmap.get(rw.cat) ?? null) : null;
    const perLineRevenue = X > 0 && J != null ? (rw.q / X) * J : 0;
    const month = rw.date ? rw.date.slice(0, 7) : null;
    const hasInv = !!rw.inv && !PLACEHOLDER_INVOICES.has(rw.inv.toLowerCase());

    let bucket: Bucket;
    const inWindow = rw.date != null && rw.date >= fyS && rw.date <= fyE;
    const invEpoch = rw.date ? Date.parse(rw.date + "T00:00:00Z") : null;
    if (!inWindow) bucket = "out_of_window";
    else if (invEpoch != null && invEpoch >= nextMonthStart) bucket = "future_month";
    else if (!hasInv) bucket = "no_invoice";
    else if (rw.q === 0) bucket = "zero_amount";
    else if (rw.colour === "red") bucket = "red_unconfirmed";
    else bucket = "realised";

    lines.push({
      row: rw.row, categoryNumber: rw.cat, categoryName: rw.cat != null ? nameMap.get(rw.cat) ?? null : null,
      description: rw.desc, actualTotal: rw.q, invoiceNumber: rw.inv, invoiceRaisedDate: rw.date, invoiceMonth: month,
      invoiceDateFontColor: rw.colour, categoryTotalActualTotal: X, categoryRevenueAllocation: J,
      perLineRevenue, perLineGp: perLineRevenue - rw.q, bucket,
    });
  }

  const monthly: Record<string, MonthBucket> = {};
  let realisedRev = 0, realisedCos = 0, realisedCount = 0;
  for (const l of lines) {
    if (l.bucket !== "realised") continue;
    realisedRev += l.perLineRevenue; realisedCos += l.actualTotal; realisedCount++;
    const m = l.invoiceMonth!;
    (monthly[m] ||= { rev: 0, cos: 0, gp: 0 });
    monthly[m].rev += l.perLineRevenue; monthly[m].cos += l.actualTotal; monthly[m].gp += l.perLineGp;
  }

  const categories = [...new Set(lines.map((l) => l.categoryNumber).filter((n): n is number => n != null))]
    .sort((a, b) => a - b)
    .map((n) => ({ number: n, name: nameMap.get(n) ?? null, X: Xmap.get(n) ?? 0, J: Jmap.get(n) ?? null, sheetX: sheetXmap.get(n) ?? null }));

  return {
    projectId: meta.projectId, projectName: meta.projectName, fileName: meta.fileName, sheet: ws.name,
    asAt: opts.asAt, fyStart: fyS, fyEnd: fyE,
    categories, lines,
    totals: { realisedRev, realisedCos, realisedGp: realisedRev - realisedCos, lineCount: lines.length, realisedCount },
    monthly,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Cross-surface: Revenue Tracking (client-invoice milestones)
 * Layout (verified): header row has C="PAYMENT MILESTONE";
 *   B(2)=No.  C(3)=milestone  E(5)=%  F(6)=value  H(8)=planned date
 *   L(12)=invoice number  N(14)=invoice raised date (+font colour=realised)
 * Realised milestone ⇔ invoice present (non-placeholder) ∧ font(N)≠red
 *   ∧ invoice-date in FY window ∧ invoice-month ≤ as-at month.
 * This is an independent revenue cross-check against the Expenditure
 * Breakdown (Q/X)×J surface — the two are reconciled in the fixture.
 * ──────────────────────────────────────────────────────────────────────── */
export interface RevMilestone {
  row: number; no: number | null; milestone: string; pct: number | null;
  value: number; invoiceNumber: string; invoiceRaisedDate: string | null;
  invoiceMonth: string | null; invoiceDateFontColor: "red" | "black"; bucket: Bucket;
}
export interface RevenueTracking {
  sheet: string;
  milestones: RevMilestone[];
  realisedRevenue: number;
  realisedCount: number;
  contractRevenue: number;          // Σ all milestone values
  monthly: Record<string, number>;  // realised revenue by invoice month
}

const RT = { no: 2, milestone: 3, pct: 5, value: 6, inv: 12, date: 14 };

export async function parseRevenueTracking(
  filePath: string,
  opts: ParseOpts,
): Promise<RevenueTracking | null> {
  const wb = new ExcelJS.Workbook();
  if (/\.xlsm$/i.test(filePath)) await wb.xlsx.readFile(filePath);
  else await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets.find((w) => /revenue tracking/i.test(w.name));
  if (!ws) return null;

  let hdr = 0;
  for (let r = 1; r <= 40; r++) if (/payment milestone/i.test(str(ws.getRow(r).getCell(RT.milestone).value))) { hdr = r; break; }
  if (!hdr) return null;

  const fyS = opts.fyStart, fyE = opts.fyEnd;
  const asAtDate = new Date(opts.asAt + "T00:00:00Z");
  const nextMonthStart = Date.UTC(asAtDate.getUTCFullYear(), asAtDate.getUTCMonth() + 1, 1);

  const milestones: RevMilestone[] = [];
  let blanks = 0;
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const noRaw = row.getCell(RT.no).value;
    const no = typeof noRaw === "number" ? noRaw : (typeof noRaw === "string" && /^\d+$/.test(noRaw.trim()) ? Number(noRaw) : null);
    const milestone = str(row.getCell(RT.milestone).value);
    const value = num(row.getCell(RT.value).value);
    const inv = str(row.getCell(RT.inv).value);
    const date = isoDate(row.getCell(RT.date).value);
    if (no == null && !milestone && value === 0 && !inv) { if (++blanks > 30) break; continue; }
    blanks = 0;
    if (milestone === "-" || /^total/i.test(milestone)) continue;
    if (no == null && !milestone) continue;
    const colour = fontColour(row.getCell(RT.date));
    const month = date ? date.slice(0, 7) : null;
    const hasInv = !!inv && !PLACEHOLDER_INVOICES.has(inv.toLowerCase());
    const inWindow = date != null && date >= fyS && date <= fyE;
    const invEpoch = date ? Date.parse(date + "T00:00:00Z") : null;
    let bucket: Bucket;
    if (!inWindow) bucket = "out_of_window";
    else if (invEpoch != null && invEpoch >= nextMonthStart) bucket = "future_month";
    else if (!hasInv) bucket = "no_invoice";
    else if (value === 0) bucket = "zero_amount";
    else if (colour === "red") bucket = "red_unconfirmed";
    else bucket = "realised";
    milestones.push({
      row: r, no, milestone, pct: row.getCell(RT.pct).value != null ? num(row.getCell(RT.pct).value) : null,
      value, invoiceNumber: inv, invoiceRaisedDate: date, invoiceMonth: month, invoiceDateFontColor: colour, bucket,
    });
  }

  const monthly: Record<string, number> = {};
  let realisedRevenue = 0, realisedCount = 0;
  for (const m of milestones) {
    if (m.bucket !== "realised") continue;
    realisedRevenue += m.value; realisedCount++;
    monthly[m.invoiceMonth!] = (monthly[m.invoiceMonth!] ?? 0) + m.value;
  }
  // Some workbooks restate the milestone block (planned vs actual / VO mirror),
  // repeating the same milestone numbers. Dedupe by milestone No. (first
  // occurrence) so contractRevenue is the true contract, not a doubled sum.
  const seenNo = new Set<number>();
  let contractRevenue = 0;
  for (const m of milestones) {
    if (m.no != null) {
      if (seenNo.has(m.no)) continue;
      seenNo.add(m.no);
    }
    contractRevenue += m.value;
  }
  return { sheet: ws.name, milestones, realisedRevenue, realisedCount, contractRevenue, monthly };
}
