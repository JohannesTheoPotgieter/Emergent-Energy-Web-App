# Dev Data Refresh Runbook (Nightly Prod → Dev Sync)

**Owner:** Operations
**Last reviewed:** 2026-04-12
**Related fix:** Audit finding A6 — dev environment had no real-data refresh.

This runbook describes the nightly job that wipes the DEV database and
replaces it with a verbatim copy of PROD, so developers always work with
realistic data.

---

## 1. What it does (and what it does NOT do)

**Does:**
- Dumps the entire PROD database (all schemas, all tables, all rows) using `pg_dump`.
- Wipes the DEV database (drops every non-system schema, recreates `public`).
- Restores the dump into DEV using `psql`.
- Writes a `dev_data_sync_sentinel` row in DEV recording the sync time and
  **source PROD host/database**.
- Verifies the restore succeeded in two phases:
  1) required tables exist, and
  2) row counts can be queried from those tables.

**Does NOT:**
- Mask, redact, or filter any data. Per audit direction (internal-use,
  single-tenant, no PII concerns), DEV gets a verbatim copy of PROD.
- Touch PROD in any way except read-only via `pg_dump`.
- Run if `PROD_DATABASE_URL` and `DEV_DATABASE_URL` resolve to the same
  host+port+database (safety guard 14).
- Run if `DEV_DATABASE_URL` contains tokens like `production`, `prod-`,
  `.prod.`, `live-`, `.live.` anywhere in host or database name (safety
  guard 15).

If any safety guard trips, the script exits non-zero before touching the
database.

---

## 2. Schedule

| When | What |
|---|---|
| 02:00 UTC daily (04:00 SAST) | Automatic run via GitHub Actions workflow `.github/workflows/nightly-prod-to-dev.yml` |
| Manual | Operators can trigger from the Actions tab → "Nightly Prod → Dev Sync" → "Run workflow" |

The schedule is off-peak for South African business hours so devs find
fresh data when they start the day.

---

## 3. One-time setup (do this once before the first run)

### 3.1 Create GitHub repository secrets

Go to: **Repo settings → Secrets and variables → Actions → New repository secret**

Add these two secrets:

| Secret name | Value | Notes |
|---|---|---|
| `PROD_DATABASE_URL` | `postgres://<user>:<pass>@<prod-host>:5432/<prod-db>?sslmode=require` | Read-only credentials are sufficient. The script only runs `pg_dump` against PROD. |
| `DEV_DATABASE_URL` | `postgres://<user>:<pass>@<dev-host>:5432/<dev-db>?sslmode=require` | Must have `DROP SCHEMA` permission. The dev DB will be wiped on every run. |

> ⚠️ The dev URL must NOT contain any of: `production`, `prod-`, `.prod.`,
> `live-`, `.live.` — the script refuses to run if any of these tokens
> appear in the host or database name.

### 3.2 Verify the workflow can see the secrets

1. Go to the **Actions** tab.
2. Select **Nightly Prod → Dev Sync** in the left sidebar.
3. Click **Run workflow** → **Run workflow**.
4. Watch the run. The first step should print:
   ```
   [sync-prod-to-dev] prod = <prod-host>:5432/<prod-db>
   [sync-prod-to-dev] dev  = <dev-host>:5432/<dev-db>
   ```
   If it prints `PROD_DATABASE_URL is not set`, the secret is missing or
   typo'd.

### 3.3 Verify the dev DB is actually receiving data

After the first successful run, query the dev database:

```sql
SELECT * FROM dev_data_sync_sentinel ORDER BY synced_at DESC LIMIT 5;
```

You should see one row per successful sync, with the most recent at the
top.

---

## 4. Manual run (from your laptop)

If you need to refresh dev right now without waiting for the nightly job:

```bash
PROD_DATABASE_URL="postgres://user:pass@prod-host:5432/db?sslmode=require" \
DEV_DATABASE_URL="postgres://user:pass@dev-host:5432/db?sslmode=require"  \
  tsx scripts/sync-prod-to-dev.ts
```

You will need:
- `pg_dump` and `psql` installed locally (PostgreSQL 16 client matching the
  server version)
