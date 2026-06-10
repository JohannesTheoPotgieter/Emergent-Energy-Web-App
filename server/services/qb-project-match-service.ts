/**
 * Per-project QuickBooks attribution service (G2 auto-matcher) — orchestration.
 *
 * Pulls QuickBooks documents (best-effort; auto-mocked in dev) + the project
 * tracker lines, runs the PURE matcher (server/lib/finance/qb-project-matcher.ts)
 * and persists the per-QB-doc attribution into `qb_project_match` (full-replace,
 * idempotent, re-runnable). READ/COMPARE ONLY — nothing is written back to QB
 * and no tracker is ever adjusted (§ 3.4).
 *
 * QB ex-VAT comes from the EXISTING parse (billRawToSummary / invoiceRawToSummary,
 * TotalAmt − TxnTaxDetail.TotalTax); tracker ex-VAT from normalized_*_lines
 * (col Q for COS, col U for REV). No parallel amount calc.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { qbProjectMatch } from "@shared/schema/qb-project-match";
import { normalizedCostLines, normalizedRevenueLines } from "@shared/schema/finance";
import { projectInfo } from "@shared/schema/projects";
import { db } from "../db";
import { getBills, getInvoices } from "./quickbooks-service";
import { billRawToSummary, invoiceRawToSummary } from "./quickbooks-reconciliation-service";
import {
  matchQbDocsToTrackerLines,
  computeProjectAttribution,
  computeUnattributed,
  tallyMatches,
  round2,
  DEFAULT_MATCH_TOLERANCE,
  type MatchStream,
  type QbDocInput,
  type TrackerLineInput,
  type QbProjectMatch,
  type ProjectQbAttribution,
  type UnattributedBucket,
  type MatchCounts,
} from "../lib/finance/qb-project-matcher";

export type DbOrTx = typeof db;

const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
};

function defaultWindow(monthsBack: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export interface RefreshOptions {
  start?: string;
  end?: string;
  monthsBack?: number;
  tolerance?: number;
}

export interface QbProjectMatchRefreshSummary {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  tolerance: number;
  qbAvailable: boolean;
  cos: MatchCounts;
  rev: MatchCounts;
  rowsWritten: number;
}

// ---------------------------------------------------------------------------
// Tracker-side loaders (id + project_id + invoice number + ex-VAT)
// ---------------------------------------------------------------------------

async function loadTrackerLines(
  dbi: DbOrTx,
  stream: MatchStream,
  window: { start: string; end: string } | null,
): Promise<TrackerLineInput[]> {
  const table = stream === "COS" ? normalizedCostLines : normalizedRevenueLines;
  const rows = (await dbi
    .select({
      id: table.id,
      projectId: table.projectId,
      invoiceNumber: table.invoiceNumber,
      amountExVat: table.amountExVat,
      invoiceDate: table.invoiceDate,
    })
    .from(table)
    .where(and(isNull(table.effectiveTo), isNull(table.deletedAt)))) as Array<{
    id: number;
    projectId: number | null;
    invoiceNumber: string | null;
    amountExVat: string | null;
    invoiceDate: unknown;
  }>;

  return rows
    .filter((r) => r.projectId != null)
    .filter((r) => {
      if (!window) return true;
      const d = isoDate(r.invoiceDate);
      return d != null && d >= window.start && d <= window.end;
    })
    .map((r) => ({
      trackerLineId: r.id,
      projectId: r.projectId as number,
      invoiceNumber: r.invoiceNumber,
      amountExVat: toNum(r.amountExVat),
    }));
}

// ---------------------------------------------------------------------------
// QB-side loader (best-effort; mock fixtures in dev when creds absent)
// ---------------------------------------------------------------------------

async function loadQbDocs(
  window: { start: string; end: string },
): Promise<{ cos: QbDocInput[]; rev: QbDocInput[] } | null> {
  try {
    const [bills, invoices] = await Promise.all([
      getBills(window.start, window.end),
      getInvoices(window.start, window.end),
    ]);
    const cos: QbDocInput[] = ((bills as { QueryResponse?: { Bill?: unknown[] } })?.QueryResponse?.Bill ?? [])
      .map((b) => billRawToSummary(b))
      .map((s) => ({ qbDocId: s.id, docNumber: s.docNumber, amountExVat: toNum(s.qbAmountExVat ?? s.totalAmount), date: isoDate(s.txnDate) }));
    const rev: QbDocInput[] = ((invoices as { QueryResponse?: { Invoice?: unknown[] } })?.QueryResponse?.Invoice ?? [])
      .map((i) => invoiceRawToSummary(i))
      .map((s) => ({ qbDocId: s.id, docNumber: s.docNumber, amountExVat: toNum(s.totalAmount), date: isoDate(s.txnDate) }));
    return { cos, rev };
  } catch (err) {
    console.warn(
      "[qb-project-match] QuickBooks unavailable — skipping refresh:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh — match + full-replace persist (idempotent)
// ---------------------------------------------------------------------------

export async function refreshQbProjectMatches(
  dbi: DbOrTx,
  opts: RefreshOptions = {},
): Promise<QbProjectMatchRefreshSummary> {
  const tolerance = opts.tolerance ?? DEFAULT_MATCH_TOLERANCE;
  const window =
    opts.start && opts.end ? { start: opts.start, end: opts.end } : defaultWindow(opts.monthsBack ?? 18);
  const now = new Date();
  const generatedAt = now.toISOString();

  const qb = await loadQbDocs(window);
  if (!qb) {
    return {
      generatedAt,
      windowStart: window.start,
      windowEnd: window.end,
      tolerance,
      qbAvailable: false,
      cos: { matched: 0, ambiguous: 0, unmatched: 0, total: 0 },
      rev: { matched: 0, ambiguous: 0, unmatched: 0, total: 0 },
      rowsWritten: 0,
    };
  }

  const [cosTracker, revTracker] = await Promise.all([
    loadTrackerLines(dbi, "COS", window),
    loadTrackerLines(dbi, "REV", window),
  ]);

  const cosMatches = matchQbDocsToTrackerLines("COS", qb.cos, cosTracker, { tolerance });
  const revMatches = matchQbDocsToTrackerLines("REV", qb.rev, revTracker, { tolerance });
  const all = [...cosMatches, ...revMatches];

  // Full-replace: the matcher owns the whole table, so a re-run is idempotent.
  await dbi.delete(qbProjectMatch);
  if (all.length > 0) {
    const values: Array<typeof qbProjectMatch.$inferInsert> = all.map((m) => ({
      stream: m.stream,
      qbDocId: m.qbDocId,
      qbDocNumber: m.docNumber,
      invoiceNoNorm: m.invoiceNoNorm || null,
      qbExVatAmount: m.qbExVatAmount.toFixed(2),
      trackerExVatAmount: m.trackerExVatAmount != null ? m.trackerExVatAmount.toFixed(2) : null,
      qbDate: m.qbDate,
      trackerLineId: m.trackerLineId,
      projectId: m.projectId,
      matchType: m.matchType,
      candidateCount: m.candidateCount,
      confidence: m.confidence.toFixed(4),
      matchedAt: now,
    }));
    // Chunked insert keeps the parameter count under driver limits.
    for (let i = 0; i < values.length; i += 500) {
      await dbi.insert(qbProjectMatch).values(values.slice(i, i + 500));
    }
  }

  return {
    generatedAt,
    windowStart: window.start,
    windowEnd: window.end,
    tolerance,
    qbAvailable: true,
    cos: tallyMatches(cosMatches),
    rev: tallyMatches(revMatches),
    rowsWritten: all.length,
  };
}

// ---------------------------------------------------------------------------
// Reads — per-project attribution + coverage + worklist
// ---------------------------------------------------------------------------

/** Rehydrate persisted rows into the matcher shape the rollups consume. */
function rowToMatch(r: typeof qbProjectMatch.$inferSelect): QbProjectMatch {
  return {
    stream: r.stream as MatchStream,
    qbDocId: r.qbDocId,
    docNumber: r.qbDocNumber,
    invoiceNoNorm: r.invoiceNoNorm ?? "",
    qbExVatAmount: toNum(r.qbExVatAmount),
    trackerExVatAmount: r.trackerExVatAmount != null ? toNum(r.trackerExVatAmount) : null,
    qbDate: r.qbDate ? String(r.qbDate) : null,
    matchType: r.matchType as QbProjectMatch["matchType"],
    trackerLineId: r.trackerLineId,
    projectId: r.projectId,
    candidateCount: r.candidateCount,
    confidence: toNum(r.confidence),
    candidateLineIds: [],
  };
}

