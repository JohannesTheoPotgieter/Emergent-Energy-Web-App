# Pipedrive integration hardening — 2026-04-22

**Owner:** Platform / D1 (CRM truth boundary)
**Trigger:** Task #29. Admin Pipedrive page (`/admin/pipedrive`) was showing
the most recent run (`id=5`, 2026-04-22 06:36 UTC) as `partial` with
hundreds of per-deal errors of the form
`"Deal <id>: Failed query: select \"id\", … from clients where pipedrive_org_id = $1"`.
Sync was visibly degraded for the operator and a meaningful fraction of
deals were not being mapped to clients.

This runbook documents (a) the actual root cause, (b) the hardening
shipped to make the failure mode impossible to repeat, and (c) the
operating procedure when the same class of issue resurfaces.

---

## 1. Root cause

The brief proposed two hypotheses (type coercion on `pipedrive_org_id`
and a null-org fallback that swallows all errors). Neither was the
proximate cause. The proximate cause was **schema drift** between this
environment's database and the application's Drizzle schema:

* Migration `migrations/0013_client_email_domains.sql` adds
  `clients.primary_email_domain` (text) and
  `clients.additional_email_domains` (jsonb).
* `shared/schema/projects.ts` references both columns. Drizzle's
  generated SELECT therefore lists every `clients` column — including
  the two missing ones.
* The dev DB had not had `0013` applied. Every call to
  `db.select().from(clients).where(eq(clients.pipedriveOrgId, …))`
  blew up with `column "primary_email_domain" does not exist`.
* The sync's `try { … find or create client … } catch` branch was wide
  enough to swallow the SQL error and surface it as an opaque per-deal
  string.

The `pipedrive_org_id` text-vs-int hypothesis was not borne out: the
column is `text`, all 1,182 PD-prefixed clients store it as text, and
the failing SQL was successfully formed and bound — it was the SELECT
list itself that referenced a non-existent column.

### Immediate fix

```sql
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS primary_email_domain text,
  ADD COLUMN IF NOT EXISTS additional_email_domains jsonb DEFAULT '[]'::jsonb;
```

Verified columns present, `npm run db:push` is the canonical recovery
once a TTY is available.

---

## 2. Hardening (this PR)

### 2.1 Centralised field-mapping registry

`server/services/pipedrive-field-mapping.ts` is the single source of
truth for every Pipedrive deal field the sync reads.

Each entry declares `{ source, target, owner, nullsOverwrite, transform,
notes }`. Owner is one of:

| Owner        | Meaning                                                                 |
|--------------|-------------------------------------------------------------------------|
| `pipedrive`  | CRM truth — the sync overwrites the column on every run.                |
| `app`        | App-owned — the sync MUST NOT touch (negative-asserted in unit tests).  |
| `derived`    | Computed from other source fields (e.g. `stage` ← stage map).           |
| `enrichment` | Populated from a side call (person email, owner email→user_id lookup).  |

Two derived sets are exported and used as guard rails:

* `PIPEDRIVE_WRITABLE_COLUMNS` — what the sync may write
* `PIPEDRIVE_APP_OWNED_COLUMNS` — what the sync must never write
  (`notes`, `commercialRisks`, `fundingType`, `contractType`, `siteId`,
  `handoverReadiness`)

Adding a new Pipedrive field is now a one-line entry in the registry —
the sync engine picks it up automatically.

### 2.2 Schema self-check at sync start

`server/services/pipedrive-sync-service.ts` now calls
`checkSchemaParity()` immediately after the API-token check.
It SELECTs `information_schema.columns` for the columns the sync
depends on (clients + opportunities) and aborts the run with one
clearly-labelled `schema_mismatch` error if any are missing. The bad
old behaviour — N opaque per-deal SQL dumps — is no longer reachable.

### 2.3 Hardened client/org matching

`resolveClientId(deal)` now follows a documented three-step priority:

1. Direct match on `clients.pipedrive_org_id` (text, normalised via
   `coerceOrgIdToText` so an int or a string never disagree).
2. Email-domain match: pull *all* candidates where
   `primary_email_domain = <domain>` OR
   `additional_email_domains @> [<domain>]` (no `LIMIT`). The match is
   accepted only when there is **exactly one** candidate AND its
   `pipedrive_org_id` is null OR equals the incoming org id. Multiple
   candidates, or a single candidate already bound to a different
   `pipedrive_org_id`, emit a `client_resolve` warning into
   `result.errors` (visible on the admin page) and the deal falls
   through to the safe-create branch — never silently merging two
   unrelated orgs. The match is also accepted only
   when the existing client has either no `pipedrive_org_id` or the
   same one — preventing two unrelated orgs that share a domain from
   collapsing into one record. When unambiguous the org id is
   backfilled onto the existing client.
3. Safe new-client creation with `client_id = PD-{orgId}` inside a
   transaction guarded by `pg_advisory_xact_lock(0x50444341)`. The
   txn re-reads inside the lock so two concurrent syncs cannot insert
   the same `PD-{orgId}` row and race on the unique constraint.

`null` org id ⇒ structured `missing_org` error and the deal is not
auto-created (we do not want CRM-orphan opportunities).

### 2.4 Idempotent updates