- `tsx` (or run via `npx tsx`)
- Network access to both prod and dev databases

The script prints progress to stdout and exits with a clear error code on
failure (see section 6).

---

## 5. What the dev database looks like after a sync

| State | Details |
|---|---|
| Schemas | Identical to prod (`public`, `core`, etc.) |
| Tables | Every prod table is present with all rows |
| Sequences | Reset to prod values |
| Extensions | Replicated from prod (`pgcrypto`, `uuid-ossp`, etc.) |
| Sessions | The `session` table is also copied — but live cookies will not match dev's secrets, so all users will need to log in fresh |
| Sentinel | `dev_data_sync_sentinel` table contains one row per sync |

Logged-in dev users will be **logged out** after a sync because the
session secrets and cookies don't match. They simply log in again.

---

## 6. Troubleshooting

| Exit code | Meaning | Fix |
|---|---|---|
| `10` | `PROD_DATABASE_URL` is not set | Add the GitHub secret or pass it via env when running locally |
| `11` | `DEV_DATABASE_URL` is not set | Same |
| `12` | Prod and dev URLs are identical strings | Confirm you're using two distinct connection strings |
| `13` | URL is malformed (bad protocol, missing host/user/db) | Fix the connection string format |
| `14` | Prod and dev resolve to the same host+port+database | This is the most important safety check. Make sure your dev DB is genuinely a separate database. |
| `15` | Dev URL contains a "production" token | Rename the dev database/host so its URL no longer contains `production`, `prod-`, `.prod.`, `live-`, or `.live.`. |
| `20` | A `psql` command failed | Check the stderr in the workflow log — usually a permission or connectivity issue |
| `30` | `pg_dump` failed | Usually means PROD credentials don't have read access, or the network is blocking the connection |
| `31` | Dump file is empty | PROD may be empty, or pg_dump is silently failing — check the workflow log |
| `40` | psql restore failed | Usually a constraint violation or extension mismatch — check the workflow log |
| `50` | Verification query failed after restore | Restore may have completed partially. Inspect the dev DB. |
| `51` | Critical-table verification query failed | Check `psql` stderr in workflow logs for permission/connectivity/schema issues |
| `52` | Restore completed but critical tables are missing | Dump/load succeeded technically, but expected application tables are absent (wrong DB, partial restore, or upstream schema issue) |
| `99` | Unhandled error | Check the stack trace in the workflow log |

### Common issues

**"FATAL: SSL connection is required"**
Your prod or dev URL is missing `?sslmode=require` (or your client doesn't
support it). Add `?sslmode=require` to the connection string.

**"role does not exist"**
The dev DB has a different role than the dump expects. The script uses
`--no-owner --no-acl` which strips owner/grant statements, so this should
not happen. If it does, check that the dev role has `CREATE` privilege on
the database.

**"out of memory"**
The dev DB is too small to hold the dump. Increase dev resources or
exclude unneeded large tables (this would be a separate enhancement to
the script).

**"refusing — DEV_DATABASE_URL appears to point at production"**
The script's safety guard 15 has tripped. Either rename the dev resource
to remove `production`/`prod-`/`live-` from its URL, or relax the
`PROD_HOST_HINTS` constant in `scripts/sync-prod-to-dev.ts` (carefully —
this guard is your last line of defence against accidentally writing to
prod).

---

## 7. Disabling or pausing the sync

If you need to pause the nightly sync temporarily:

1. Go to the **Actions** tab.
2. Select **Nightly Prod → Dev Sync** in the left sidebar.
3. Click the **`...`** menu → **Disable workflow**.
4. Re-enable the same way.

To remove the sync entirely, delete `.github/workflows/nightly-prod-to-dev.yml`
and `scripts/sync-prod-to-dev.ts`.

---

## 8. References

- `scripts/sync-prod-to-dev.ts` — the script
- `.github/workflows/nightly-prod-to-dev.yml` — the schedule
- Audit finding A6 in the consolidated audit report
- `docs/runbooks/secrets-rotation.md` — for the secrets rotation procedure
