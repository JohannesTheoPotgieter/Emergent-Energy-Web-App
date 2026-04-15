---
name: finance-snapshot-queries
description: Use when writing or reviewing any query against the temporal snapshot tables in shared/schema/finance.ts or shared/schema/projects.ts. Ensures every read filters out historical rows with effectiveTo IS NULL to avoid double-counting. Triggers on: normalizedCostLines, normalizedRevenueLines, cashflowPoints, financeRevenueMonthly, financeCosMonthly, categoryRevenueAllocations, projectRevenueSummary.
---

# Finance Snapshot Queries

## The Rule

The following tables store **temporal snapshots** with `effective_from` /
`effective_to` columns. Every row represents a historical state; currently-live
rows have `effective_to = NULL`. Any aggregate, list, or lookup query MUST
filter to live rows only — otherwise you double-count historical snapshots.

| Drizzle table                | Domain file                   | Notes                                      |
|------------------------------|-------------------------------|--------------------------------------------|
| `normalizedCostLines`        | `shared/schema/finance.ts`    | Current cost line table — use for new code |
| `normalizedRevenueLines`     | `shared/schema/finance.ts`    | Current revenue line table                 |
| `cashflowPoints`             | `shared/schema/finance.ts`    |                                            |
| `financeRevenueMonthly`      | `shared/schema/finance.ts`    |                                            |
| `financeCosMonthly`          | `shared/schema/finance.ts`    |                                            |
| `categoryRevenueAllocations` | `shared/schema/finance.ts`    |                                            |
| `projectRevenueSummary`      | `shared/schema/projects.ts`   |                                            |

**Deprecated:** `ProgramExpense` / `ProgramInflows` are legacy PE/PI type
aliases in `shared/schema/finance.ts`. Do NOT use for new code — use
`normalizedCostLines` / `normalizedRevenueLines`.

## Drizzle Pattern

```ts
import { and, eq, isNull } from "drizzle-orm";
import { normalizedCostLines } from "@shared/schema";

const rows = await db
  .select()
  .from(normalizedCostLines)
  .where(
    and(
      eq(normalizedCostLines.projectId, projectId),
      isNull(normalizedCostLines.effectiveTo), // ← REQUIRED
    ),
  );
```

## Raw SQL Pattern (when unavoidable)

```sql
SELECT … FROM normalized_cost_lines
WHERE project_id = $1
  AND effective_to IS NULL;      -- REQUIRED
```

## Review Checklist

When reviewing a PR that touches any of the tables above, grep for each table
name and verify every hit includes one of:

- `isNull(<table>.effectiveTo)` (Drizzle)
- `effective_to IS NULL` (raw SQL)

A query that omits the guard is almost always a bug — flag it.

## Exceptions

The only legitimate reasons to read historical rows:

1. An **audit/history** endpoint that explicitly surfaces the snapshot timeline
   (e.g. "show all versions of this cost line"). In that case, the omission
   must be obvious from the query and the function name.
2. A **backfill / migration script** that rewrites historical data in place.
3. A **reconciliation report** that compares current vs historical — these
   should use a sub-query pattern rather than a plain SELECT.

In all three cases, leave a code comment explaining why the guard is
intentionally omitted. Otherwise assume the query is buggy.