export interface ProjectAttributionRow {
  projectId: number;
  projectName: string | null;
  cos: ProjectQbAttribution | null;
  rev: ProjectQbAttribution | null;
}

export interface QbProjectAttributionResult {
  generatedAt: string;
  lastMatchedAt: string | null;
  projects: ProjectAttributionRow[];
  unattributed: { cos: UnattributedBucket; rev: UnattributedBucket };
  totals: {
    cosCoveragePct: number;
    revCoveragePct: number;
    qbAttributedExVat: number;
    qbUnattributedExVat: number;
  };
}

export async function getQbProjectAttribution(dbi: DbOrTx): Promise<QbProjectAttributionResult> {
  const rows = (await dbi.select().from(qbProjectMatch)) as Array<typeof qbProjectMatch.$inferSelect>;
  const [cosTracker, revTracker] = await Promise.all([
    loadTrackerLines(dbi, "COS", null),
    loadTrackerLines(dbi, "REV", null),
  ]);

  const cosMatches = rows.filter((r) => r.stream === "COS").map(rowToMatch);
  const revMatches = rows.filter((r) => r.stream === "REV").map(rowToMatch);

  const cosAttr = computeProjectAttribution("COS", cosMatches, cosTracker);
  const revAttr = computeProjectAttribution("REV", revMatches, revTracker);
  const cosUnattr = computeUnattributed("COS", cosMatches);
  const revUnattr = computeUnattributed("REV", revMatches);

  const cosByProject = new Map(cosAttr.map((a) => [a.projectId, a]));
  const revByProject = new Map(revAttr.map((a) => [a.projectId, a]));
  const projectIds = [...new Set<number>([...cosByProject.keys(), ...revByProject.keys()])];

  const names =
    projectIds.length > 0
      ? ((await dbi
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(inArray(projectInfo.id, projectIds))) as Array<{ id: number; projectName: string | null }>)
      : [];
  const nameById = new Map(names.map((n) => [n.id, n.projectName]));

  const projects: ProjectAttributionRow[] = projectIds
    .map((projectId) => ({
      projectId,
      projectName: nameById.get(projectId) ?? null,
      cos: cosByProject.get(projectId) ?? null,
      rev: revByProject.get(projectId) ?? null,
    }))
    .sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? "") || a.projectId - b.projectId);

  const sumCoverage = (attr: ProjectQbAttribution[]): number => {
    const matched = attr.reduce((s, a) => s + a.trackerMatchedExVat, 0);
    const invoiced = attr.reduce((s, a) => s + a.trackerInvoicedExVat, 0);
    return invoiced !== 0 ? round2((matched / invoiced) * 100) : 0;
  };
  const qbAttributedExVat = round2(
    [...cosAttr, ...revAttr].reduce((s, a) => s + a.qbAttributedExVat, 0),
  );
  const qbUnattributedExVat = round2(
    cosUnattr.unmatchedExVat + cosUnattr.ambiguousExVat + revUnattr.unmatchedExVat + revUnattr.ambiguousExVat,
  );

  let lastMatchedAt: string | null = null;
  for (const r of rows) {
    const t = r.matchedAt ? r.matchedAt.toISOString() : null;
    if (t && (!lastMatchedAt || t > lastMatchedAt)) lastMatchedAt = t;
  }

  return {
    generatedAt: new Date().toISOString(),
    lastMatchedAt,
    projects,
    unattributed: { cos: cosUnattr, rev: revUnattr },
    totals: {
      cosCoveragePct: sumCoverage(cosAttr),
      revCoveragePct: sumCoverage(revAttr),
      qbAttributedExVat,
      qbUnattributedExVat,
    },
  };
}

