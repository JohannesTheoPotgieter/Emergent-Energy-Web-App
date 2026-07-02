# Handover Guide

New-maintainer starting point for the Emergent Energy Web App. It orients you,
lists what only the outgoing owner can supply, and records the known open items.
Items marked **TODO(owner)** need input from Johannes (COO) before this file is
complete.

---

## 1. What this is

Internal operations platform for a South African C&I solar EPC company —
project delivery, finance/reporting, document management, and integrations
(Microsoft 365, QuickBooks, Pipedrive). TypeScript monorepo: React 19 + Vite
client, Express 5 server, Drizzle ORM + PostgreSQL, hosted on Replit
(autoscale, single port 5000).

Orientation reading, in order:

1. [`README.md`](README.md) — quick start (runs with zero config).
2. [`docs/dev-setup.md`](docs/dev-setup.md) — dev/testing detail.
3. [`docs/AGENT_GUARDRAILS.md`](docs/AGENT_GUARDRAILS.md) — the canonical rules
   (schema, RBAC, migrations, finance, integrations). The most important doc.
4. [`docs/README.md`](docs/README.md) — the rest of the docs by topic.
5. [`CLAUDE.md`](CLAUDE.md) — AI-agent context (also a good architecture map).

Repo layout, commands, and CI are described in `README.md` and `CLAUDE.md`.

## 2. Can it be maintained from the front end?

Mostly yes — day-to-day operations are UI-driven: user/role management, RBAC,
imports (Smart Import v2), integration connect/health, and settings all have
admin screens. The operations that still require a script or the Replit console
are: **deploys and DB migrations** (`npm run db:migrate` on deploy),
**secret rotation** (Replit Secrets Manager / Azure Key Vault), **backups /
restore** (GitHub Actions), and **one-off data fixes** (`scripts/`). Those are
covered by the runbooks under `docs/runbooks/`.

## 3. Contacts & ownership — TODO(owner)

| Role | Name | Contact |
|---|---|---|
| Product owner (COO) | Johannes Theo Potgieter | johannes@emergentenergy.co.za |
| On-call engineer / dev partner | TODO(owner) | TODO(owner) |
| GitHub org admin | TODO(owner) | TODO(owner) |
| Replit workspace owner | TODO(owner) | TODO(owner) |

The finance-freeze runbook (`docs/finance-freeze-runbook.md`) also has
escalation-contact placeholders the owner must fill before it is handed to a
non-developer operator.

## 4. External accounts & custody — TODO(owner)

Confirm who holds each account and how access transfers on handover:

- **GitHub** — repo `johannestheopotgieter/emergent-energy-web-app`; Actions
  secrets `PROD_DATABASE_URL`, `DEV_DATABASE_URL` (used by the backup and
  prod→dev sync workflows). **Branch protection** on `main` with *Require review
  from Code Owners* MUST be enabled — the entire finance freeze depends on it
  (see `.github/CODEOWNERS`). Confirm it is on.
- **Replit** — the hosting workspace + Secrets Manager (all runtime secrets).
- **Azure** — tenant `d6319480-…` (public, in `.replit`), client
  `d2fd99cb-…`; the `AZURE_CLIENT_SECRET`, and the Key Vault (`KEY_VAULT_URI`).
- **Intuit / QuickBooks** — developer app (OAuth client id/secret, redirect URI).
- **Pipedrive** — API token.
- **Read.ai** — webhook secret.

## 5. Secrets inventory

Names and rotation procedure live in
[`docs/runbooks/secrets-rotation.md`](docs/runbooks/secrets-rotation.md) and the
annotated [`.env.example`](.env.example). No secret values live in the repo;
they are in the Replit Secrets Manager / Azure Key Vault / GitHub Actions
secrets. **Action:** re-verify that runbook's inventory is complete and current
(it was last reviewed 2026-04-12 and is missing some names — see §7).

## 6. The finance freeze

Finance computation code is **frozen** — do not change formulas/numbers.

- What is frozen and why: [`FINANCE_FROZEN.md`](FINANCE_FROZEN.md),
  [`docs/finance-source-of-truth-audit.md`](docs/finance-source-of-truth-audit.md)
  (Part I = the locked rules), enforced by `.github/CODEOWNERS`.
- Break-glass procedures: [`docs/finance-freeze-runbook.md`](docs/finance-freeze-runbook.md).
- **Freeze start/end date and unlock procedure: TODO(owner)** — nothing in the
  repo records when the lock started, when it lifts, or who authorises changes.

## 7. Known open items (as of this handover)

**Do soon:**

