# Migration Integration Tests

Executable tests that apply all migrations against a real Postgres database, seed fixture data, and verify backfill correctness with deterministic assertions.

## Quick Start

```bash
# Requires DATABASE_URL or MIGRATION_TEST_DATABASE_URL pointing to a disposable Postgres
export DATABASE_URL=postgresql://test:test@localhost:5432/emergent_test

npm run test:migrations
```

## What It Does

1. Connects to a real Postgres instance
2. Applies `script/pre-push-enums.sql` and `script/full-schema-alignment.sql` (creates base schema)
3. Seeds minimal fixture data (users, clients, counterparties, projects, cost/revenue lines, change requests, approvals)
4. Applies all 176+ migration files in order (excluding rollbacks and prod-only variants)
5. Runs assertions against the resulting database state

## Test Coverage

| Domain | Phase | What's Verified |
|--------|-------|-----------------|
| **Schema creation** | All | 10 promoted schemas exist (core, finance, internal, etc.) |
| **Parties/Users/Roles** | A | Parties backfilled from counterparties, clients, users; user_accounts created with party_id FK |
| **Project spine** | B | project_instances created, client_party_id populated, project_party_links with role assignment |
| **Work engine** | C | work_packages and work_items_v2 tables exist and are queryable |
| **Approvals/Deliverables** | D/E | governed_processes, deliverable_definitions, approval_instances exist, FK integrity |
| **Finance** | F | finance_records backfilled from cost/revenue/change_requests; amount SUMs match; direction logic correct; party_id populated for VOs |
| **Bridge infra** | - | bridge_sync_failures and sync_watermarks tables exist |
| **Support tables** | G/H | external_resources, activity_logs, strategic_priorities, import_batches exist |
| **FK integrity** | Cross | No orphaned FKs across all major join paths |
| **Post-migration mutations** | - | INSERT/UPDATE/DELETE on legacy tables still works after migrations |
| **Idempotency** | - | Key promoted tables still exist after full migration pass |

## Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `MIGRATION_TEST_DATABASE_URL` | (none) | Dedicated test DB connection string (highest priority) |
| `DATABASE_URL` | `postgresql://test:test@localhost:5432/emergent_test` | Fallback connection string |

## CI Integration

The test runs automatically in CI after unit tests:

```yaml
# .github/workflows/ci.yml
- run: npm run test:migrations
  name: Migration integration tests
```

CI provisions a Postgres 16 service container with credentials `test/test` and database `emergent_test`.

## Running Locally

```bash
# Option 1: Use Docker
docker run -d --name pg-test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=emergent_test -p 5432:5432 postgres:16
export DATABASE_URL=postgresql://test:test@localhost:5432/emergent_test
npm run test:migrations

# Option 2: Use existing local Postgres
createdb emergent_test_local
export MIGRATION_TEST_DATABASE_URL=postgresql://localhost/emergent_test_local
npm run test:migrations
dropdb emergent_test_local
```

## Files

| File | Purpose |
|------|---------|
| `qa/tests/integration/migration-test-helper.ts` | DB connection, migration runner, fixtures, assertion helpers |
| `qa/tests/integration/migration-execution.test.ts` | Test suites (11 describe blocks, 40+ tests) |
| `qa/vitest.integration.config.ts` | Separate vitest config with 5-min timeout, single-fork pool |
| `docs/migration-integration-tests.md` | This documentation |

## Design Decisions

- **Separate vitest config** — migration tests need 5-min timeouts and single-fork isolation; unit tests need fast parallel execution
- **psql for migration application** — handles `$$` blocks, `DO` blocks, and transactions correctly; much faster than statement-level Node.js execution
- **Minimal fixtures** — 3 users, 2 clients, 2 counterparties, 2 projects, 3 cost lines, 2 revenue lines, 2 change requests, 2 approvals; enough to exercise all backfill paths without brittleness
- **Deterministic assertions** — count thresholds (>= N) rather than exact matches; SUM comparisons with tolerance; FK existence checks rather than specific values
- **Mutation tests use INSERT/UPDATE/DELETE** — proves legacy tables are still writable after spine view swap and all migrations
