---
description: Review session changes for EE-specific invariants (snapshot guards, RBAC, repository layer, migrations).
---

Review the files I've changed in this session against the Emergent Energy
invariants documented in `CLAUDE.md`. Do NOT run the full test suite — this is
a static review only.

For each changed file, check:

1. **Snapshot queries** — any query against `normalizedCostLines`,
   `normalizedRevenueLines`, `cashflowPoints`, `financeRevenueMonthly`,
   `financeCosMonthly`, `categoryRevenueAllocations`, or `projectRevenueSummary`
   MUST include `isNull(table.effectiveTo)` (Drizzle) or `effective_to IS NULL`
   (raw SQL). Flag any that don't.
2. **RBAC middleware** — any new route must use `requireAuth` and
   `requireRole([...])` from `server/middleware/`. Flag routes without both.
3. **Repository layer** — route handlers must not call `db.select()` /
   `db.insert()` / `db.update()` / `db.delete()` directly. Data access goes
   through `server/repositories/`.
4. **Route file location** — new route files must live under `server/routes/`
   as `<domain>.routes.ts`, not as `server/<domain>-routes.ts`.
5. **Schema edits** — new tables/columns must be added to the relevant
   `shared/schema/*.ts` domain file, NOT to `shared/schema.ts` (which is only
   a barrel re-export).
6. **Migrations** — new migrations live under `/migrations/` at repo root,
   NOT `server/migrations/`. Every migration statement must use
   `IF NOT EXISTS` / `IF EXISTS` guards and be additive (no destructive drops
   or renames without an explicit safe-migration plan).
7. **SQLite-incompatible SQL** — flag any `::` cast syntax or Postgres-only
   constructs in raw SQL that would break the dev SQLite fallback.
8. **Error handling** — routes throw `ApiError` from `server/lib/api-error.ts`.
   Flag any `res.status(500).json({ error: err })` or raw error leaks.
9. **Type safety** — flag any new `any`, `as any`, `@ts-ignore`, or
   route-local interface that duplicates a schema-inferred type.
10. **Legacy files** — flag any new code added to `server/work-items-adapter.ts`,
    `server/work-items-backfill.ts`, `server/excelParser.ts`, or
    `server/importPipeline.ts` (all legacy / read-only).

Output: a numbered checklist. For each finding, give:

- File path and line number
- The rule it violates (from the list above)
- A one-line suggested fix

If everything passes, say so explicitly and stop.
