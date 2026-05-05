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
 *   1. Already linked (route layer detects via DB; matcher returns 100)
 *   2. Exact invoice number (normalized) + amount within tolerance        → 95
 *   3. Exact invoice number only                                          → 85
 *   4. Amount within tolerance + counterparty Jaccard ≥ 0.6 + same month  → 78
 *   5. Counterparty Jaccard ≥ 0.6 + amount within 5% + ±60 days           → 62
 *   6. Counterparty Jaccard > 0 (any amount)                              → 45
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

/** Date proximity in days for tier 5. */
const DATE_PROXIMITY_DAYS = 60;

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
  // Tier 4 — amount exact + name strong + same month
  else if (amountExact && nameStrong && monthMatch) {
    confidence = 78;
    reasons.push("amount within R0.01", `vendor ${Math.round(sim * 100)}% match`, "same month");
  }
  // Tier 4b — amount exact only (no name/month required)
  else if (amountExact) {
    confidence = 68;
    reasons.push("amount within R0.01");
    if (!nameStrong) warnings.push("vendor_not_matched");
  }
  // Tier 5 — name strong + amount fuzzy + ±60 days
  else if (nameStrong && amountFuzzy && dateClose) {
    confidence = 62;
    reasons.push(
      `vendor ${Math.round(sim * 100)}% match`,
      "amount within 5%",
      `${dayDiff}d apart`,
    );
  }
  // Tier 5b — amount fuzzy only (no name required)
  else if (amountFuzzy) {
    confidence = 50;
    reasons.push("amount within 5%");
    if (!nameStrong) warnings.push("vendor_not_matched");
  }
  // Tier 6 — any name overlap (lowest)
  else if (sim > 0) {
    confidence = 45;
    reasons.push(`vendor ${Math.round(sim * 100)}% match`);
    if (!amountFuzzy) warnings.push("amount_mismatch");
    if (sim < NAME_SIM_FLOOR) warnings.push("vendor_mismatch");
  } else {
    return null;
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
