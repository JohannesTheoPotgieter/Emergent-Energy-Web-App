# Blast Radius — § 3.7 paidDate fallback bug

**Generated:** 2026-05-07T17:43:41.510Z
**Source:** `scripts/blast-radius-paiddate.ts` (read-only SQL replay)
**Bug context:** Pre-PR #841 (commit 465f325), `paidDateConfirmed` could fall back to `forecastPaymentDate` colour when `paidDate` was blank. Post-fix, no fallback. This report identifies rows in `normalized_cost_lines` where the post-fix logic would not produce `paid_date_confirmed = true` but the stored value is `true` — i.e. fallout from imports under the buggy fallback.

> **READ ONLY** — this script writes no DB rows.

## Aggregate impact

| Metric | Value |
|---|---|
| Total suspect rows | 0 |
| Strict suspects (paid_date NULL) | 0 (0 match bug fingerprint) |
| Loose suspects (paid_date present, colour ≠ black) | 0 (0 match bug fingerprint) |
| Suspect rows with cashflow_confirmed = true | 0 |
| **Inflated cashflow total (sum of amount_ex_vat where cashflow_confirmed)** | **R 0.00** |
| Projects affected | 0 |

### Bug fingerprint

A row "matches the bug fingerprint" iff its persisted `cell_format.forecast_payment_date.font` is BLACK (r<40, g<40, b<40 — same threshold as `normalizer.ts:559`). These are rows the buggy fallback would have flipped to confirmed. Rows without the fingerprint are anomalies of a different cause (manual edits, legacy imports, etc.) and should be triaged separately.

### Remediation guidance per IMPLEMENTATION_PLAN_V3.md § 1.4

Use the **strict suspects** count to pick the option:

| Strict suspects | Recommended option |
|---|---|
| < 50 rows | Option 1 — fix-forward only |
| 50 – 500 rows | Option 2 — targeted backfill via additive temporal pattern |
| 500+ rows | Option 3 — force re-import of all active projects |

## Per-project breakdown

| Project ID | Code | Name | Suspect rows | Inflated R |
|---|---|---|---|---|

## Strict suspects (paid_date IS NULL)

| id | project_id | paid_date_font_color | cashflow_confirmed | forecast_payment_date | forecast_font (cellFormat) | bug_fingerprint | amount_ex_vat | source_sheet | source_row |
|---|---|---|---|---|---|---|---|---|---|

## Loose suspects (paid_date present, colour ≠ black)

| id | project_id | paid_date | paid_date_font_color | cashflow_confirmed | forecast_payment_date | forecast_font (cellFormat) | bug_fingerprint | amount_ex_vat | source_sheet | source_row |
|---|---|---|---|---|---|---|---|---|---|---|
