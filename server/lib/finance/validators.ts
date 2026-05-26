/**
 * Shared Zod refinements for finance route validation.
 *
 * Extracted from server/routes/finance-legacy-extracted-routes.ts so the
 * refinements can be unit-tested in isolation (DF-29 from
 * audit/FINANCE_AUDIT_V2_2026-05-26.md).
 */
import { z } from "zod";

/**
 * § 3.7 HARD: actuals fields (paidDate / inBankDate) receive ACTUAL dates
 * only. A value in the future is by definition not an actual — it's a
 * planned / forecast date and belongs in forecastPaymentDate /
 * expectedPaymentDate. Reject at the route boundary so the manual-edit
 * path matches the Smart Import normalizer rule.
 *
 * The "today" boundary is computed in UTC against the date-only prefix of
 * the input. This is intentionally lenient about exact timezone — the
 * field accepts an ISO calendar day, not a datetime, and the day-level
 * comparison is unambiguous.
 *
 * Empty strings are accepted (treat as "not provided") so the refinement
 * doesn't double-reject when the route layer already strips empty values.
 */
export const pastOrTodayIsoDate = (fieldName: string) =>
  z.string().refine(
    (v) => {
      if (!v) return true;
      const d = String(v).slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      return d <= today;
    },
    { message: `${fieldName} cannot be in the future. Use forecastPaymentDate for planned payments.` },
  );
