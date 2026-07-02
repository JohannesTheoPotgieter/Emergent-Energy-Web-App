# Dev vs Production Compatibility Audit (2026-04-14)

## Scope and safety constraints
- Read-only audit only; no data mutations performed.
- Production data protection policy: additive/reversible/idempotent changes only.
- This report treats previous findings as hypotheses and verifies against repository code/migrations.

## What was verified in code
1. Route registration topology and load order.
2. Duplicate route handler registrations.
3. Migration inventory vs migration journal tracking.
4. FK/on-delete declarations linked to `project_info`.
5. Index definitions for `normalized_cost_lines` and `normalized_revenue_lines`.
6. Feature-flag defaults/seed behavior.
7. Runtime environment assumptions impacting auth, permissions, and route exposure.
8. Seed/backfill/cached or derived behavior.

## Constraints discovered during this audit
- No production DB credentials are available in this runtime session, so a *live* schema diff cannot be executed from here.
- Because of that, the reconciliation plan below includes a safe read-only drift script to run against both environments before deployment.

## Findings

### Remediation status update (implemented in code)
- Duplicate route registrations were removed for:
  - `GET /api/tasks` (legacy duplicate removed from `work-items-extracted-routes.ts`).
  - `GET /api/quality/dashboard` (duplicate removed from `quality-ncr-routes.ts`).
  - `GET /api/admin/stage-definitions`, `GET/POST/PATCH /api/admin/stage-checklist-templates*` duplicates in `stage-lifecycle-routes.ts`.
  - `GET /api/pm-assignable-users` duplicate in `auth-routes.ts`.
  - `PATCH /api/expenditure/font-color-toggle` duplicate placeholder in `finance-legacy-extracted-routes.ts`.
  - Overlapping commitments/updates/queries routes removed from `stage-collaboration-routes.ts` (canonical owner remains `collaboration-workflow-routes.ts`).
- Added CI-style duplicate detection script: `scripts/check-duplicate-routes.ts` (wired to `npm run check:duplicate-routes`).
- Added additive idempotent index parity migration for normalized financial lines:
  - `migrations/20260414_safe_parity_normalized_line_indexes.sql`.

### 1) Duplicate route registrations are present and load-order dependent (verified)
- `registerAllRoutes` registers route groups in this order: core → integrations → info → project → support → department → admin → extracted → legacy shell. First match in Express wins, so earlier registration can shadow later duplicates.
- Verified duplicates include:
  - `GET /api/tasks` in both `task-management-routes.ts` and `work-items-extracted-routes.ts`.
  - `GET /api/quality/dashboard` in both `quality-routes.ts` and `quality-ncr-routes.ts`.
  - `GET /api/admin/stage-definitions` and stage checklist template endpoints in both `stage-lifecycle-routes.ts` and `routes/stage-admin-routes.ts`.
  - `GET /api/pm-assignable-users` in both `engineering-routes.ts` and `routes/auth-routes.ts`.
  - Collaboration endpoints duplicated between `collaboration-workflow-routes.ts` and `stage-collaboration-routes.ts`.
  - Intra-file duplicate: `PATCH /api/expenditure/font-color-toggle` appears twice in `finance-legacy-extracted-routes.ts`.

### 2) Collaboration route deprecation metadata is internally inconsistent (verified)
- `collaboration-workflow-routes.ts` header says it is “NOT registered”, but `register-project-routes.ts` does register it.
- `stage-collaboration-routes.ts` header says canonical routes are in collaboration workflow and legacy routes are shadowed. Both cannot simultaneously be true without drift.

### 3) Migration tracking drift risk is high (verified from repo state)
- `migrations/` contains a large migration set (many timestamped SQL files), while `migrations/meta/_journal.json` only lists two applied entries (`0000_*`, `0001_*`).
- This mismatch strongly indicates environment-specific migration execution/state divergence risk unless production is using an external migration runner/history table not represented in this journal.

### 4) `project_info` FK on-delete behavior is mixed (verified)
- Many references to `project_info.id` explicitly set `onDelete: "cascade"`.
- Multiple references omit `onDelete`, leaving DB default behavior (typically `NO ACTION`/`RESTRICT`) dependent on generated DDL and historical migration state.
- This can produce dev/prod behavioral differences if constraints were created in different waves.

### 5) Normalized finance line indexes: migration intent exists, but live parity unverified
- Repository migrations include `idx_normalized_cost_lines_project_id` and `idx_normalized_revenue_lines_project_id` creation in `20260323_project_spine_backfill.sql`.
- Additional temporal/idempotency indexes also exist in later migrations.
- Because live DB introspection was unavailable in this session, we cannot certify both dev and prod currently have the same realized index set.

### 6) Feature flags are DB-backed, default-false-heavy, and startup-seeded conditionally
- Feature flags are read from `app_settings` and default to `false` when missing.
- Startup seeds call `ensureRolloutFeatureFlags` only when startup mutations are allowed.
- This means identical code can expose different behavior if env startup mutation toggles differ (or if app_settings rows are missing).

### 7) Environment-sensitive auth/permission/runtime behavior exists
- Strict runtime (`production`/`staging`) enforces `SESSION_SECRET` and `DATABASE_URL`; non-strict can fall back (ephemeral session secret, SQLite).
- Permission checks include DB role permissions + per-user overrides with cache TTL.
- Startup orchestration defaults production to read-only behavior for seeds/backfills unless explicit flags/modes enable mutations.

### 8) Seed and derived/cached behaviors may drift by environment
- Seed execution is one-time guarded via backfill registry keys and startup flags.
- Permission caches and user override caches are in-memory with TTL and can temporarily diverge from DB updates.
- Derived snapshots/materialized metrics are maintained by migrations and runtime jobs; parity requires live validation.

