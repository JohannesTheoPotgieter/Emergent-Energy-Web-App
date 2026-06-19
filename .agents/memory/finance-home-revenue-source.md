---
name: Finance Home revenue reads the revenue-tracker, not finance/lines
description: Why Finance Home's revenue KPI + chart are sourced from /api/revenue-tracker while COS/GP stay on /api/finance/lines, and the invariants that keep them tying.
---

# Finance Home is dual-source for REV vs COS/GP

Owner decision (2026-06-19): the Finance Home **revenue** KPI and the
revenue-by-month chart read `/api/revenue-tracker` — the SAME endpoint the
Revenue screen uses — so the page ties cell-for-cell to Revenue, including a
4th `QB realised` bar (budget · planned · realised · QuickBooks). Everything
else on Home — COS KPI, GP-by-month chart, per-project table, reconciliation /
trust strip — stays on `/api/finance/lines`, because the tracker endpoint
carries no reliable COS/GP (its top-level `totalCOS` is all-time / unreliable).

**Why it still reconciles:** realised revenue is the SAME canonical source on
both endpoints (`canonicalRealisedByMonth` → the line-level repository). Only
PLANNED revenue (FYE engine) and the QB column differ. So the realised revenue
KPI ties to its own chart and to the Revenue/GP/COS pages. GP on Home is
recomputed as `tracker realised revenue − line-level realised COS`, so
`REV − COS = GP` holds exactly on the KPI strip even across the two sources.

**Fail-loud invariant (do not regress):** if `/api/revenue-tracker` errors,
revenue + GP KPIs must render a non-numeric placeholder (`—`), never a
fabricated `R0` / `0 − COS` negative. Revenue gates on the tracker query's
error; GP gates on either source erroring. This matches the app-wide finance
rule: never display a finance number you couldn't actually compute.

**Guardrail:** the Finance Home source-grep guardrail test intentionally ALLOWS
the revenue-tracker read + a QuickBooks bar, but still bans `/api/cos-tracker`,
company-overview, PRS, and QB-recon DATA (`qb-recon` endpoint, `qbStatus`,
`qbDelta`). Don't "restore" a blanket QuickBooks ban — the QB bar is approved.
