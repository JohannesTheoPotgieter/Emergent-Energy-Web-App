/**
 * Pure fuzzy-match scoring for "Find QB Matches" — pairs a single app
 * cost line (or revenue line) against a list of candidate QuickBooks
 * documents and returns ranked candidates with confidence + reasons +
 * warnings.
 *
 * No I/O; the route layer is responsible for loading the app row and the
 * QB document list. This keeps the matcher easy to unit-test and free of
 * hidden coupling with the connector / DB.
 *
 * SCORING HIERARCHY (highest first)
 *   Priority order — INVOICE NUMBER → DESCRIPTION → AMOUNT → VENDOR NAME
 *
 *   1.  Already linked (route layer detects via DB; matcher returns 100)
 *   2.  Exact invoice number (normalized) + amount within tolerance        → 95
 *   3.  Exact invoice number only                                          → 85
 *   4.  Description Jaccard ≥ 0.6 + amount within tolerance                → 80
 *   5.  Description Jaccard ≥ 0.6 + amount within 5%                       → 72
 *   6.  Description Jaccard ≥ 0.6 (any amount)                             → 65
 *   7.  Amount within tolerance + counterparty Jaccard ≥ 0.6 + same month  → 60
 *   8.  Description Jaccard ≥ 0.3 + amount within tolerance                → 58
 *   9.  Amount within tolerance only                                       → 55
 *  10.  Counterparty Jaccard ≥ 0.6 + amount within 5% + ±60 days           → 45
 *  11.  Amount within 5% only                                              → 40
 *  12.  Description Jaccard ≥ 0.3 (any amount)                             → 35
 *  13.  Counterparty Jaccard > 0 (any amount)                              → 32
 *  14.  Learned-pattern hit only (no other signal)                         → 28
 *
 * THRESHOLDS (consumed by frontend banding):
 *   - 90+ : high confidence (still requires user approval)
 *   - 70–89: medium
 *   - <70 : low
 *
 * The service NEVER auto-approves a match. It only ranks candidates.
 */

export interface AppInvoiceLike {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  amountExVat: number | null;
  counterpartyName: string | null;
  poNumber?: string | null; // cost-side only; null on revenue lines
  /**
   * Free-text description of the app line — vendor description for cost,
   * milestone/description for revenue. Surfaced verbatim in the proof
   * drawer alongside the QB doc memo so reviewers can sanity-check what
   * they're matching.
   */
  description?: string | null;
}

export interface QbCandidateLike {
  qbEntityId: string;
  qbEntityType: "bill" | "invoice";
  qbDocNumber: string | null;
  qbTxnDate: string | null; // YYYY-MM-DD
  qbCounterpartyName: string | null;
  /** QB VendorRef.value (cost) or CustomerRef.value (revenue) for mapping upserts. */
  qbCounterpartyId: string | null;
  /** Ex-VAT amount in app currency. Required for amount comparison. */
  qbAmountExVat: number | null;
  qbBalance: number | null;
  qbPaymentStatus: string | null; // 'paid' | 'partial' | 'unpaid' | null
  /** QB doc memo / PrivateNote — shown in the proof drawer for context. */
  qbDescription: string | null;
  /**
   * Phase 2 — learned-pattern hits precomputed by the route layer.
   * Each entry references an active `invoice_pattern_rules` /
   * `invoice_description_patterns` row that matched this candidate against
   * the app row's counterparty. Triggers a tier-2.5 +12 confidence boost
   * and is surfaced in the audit trail so timesConfirmed / timesOverridden
   * counters can be updated when the user approves / declines.
   */
  learnedPatternMatches?: LearnedPatternMatch[];
}

export interface LearnedPatternMatch {
  source: "invoice_number" | "description";
  ruleId: number;
  /** Token-set Jaccard for description rules; 1.0 for exact invoice-number prefix. */
  similarity: number;
  /** Display label surfaced in the candidate reasons list. */
  label: string;
}

