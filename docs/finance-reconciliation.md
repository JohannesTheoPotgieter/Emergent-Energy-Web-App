# Finance reconciliation — grain of the QuickBooks comparison

> Authority: this documents how `docs/AGENT_GUARDRAILS.md` § 3.4 ("trackers must
> match QuickBooks") is **checked**. The app only **compares and flags**; it
> never adjusts a tracker. The trackers remain the source of truth.

## Why the grain differs by metric

QuickBooks is kept the way the finance team actually books it:

- **Client invoices carry a Customer** that maps to a project. So **Revenue / AR
  reconciles per project** (matched via the QB customer → project resolver).
- **Vendor bills (COS) carry neither a Class nor a Customer** per job. There is
  no project tag on a cost bill, so **COS — and therefore GP — can only be
  reconciled to QuickBooks at the company level**, against QuickBooks' own P&L.

Forcing a per-project COS-vs-QB comparison is unmaintainable: every project
resolves to "no QB data" because the bills aren't project-tagged. That is a
**finance-process** limitation, not an app dependency.

## What the app does

| Surface | Grain | Source |
|---|---|---|
| **Finance Home "Tracker vs QuickBooks" tile** | Company | App canonical § 3.3 totals (Revenue / COS / GP) vs QuickBooks **P&L** Revenue / COS / GP for the FY, with a tie/drift status. |
| **Reconciliation board — company card** | Company | Same comparison, per metric (Revenue / COS / GP). |
| **Reconciliation board — per-project "Rev·QB" column** | Per project | **Revenue/AR only**, matched via the QB customer. Projects with no QB customer mapping show "—", not a misleading red. COS/GP are intentionally absent here. |

Endpoint: `GET /api/finance/reconciliation/company-qb?fy=<year>` →
`{ revenue, cos, gp }` each `{ tracker, qb, delta, status }` + `overallStatus`
(`green` ties · `amber` drift · `unknown` no QB data). Tie tolerance is R1
(`COMPANY_QB_TOLERANCE`). Best-effort: when QuickBooks is unavailable the `qb`
figures are `null` and the status is `unknown` (never a false drift).

## If you need per-project COS-vs-QuickBooks

That requires **QuickBooks Projects/Classes tagged per job** on every vendor
bill — a finance process change. Once bills carry a project Class, the existing
`buildQbProjectResolver` (class-first) would resolve cost bills to projects and
the per-project COS gap becomes meaningful. Until then, COS reconciles at
company grain only.

## Recon-ignores

Suppressed QB variances stay **visible and audited** (cost + revenue sides),
surfaced with who/why/when on the project detail — never silently dropped. This
is unchanged by the grain reframe.
