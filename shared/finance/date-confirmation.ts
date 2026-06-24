/**
 * Canonical §3.7 date-colour confirmation — the SINGLE definition of
 * "is this invoice / payment date confirmed?" derived from the tracker's
 * cell-colour signal.
 *
 * Rule (colour-first, matching the import-time classifier in
 * server/lib/import/normalizer.ts): a BLACK font is confirmed, a RED font is
 * unconfirmed; when no explicit colour is supplied the stored `confirmed` flag
 * decides. This is the exact logic that previously lived, duplicated, in
 * server/lib/cashflow-helpers.ts, server/lib/calculations/stateClassifier.ts and
 * server/departments/finance-routes.ts.
 *
 * Framework-agnostic (no imports) so every server status classifier shares one
 * rule. Do NOT re-implement this `fontColor === 'red' / 'black'` check inline —
 * import this function. The guard test
 * `qa/tests/unit/finance-colour-confirmation-single-source.test.ts` enforces it.
 *
 * NOTE — this is the colour-first *server classifier* rule. The realisation /
 * settlement gates (server/lib/finance/cos-realisation.ts §3.2,
 * server/lib/finance/revenue-ar-status.ts §3.4) and the client presentation
 * helper (client/src/lib/finance/settlement-status.ts) are deliberately distinct
 * canonical functions for their own concerns; this helper does not replace them.
 */
export function isDateColourConfirmed(
  confirmed: boolean | null | undefined,
  fontColor: string | null | undefined,
): boolean {
  if (fontColor === "red") return false;
  if (fontColor === "black") return true;
  if (confirmed === true) return true;
  return false;
}