---

## Drift register
| ID | Area | Severity | Evidence | Impact tomorrow morning | Safe parity action |
|---|---|---|---|---|---|
| D1 | Duplicate routes + load-order shadowing | High | Multiple duplicate path registrations across route modules | Endpoint behavior can differ by registration order and future edits | Freeze duplicate endpoints behind single owner map; block new duplicates in CI |
| D2 | Collaboration route deprecation contradiction | High | Headers conflict with actual registration | Engineers may “fix” wrong module; risk accidental behavior change | Mark one canonical module and disable duplicate registration path with feature flag/guard |
| D3 | Migration journal vs migration files mismatch | Critical | `migrations/meta/_journal.json` has only 2 entries while many migrations exist | Dev applies cleanly while prod fails/skips due unknown history | Run read-only migration-state inventory in both envs before deploy; no auto-run destructive migrations |
| D4 | Mixed `project_info` FK on-delete semantics | Medium | Some refs with cascade, others unspecified | Delete/update behavior may differ across envs | Add explicit, additive FK standardization migrations only after data impact analysis |
| D5 | Normalized-line index realization uncertain | High | Migrations define indexes but live parity unknown | Perf regressions/timeouts in one env only | Run index inventory query in dev+prod; add `CREATE INDEX IF NOT EXISTS` remediation migration if missing |
| D6 | Feature flag row drift | High | DB-stored flags + conditional startup seeding | Route/UI exposure mismatch by environment | Export and diff `app_settings` rollout flags before deploy; apply idempotent upserts only |
| D7 | Env-mode assumptions (SQLite fallback, startup mutation flags) | High | Runtime branches by env vars | Auth/data behavior can diverge immediately | Enforce env parity checklist gate in deployment pipeline |
| D8 | Seed/backfill/derived state assumptions | Medium | Startup flags + one-time markers | Data completeness differs across envs | Verify backfill registry + key derived row counts pre-deploy |
| D9 | Destructive migration committed (`drop_program_*`) | Critical | Migration file explicitly drops tables with irreversible data loss without backup restore | Any accidental apply can lose legacy data and dependent rows | Block this migration in automated deploy path; manual run only with snapshot+approval |

---

## Safe tonight changes (no production data mutation)
1. **Run read-only drift inventory script in both dev and prod** (provided in `scripts/sql/dev_prod_drift_audit.sql`).
2. **Block risky rollout behavior**:
   - Do **not** auto-apply `20260414_drop_program_expense_and_program_inflows.sql`.
   - Require explicit migration allowlist for tonight’s deploy.
3. **Operational guardrail**:
   - Produce and compare endpoint duplicate list before deploy; treat any newly introduced duplicate as release blocker.
4. **Feature-flag parity gate**:
   - Export rollout flags from both envs; any mismatch in security/data visibility flags requires explicit change ticket.

## Needs approval (high-risk or behavior-changing)
1. Deduplicate/retire overlapping route handlers where contract may change.
2. Standardize all `project_info` FK `on delete` actions (requires explicit business-approved delete semantics).
3. Apply destructive legacy-table drop migration (requires backup, rollback-by-restore, and explicit approval).
4. Any seed/backfill execution in production that mutates data outside emergency path.

## Idempotent migration/config plan
1. **Read-only phase (required before deployment):** run `scripts/sql/dev_prod_drift_audit.sql` in both envs and diff outputs.
2. **Additive DB fixes only (if drift confirmed):**
   - Missing indexes: `CREATE INDEX IF NOT EXISTS ...` for normalized tables.
   - Missing non-destructive flags/settings: `INSERT ... ON CONFLICT DO UPDATE` in `app_settings`.
   - Missing non-destructive constraints only if validated with `NOT VALID` + `VALIDATE CONSTRAINT` pattern.
3. **Route safety:** add CI duplicate-route detector and block merges introducing duplicates.
4. **Destructive operations:** keep quarantined behind manual runbook and explicit approval.

## Validation checklist before deployment
- [ ] Drift audit SQL run against dev and prod, outputs archived.
- [ ] Migration history tables/journal reconciled and mapped to actual applied SQL in each env.
- [ ] Duplicate route report reviewed; no new duplicates; known duplicates explicitly accepted or blocked.
- [ ] `project_info` FK inventory reviewed for on-delete behavior differences.
- [ ] `normalized_cost_lines` / `normalized_revenue_lines` index inventory matches expected set.
- [ ] Feature flags (`app_settings`) parity validated for rollout/security-sensitive flags.
- [ ] Environment variable parity confirmed for auth, permissions, startup mutation toggles, and DB mode.
- [ ] Seed/backfill registry parity validated; no surprise production startup mutations enabled.
- [ ] Destructive migrations excluded from automatic deployment run.

## Rollback
- **Config/flag changes:** revert via idempotent upsert to previous values.
- **Additive indexes:** safe to leave; if required, `DROP INDEX CONCURRENTLY` in controlled window.
- **Route registration changes:** revert commit to restore prior handler ownership.
- **Any destructive migration:** rollback requires verified backup/snapshot restore path; SQL rollback files that recreate structure do not restore data.

---

## A. Safe tonight
- Read-only drift inventory and parity gates.
- Block destructive migration auto-apply.
- No schema/table destructive action.

## B. Needs approval
- Route deduplication that changes active handler ownership.
- FK on-delete standardization.
- Any production data-mutating backfill/seed beyond existing approved runbooks.
- `program_expense` / `program_inflows` drop migration execution.

## C. Later structural cleanup
- Consolidate collaboration route modules and remove contradictory deprecation headers.
- Introduce single source of truth for migration state (journal + applied SQL table contract).
- Create automated dev/prod drift report job (schema, indexes, flags, route map, env assumptions).
