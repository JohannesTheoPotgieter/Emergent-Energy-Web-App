/* ───────────────────────────────────────────────────────────────────────────
 * FROZEN — finance computation path (CLAUDE.md FREEZE · AGENT_GUARDRAILS § 3B S10).
 * Formula / number / calculation / match-rule changes require explicit owner
 * approval. Number-preserving refactors are allowed only while
 * `npm run verify:finance` and the finance unit tests stay green.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Per-project QuickBooks attribution matcher — PURE logic (no DB, no QB, no app
 * state; safe to unit-test). The orchestration shell lives in
 * server/services/qb-project-match-service.ts.
 *
 * QuickBooks has no project code; the trackers do. We bridge by matching each
 * QB document to tracker line(s) on (normalised invoice number AND ex-VAT amount
 * within tolerance), then the QB doc inherits the matched tracker line's
 * project_id. This is READ/COMPARE only — nothing is written back to QB.
 *
 * Classification per QB document:
 *   matched    — exactly ONE tracker line matches → inherit its project_id.
 *   ambiguous  — MORE THAN ONE tracker line matches → project-less (never pick).
 *   unmatched  — ZERO tracker lines match (or QB doc has no usable number).
 *
 * An amount that differs by more than the tolerance is NOT a match — it falls to
 * `unmatched`, never a wrong attribution. Ambiguous + unmatched are never
 * force-assigned; they roll to the company "unattributed" bucket + worklist.
 *
 * Invoice-number normalisation reuses the shared NORMALIZERS registry and
 * defaults to `digits_no_leading_zeros` — the SAME normalizer the company-wide
 * engine uses (QB_RECON_NORMALIZER in qb-tracker-reconcile.ts) so per-project
 * and company QB attribution agree (Six Rule #3). Both sides ex-VAT.
 */
import { NORMALIZERS } from "./qb-match-rate";

export type MatchStream = "COS" | "REV";
export type ProjectMatchType = "matched" | "ambiguous" | "unmatched";

/** R1 — the ex-VAT tie tolerance shared across finance. Configurable per run. */
export const DEFAULT_MATCH_TOLERANCE = 1;

/** Default invoice-number normalizer — identical to QB_RECON_NORMALIZER. */
export const DEFAULT_NORMALIZER = NORMALIZERS.digits_no_leading_zeros;

export type Normalize = (raw: string | null | undefined) => string;

/** One QuickBooks document reduced to its match key (per-doc grain). */
export interface QbDocInput {
  qbDocId: string;
  docNumber: string | null;
  /** Ex-VAT (TotalAmt − TxnTaxDetail.TotalTax) — reuse the existing QB parse. */
  amountExVat: number;
  date: string | null; // YYYY-MM-DD
}

/** One tracker line (per-line grain) carrying its project_id. */
export interface TrackerLineInput {
  trackerLineId: number;
  projectId: number;
  /** Tracker col S. */
  invoiceNumber: string | null;
  /** Ex-VAT: col U for revenue, col Q for COS. */
  amountExVat: number;
}

export interface QbProjectMatch {
  stream: MatchStream;
  qbDocId: string;
  docNumber: string | null;
  invoiceNoNorm: string;
  qbExVatAmount: number;
  /** The matched tracker line's ex-VAT (null unless matchType === 'matched'). */
  trackerExVatAmount: number | null;
  qbDate: string | null;
  matchType: ProjectMatchType;
  /** Inherited only on a 1:1 match. */
  trackerLineId: number | null;
  projectId: number | null;
  candidateCount: number;
  confidence: number;
  /** Tracker candidate line ids (1 when matched, >1 when ambiguous, [] unmatched). */
  candidateLineIds: number[];
}

export const round2 = (n: number): number => Number(n.toFixed(2));
const round4 = (n: number): number => Number(n.toFixed(4));

/**
 * Confidence for a 1:1 match from amount closeness: 1.0 at an exact amount,
 * falling linearly to 0.5 at the tolerance edge (a match is always ≥ 0.5).
 */
export function matchedConfidence(absDelta: number, tolerance: number): number {
  if (tolerance <= 0) return absDelta === 0 ? 1 : 0;
  return round4(1 - 0.5 * Math.min(absDelta / tolerance, 1));
}

