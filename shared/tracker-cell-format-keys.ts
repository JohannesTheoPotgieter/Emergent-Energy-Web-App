/**
 * Canonical ↔ source-sheet key resolution for tracker `cell_format` maps.
 *
 * The Smart Import pipeline persists each row's source-workbook cell colour to
 * a `cell_format` JSONB column, keyed by the SOURCE-SHEET column label — e.g.
 * `payment_received_date` on revenue lines, `payment_date` on cost lines and
 * actual batches, `planned_payment_date` for a milestone's planned date. The
 * rest of the app refers to those same columns by their canonical field name
 * (`paidDate`, `expectedPaymentDate`, `financePaymentDate`).
 *
 * Without a bridge, a lookup by the canonical name never matches the importer's
 * key and the imported colour (red = unconfirmed, black/green = paid/confirmed)
 * is silently dropped — which is why the invoice/payment-date colour failed to
 * show on the finance views. This module is the SINGLE SOURCE OF TRUTH that
 * reconciles the two naming schemes, so every surface — the revenue Milestone
 * Tracker, the Expenditure Breakdown, and the Excel-vs-App diff — resolves the
 * imported colour from one place.
 *
 * Framework-agnostic (no React) so both the client renderer
 * (`client/src/lib/tracker-cell-format.ts`) and the server diff repository
 * (`server/repositories/tracker-replica-repository.ts`) import it.
 */

export type CellFormatEntry = { font?: string; fill?: string; bold?: boolean };

export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Canonical field name → the source-sheet column-label aliases the importer
 * may have written. Keyed by canonical camelCase name. Only the payment-date
 * columns need this today; `invoice_date` already reconciles via plain
 * snake/camel normalisation, so it needs no synonym entry.
 */
export const CELL_FORMAT_FIELD_SYNONYMS: Record<string, readonly string[]> = {
  // Payment received: revenue milestones store it as `payment_received_date`;
  // cost lines and actual batches store it as `payment_date`.
  paidDate: ["payment_received_date", "payment_date"],
  // Finance/actual payment date on an expenditure actual batch.
  financePaymentDate: ["payment_date"],
  // Planned/expected payment date on a revenue milestone.
  expectedPaymentDate: ["planned_payment_date"],
};

/** Every key a given canonical field could be stored under, in match order. */
function candidateKeys(field: string): string[] {
  const camel = snakeToCamel(field);
  const keys = [field, camel, camelToSnake(field)];
  const synonyms = CELL_FORMAT_FIELD_SYNONYMS[field] ?? CELL_FORMAT_FIELD_SYNONYMS[camel] ?? [];
  for (const syn of synonyms) {
    keys.push(syn, snakeToCamel(syn), camelToSnake(syn));
  }
  return Array.from(new Set(keys));
}

/**
 * Resolve the `cell_format` entry for `field` from a raw (possibly null) JSONB
 * map, accepting snake_case / camelCase / known source-sheet synonyms. Returns
 * `null` when nothing matches so callers can fall back to default styling.
 */
export function resolveCellFormatEntry(rawMap: unknown, field: string): CellFormatEntry | null {
  if (rawMap == null || typeof rawMap !== "object") return null;
  const map = rawMap as Record<string, unknown>;
  for (const key of candidateKeys(field)) {
    const entry = map[key];
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const out: CellFormatEntry = {};
      if (typeof e.font === "string") out.font = e.font;
      if (typeof e.fill === "string") out.fill = e.fill;
      if (typeof e.bold === "boolean") out.bold = e.bold;
      return out;
    }
  }
  return null;
}
