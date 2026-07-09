# 🔒 FINANCE FROZEN

> **The finance feature is under a 6-month freeze. Do NOT change finance code.**
>
> Break-glass runbook (the only human touches that are ever needed):
> **[`docs/finance-freeze-runbook.md`](docs/finance-freeze-runbook.md)**

---

## What "frozen" means

The finance computation paths — REV / COS / GP / cashflow, the recognition &
realisation predicates, the fiscal-year window, the weekly-cash engine, and the
QuickBooks invoice matcher — are **locked**. Formula, number, and calculation
changes require **explicit written approval from the owner** (Johannes Theo
Potgieter, COO). This is enforced two ways:

1. **CODEOWNERS** (`.github/CODEOWNERS`) routes every PR touching a finance path
   to the owner for review. Combined with branch protection ("Require review
   from Code Owners" on `main`), finance cannot change without owner sign-off.
2. **The canonical rules** live in `docs/finance-source-of-truth-audit.md`
   Part I and are enforced by `docs/AGENT_GUARDRAILS.md` § 3 + § 3B.

The frozen surface (do not modify without owner approval):

| Surface | Path |
|---|---|
| Line-level finance computation | `server/repositories/finance-line-level-repository.ts` |
| Recognition / realisation / totals | `server/lib/finance/` |
| Fiscal-year window (Sep–Aug, dynamic) | `server/lib/fy-window.ts` |
| Weekly-cash engine | `server/lib/finance/weekly-cashflow-engine.ts` |
| QuickBooks invoice matcher | `server/lib/finance/qb-project-matcher.ts`, `server/services/qb-project-match-service.ts` |
| Finance schema | `shared/schema/finance.ts` |
| Finance pages | `client/src/pages/finance-*.tsx`, `client/src/pages/cashflow*.tsx` |

Number-preserving refactors are allowed **only** if `npm run verify:finance` and
the finance unit tests stay green — and still need owner review via CODEOWNERS.

## The ring-fence is actively monitored

The freeze is not "set and forget". The app watches itself and pages the owner:

- **Fail-loud DB guard (H1):** finance refuses to serve on the wrong/absent
  database rather than silently degrade — `server/db.ts` (production requires
  PostgreSQL; SQLite fallback is blocked).
- **Schema-drift boot guard (F5):** if the live schema is missing migrated
  tables/columns, finance serves a typed `503` maintenance state instead of
  wrong numbers — `server/bootstrap/schema-verification-runtime.ts` +
  `server/middleware/schema-readiness-gate.ts`.
- **Weekly integrity guard:** re-runs the cross-surface + reconciliation
  proofs against production and pages the owner on any drift.
- **Monthly health digest:** a scheduled summary to the owner — the "is the
  ring-fence still holding?" signal.
- **Daily tested backups:** `.github/workflows/db-backup.yml` dumps prod and
  proves the dump restores to a working finance DB every day.

The owner-facing status page is **Finance → Finance Health** (`/finance/health`).

## If something needs a human

There are exactly **five** things that can ever need a person during the freeze.
All five are **ops actions, not code changes**. Each has step-by-step,
non-developer instructions in the break-glass runbook:

1. Reconnect QuickBooks
2. Rotate / replace the Azure client secret
3. Restore from backup
4. Acknowledge / clear an alert
5. Re-run the weekly integrity check

👉 **[`docs/finance-freeze-runbook.md`](docs/finance-freeze-runbook.md)**
