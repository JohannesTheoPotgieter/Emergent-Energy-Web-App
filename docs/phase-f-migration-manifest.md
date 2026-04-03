# Phase F Migration Manifest

> **Phase:** F — Unified Finance  
> **Status:** Complete  
> **Total migrations:** 9 (2 DDL + 5 backfill + 2 rollback)

---

## Execution Order (alphabetical sort = dependency order)

| # | File | Purpose |
|---|---|---|
| 1 | `20260403_f01_create_finance_records.sql` | Create `finance.finance_records` + `finance.finance_record_events` |
| 2 | `20260403_f02_create_budget_lines.sql` | Create `finance.budget_lines` |
| 3 | `20260403_f03_backfill_finance_records_costs.sql` | Backfill from `finance.cost_lines` (outflow) + party resolution |
| 4 | `20260403_f04_backfill_finance_records_revenue.sql` | Backfill from `finance.revenue_lines` (inflow) |
| 5 | `20260403_f05_backfill_finance_records_po_payments.sql` | Backfill from POs, payment_requests, invoice_captures, procurement_items |
| 6 | `20260403_f06_backfill_budget_lines.sql` | Backfill from budget_baselines (4 types) + fye_budgets |
| 7 | `20260403_f07_backfill_finance_record_events.sql` | Reconstruct lifecycle audit trail from timestamps |

---

## Rollback

| # | File | Drops |
|---|---|---|
| 1 | `20260403_f08_rollback_budget_lines.sql` | `budget_lines` |
| 2 | `20260403_f09_rollback_finance_records.sql` | `finance_record_events` → `finance_records` |

---

## New Tables

| Table | Schema | Rows (est.) | Type |
|---|---|---|---|
| `finance.finance_records` | finance | ~87,000 | Unified transaction spine |
| `finance.finance_record_events` | finance | ~150,000 | Lifecycle audit trail |
| `finance.budget_lines` | finance | ~2,400 | Budget allocations |

---

## Backfill Sources

### Finance Records

| Source | → financial_type | → direction | Key Fields in record_data |
|---|---|---|---|
| `finance.cost_lines` | cost | outflow | counterparty, invoice, dates, opening balance flag |
| `finance.revenue_lines` | revenue | inflow | milestone, invoice, dates, opening balance flag |
| `purchase_orders` | purchase_order | outflow | PO ref/number, supplier, line items, terms |
| `payment_requests` | payment_request | outflow | PO link, invoice link, due/cutoff dates |
| `invoice_captures` | invoice | outflow | Invoice number/date, document refs, QB sync |
| `procurement_items` | procurement | outflow | Category, quantities, RFQ/quote/delivery data |

### Budget Lines

| Source | → budget_type | Key Fields |
|---|---|---|
| `budget_baselines` (revenue) | revenue | version, baseline lock, approval |
| `budget_baselines` (cost) | cost | version, baseline lock, approval |
| `budget_baselines` (margin) | margin | version, baseline lock, approval |
| `budget_baselines` (contingency) | contingency | version, baseline lock, approval |
| `fye_budgets` | varies | FYE year, month key, amount |
