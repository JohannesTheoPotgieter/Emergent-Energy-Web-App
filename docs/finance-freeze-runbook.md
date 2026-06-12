# Finance Freeze — Break-Glass Runbook

**Owner:** Johannes Theo Potgieter (COO) — johannes@emergentenergy.co.za
**Status:** 🔒 FINANCE FROZEN (6-month lock)
**Scope:** the only five things that can ever need a human while finance is frozen.
**Last reviewed:** 2026-06-11

---

## ⚠️ Read this first

The finance feature is **frozen**. The numbers (REV / COS / GP / cashflow), the
recognition/realisation logic, the fiscal-year window, the weekly-cash engine,
and the QuickBooks matcher are **locked and verified**. During the freeze:

> ## 🚫 Do NOT change finance code to fix any of the situations below.
>
> Every scenario in this runbook is an **operations action** — a few clicks in a
> portal — **not** a code change. If you find yourself editing
> `server/repositories/finance-*`, `server/lib/finance/*`, `shared/schema/finance.ts`,
> or any finance page to "fix" one of these, **stop** and call the owner. Changing
> finance code during the freeze is how a verified, ring-fenced system silently
> starts producing wrong numbers. The branch-protection + CODEOWNERS gate exists
> precisely to stop this; do not work around it.

The app **monitors its own ring-fence** and pages the owner. You will normally
arrive here because you received one of those alerts. The owner-facing status
page is **Finance → Finance Health** (`/finance/health`).

### The five human-touch scenarios