/**
 * Match a stream's QB documents to tracker lines and classify each QB doc.
 * One result per QB document.
 */
export function matchQbDocsToTrackerLines(
  stream: MatchStream,
  qbDocs: readonly QbDocInput[],
  trackerLines: readonly TrackerLineInput[],
  opts: { tolerance?: number; normalize?: Normalize } = {},
): QbProjectMatch[] {
  const tolerance = opts.tolerance ?? DEFAULT_MATCH_TOLERANCE;
  const normalize = opts.normalize ?? DEFAULT_NORMALIZER;

  // Index tracker lines by normalised invoice number (lines with a number).
  const byNumber = new Map<string, TrackerLineInput[]>();
  for (const t of trackerLines) {
    const key = normalize(t.invoiceNumber);
    if (!key) continue; // no usable number → not matchable on number
    const arr = byNumber.get(key);
    if (arr) arr.push(t);
    else byNumber.set(key, [t]);
  }

  return qbDocs.map((qb) => {
    const key = normalize(qb.docNumber);
    const qbExVatAmount = round2(qb.amountExVat);
    const base = {
      stream,
      qbDocId: qb.qbDocId,
      docNumber: qb.docNumber,
      invoiceNoNorm: key,
      qbExVatAmount,
      qbDate: qb.date ?? null,
    };

    // No usable number on the QB side → cannot match on number → unmatched.
    const sameNumber = key ? byNumber.get(key) ?? [] : [];
    // Match gate: number already equal (same bucket) AND amount within tolerance.
    const candidates = sameNumber.filter(
      (t) => Math.abs(round2(t.amountExVat - qbExVatAmount)) <= tolerance,
    );

    if (candidates.length === 1) {
      const t = candidates[0]!;
      const absDelta = Math.abs(round2(t.amountExVat - qbExVatAmount));
      return {
        ...base,
        trackerExVatAmount: round2(t.amountExVat),
        matchType: "matched" as const,
        trackerLineId: t.trackerLineId,
        projectId: t.projectId,
        candidateCount: 1,
        confidence: matchedConfidence(absDelta, tolerance),
        candidateLineIds: [t.trackerLineId],
      };
    }
    if (candidates.length > 1) {
      return {
        ...base,
        trackerExVatAmount: null,
        matchType: "ambiguous" as const,
        trackerLineId: null,
        projectId: null,
        candidateCount: candidates.length,
        confidence: 0,
        candidateLineIds: candidates.map((c) => c.trackerLineId),
      };
    }
    return {
      ...base,
      trackerExVatAmount: null,
      matchType: "unmatched" as const,
      trackerLineId: null,
      projectId: null,
      candidateCount: 0,
      confidence: 0,
      candidateLineIds: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Per-project attribution + explicit coverage
// ---------------------------------------------------------------------------

export interface ProjectQbAttribution {
  projectId: number;
  stream: MatchStream;
  /** Σ QB ex-VAT over docs matched to this project (the attributed QB figure). */
  qbAttributedExVat: number;
  /** Σ tracker ex-VAT over this project's matched lines (each line once). */
  trackerMatchedExVat: number;
  /** Σ tracker ex-VAT over ALL this project's INVOICED lines (the denominator). */
  trackerInvoicedExVat: number;
  /** matched ÷ invoiced × 100 — the explicit coverage. */
  coveragePct: number;
  /** tracker − qb on matched lines only (signed). */
  varianceExVat: number;
  matchedDocCount: number;
  /** True only when coverage reaches 100% — otherwise "matched portion only". */
  complete: boolean;
}

/**
 * Roll matches to per-project attribution with EXPLICIT coverage. The
 * denominator is the project's total invoiced tracker value (lines that carry a
 * usable invoice number), so coverage honestly reflects how much of the project
 * found a QB counterpart. Matched tracker value counts each line once even if
 * two QB docs matched it, so coverage can never exceed 100%.
 */
export function computeProjectAttribution(
  stream: MatchStream,
  matches: readonly QbProjectMatch[],
  trackerLines: readonly TrackerLineInput[],
  opts: { normalize?: Normalize } = {},
): ProjectQbAttribution[] {
  const normalize = opts.normalize ?? DEFAULT_NORMALIZER;

  const trackerById = new Map<number, TrackerLineInput>();
  const invoicedByProject = new Map<number, number>();
  for (const t of trackerLines) {
    trackerById.set(t.trackerLineId, t);
    if (!normalize(t.invoiceNumber)) continue; // only invoiced lines count
    invoicedByProject.set(t.projectId, (invoicedByProject.get(t.projectId) ?? 0) + t.amountExVat);
  }

  const qbAttr = new Map<number, number>();
  const matchedDocs = new Map<number, number>();
  const matchedLineIds = new Map<number, Set<number>>();
  for (const m of matches) {
    if (m.matchType !== "matched" || m.projectId == null || m.trackerLineId == null) continue;
    qbAttr.set(m.projectId, (qbAttr.get(m.projectId) ?? 0) + m.qbExVatAmount);
    matchedDocs.set(m.projectId, (matchedDocs.get(m.projectId) ?? 0) + 1);
    const set = matchedLineIds.get(m.projectId) ?? new Set<number>();
    set.add(m.trackerLineId);
    matchedLineIds.set(m.projectId, set);
  }

  const projectIds = new Set<number>([...invoicedByProject.keys(), ...qbAttr.keys()]);
  const out: ProjectQbAttribution[] = [];
  for (const projectId of projectIds) {
    const trackerInvoicedExVat = round2(invoicedByProject.get(projectId) ?? 0);
    let trackerMatchedExVat = 0;
    for (const lineId of matchedLineIds.get(projectId) ?? []) {
      trackerMatchedExVat += trackerById.get(lineId)?.amountExVat ?? 0;
    }
    trackerMatchedExVat = round2(trackerMatchedExVat);
    const qbAttributedExVat = round2(qbAttr.get(projectId) ?? 0);
    const coveragePct =
      trackerInvoicedExVat !== 0 ? round2((trackerMatchedExVat / trackerInvoicedExVat) * 100) : 0;
    out.push({
      projectId,
      stream,
      qbAttributedExVat,
      trackerMatchedExVat,
      trackerInvoicedExVat,
      coveragePct,
      varianceExVat: round2(trackerMatchedExVat - qbAttributedExVat),
      matchedDocCount: matchedDocs.get(projectId) ?? 0,
      complete: trackerInvoicedExVat !== 0 && coveragePct >= 100,
    });
  }
  return out.sort((a, b) => a.projectId - b.projectId);
}

// ---------------------------------------------------------------------------
// Company "unattributed" bucket — never silently dropped
// ---------------------------------------------------------------------------

export interface UnattributedBucket {
  stream: MatchStream;
  unmatchedExVat: number;
  unmatchedCount: number;
  ambiguousExVat: number;
  ambiguousCount: number;
}

/** QB docs that found no single project — kept visible at company grain. */
export function computeUnattributed(
  stream: MatchStream,
  matches: readonly QbProjectMatch[],
): UnattributedBucket {
  let unmatchedExVat = 0;
  let unmatchedCount = 0;
  let ambiguousExVat = 0;
  let ambiguousCount = 0;
  for (const m of matches) {
    if (m.matchType === "unmatched") {
      unmatchedExVat += m.qbExVatAmount;
      unmatchedCount += 1;
    } else if (m.matchType === "ambiguous") {
      ambiguousExVat += m.qbExVatAmount;
      ambiguousCount += 1;
    }
  }
  return {
    stream,
    unmatchedExVat: round2(unmatchedExVat),
    unmatchedCount,
    ambiguousExVat: round2(ambiguousExVat),
    ambiguousCount,
  };
}

export interface MatchCounts {
  matched: number;
  ambiguous: number;
  unmatched: number;
  total: number;
}

/** Headline counts for a run summary / report. */
export function tallyMatches(matches: readonly QbProjectMatch[]): MatchCounts {
  const counts = { matched: 0, ambiguous: 0, unmatched: 0, total: matches.length };
  for (const m of matches) counts[m.matchType] += 1;
  return counts;
}