export interface ScoredCandidate {
  qbEntityId: string;
  qbEntityType: "bill" | "invoice";
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbCounterpartyName: string | null;
  /** QB VendorRef.value (cost) or CustomerRef.value (revenue) — used by the
   *  approve endpoint to upsert a vendor/customer mapping when the caller opts in. */
  qbCounterpartyId: string | null;
  qbAmountExVat: number | null;
  qbBalance: number | null;
  qbPaymentStatus: string | null;
  /** QB doc memo / PrivateNote — passed through from the candidate. */
  qbDescription: string | null;
  confidence: number; // 0–100
  reasons: string[];
  warnings: string[]; // per-candidate flags surfaced in the UI
  /** Phase 2 — pattern rules that boosted this candidate. Persisted on the
   *  suggestion so timesConfirmed / timesOverridden can be updated when the
   *  user approves / declines. */
  learnedPatternMatches?: LearnedPatternMatch[];
}

export interface InvoiceMatchWarnings {
  /** App-side flag — invoice has no PO number (cost-side red flag). */
  no_po: boolean;
  /** App row has any active QB link already. */
  already_linked: boolean;
}

// =========================================================================
// Tunables
// =========================================================================

/** Amount equality within 1 cent counts as an exact match. */
const AMOUNT_EXACT_TOL = 0.01;

/** Amount equality within 5% counts as a fuzzy match (used in tier 5). */
const AMOUNT_FUZZY_REL = 0.05;

/** Counterparty token overlap below this is treated as "not the same vendor". */
const NAME_SIM_FLOOR = 0.6;

/** Date proximity in days for tier 10. */
const DATE_PROXIMITY_DAYS = 60;

/**
 * Description / memo token-set Jaccard ≥ this counts as a "strong"
 * description match — same Jaccard floor as counterparty so behaviour is
 * predictable for reviewers.
 */
const DESC_SIM_STRONG = 0.6;

/**
 * Lower threshold — a "partial" description hit. Surfaces as a low-tier
 * reason so reviewers can still see when memo language overlaps weakly
 * (e.g. one shared meaningful token like "diesel" or "milestone").
 */
const DESC_SIM_FUZZY = 0.3;

// =========================================================================
// Pure helpers (no Date/Intl side effects, deterministic)
// =========================================================================

export function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normTokens(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  const cleaned = value
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return new Set(cleaned.split(" ").filter((t) => t.length >= 2));
}

/** Token-set Jaccard similarity (0–1). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const aTok = normTokens(a);
  const bTok = normTokens(b);
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = aTok.size + bTok.size - inter;
  return union === 0 ? 0 : inter / union;
}

function amountWithinAbs(a: number | null, b: number | null, tol: number): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tol;
}

function amountWithinRel(a: number | null, b: number | null, rel: number): boolean {
  if (a === null || b === null) return false;
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return false;
  return Math.abs(a - b) / denom <= rel;
}

function sameMonth(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 7) === b.slice(0, 7); // YYYY-MM
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

// =========================================================================
// Scoring
// =========================================================================

/**
 * Score a single (app row, QB candidate) pair. Returns null if the pair
 * has zero overlap on every dimension we care about (saves the caller
 * from filtering empties).
 */
