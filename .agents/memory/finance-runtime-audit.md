---
name: Finance runtime audit harness & known defects
description: How to re-run the Emergent Energy finance source-of-truth audit and the durable defects it keeps surfacing.
---

# Finance source-of-truth audit

Reports: `docs/finance-source-of-truth-audit.md` (V1), `docs/finance-source-of-truth-audit-v2.md` (V2). Both RED.

## Auth harness (required for every API + browser call)
- Cookie/session auth on the dev UI is BROKEN: cookie-only `/api/auth/me` = 401; the app preview redirects to login.
- Working path: `dev-login → exchange-code → JWT`; send `Authorization: Bearer <jwt>` on every request. Bearer = 200.
- Browser (Playwright): inject the Bearer via `extraHTTPHeaders` AND localStorage init-script. Use
  `process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `--no-sandbox`, `waitUntil:'domcontentloaded'` (NOT
  `networkidle` — Vite HMR websocket retries never settle and hang the run). Vite HMR websocket console errors are
  harness noise, not app bugs.

## Durable defects (data layer — survive across audits; dev DB stable)
- **PRS mis-keyed:** `project_revenue_summary.project_id` ≠ `project_info.id`; 27 orphan rows in dev (~90% of revenue
  in prod). Admin `revenue_actual` (PRS all-active) is inflated vs canonical `inflow_total_value` (normalized lines).
- **Same number, many surfaces:** revenue, realised-COS, GP, and GP-margin each render as several irreconcilable
  values; each surface is internally consistent but built on a different unreconciled base.
- **Canonical = normalized_*_lines** (active = `effective_to IS NULL`), NOT project_revenue_summary.
- `cashflow_points` / `finance_*_monthly` tables are empty (dev+prod) → KPI cashflow tiles show 0; cashflow-tracker
  still emits epoch-zero week dates (1899-12-25). `manual_overrides` and `quickbooks_invoice_links` absent/empty.
- `amount_ex_vat` / `revenue_recognition_amount` are TEXT — always guard-cast with a numeric regex before summing.

**Why:** these are data-model / source-of-truth problems, not display bugs; do not "fix" by changing a query —
the underlying keying and snapshot-table population are the issue.

## Prod read access
- Prod is read-only via `CLAUDE_RO_DATABASE_URL`, schema `claude_views`, tables `v_*` (not `public.*`).
