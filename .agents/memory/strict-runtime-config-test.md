---
name: strict-runtime-config test env leak
description: Why qa/tests/unit/strict-runtime-config.test.ts fails in Replit containers and why it is not an app regression.
---

# strict-runtime-config test fails in Replit containers

`qa/tests/unit/strict-runtime-config.test.ts > "fails in production when DATABASE_URL
is missing"` expects `resolveDbConfig()` to throw, but it does not in this container.

**Cause:** the test clears only `NODE_ENV/DB_MODE/DATABASE_URL/JWT_SECRET`. Replit
containers also set `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`. `server/db-config.ts`
auto-detects `PGHOST` and synthesises a `DATABASE_URL` before reaching the production
guard, so it never throws.

**Why it matters:** this is a pre-existing test-isolation gap, environment-driven, not a
finance/app regression. Don't chase it when QA-ing unrelated features. Proper fix (test
infra) is to also delete the `PG*` vars in the test's env setup.
