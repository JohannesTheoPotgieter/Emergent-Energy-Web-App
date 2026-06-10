---
name: Golden oracle finance reconciliation
description: Durable findings from building the independent line-item golden fixture vs the dashboard oracle and prod.
---

# Golden oracle finance reconciliation

Independent standalone tracker reader (qa/golden-oracle/) reproduces the dashboard
oracle from raw SharePoint xlsx, with NO app importer/derivation code.

## What ties and what does not
- **Realised COS** ((sum of realised line actuals, realised = invoice present,
  non-red invoice-date font colour, in FY window, ≤ as-at) ties the oracle within
  ~1% per project and EXACTLY for De Drift. This is the trustworthy surface.
- **Realised REV** computed as (Q/X)×J from the Expenditure Breakdown
  (Q=line COS, X=category COS total, J=category revenue allocation) **overshoots**
  the oracle and is NOT reproducible from any single raw tracker surface.

**Why:** the oracle's realised revenue is a prod-derived *blend* — empty tracker J
allocations get promoted from QuickBooks evidence / admin overrides, and prod
`category_revenue_allocations.revenue_allocation` is NULL for some categories even
at the 08/06 snapshot. So a pure raw-tracker (Q/X)×J cannot equal the oracle. Treat
the REV gap as a documented audit finding, not a parser bug.

## Prod canonical-view quirks (via claude_views)
- `v_normalized_cost_lines` filtered to `cos_realised=true` ties oracle COS for
  De Drift / Seshego / Unitrans, but is ~2× INFLATED for Mondi and Coega (the view
  carries both header and child rows flagged realised → double count). Surfaces as
  large `orphan_in_prod` counts in the diff.
- `v_normalized_revenue_lines` `status='paid'` is the billed/Revenue-Tracking
  surface (actual invoiced revenue), a different concept from (Q/X)×J recognised
  revenue — it ties the tracker RT realised for De Drift/Seshego, not the oracle REV.

## Revenue Tracking parser gotcha
Some workbooks restate the milestone block (planned-vs-actual or VO mirror),
repeating milestone No. values. Dedupe `contractRevenue` by milestone No. (first
occurrence). Do NOT add a monotonic-No. break to stop parsing — that silently drops
legitimate later milestones (broke Seshego). Realised revenue is robust to the
mirror block (mirror rows lack invoices); only the contract total double-counts.

## Diff must be line-granular
A prod-vs-fixture diff that pre-aggregates by invoice can let offsetting per-line
errors net out and hide real mismatches. Match lines one-for-one within each
invoice group (exact-amount pass → pair remainders as mismatches → leftovers as
orphans), never summing, so every differing line gets its own report row.