`syncSingleDeal` now diffs the prepared payload against the existing
opportunity row column-by-column (with `Date` / decimal-string
tolerance via `fieldsEqual`) and calls UPDATE only when at least one
tracked column actually changed. `updatedAt` is stamped only on real
writes. **A second consecutive sync with no Pipedrive changes produces
zero UPDATEs and zero errors** — the result counters distinguish
`dealsUpdated` from `dealsUnchanged`.

### 2.5 Typed structured errors

The sync result's `errors` field changed shape from
`string[]` → `StructuredSyncError[]`:

```ts
interface StructuredSyncError {
  dealId: number | null;
  dealTitle: string | null;
  class: "missing_org" | "schema_mismatch" | "type_coercion"
       | "missing_field" | "api_error" | "client_resolve" | "unknown";
  message: string;        // first informative line, never the full SQL dump
  retryable: boolean;
}
```

`classifySyncError(err)` does best-effort classification and
`extractPgErrorLine(raw)` strips the noisy `Failed query: select …` /
`params: …` lines so the admin sees `column "x" does not exist`
instead of a 1.5 KB blob.

The admin UI (`client/src/pages/admin-pipedrive.tsx`) now renders:

* a per-error-class badge summary (`Schema mismatch: 24 · Missing org: 3`)
* per-error rows with deal id + title, the human label, the
  retryable flag, and the cleaned message.

Old plain-string log rows still render correctly via a back-compat
branch in `parseErrors`.

### 2.6 App-owned field protection

The sync's UPDATE/INSERT payload is built exclusively from the
registry's CRM-owned entries. As a defence-in-depth step,
`syncSingleDeal` filters the payload through `PIPEDRIVE_WRITABLE_COLUMNS`
before writing — even a future bug in the registry cannot leak an
app-owned column into the SET clause. `notes` is seeded once on INSERT
(`"Pipedrive: <title>"`) and never touched on UPDATE.

### 2.7 `project_info`-linked guard preserved

The "if this opportunity has a non-deleted `project_info` shell linked
to it, skip the sync entirely" guard is unchanged and runs before any
write — converted projects stay frozen.

---

## 3. Tests

`qa/tests/unit/pipedrive-sync-mapping.test.ts` covers:

* Registry invariants (CRM-owned and app-owned sets are disjoint;
  every custom-field hash is registered).
* `buildCrmOwnedFieldsFromDeal` produces the expected payload, never
  emits app-owned columns, omits sparse custom fields when source is
  null, and overwrites with null when `nullsOverwrite=true`.
* `pipedriveDateOnly`, `renderLabels`, `resolveProvinceFromLeadLocation`,
  `asNumericString`, `coerceOrgIdToText` transforms.
* `classifySyncError` correctly tags missing-column, invalid-syntax,
  network, and missing-org errors and returns clean messages.

Run: `npx vitest run -c qa/vitest.config.ts qa/tests/unit/pipedrive-sync-mapping.test.ts`

---

## 4. Operator playbook — Pipedrive sync looks broken

1. **Open `/admin/pipedrive`. Look at the most recent row.**
   * `Schema mismatch` badge → migrations are out of date for this DB.
     Run `npm run db:push` (TTY required) **or** apply the missing
     migration directly. The sync cannot succeed until the DB matches
     `shared/schema/*.ts`.
   * `Missing org` badges → expected for any Pipedrive deal with no
     organisation. Fix on the Pipedrive side or accept the warning.
   * `Pipedrive API` badge with `retryable=true` → transient network
     issue; rerun the sync.
   * `Client lookup` badge → check for duplicate `client_id` values
     in `clients` (inspect `pipedrive_sync_log.errors[].message`).
   * `Type error` badge → almost certainly a Pipedrive payload that
     stopped matching the registry. Check the deal id surfaced in
     the error and add a transform to the registry entry.
2. **Confirm idempotency.** Trigger the sync a second time. Expect
   `dealsUpdated = 0`, `dealsUnchanged ≈ dealsProcessed`, no new
   errors. If a re-run keeps writing, a registry transform is
   producing a value that doesn't equal what the column already holds
   (look for type coercion: numeric strings vs numbers, dates vs
   strings, label CSV ordering).
3. **Never edit Pipedrive from the app.** Only read paths are
   permitted; if you need to mutate Pipedrive, do it in Pipedrive.

---

## 5. What was deliberately *not* changed

* Pipedrive token rotation — separate task already in flight.
* The `pipedrive-routes.ts` concurrency lock & "stale running" sweeper
  — already correct; left as-is.
* `pipedrive_org_id` int↔text coercion at the DB layer — column is
  text and the registry's `coerceOrgIdToText` makes the mismatch
  unrepresentable in code, so no DDL needed.
* Duplicate prevention on `clients(pipedrive_org_id)` — there is no
  unique index today; the advisory-locked upsert plus the existing
  `clients_client_id_key` UNIQUE on `client_id` (which we always
  derive as `PD-{orgId}`) covers the race. A unique index on
  `pipedrive_org_id` would still be a defence-in-depth improvement,
  filed as a follow-up.

---

## 6. Files changed

* `server/services/pipedrive-field-mapping.ts` — new
* `server/services/pipedrive-sync-service.ts` — refactored
* `client/src/pages/admin-pipedrive.tsx` — structured-error renderer
* `qa/tests/unit/pipedrive-sync-mapping.test.ts` — new
* `docs/runbooks/pipedrive-integration-hardening-2026-04-22.md` — this file
* DB: `clients.primary_email_domain`, `clients.additional_email_domains`
  applied directly to align with migration `0013_client_email_domains.sql`.
