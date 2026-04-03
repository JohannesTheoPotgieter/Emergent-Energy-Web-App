# Slice F.1: Unified Finance (Clean Model)

> **Status:** Implemented  
> **Predecessor:** Phase A (parties), Phase B (project_instances, phase_definitions), Phase 1B (cost_lines, revenue_lines, fiscal_periods)  
> **Principle:** Additive, non-breaking, one narrow slice  
> **Risk:** High (most complex data, highest volume ~87k rows)

---

## Design

### Finance Records (Unified Spine)

`finance.finance_records` consolidates all financial transactions into a single table. Each record represents one financial event that progresses through lifecycle stages tracked in `finance.finance_record_events`.

| Source Table | financial_type | direction | Rows (est.) |
|---|---|---|---|
| `finance.cost_lines` | `cost` | `outflow` | ~74,000 |
| `finance.revenue_lines` | `revenue` | `inflow` | ~6,000 |
| `purchase_orders` | `purchase_order` | `outflow` | ~500 |
| `payment_requests` | `payment_request` | `outflow` | ~1,000 |
| `invoice_captures` | `invoice` | `outflow` | ~2,000 |
| `procurement_items` | `procurement` | `outflow` | ~3,000 |

### Finance Record Events (Lifecycle Audit Trail)

`finance.finance_record_events` preserves the full audit trail. Each lifecycle stage (PO raised → invoice received → approved → payment made) is a separate event with its own timestamp.

Events reconstructed from existing timestamp columns:
- Cost lines: `invoice_received`, `approved`, `payment_made`
- Revenue lines: `invoice_raised`, `payment_expected`, `payment_received`
- Purchase orders: `po_raised`, `po_sent`
- Payment requests: `payment_requested`
- Invoice captures: `invoice_captured`
- Procurement: `rfq_sent`, `quote_received`, `delivery_received`

### Budget Lines

`finance.budget_lines` consolidates budget allocations:

| Source Table | Budget Types | Rows (est.) |
|---|---|---|
| `budget_baselines` | revenue, cost, margin, contingency (4 lines per baseline) | ~400 |
| `fye_budgets` | monthly allocations per project | ~2,000 |

---

## Import/Override Tracking

The spreadsheet is the foundation. The `import_source` field tracks which table/sheet the record originated from. The `has_frontend_override` flag indicates manual edits made via the frontend — on next import, the user is prompted to sync changes back to Excel.

---

## Scope In

- [x] DDL: `finance_records` + `finance_record_events`
- [x] DDL: `budget_lines`
- [x] Backfill: cost_lines → finance_records (outflow)
- [x] Backfill: revenue_lines → finance_records (inflow)
- [x] Backfill: POs, payment_requests, invoice_captures, procurement_items
- [x] Backfill: budget_baselines + fye_budgets → budget_lines
- [x] Backfill: lifecycle events from timestamps
- [x] Party resolution (counterparty name/id → core.parties)
- [x] Safety warnings for unresolvable references
- [x] Rollback: drops in FK order
- [x] Idempotency: ON CONFLICT + NOT EXISTS guards

## Scope Out

- Cashflow/monthly summaries (derived — rebuild from clean model later)
- No Drizzle ORM schema
- No app code changes
- Legacy tables remain untouched
