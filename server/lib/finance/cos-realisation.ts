/* ───────────────────────────────────────────────────────────────────────────
 * FROZEN — finance computation path (CLAUDE.md FREEZE · AGENT_GUARDRAILS § 3B S10).
 * `isCanonicalCosRealised` is the SINGLE COS-realisation gate (§ 3.2). Formula /
 * number / calculation changes require explicit owner approval. Number-preserving
 * refactors are allowed only while `npm run verify:finance` and the finance unit
 * tests stay green. Do not re-litigate the realisation rule here.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface CosLineInput {
  status: string | null;
  cosStatusOverride: string | null;
  cosRealised: boolean | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePoNumber: string | null;
  paymentDate: string | null;
  today: string;
  /** Actual cost amount. When provided, zero-amount lines are not considered realised. */
  amountExVat?: string | number | null;
  /**
   * Invoice-date confirmation signal from the source sheet.
   *   - 'black' = finance has confirmed the invoice date (realised gate satisfied)
   *   - 'red'   = invoice date captured but not yet confirmed (NOT realised)
   * When the column is missing entirely, callers may also pass
   * invoiceDateConfirmed instead. If neither field is supplied the function
   * falls back to the legacy invoice-only behaviour for backward compatibility.
   */
  invoiceDateFontColor?: string | null;
  /** Boolean equivalent of black-font confirmation. */
  invoiceDateConfirmed?: boolean | null;
  /** Allocation-aware QB evidence total assigned to this line (ex-VAT). */
  lineAssignedQbExVat?: number | null;
  /** Optional precomputed line amount (ex-VAT). Falls back to amountExVat. */
  lineAmountExVat?: number | null;
}

/**
 * Placeholder invoice values that do not indicate a captured supplier invoice.
 * Used both here (runtime check) and in the normalizer (import-time derivation).
 */
export const PLACEHOLDER_INVOICES = new Set([
  "tbc", "tba", "pending", "n/a", "to follow", "to be confirmed",
  "000", "0", "na", "none", "-", "tbd",
]);

/**
 * Admin override sets for manual COS status control.
 * These are the ONLY values that can force realisation or block it via override.
 */
export const OVERRIDE_REALISED = new Set(["COS REALISED", "REALISED"]);
export const OVERRIDE_NOT_REALISED = new Set(["PLANNED", "COMMITTED", "INVOICED", "APPROVED", "PAID"]);

/**
 * Parse a date-ish string to a UTC epoch (day precision), or null when the
 * value is empty/unparseable. Fast-paths ISO `YYYY-MM-DD` (the normalizer /
 * tracker format) to avoid timezone drift; falls back to Date.parse otherwise.
 * Returning null on bad input lets the future-date guard SKIP rather than
 * wrongly block realisation on a malformed date.
 */
function toEpochDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Canonical COS Realisation Check — SINGLE SOURCE OF TRUTH
 *
 * Business rules (do not reinterpret):
 *   1. Admin override takes absolute precedence.
 *   2. Invoice number must be a valid (non-placeholder) supplier invoice.
 *   3. Invoice date must be CONFIRMED. Confirmation comes from one of:
 *        - invoiceDateFontColor === 'black' (finance team's manual signal),
 *        - invoiceDateConfirmed === true.
 *      Red font means the date is captured but not yet confirmed → NOT
 *      realised. This is the gate that prevents the COS Tracker / Revenue
 *      Tracker / dashboards from over-counting unconfirmed lines.
 *   4. PO is NOT the gate for realisation.
 *   5. Invoice without PO is a red flag but does NOT block realisation.
 *   6. Status labels alone do NOT determine realisation.
 *   7. "Committed from prior month" does NOT silently become realised
 *      unless it has an invoice + black-font date.
 *   8. cosRealised boolean flag is respected as backward-compatible signal
 *      for legacy rows that were correctly marked during import.
 *
 * Backward compat: if the caller does NOT supply ANY confirmation signal
 * (invoiceDateFontColor === undefined AND invoiceDateConfirmed === undefined)
 * the function falls back to the legacy invoice-only behaviour. Once a
 * caller starts providing either field the strict gate engages. New callers
 * should always pass the confirmation fields.
 *
 * The `today` parameter is the as-at date for the future-date guard (step 2b):
 * an invoice dated AFTER `today` has not been incurred yet, so it is Committed
 * /Planned — not Realised. When `today` is omitted or unparseable the guard
 * falls back to the current date (a live "realised as of now" read). Month
 * bucketing for period reporting remains a separate concern handled by
 * getCosEffectiveDateAndSource().
 */
export function isCanonicalCosRealised(input: CosLineInput): boolean {
  // 1. Admin override takes absolute precedence.
  const override = (input.cosStatusOverride ?? "").toUpperCase().trim();
  if (OVERRIDE_REALISED.has(override)) return true;
  if (OVERRIDE_NOT_REALISED.has(override)) return false;

  // 2. QB evidence is truth. When a QB bill has been captured (and allocated
  //    to this line) the line is realised regardless of Excel font-colour
  //    ambiguity. Excel font-colour remains the fallback when QB is silent.
  const qbEvidence =
    typeof input.lineAssignedQbExVat === "number" && Number.isFinite(input.lineAssignedQbExVat)
      ? input.lineAssignedQbExVat
      : 0;
  if (qbEvidence > 0) return true;

  // 2b. Future-MONTH guard (owner decision 2026-06, revised 2026-06-05).
  //     A line whose invoice date falls in a month AFTER the as-at month has
  //     not been incurred yet — it is Committed/Planned, not Realised.
  //
  //     The guard is MONTH-granular, not day-granular: the tracker books a
  //     month's costs at the month-END date (e.g. 30 June), so a day-level
  //     "after today" check would hold the CURRENT month at zero until its
  //     final day even after finance has confirmed those lines. Once the as-at
  //     date has REACHED a month, that month's lines clear this guard and the
  //     confirmation gate (step 3b) decides realisation as usual. Only LATER
  //     months are excluded, so this does not re-introduce the cross-month
  //     over-counting the original guard removed.
  //
  //     Admin override (step 1) and QB evidence (step 2) are checked ABOVE and
  //     still win: an explicitly-confirmed or QB-billed cost can realise even
  //     when the tracker's invoice date is in a future month.
  let asAtEpoch = toEpochDay(input.today);
  if (asAtEpoch === null) {
    const now = new Date();
    asAtEpoch = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  const asAtDate = new Date(asAtEpoch);
  // First day of the month AFTER the as-at month. Any invoice dated on/after
  // this lands in a future month and is not yet incurred.
  const nextMonthStart = Date.UTC(
    asAtDate.getUTCFullYear(),
    asAtDate.getUTCMonth() + 1,
    1,
  );
  const invoiceEpoch = toEpochDay(input.expenseInvoicedDate);
  if (invoiceEpoch !== null && invoiceEpoch >= nextMonthStart) {
    return false;
  }

  // 3. Invoice number check — must be a valid (non-placeholder) supplier invoice.
  //    Status labels (INVOICED, PAID, etc.) do NOT independently gate this.
  const invoiceTrimmed = (input.expenseInvoiceNumber ?? "").trim();
  const hasInvoice = !!invoiceTrimmed;
  const isPlaceholder = hasInvoice && PLACEHOLDER_INVOICES.has(invoiceTrimmed.toLowerCase());

  if (hasInvoice && !isPlaceholder) {
    // 3a. Zero-amount lines are not realised (no actual cost = nothing to realise).
    if (input.amountExVat !== undefined && input.amountExVat !== null) {
      const amount = typeof input.amountExVat === "number" ? input.amountExVat : parseFloat(String(input.amountExVat));
      if (!isNaN(amount) && amount === 0) return false;
    }

    // 3b. Invoice-date-confirmed gate. Black font OR confirmed=true.
    //     If neither field is supplied the caller is on the legacy contract
    //     and we fall through to the old "invoice alone = realised" rule.
    const fontColorProvided = input.invoiceDateFontColor !== undefined;
    const confirmedProvided = input.invoiceDateConfirmed !== undefined;
    if (fontColorProvided || confirmedProvided) {
      const blackFont = String(input.invoiceDateFontColor ?? "").toLowerCase() === "black";
      const confirmedFlag = input.invoiceDateConfirmed === true;
      return blackFont || confirmedFlag;
    }

    return true;
  }

  // 4. Legacy cosRealised boolean — backward-compatible signal for rows
  //    that were marked during import. Respected but should be migrated
  //    to invoice-based tracking over time.
  if (input.cosRealised === true) return true;

  return false;
}

/**
 * Diagnostic: flags risk conditions on a COS line.
 * Call after isCanonicalCosRealised() returns true to surface data-quality warnings.
 *
 * Possible warnings:
 *   - INVOICE_WITHOUT_PO: Invoice captured but no PO on file (red flag per business rules)
 *   - INVOICE_WITHOUT_DATE: Invoice number present but no invoice date — realised for
 *     totals but cannot be month-bucketed (the open edge case)
 */
export function getCosRealisationWarnings(input: CosLineInput): string[] {
  const warnings: string[] = [];
  if (!isCanonicalCosRealised(input)) return warnings;

  const hasInvoice = !!(input.expenseInvoiceNumber && input.expenseInvoiceNumber.trim());
  const hasInvoiceDate = !!(input.expenseInvoicedDate && input.expenseInvoicedDate.trim());
  const hasPo = !!(input.expensePoNumber && input.expensePoNumber.trim());

  const invoiceTrimmedW = (input.expenseInvoiceNumber ?? "").trim();
  const isPlaceholderW = !!invoiceTrimmedW && PLACEHOLDER_INVOICES.has(invoiceTrimmedW.toLowerCase());

  const qbEvidence =
    typeof input.lineAssignedQbExVat === "number" && Number.isFinite(input.lineAssignedQbExVat)
      ? input.lineAssignedQbExVat
      : 0;

  if (isPlaceholderW) {
    warnings.push("PLACEHOLDER_INVOICE");
  }
  if (hasInvoice && !hasPo) {
    warnings.push("INVOICE_WITHOUT_PO");
  }
  if (hasInvoice && !hasInvoiceDate) {
    warnings.push("INVOICE_WITHOUT_DATE");
  }

  // H7: flag lines that are realised via Excel font-colour only (no QB
  // evidence). These are lower-confidence realisations per policy:
  // "QB if captured is truth; red is still used in Excel as a fallback."
  const fontOnly =
    qbEvidence <= 0 &&
    hasInvoice &&
    !isPlaceholderW &&
    (String(input.invoiceDateFontColor ?? "").toLowerCase() === "black" ||
      input.invoiceDateConfirmed === true);
  if (fontOnly) {
    warnings.push("REALISED_BY_FONT_COLOR_ONLY");
  }

  return warnings;
}

/**
 * Past-month auto-promote check (C001).
 *
 * Returns true iff the line:
 *   - sits in a closed month (monthKey strictly < currentMonthKey),
 *   - has a non-empty, non-placeholder invoice number,
 *   - has NOT been admin-overridden to a not-realised status.
 *
 * Mirrors the override + placeholder gates in `isCanonicalCosRealised` so
 * past-month lines respect explicit finance intent (overrides) and don't get
 * promoted on placeholder values like "TBC" / "N/A".
 *
 * Rationale: font-colour confirmation is a current-month vetting heuristic
 * that stops being meaningful once finance has moved on. Without this rule
 * historical invoice-bearing rows sit in "Committed" limbo forever and the
 * COS Tracker drifts from QuickBooks.
 */
export function isPastMonthAutoRealised(
  _exp: { cosStatusOverride?: string | null; expenseInvoiceNumber?: string | null } & Record<string, any>,
  _monthKey: string | null,
  _currentMonthKey: string,
): boolean {
  // NEUTRALISED — owner decision 2026-06 (RECON_FINDINGS C1 / IMPORTER_AUDIT C1).
  //
  // This previously auto-promoted ANY invoice-bearing line in a closed month to
  // "realised" regardless of the invoice-date colour, overriding the canonical
  // red/black signal (§3.2) for every closed month and overstating Realised vs
  // Committed. The realisation gate is now COLOUR-GATED FOR ALL MONTHS: a red
  // invoice-date stays Committed even in a closed month. Retained as a no-op so
  // existing call sites keep routing through the single canonical gate.
  //
  // If a "reconcile-to-QuickBooks" promotion is wanted later, model it as a
  // distinct, visible state driven by QB evidence (lineAssignedQbExVat) — never
  // a blanket date override.
  return false;
}

/**
 * Effective realised gate used by COS Tracker, Revenue Tracker, and every
 * downstream reporting surface that needs to know "is this line realised
 * for the period it sits in?".
 *
 * Combines:
 *   - past-month auto-promote (closed-month invoiced lines), and
 *   - canonical strict realisation (font-colour confirmed),
 *
 * with a current-month boundary guard so future-dated realised lines do not
 * leak into the current period.
 *
 * Pass the line, its CoS month-key (from getCosEffectiveDateAndSource), and
 * the *current* month key in UTC. The two month-keys MUST be on the same UTC
 * anchor or aggregate vs per-project views will disagree.
 */
export function isEffectivelyRealised(
  exp: any,
  monthKey: string | null,
  currentMonthKey: string,
): boolean {
  // Colour-gated for ALL months (owner decision 2026-06, §3.2): realisation
  // requires invoice captured + invoice-date BLACK/confirmed. No past-month
  // auto-promote. The current-month boundary guard still prevents future-dated
  // realised lines from leaking into the current period.
  if (!isCanonicalCosRealised(exp)) return false;
  return monthKey ? monthKey <= currentMonthKey : true;
}

/**
 * Mirror of isEffectivelyRealised: lines that are still actively committed
 * (PO or invoice-in-progress, but not yet effectively realised). Past-month
 * auto-promoted lines are excluded so they don't double-count.
 */
export function isEffectivelyCommitted(
  exp: any,
  _monthKey: string | null,
  _currentMonthKey: string,
  classifyCosStatusFull: (e: any) => string,
): boolean {
  // Past-month auto-promote removed (C1): a red closed-month line stays
  // Committed rather than being silently reclassified as realised.
  if (isCanonicalCosRealised(exp)) return false;
  return classifyCosStatusFull(exp) === "Committed";
}