1. **Rotate the leaked DB credential.** A prior commit committed a plaintext
   Neon Postgres connection string (in `attached_assets/`). The file has been
   removed from `HEAD`, but the credential is still in git history. Rotate the
   Neon password, then purge it from history (git filter-repo, coordinated
   force-push + re-clone on Replit — same procedure as the earlier PNG purge,
   recorded in `docs/archive/ops-history/cleanup-repo.sh`). Owner action.
2. **Backups are GitHub-artifact-only.** The daily backup + tested-restore
   workflow (`.github/workflows/db-backup.yml`) had been failing for ~a week on
   a `SUM(text)` bug — fixed in this cleanup. But backups exist only as GitHub
   Actions artifacts (30-day retention); there is no off-GitHub copy. Decide on
   an external backup destination.
3. **Confirm GitHub branch protection** is enabled (see §4) — the freeze is
   unenforceable without it.

**Should fix (own PRs):**

- **`npm audit`**: 4 high-severity production vulns with fixes available
  (multer — the live upload handler — tmp, undici; `ws` was already removed in
  this cleanup). No `dependabot.yml` exists — add one.
- **Node version drift:** Replit/CI pin Node 20, GitHub runners now force
  Node 24 for actions, local dev used Node 22, and `package.json` has no
  `engines` field / `.nvmrc`. Pick a supported version and pin it.
- **Nightly prod→dev sync** (`docs/runbooks/dev-data-refresh.md`) references a
  `.github/workflows/nightly-prod-to-dev.yml` that does not exist — either
  restore it or update the runbook (the `scripts/sync-prod-to-dev.ts` it calls
  does exist).
- **`npm run qa:report`** is broken (it requires docs that were moved to
  `docs/archive/`). Fix the paths or retire the script + its package.json entry.
- **Dangling doc refs in code comments:** `server/auth-context.ts` and
  `server/jwt.ts` cite `docs/spine-v2/08-org-scoping-plan.md`;
  `server/services/finance-line-write-service.ts` cites
  `docs/write-authority-model.md` — neither doc exists (pre-existing; the
  finance one sits on the frozen surface, so leave it for the freeze window).
- **Dead dark-mode Tailwind classes:** dark mode was removed (#1156) but ~70
  inert `dark:` variant classes across ~22 files and the custom `dark` variant
  in `index.css` remain. Removing the variant alone would re-enable
  OS-preference dark styling, so this needs a coordinated one-PR sweep.
- **~948 stale branches on origin** (agent working branches, zero open PRs).
  Prune, but first **protect `backup-pre-cleanup-20260605-180235`** — it is the
  only surviving copy of pre-2026-06 git history.
- **209 `console.log` calls** in server runtime code bypass the structured
  logger; `no-console` is only a `warn`. Consider tightening the rule.
- Consolidate the two scripts that regenerate the same permission-snapshot
  fixture (`scripts/regenerate-permission-snapshot.ts` vs
  `scripts/permissions/build-snapshot.ts`).

## 8. Finance-adjacent code kept pending owner sign-off

This cleanup left the following in place because they touch the frozen finance
surface or are parked features — they look unused but must not be removed
without owner approval:

- **Server:** `services/finance-model.ts`, `services/recognition-mode-service.ts`
  (FROZEN); `services/financial-temporal.ts`,
  `lib/reconciliation/selected-truth-registry.ts` (unwired but finance-adjacent).
- **Client:** `pages/finance-weekly-close.tsx` (frozen, unrouted),
  `pages/admin-control-center.tsx` (fallback), the `components/quickbooks/`
  QbMatchingWorkbench cluster, `components/finance/*` (finance-redesign
  foundation, contract-tested), `components/tabs/FinancialReviewTab.tsx`
  (parked), `lib/finance/gp-summary.ts`, `lib/cashflow-drill.ts`.
- **Scripts:** `script/full-schema-alignment.sql` + `script/pre-push-enums.sql`
  (deprecated but guard-test-pinned), `scripts/finance-live-uniqueness.sql`
  (run-once prod fix — confirm whether it was applied), `scripts/undo-qb-matches.ts`
  (QB rollback escape hatch).

## 9. What this cleanup changed

Removed dead code (server routes/services, ~80 unreachable client files, dead
shared modules, unused deps), archived dated docs and one-off scripts under
`docs/archive/` and `scripts/_archive/`, relocated CI tracker fixtures to
`qa/fixtures/trackers/`, pruned `migrations/meta/` (73 MB → 2 MB), purged the
`attached_assets/` paste dump, fixed the backup-restore drill, and rewrote the
onboarding docs. Frozen finance code was not touched. Every step kept
`check` + `test` + `build` + `db:check` green; see the PR history for the
per-phase detail.
