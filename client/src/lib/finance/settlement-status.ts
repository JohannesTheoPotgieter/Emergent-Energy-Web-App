/**
 * Business-facing settlement status, derived from the imported tracker's
 * invoice/payment dates + their colour-confirmation signal.
 *
 * This is PRESENTATION ONLY — it re-expresses the same canonical signals the
 * frozen realisation logic already uses (server/lib/finance/cos-realisation.ts
 * §3.2 and server/lib/finance/revenue-ar-status.ts §3.4) so a user can read the
 * status of a line at a glance. It computes no finance number and gates nothing.
 *
 * The company's colour convention (AGENT_GUARDRAILS §3.7): on any date column,
 * BLACK font (or no explicit colour) = confirmed/realised (invoice issued,
 * payment made/received); a non-black/RED font = captured but not yet confirmed
 * (pending/forecast).
 */

export type SettlementTone = "paid" | "pending" | "invoiced" | "planned";

export type SettlementStatusKey =
  | "paid"
  | "paid_unconfirmed"
  | "invoiced"
  | "invoiced_unconfirmed"
  | "planned";

export interface SettlementStatus {
  key: SettlementStatusKey;
  label: string;
  tone: SettlementTone;
  /** Plain-language explanation for a tooltip / aria-label. */
  title: string;
}

export interface SettlementStatusInput {
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoiceDateConfirmed?: boolean | null;
  invoiceDateFontColor?: string | null;
  paidDate?: string | null;
  paidDateConfirmed?: boolean | null;
  paidDateFontColor?: string | null;
}

function hasIsoDate(value: string | null | undefined): boolean {
  return !!(value && /^\d{4}-\d{2}-\d{2}/.test(value.trim()));
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Is a date's colour signal "confirmed"? The explicit boolean flag wins; when
 * it is absent we infer from the font colour — BLACK or no colour = confirmed,
 * RED (any non-black) = unconfirmed (§3.7).
 */
function dateConfirmed(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (confirmed === true) return true;
  if (confirmed === false) return false;
  const c = String(fontColor ?? "").toLowerCase();
  if (c.includes("red")) return false;
  return true; // black / default / absent = confirmed
}

/**
 * Derive the settlement status for an invoice/payment line. Precedence mirrors
 * the realisation gates: a payment date settles the line; otherwise an invoice
 * means it's been released; otherwise it's still planned. The colour signal
 * splits each into confirmed vs unconfirmed.
 */
export function deriveSettlementStatus(input: SettlementStatusInput): SettlementStatus {
  if (hasIsoDate(input.paidDate)) {
    return dateConfirmed(input.paidDateConfirmed, input.paidDateFontColor)
      ? { key: "paid", label: "Paid", tone: "paid", title: "Payment date confirmed (black) — settled." }
      : {
          key: "paid_unconfirmed",
          label: "Paid · unconfirmed",
          tone: "pending",
          title: "Payment date captured but red — not yet confirmed.",
        };
  }

  if (hasIsoDate(input.invoiceDate) || hasText(input.invoiceNumber)) {
    return dateConfirmed(input.invoiceDateConfirmed, input.invoiceDateFontColor)
      ? { key: "invoiced", label: "Invoiced", tone: "invoiced", title: "Invoice raised (black) — awaiting payment." }
      : {
          key: "invoiced_unconfirmed",
          label: "Invoiced · unconfirmed",
          tone: "pending",
          title: "Invoice date captured but red — not yet confirmed.",
        };
  }

  return { key: "planned", label: "Planned", tone: "planned", title: "No invoice raised yet." };
}
