# Schema Authority Model

## Single Authority: Versioned Migrations

Versioned SQL migrations in `migrations/*.sql` are the **sole schema authority** for all environments. No other mechanism may create, alter, or drop database objects in production.

## Environment Behavior

| Environment | Schema DDL Source | Startup DDL | db.ts DDL | Guard |
|---|---|---|---|---|
| **Production** | `migrations/*.sql` only | BLOCKED | None | `NODE_ENV=production` hard block |
| **Staging** | `migrations/*.sql` only | BLOCKED | None | `NODE_ENV=staging` hard block |
| **Development** (post-migration) | `migrations/*.sql` | Skipped | None | `isPromotedSchemaPresent()` detects `core.projects` |
| **Development** (first-boot) | Startup orchestrator | Runs additive alignments | None | Only when promoted schema absent |

## How It Works

### Production / Staging

1. Migrations are applied via CI/CD before the app starts (e.g., `npm run db:push` or direct `psql` execution).
2. On startup, `runStartupOrchestrator()` checks `NODE_ENV`:
   - If `production` or `staging`: **all startup DDL is blocked**, regardless of flags.
   - A warning is logged if `core.projects` doesn't exist (migrations haven't been run).
3. `server/db.ts` contains **zero DDL** in the PostgreSQL connection path. It only creates the connection pool.

### Development (Normal)

Once versioned migrations have been applied (detected by `core.projects` existing):
- Startup DDL is skipped — same behavior as production.
- The reconciliation scheduler starts for bridge health monitoring.

### Development (First Boot / No Migrations)

For brand-new local environments where migrations haven't been run yet:
1. `isPromotedSchemaPresent()` returns `false` (no `core.projects` table).
2. Startup orchestrator runs legacy safety nets:
   - `runDrizzleSchemaSync()` — applies `pre-push-enums.sql` and `full-schema-alignment.sql`
   - `runAdditiveSchemaAlignments()` — creates tables and adds columns with `IF NOT EXISTS`
3. This is a **one-time bootstrap** — once migrations are applied, this path is never taken again.

## Defense in Depth

Three independent guards prevent production schema mutation:

1. **Orchestrator-level**: `NODE_ENV === "production"` check in `runStartupOrchestrator()` blocks all DDL paths before they're called.
2. **Function-level**: Both `runDrizzleSchemaSync()` and `runAdditiveSchemaAlignments()` have their own `NODE_ENV` checks that return immediately in production/staging.
3. **Schema-level**: `isPromotedSchemaPresent()` skips DDL when versioned migrations have been applied (even in development).

## What Was Removed

### `server/db.ts` DDL (removed)
Previously, the PostgreSQL connection init path contained:
- `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS ...` (10 columns)
- `CREATE TABLE IF NOT EXISTS entity_assignments ...` with 3 indexes

This DDL was redundant with `runAdditiveSchemaAlignments()` and ran on every app restart, including production. It has been removed entirely.

### `runtime-schema-compatibility.ts` (already neutered)
Already returns early in production. No DDL executed.

### `maintenance.ts` (already neutered)
Already returns early. No DDL executed.

## Migration Workflow

### Adding a New Table or Column

1. Add the Drizzle schema definition in `shared/schema/*.ts`.
2. Generate a migration: create `migrations/YYYYMMDD_description.sql` with the DDL.
3. Apply in dev: `npm run db:push` or `psql $DATABASE_URL -f migrations/YYYYMMDD_description.sql`.
4. CI/CD applies the migration before deploying the new app version.

### Do NOT

- Add `CREATE TABLE` or `ALTER TABLE` statements to `startup-orchestrator.ts` for new features.
- Add DDL to `server/db.ts` connection initialization.
- Use `ENABLE_STARTUP_SCHEMA_REPAIR=true` in production.

## Files

| File | Role |
|---|---|
| `migrations/*.sql` | Authoritative schema definitions |
| `shared/schema/*.ts` | Drizzle ORM schema (TypeScript source of truth) |
| `script/pre-push-enums.sql` | Generated: enum types + stub tables (dev bootstrap only) |
| `script/full-schema-alignment.sql` | Generated: ADD COLUMN IF NOT EXISTS (dev bootstrap only) |
| `server/bootstrap/startup-orchestrator.ts` | Startup DDL orchestration (blocked in production) |
| `server/db.ts` | Database connection only (no DDL) |
| `server/bootstrap/runtime-schema-compatibility.ts` | Neutered — no DDL |
| `server/bootstrap/maintenance.ts` | Neutered — no DDL |
