---
name: Finance runtime audit harness
description: How to drive the Emergent Energy app + DB for runtime finance audits, and what is/ isn't testable.
---

# Authenticating for runtime API audits (dev only)
The app gates every finance endpoint behind MSAL + a JWT stored in browser localStorage.
For programmatic testing in the dev environment there is a non-production bypass:
1. `GET /api/auth/dev-login` → 302 redirect to `/auth/ms-callback?code=<64-hex>` (logs in seeded admin `johannes`, role COO_ADMIN).
2. `POST /api/auth/exchange-code {code}` → `{token}` (JWT, ~60s code TTL).
3. Send `Authorization: Bearer <token>` to any endpoint.
**Why:** lets you capture the exact payloads the React-Query pages render, without a browser.
**How to apply:** any runtime audit/regression. Blocked when NODE_ENV=production.

# Screenshot / browser tool is UNauthenticated
The app_preview screenshot tool loads a fresh context with no JWT, so it only ever shows the
MSAL sign-in screen for finance pages (`/api/auth/me` → 401). Browser-rendered per-control
screenshots, UX-state capture, and role-by-role rendering are NOT executable with that tool.
dev-login only mints a COO_ADMIN session — no low-privilege session is obtainable, so live RBAC
rendering can't be driven. Report endpoint/data-layer evidence instead and say so explicitly.

# DB access
`psql "$DATABASE_URL"` reaches the live dev DB (helium/heliumdb). `amount_ex_vat` is TEXT —
guard numeric casts: `case when btrim(x) ~ '^-?[0-9]+([.][0-9]+)?$' then x::numeric else 0 end`.

# Durable finding: cross-surface finance numbers don't reconcile
The PRS (`project_revenue_summary`) snapshot is mis-keyed (project_id != project_info.id),
orphaned, and duplicated. Surfaces that read PRS (admin kpi-traceability, GP pages, v2
project-finance summary `costedSummary`) disagree with the canonical normalized_* line totals
by up to ~R200M, and project-detail can show a different project's costed summary.
**Why:** any "is finance correct?" task must compare the same number across pages, not just
internal consistency. Reports: docs/finance-source-of-truth-audit.md (V1), -v2.md (V2 runtime).
