# Memory Index

- [Dev DB schema drift](dev-db-drift.md) — ledger can say "all migrations applied" while columns are absent; root-cause via Postgres 42703 and re-apply idempotent ALTERs to dev only.
- [Playwright / long gates in this container](playwright-and-gates.md) — bundled Chromium misses libglib; use REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE + --no-sandbox; detached bash jobs die across calls — use the validation runner.
- [strict-runtime-config test env leak](strict-runtime-config-test.md) — fails in Replit containers because PGHOST fallback synthesises DATABASE_URL; not an app bug.