export interface ProjectAttributionDetail {
  projectId: number;
  projectName: string | null;
  cos: ProjectQbAttribution | null;
  rev: ProjectQbAttribution | null;
  matchedDocs: Array<{
    stream: MatchStream;
    qbDocId: string;
    qbDocNumber: string | null;
    qbExVatAmount: number;
    trackerExVatAmount: number | null;
    qbDate: string | null;
    confidence: number;
  }>;
}

export async function getQbProjectAttributionForProject(
  dbi: DbOrTx,
  projectId: number,
): Promise<ProjectAttributionDetail> {
  const [matchRows, costLines, revLines, proj] = await Promise.all([
    dbi
      .select()
      .from(qbProjectMatch)
      .where(eq(qbProjectMatch.projectId, projectId)) as Promise<Array<typeof qbProjectMatch.$inferSelect>>,
    dbi
      .select({ id: normalizedCostLines.id, projectId: normalizedCostLines.projectId, invoiceNumber: normalizedCostLines.invoiceNumber, amountExVat: normalizedCostLines.amountExVat })
      .from(normalizedCostLines)
      .where(and(eq(normalizedCostLines.projectId, projectId), isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))) as Promise<Array<{ id: number; projectId: number | null; invoiceNumber: string | null; amountExVat: string | null }>>,
    dbi
      .select({ id: normalizedRevenueLines.id, projectId: normalizedRevenueLines.projectId, invoiceNumber: normalizedRevenueLines.invoiceNumber, amountExVat: normalizedRevenueLines.amountExVat })
      .from(normalizedRevenueLines)
      .where(and(eq(normalizedRevenueLines.projectId, projectId), isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))) as Promise<Array<{ id: number; projectId: number | null; invoiceNumber: string | null; amountExVat: string | null }>>,
    dbi.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1) as Promise<Array<{ projectName: string | null }>>,
  ]);

  const toTracker = (r: { id: number; projectId: number | null; invoiceNumber: string | null; amountExVat: string | null }): TrackerLineInput => ({
    trackerLineId: r.id,
    projectId: r.projectId as number,
    invoiceNumber: r.invoiceNumber,
    amountExVat: toNum(r.amountExVat),
  });

  const cosMatches = matchRows.filter((r) => r.stream === "COS").map(rowToMatch);
  const revMatches = matchRows.filter((r) => r.stream === "REV").map(rowToMatch);
  const cosAttr = computeProjectAttribution("COS", cosMatches, costLines.map(toTracker));
  const revAttr = computeProjectAttribution("REV", revMatches, revLines.map(toTracker));

  const matchedDocs = matchRows
    .filter((r) => r.matchType === "matched")
    .map((r) => ({
      stream: r.stream as MatchStream,
      qbDocId: r.qbDocId,
      qbDocNumber: r.qbDocNumber,
      qbExVatAmount: toNum(r.qbExVatAmount),
      trackerExVatAmount: r.trackerExVatAmount != null ? toNum(r.trackerExVatAmount) : null,
      qbDate: r.qbDate ? String(r.qbDate) : null,
      confidence: toNum(r.confidence),
    }))
    .sort((a, b) => b.qbExVatAmount - a.qbExVatAmount);

  return {
    projectId,
    projectName: proj[0]?.projectName ?? null,
    cos: cosAttr.find((a) => a.projectId === projectId) ?? null,
    rev: revAttr.find((a) => a.projectId === projectId) ?? null,
    matchedDocs,
  };
}