| # | Situation | Section | Typical time |
|---|---|---|---|
| a | "Reconnect required: QuickBooks" | [§ A](#a-reconnect-quickbooks) | ~2 min |
| b | Azure / SharePoint client secret expiring | [§ B](#b-rotate--replace-the-azure-client-secret) | ~15 min |
| c | Restore the database from backup | [§ C](#c-restore-from-backup) | ≤ 60 min |
| d | Acknowledge / clear an alert | [§ D](#d-acknowledge--clear-an-alert) | ~1 min |
| e | Re-run the weekly integrity check | [§ E](#e-re-run-the-weekly-integrity-check) | ~2 min |

### Who to call if a step fails

Escalate in this order. (Owner to fill in exact phone numbers before handing this
to a non-developer operator.)

1. **Owner / COO — Johannes Theo Potgieter** — johannes@emergentenergy.co.za — `<phone>`
2. **Development partner / on-call engineer** — `<name / contact>`
3. **Vendor support for the failing system:**
   - QuickBooks (Intuit) — https://help.developer.intuit.com / Intuit account support
   - Microsoft / Azure AD — your Microsoft 365 admin, then Microsoft support
   - Hosting (Replit) — https://replit.com/support
   - GitHub Actions / backups — https://support.github.com

> 📸 Screenshots: where this runbook says **"you should see …"**, attach a
> screenshot in `docs/finance-freeze/` and link it inline if you want a fully
> visual SOP. The exact clicks and expected screen states below are written so
> the procedure works even without screenshots.

---

## A. Reconnect QuickBooks

**When:** you get a **"Reconnect required: QuickBooks"** alert (in-app inbox /
monthly digest), or the **Finance Health → Finance integrations** tile shows
QuickBooks as `stale`/`failing`. QuickBooks rotates its refresh token and
hard-expires it ~100 days after the last sign-in; a long idle freeze can let it
lapse. **This is not a code problem.**

> 🚫 Do NOT touch finance code. Until you reconnect, finance pages keep showing
> the **last-good** reconciliation data with an "as of «timestamp»" banner — they
> do not break.

### Exact clicks

1. Sign in to the app as an **admin / COO**.
2. Go to **Admin → QuickBooks** (or **Admin → Integration Statuses → Connection
   Health**).
   - 📸 *You should see:* a QuickBooks tile with a red/amber **"Reconnect
     required"** badge and a **Reconnect QuickBooks** button.
3. Click **Reconnect QuickBooks**. This starts the one-click Intuit OAuth flow
   (`/api/quickbooks/auth`, admin-only).
4. On the Intuit consent screen, sign in with the Emergent Energy QuickBooks
   credentials and **approve** access for the Emergent Energy company.
5. You are redirected back to the app.
   - 📸 *You should see:* the tile flip to **Connected**, and **"Last successful
     sync"** update to just now.

### Verify

- On **Finance → Finance Health**, the **Finance integrations** row for
  QuickBooks shows `healthy`.
- Open **Finance → QB Reconciliation**; the page loads current data without the
  stale banner.

No environment variables or secrets change — the new tokens are stored
(encrypted) automatically.

### If it fails

- Re-check you approved the **correct QuickBooks company**.
- If Intuit shows "app not authorized", the Intuit app connection may have been
  revoked Intuit-side — call the owner; this may need the Intuit developer
  account, not a code change.
- Full reference: [`docs/runbooks/secrets-rotation.md` § 5A.1](runbooks/secrets-rotation.md).

---

## B. Rotate / replace the Azure client secret

**When:** you get an **"Azure client secret expiring"** / **SharePoint secret
expiring** alert, or **Connection Health** shows a secret-expiry countdown near
zero. `AZURE_CLIENT_SECRET` (Microsoft SSO + Outlook/Teams) and
`SHAREPOINT_CLIENT_SECRET` (app-only SharePoint reads) expire on a fixed clock
and **do not self-heal**. They are rotated **in Azure + Replit Secrets, never in
code.**

> 🚫 Do NOT change finance code. Until rotation, Microsoft reads degrade to the
> last-imported tracker data — they do not crash. This is a config rotation only.

### Exact clicks

1. **Generate a new secret in Azure:** Azure Portal → **Azure Active Directory**
   → **App registrations** → **Emergent Energy** → **Certificates & secrets** →
   **New client secret**. Pick an expiry (e.g. 180 days). **Copy the value
   immediately** — Azure shows it once. Note the **expiry date** displayed.
2. **Store the new secret:** in the Replit workspace → **Tools → Secrets** (lock
   icon) → edit `AZURE_CLIENT_SECRET` (or `SHAREPOINT_CLIENT_SECRET`) → paste the
   new value → **Save**. Do **not** click "Add to .env".
3. **Update the expiry date** (this is what silences the alert and resets the
   countdown — do not skip it): set `AZURE_CLIENT_SECRET_EXPIRES_ON` (or
   `SHAREPOINT_CLIENT_SECRET_EXPIRES_ON`) to the new expiry as `YYYY-MM-DD`.
4. **Restart the app:** in the Replit workspace click **Stop**, then **Run**.

### Verify

- Sign in via **Microsoft SSO** in a fresh incognito window; you reach the
  dashboard.
- **Admin → Integration Statuses → Connection Health**: the secret-expiry
  countdown shows the **new** date and the "Secret expiring / Reconnect" badge
  has cleared.
- Boot log shows no `[Secrets] Missing required runtime secrets`.

### If it fails

- `[Secrets] Missing required runtime secrets` after restart → the secret name or
  value didn't save; redo step 2.
- SSO loops / "invalid client secret" → you copied the secret **ID** instead of
  the **value**, or pasted with a trailing space. Regenerate and redo.
- Full reference: [`docs/runbooks/secrets-rotation.md` § 5A.2](runbooks/secrets-rotation.md).

---

## C. Restore from backup

**When:** the database is lost/corrupted, a bad data load must be rolled back, or
the **Daily DB Backup + Tested Restore** GitHub Action turned red (meaning the
*last* backup wouldn't have restored — treat as **P1**).

> 🚫 Do NOT "fix" finance numbers by editing code or hand-patching rows. The
> correct recovery is to restore a known-good backup. Hand-edits break the
> verified ring-fence.

### How backups work

- **`.github/workflows/db-backup.yml`** runs **daily at 00:30 UTC (02:30 SAST)**.
  Each run:
  1. dumps production with `scripts/backup-db.ts` (compressed, custom-format,
     TOC-validated),
  2. uploads the `.dump` as a **retained GitHub Actions artifact** (the durable
     off-box copy), and
  3. **restores it into a throwaway Postgres and verifies it** with
     `scripts/verify-backup-restore.ts` — so every backup is proven restorable,
     not just written.
- Backups are also kept on disk per `BACKUP_RETENTION_DAYS` (30) with a floor of
  `BACKUP_MIN_KEEP` (7) newest always retained.

### Recovery objectives

| Objective | Value | Basis |
|---|---|---|
| **RPO** (max data loss) | **≤ 24 h** | daily backup cadence. In practice near-zero for finance: the tracker is imported manually and finance is frozen, so little changes between backups. |
| **RTO** (time to restore) | **≤ 60 min** | download artifact + `pg_restore` + verify + repoint. The automated restore+verify round-trip completes in well under a minute on the verification DB (see proof below); the budget covers a production-size archive plus human steps. |

> **Defense in depth:** the managed Postgres (Replit/Neon) may also offer
> point-in-time recovery. That is a *second* layer — the GitHub Actions artifact
> is the **guaranteed, independently tested** copy this runbook relies on.

### Exact steps

You need: repo **read** access (to download the artifact) and a **scratch**
Postgres database URL to restore into (never restore a drill onto production).

1. **Get the latest good backup.** GitHub → **Actions** → **Daily DB Backup +
   Tested Restore** → newest **green** run → **Artifacts** → download
   `db-backup-«run id»` → unzip to get `ee-«db»-«timestamp».dump`.
   - 📸 *You should see:* a green check on the run and a `Tested restore` step
     that ends `PASS — backup restores to a working finance DB`.
2. **Prove it on a scratch DB first** (so you never gamble on production):
   ```bash
   RESTORE_TARGET_DATABASE_URL="postgres://USER:PASS@SCRATCH_HOST/scratch_db" \
   npm run db:restore:verify -- --dump path/to/ee-«db»-«timestamp».dump
   ```
   It must print `PASS — backup restores to a working finance DB`. The target is
   **refused** if its host/name looks like production.
3. **Restore into production** *only* with owner approval and a maintenance
   window. Point `RESTORE_TARGET_DATABASE_URL` at the (empty, freshly
   provisioned) production DB and run the same command, **or** restore manually:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
     --dbname "$PROD_DATABASE_URL" path/to/ee-«db»-«timestamp».dump
   ```
4. **Restart the app** (Replit **Stop → Run**). On boot the **schema-drift guard
   (F5)** confirms the schema is complete; if anything is missing it serves a
   `503` maintenance state instead of wrong numbers — that is the guard doing its
   job, not a new bug.
5. **Verify finance is healthy:** open **Finance → Finance Health**; run the
   integrity check ([§ E](#e-re-run-the-weekly-integrity-check)). It should be
   `PASS` with zero drift.

### Re-prove the backup tooling any time

```bash
npm run backup:selftest
```

This stands up a throwaway Postgres, seeds a representative finance schema, runs
the real backup + restore-verify, and asserts the finance numbers survive the
round-trip. **Verified 2026-06-11** (representative DB):

```
[backup-db] Archive validated: 59 restorable TOC entries.
[verify-restore] All 8 required finance tables present.
[verify-restore] Restored finance fingerprint: rev=3 lines / Σ 1350.50; cost=2 lines / Σ 340.25; projects=2.
[verify-restore] Finance fingerprint MATCHES source exactly — numbers survived the round-trip.
[verify-restore] PASS — backup restores to a working finance DB.
```

### If it fails

- `db:restore:verify` reports a **missing table** or **empty core table** → that
  archive is bad; use the previous green run's artifact and **call the owner** —
  a P1.
- `pg_restore` errors on production → do **not** retry blindly onto prod; restore
  to a scratch DB, confirm, then repoint. Call the owner / on-call engineer.

---

## D. Acknowledge / clear an alert

**When:** the freeze monitor paged the owner (in-app inbox, and for critical
events a best-effort Teams message). After you have **dealt with the cause** (one
of the other sections), clear the alert so the inbox reflects reality.

> 🚫 Acknowledging an alert is **not** a fix and **never** a code change. Clear it
> only once the underlying cause is resolved.

### Exact clicks

1. In the app top bar, click the **🔔 notification bell**.
   - 📸 *You should see:* a dropdown listing recent alerts; finance alerts are
     titled e.g. *"Finance integrity guard found DRIFT"*, *"Reconnect required:
     QuickBooks"*, *"Azure client secret expiring"*.
2. Click a notification to open it / mark it read, or click **Mark all as read**
   to clear the unread badge.
3. Cross-check on **Finance → Finance Health → Recent finance alerts** — it lists
   the same events with timestamps so you can confirm nothing critical is
   outstanding.

### Verify

- The bell's unread count returns to zero.
- **Finance Health → Overall** is `healthy` (green). If it is still `warn`/
  `critical`, the cause is not yet resolved — go back to the relevant section;
  do **not** just re-clear the alert.

### If it fails

- The same alert re-fires within minutes → the cause is still live (e.g.
  QuickBooks still disconnected). Resolve the cause first. Repeated identical
  alerts are throttled/deduped, so a new one means a genuinely new occurrence.

---

## E. Re-run the weekly integrity check

**When:** after any intervention (reconnect, secret rotation, restore), or any
time you want fresh proof the frozen numbers still tie out. The integrity guard
re-runs the **golden**, **cross-surface**, and **reconciliation** proofs
read-only against production and pages the owner on any drift.

> 🚫 The integrity check is **read-only**. It never writes finance data and never
> changes a number. Running it cannot break anything.

### Exact clicks (no terminal needed)

1. Sign in as **admin / COO**.
2. Go to **Finance → Finance Health** (`/finance/health`).
3. Under **Admin actions**, click **Run integrity guard now**.
   - 📸 *You should see:* a toast like *"Integrity guard complete"* and the
     **Weekly integrity guard** card update with `status pass · drift 0` and a
     fresh "Last run" time.

### Verify

- **Weekly integrity guard** card shows **`pass`** and **`drift 0`**.
- If it shows **`drift`**, the owner is paged automatically. **Do not edit finance
  code.** A drift means *data or an integration* changed under the freeze
  (a tracker edit, a QB re-sync). Investigate the data/integration via Finance
  Health; call the owner.

### Same thing from a terminal (optional)

```bash
# In-app admin endpoint (preferred — runs in the live app context):
#   POST /api/admin/finance/observability/run-integrity   (admin only)
#
# Or the offline verifiers (need a finance Postgres connection):
npm run verify:golden
npm run verify:finance
```

---

## Reference — how the ring-fence is enforced (for the owner / engineers)

These are confirmed **active** as part of the freeze; you do not operate them,
but you should know they exist.

### Fail-loud DB guard (H1)

Finance refuses to serve on the **wrong or absent database** rather than silently
degrade. In production the app **requires PostgreSQL and blocks any SQLite
fallback** — `server/db.ts` throws at startup if Postgres is missing or
unreachable (`"Production requires PostgreSQL…"`, `"refusing SQLite fallback in
production"`). Finance trust never runs on a dev/SQLite database.

### Schema-drift boot guard (F5)

If the live schema is **missing migrated tables/columns** (ledger says applied,
DB disagrees), the app does not serve wrong numbers: at boot
`server/bootstrap/schema-verification-runtime.ts` flags it, and
`server/middleware/schema-readiness-gate.ts` returns a typed **`503` maintenance**
for the finance surface until an operator applies the drift-repair migration
(`npm run db:migrate`, confirm with `npm run db:verify-schema`).

### Monthly health digest

On the **1st of each month** the app emails/Teams the owner a roll-up:
integrations (green / secret-expiry countdown), job health, data freshness,
integrity (golden + cross-surface), and any alerts in the period — the owner's
"is the ring-fence still holding?" signal. Scheduled in
`server/bootstrap/finance-integrity-guard-scheduler.ts`; you can also send one on
demand from **Finance Health → Send digest now**.

### Branch protection (one-time setup)

CODEOWNERS (`.github/CODEOWNERS`) only **blocks merges** once branch protection is
enabled. The owner sets this once:

1. GitHub → repo **Settings → Branches → Add branch protection rule**.
2. Branch name pattern: **`main`**.
3. Enable:
   - ✓ **Require a pull request before merging** → ✓ **Require approvals** (≥1)
   - ✓ **Require review from Code Owners**
   - ✓ **Do not allow bypassing the above settings**
   - (recommended) ✓ **Require status checks to pass** → select the PR checks
     workflow.
4. Save. Now any PR touching a finance path needs the owner's review to merge.

---

## F. Finance-only module — turning other modules back on

During the freeze the app runs as a **finance-only module**: only Finance (plus
the platform plumbing finance depends on) is reachable. Every other area is
hidden from the nav AND hard-blocked + redirected to `/finance` on both client
and server. Only management + finance roles can enter; all other roles get a
branded "this area is being updated" landing.

This is **presentation / access configuration only** — it changes **no finance
number, formula, query, or schema**, so it is *not* part of the frozen finance
code. You may change the module configuration without breaking the freeze.

### The single source of truth

Everything derives from one file:

> **`shared/config/enabled-modules.ts`**

| Knob | What it does |
|---|---|
| `FINANCE_ONLY_MODE` | Master switch. `false` lifts the whole restriction (every module + role back on). |
| `FINANCE_ONLY_MODULE_CONFIG.navGroups` | Per-navGroup enablement: `{ mode: "full" }`, `{ mode: "disabled" }`, or `{ mode: "partial"; pageIds }`. |
| `ENABLED_SYSTEM_PAGE_IDS` | The finance plumbing pages kept on inside the (otherwise disabled) SYSTEM group. |
| `FINANCE_MODULE_ROLE_ALLOWLIST` | The 7 management + finance roles allowed into the module. |

### Re-enable ONE module (one-line change)

To bring a hidden module back (e.g. Engineering), flip its entry from
`{ mode: "disabled" }` to `{ mode: "full" }`:

```ts
// shared/config/enabled-modules.ts → FINANCE_ONLY_MODULE_CONFIG.navGroups
ENGINEERING: { mode: "full" },   // was: { mode: "disabled" }
```

That one line restores **both** its top-nav section AND its routes (deep-links
stop redirecting to `/finance`), for exactly the roles that already had access
in the role/permission model — no other code edits. The valid navGroup keys are
the page-registry `navGroup` values: `MY_WORK, PORTFOLIO, PRIORITIES,
PROJECT_DEVELOPMENT, PROJECTS, PROJECT_MANAGEMENT, GATES, FINANCE, ENGINEERING,
QUALITY, HSE, REPORTS, KNOWLEDGE, SYSTEM`.

To enable just *some* pages of a group, use `{ mode: "partial", pageIds: [...] }`
with page-registry `id`s (this is how SYSTEM keeps only the finance plumbing).

### Turn the whole thing off

Set `FINANCE_ONLY_MODE = false`. Nav, routing, search scoping, the no-access
gate and the server API gate all become no-ops and the app returns to its full
multi-module behaviour.

### Add / remove an allowed role

Edit `FINANCE_MODULE_ROLE_ALLOWLIST` (values must be real `COMPANY_ROLES` from
`shared/schema/users.ts`). Removing a role sends it to the no-access landing and
blocks its non-auth API calls; adding one lets it into the finance module.

### Proof + guardrails

- `qa/tests/unit/finance-only-module.test.ts` locks the config and **proves
  reversibility** (flipping a navGroup to `full` restores its routes + nav).
- Client gate: `client/src/App.tsx` (`FinanceModuleGate` + per-route redirect),
  nav filter in `client/src/config/app-navigation.ts`
  (`filterSectionsByEnabledModules`).
- Server gate: `server/middleware/finance-only-gate.ts` (mounted in
  `server/routes/register-all-routes.ts`).

After any change run `npm run check && npm run test && npm run build`.

---

## Appendix — files referenced by this runbook

| Purpose | Path |
|---|---|
| Visible freeze marker | `FINANCE_FROZEN.md` |
| Ownership gate | `.github/CODEOWNERS` |
| Daily backup + tested restore (CI) | `.github/workflows/db-backup.yml` |
| Backup script | `scripts/backup-db.ts` (`npm run db:backup`) |
| Restore + finance verification | `scripts/verify-backup-restore.ts` (`npm run db:restore:verify`) |
| Self-contained round-trip proof | `scripts/backup-restore-selftest.sh` (`npm run backup:selftest`) |
| Secrets rotation (full detail) | `docs/runbooks/secrets-rotation.md` |
| Canonical finance rules (frozen) | `docs/finance-source-of-truth-audit.md` Part I |
| Finance Health page | `client/src/pages/finance-health.tsx` → `/finance/health` |
| Fail-loud DB guard (H1) | `server/db.ts` |
| Schema-drift boot guard (F5) | `server/bootstrap/schema-verification-runtime.ts`, `server/middleware/schema-readiness-gate.ts` |
| Monthly digest + weekly integrity | `server/bootstrap/finance-integrity-guard-scheduler.ts`, `server/services/finance-observability/` |
