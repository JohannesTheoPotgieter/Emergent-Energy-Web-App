---
name: Prod finance reconciliation methodology
description: How to correctly sum Revenue/COS/GP from the prod normalized line views, and the recurring distortions to watch for.
---

# Reconciling Revenue / COS / GP on production

Prod RO access (`CLAUDE_RO_DATABASE_URL`) is privilege-filtered: base `public` tables are
denied; read everything through the `claude_views.*` views. Finance line data lives in
`claude_views.v_normalized_revenue_lines` and `claude_views.v_normalized_cost_lines`.

## The two filters you MUST apply or numbers explode
1. **Current snapshot only:** `WHERE effective_to IS NULL`. These are SCD-2 history tables.
   ~95% of revenue rows and ~96% of cost rows are superseded history. Summing all rows
   over-counts ~80x (e.g. revenue 'paid' all-history ≈ R11.2bn vs current ≈ R435m).
   `snapshot_run_id` is NOT a usable global run id (it's tiny per-line batches) — use
   `effective_to IS NULL`, not max(snapshot_run_id).
2. **Fiscal-year window** on `invoice_date` (TEXT; parse `left(invoice_date,10)::date`).
   The business "golden" numbers are FY-scoped (FY2026 = 2025-09-01..2026-08-31). Without
   the FY filter, large multi-year projects (Mondi, Trident, Coega) inflate realised revenue.

With both filters applied, prod realised revenue reconciles to within ~2% of the raw-tracker
golden number — i.e. the imported data is fundamentally sound; distortions are in the
aggregation/derivation layer.

## Recurring distortions in the derivation/dashboard layer
- **`v_derived_project_kpis` is NOT FY-windowed** (and overstates realised) — portfolio
  revenue_realised/GP come out several-fold high vs the FY golden.
- **COS realised is overstated** because Committed (red invoice date) can't be told apart
  from Realised (black) — the `invoice_date_font_color` signal lives on
  `normalized_cost_line_actuals` and that column has been missing on prod (migration 0081
  journaled-but-not-applied). No colour → costs over-marked `cos_realised=t`.
  - The line source the trackers audit against is `v_normalized_cost_lines`:
    **COS = `amount_ex_vat`, REV = `revenue_recognition_amount`** (both TEXT, cast carefully).
    `cost_line_status` is only paid/invoiced/planned and `cos_realised` is binary — prod has
    NO Committed state, so it collapses 4 tracker states into 2.
  - The overstatement concentrates in **future-dated lines** (invoice month-end beyond the
    as-at, e.g. Jun–Aug for an FY-end Aug) wrongly flagged `cos_realised=t`. Restricting prod
    realised to past months reconciles to the tracker's YTD realised within ~2%; the stripped
    future block ≈ the tracker's Committed bucket. Fix needs a future-date guard + black-font
    (confirmed) requirement, not invoice-presence alone.
- **Project set inflated**: ~90 "active" projects, of which a large share have zero current
  financial lines (leads/deals/adhoc/folder artifacts). Golden delivery-project count is far
  lower. Named folder artifacts (BMG, Maynard Mall Extension, IconsSA KZN, Klein Karoo) leak
  into the active set.
- **Undated paid revenue**: a big block of `status='paid'` revenue lines have `invoice_date
  IS NULL`, so they can't be FY-attributed. Confirm whether any belong to the current FY.

**Why:** these distortions are what make the dashboard diverge from the trackers; the fix is
in derivation/import logic and data hygiene, not in re-importing the raw numbers.