export interface WorklistRow {
  stream: MatchStream;
  qbDocId: string;
  qbDocNumber: string | null;
  invoiceNoNorm: string | null;
  exVatAmount: number;
  qbDate: string | null;
  matchType: "ambiguous" | "unmatched";
  candidateCount: number;
}

/** Unmatched + ambiguous QB docs — the actionable resolve list for finance. */
export async function getQbProjectMatchWorklist(
  dbi: DbOrTx,
  filter: { stream?: MatchStream; matchType?: "ambiguous" | "unmatched" } = {},
): Promise<WorklistRow[]> {
  const conds = [inArray(qbProjectMatch.matchType, ["ambiguous", "unmatched"])];
  if (filter.stream) conds.push(eq(qbProjectMatch.stream, filter.stream));
  if (filter.matchType) conds.push(eq(qbProjectMatch.matchType, filter.matchType));

  const rows = (await dbi
    .select()
    .from(qbProjectMatch)
    .where(and(...conds))
    .orderBy(desc(qbProjectMatch.qbExVatAmount))) as Array<typeof qbProjectMatch.$inferSelect>;

  return rows.map((r) => ({
    stream: r.stream as MatchStream,
    qbDocId: r.qbDocId,
    qbDocNumber: r.qbDocNumber,
    invoiceNoNorm: r.invoiceNoNorm,
    exVatAmount: toNum(r.qbExVatAmount),
    qbDate: r.qbDate ? String(r.qbDate) : null,
    matchType: r.matchType as "ambiguous" | "unmatched",
    candidateCount: r.candidateCount,
  }));
}
