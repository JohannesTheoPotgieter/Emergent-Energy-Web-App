/**
 * Pure helpers for the COMPANY-wide tracker-vs-QuickBooks recon-ignore surface
 * (G4 — accepted-difference suppression). No I/O — the route layer loads the
 * rows and calls these so the merge / filter logic is unit-testable without a
 * DB or QuickBooks.
 *
 * Two ignore sources are surfaced together on this view:
 *   - recon_line — the company worklist ignore (this feature): keyed on the
 *     recon line identity (stream + normalized invoice number), carries an id
 *     so it can be restored from the UI.
 *   - qb_doc     — the legacy per-project tracker-gap ignore (qb_recon_ignores
 *     / qb_revenue_recon_ignores): keyed on a single QB Bill/Invoice id. Shown
 *     read-only here for a complete audit picture; restored from its own surface.
 *
 * The engine + amounts are NEVER mutated. An active ignore only removes the
 * line from the actionable worklist; it stays visible + audited. READ/COMPARE.
 */

export type ReconStream = "COS" | "REV";

/** A recon-line ignore row (qb_recon_line_ignores) as loaded from the repo. */
export interface LineIgnoreRow {
  id: number;
  stream: string;
  invoiceNoNorm: string;
  invoiceNoRaw: string | null;
  trackerAmountExVat: string | null;
  qbAmountExVat: string | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: Date | string | null;
}

/** The legacy per-project tracker-gap ignore view (from getActiveQbReconIgnores). */
export interface QbDocIgnoreView {
  side: "cost" | "revenue";
  qbDocNumber: string | null;
  counterpartyName: string | null;
  amountExVat: number | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: string | null;
}

/** The unified row the /ignores endpoint returns and the worklist filter uses. */
export interface MergedIgnoreView {
  source: "recon_line" | "qb_doc";
  /** Present (restorable) only for recon_line ignores. */
  id: number | null;
  side: "cost" | "revenue";
  /** Present only for recon_line ignores — needed to re-key against a line. */
  stream: ReconStream | null;
  invoiceNoNorm: string | null;
  /** Raw invoice / QB doc number (display). */
  qbDocNumber: string | null;
  counterpartyName: string | null;
  amountExVat: number | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: string | null;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIso = (v: Date | string | null): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Stable composite key identifying a company recon line. */
export function lineIgnoreKey(stream: string, invoiceNoNorm: string): string {
  return `${stream}|${invoiceNoNorm}`;
}

/** The set of (stream, normalized-number) keys that are currently suppressed. */
export function activeLineIgnoreKeySet(rows: readonly LineIgnoreRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) out.add(lineIgnoreKey(r.stream, r.invoiceNoNorm));
  return out;
}

/** True when a recon line is suppressed by an active recon-line ignore. */
export function isLineIgnored(
  line: { stream: string; invoiceNoNorm: string },
  ignoredKeys: ReadonlySet<string>,
): boolean {
  return ignoredKeys.has(lineIgnoreKey(line.stream, line.invoiceNoNorm));
}

/** Drop suppressed lines from the actionable worklist. */
export function filterOutIgnoredLines<T extends { stream: string; invoiceNoNorm: string }>(
  lines: readonly T[],
  ignoredKeys: ReadonlySet<string>,
): T[] {
  if (ignoredKeys.size === 0) return [...lines];
  return lines.filter((l) => !isLineIgnored(l, ignoredKeys));
}

/** Map a recon-line ignore row to the unified view (restorable). */
export function lineIgnoreToView(row: LineIgnoreRow): MergedIgnoreView {
  const stream = row.stream === "REV" ? "REV" : "COS";
  return {
    source: "recon_line",
    id: row.id,
    side: stream === "REV" ? "revenue" : "cost",
    stream,
    invoiceNoNorm: row.invoiceNoNorm,
    qbDocNumber: row.invoiceNoRaw ?? row.invoiceNoNorm,
    counterpartyName: null,
    amountExVat: toNum(row.trackerAmountExVat) ?? toNum(row.qbAmountExVat),
    reason: row.reason,
    ignoredByName: row.ignoredByName,
    ignoredAt: toIso(row.ignoredAt),
  };
}

/** Adapt a legacy qb-doc ignore view to the unified shape (read-only here). */
export function qbDocIgnoreToView(v: QbDocIgnoreView): MergedIgnoreView {
  return {
    source: "qb_doc",
    id: null,
    side: v.side,
    stream: null,
    invoiceNoNorm: null,
    qbDocNumber: v.qbDocNumber,
    counterpartyName: v.counterpartyName,
    amountExVat: v.amountExVat,
    reason: v.reason,
    ignoredByName: v.ignoredByName,
    ignoredAt: v.ignoredAt,
  };
}

/** Compose the full ignore list shown on the company recon view. */
export function buildMergedIgnoreViews(
  lineIgnores: readonly LineIgnoreRow[],
  qbDocIgnores: readonly QbDocIgnoreView[],
): MergedIgnoreView[] {
  return [
    ...lineIgnores.map(lineIgnoreToView),
    ...qbDocIgnores.map(qbDocIgnoreToView),
  ];
}