export function scoreInvoiceMatch(
  app: AppInvoiceLike,
  qb: QbCandidateLike,
): ScoredCandidate | null {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const appInv = normalizeInvoiceNumber(app.invoiceNumber);
  const qbInv = normalizeInvoiceNumber(qb.qbDocNumber);
  const invoiceExact = !!appInv && !!qbInv && appInv === qbInv;

  const amountExact = amountWithinAbs(app.amountExVat, qb.qbAmountExVat, AMOUNT_EXACT_TOL);
  const amountFuzzy = amountWithinRel(app.amountExVat, qb.qbAmountExVat, AMOUNT_FUZZY_REL);

  const sim = nameSimilarity(app.counterpartyName, qb.qbCounterpartyName);
  const nameStrong = sim >= NAME_SIM_FLOOR;

  // Description / memo similarity — same token-set Jaccard helper used for
  // counterparty names. Compares the app line's free-text description
  // (vendor description for cost lines, milestone/description for revenue)
  // against the QB doc's memo / PrivateNote. Promoted above the amount
  // tiers per the operator-requested priority order:
  //   invoice number → description → amount → vendor name.
  const descSim = nameSimilarity(app.description, qb.qbDescription);
  const descStrong = descSim >= DESC_SIM_STRONG;
  const descFuzzy = descSim >= DESC_SIM_FUZZY;

  const monthMatch = sameMonth(app.invoiceDate, qb.qbTxnDate);
  const dayDiff = daysBetween(app.invoiceDate, qb.qbTxnDate);
  const dateClose = dayDiff !== null && dayDiff <= DATE_PROXIMITY_DAYS;

  let confidence = 0;

  // Tier 2 — exact invoice number AND amount within tolerance
  if (invoiceExact && amountExact) {
    confidence = 95;
    reasons.push("invoice number exact match", "amount within R0.01");
  }
  // Tier 3 — exact invoice number only
  else if (invoiceExact) {
    confidence = 85;
    reasons.push("invoice number exact match");
    if (!amountFuzzy) warnings.push("amount_mismatch");
  }
  // Tier 4 — strong description match + amount exact
  else if (descStrong && amountExact) {
    confidence = 80;
    reasons.push(
      `description ${Math.round(descSim * 100)}% match`,
      "amount within R0.01",
    );
  }
  // Tier 5 — strong description match + amount fuzzy
  else if (descStrong && amountFuzzy) {
    confidence = 72;
    reasons.push(
      `description ${Math.round(descSim * 100)}% match`,
      "amount within 5%",
    );
  }
  // Tier 6 — strong description match only
  else if (descStrong) {
    confidence = 65;
    reasons.push(`description ${Math.round(descSim * 100)}% match`);
    warnings.push("amount_mismatch");
  }
  // Tier 7 — amount exact + name strong + same month
  else if (amountExact && nameStrong && monthMatch) {
    confidence = 60;
    reasons.push("amount within R0.01", `vendor ${Math.round(sim * 100)}% match`, "same month");
  }
  // Tier 8 — partial description match + amount exact
  // (placed ABOVE the amount-only tier so a partial memo hit still
  //  outranks a same-amount candidate with unrelated text — preserves
  //  the operator-requested invoice → description → amount ordering
  //  even for fuzzy description matches.)
  else if (descFuzzy && amountExact) {
    confidence = 58;
    reasons.push(
      `description ${Math.round(descSim * 100)}% partial`,
      "amount within R0.01",
    );
  }
  // Tier 9 — amount exact only (no name/month/description required)
  else if (amountExact) {
    confidence = 55;
    reasons.push("amount within R0.01");
    if (!nameStrong) warnings.push("vendor_not_matched");
  }
  // Tier 10 — name strong + amount fuzzy + ±60 days
  else if (nameStrong && amountFuzzy && dateClose) {
    confidence = 45;
    reasons.push(
      `vendor ${Math.round(sim * 100)}% match`,
      "amount within 5%",
      `${dayDiff}d apart`,
    );
  }
  // Tier 11 — amount fuzzy only (no name required)
  else if (amountFuzzy) {
    confidence = 40;
    reasons.push("amount within 5%");
    if (!nameStrong) warnings.push("vendor_not_matched");
  }
  // Tier 12 — partial description match only
  else if (descFuzzy) {
    confidence = 35;
    reasons.push(`description ${Math.round(descSim * 100)}% partial`);
    warnings.push("amount_mismatch");
    if (!nameStrong) warnings.push("vendor_not_matched");
  }
  // Tier 13 — any name overlap (lowest direct-signal tier)
  else if (sim > 0) {
    confidence = 32;
    reasons.push(`vendor ${Math.round(sim * 100)}% match`);
    if (!amountFuzzy) warnings.push("amount_mismatch");
    if (sim < NAME_SIM_FLOOR) warnings.push("vendor_mismatch");
  }
  // Tier 14 — learned-pattern match with zero other signal. Common when a
  // vendor's QB record carries a different name than the app counterparty
  // but the memo / invoice-prefix matches a fingerprint we've already
  // approved. Surfaces as a low-confidence candidate with the learned
  // reason — the reviewer still has the call.
  else if ((qb.learnedPatternMatches ?? []).length > 0) {
    confidence = 28;
    reasons.push("learned pattern match (no other signal)");
    if (!amountFuzzy) warnings.push("amount_mismatch");
    warnings.push("vendor_mismatch");
  } else {
    return null;
  }

  // Tier-2.5 — learned-pattern boost. When the route precomputed pattern
  // matches against active `invoice_pattern_rules` /
  // `invoice_description_patterns` rows for the app row's counterparty,
  // each match adds +6 confidence (capped at +12 for two or more matches)
  // and surfaces a "learned pattern" reason. This is what makes the
  // matcher get smarter as finance approves more bills from the same
  // vendor — it's the "auto-suggest similar invoices for approval" loop
  // the user explicitly asked for.
  const learnedMatches = qb.learnedPatternMatches ?? [];
  if (learnedMatches.length > 0) {
    const boost = Math.min(12, learnedMatches.length * 6);
    confidence = Math.min(100, confidence + boost);
    for (const m of learnedMatches) {
      reasons.push(`learned: ${m.label}`);
    }
  }

  // Date warnings — surface date mismatches so the reviewer is aware
  if (app.invoiceDate && qb.qbTxnDate && !monthMatch) {
    warnings.push("date_mismatch");
    if (dayDiff !== null) {
      reasons.push(`${dayDiff}d apart`);
    }
  }

  // Universal warnings layered on top
  if (
    qb.qbPaymentStatus === "paid" &&
    qb.qbBalance !== null &&
    qb.qbBalance > 0
  ) {
    warnings.push("qb_payment_inconsistent");
  }
  if (qb.qbAmountExVat === null) {
    warnings.push("qb_amount_unknown");
  }

  return {
    qbEntityId: qb.qbEntityId,
    qbEntityType: qb.qbEntityType,
    qbDocNumber: qb.qbDocNumber,
    qbTxnDate: qb.qbTxnDate,
    qbCounterpartyName: qb.qbCounterpartyName,
    qbCounterpartyId: qb.qbCounterpartyId,
    qbAmountExVat: qb.qbAmountExVat,
    qbBalance: qb.qbBalance,
    qbPaymentStatus: qb.qbPaymentStatus,
    qbDescription: qb.qbDescription,
    confidence,
    reasons,
    warnings,
    learnedPatternMatches: learnedMatches.length > 0 ? learnedMatches : undefined,
  };
}

/**
 * Rank a list of QB candidates against one app row. Returns up to `topN`
 * results sorted by confidence descending. Caller filters out QB IDs that
 * are already linked to a different app row before passing in (set
 * `qb_already_linked_elsewhere` warning at the route layer).
 */
export function rankInvoiceMatches(
  app: AppInvoiceLike,
  qbCandidates: QbCandidateLike[],
  topN = 10,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const qb of qbCandidates) {
    const scored = scoreInvoiceMatch(app, qb);
    if (scored) out.push(scored);
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, topN);
}

/**
 * Universal app-side warnings that don't depend on a specific candidate.
 * Surfaced once per app row, not per candidate.
 */
export function appSideWarnings(
  app: AppInvoiceLike,
  scope: "cost" | "revenue",
  hasActiveLink: boolean,
): InvoiceMatchWarnings {
  return {
    no_po: scope === "cost" && !app.poNumber,
    already_linked: hasActiveLink,
  };
}

/** Confidence bands used by the UI for colouring. */
export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 90) return "high";
  if (confidence >= 70) return "medium";
  return "low";
}
