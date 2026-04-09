# markProjectsActive + getProjectCounts — Behavioral Invariants

> Baseline document for extraction wave.
> Source: `server/storage.ts` lines 841–877 (as of 2026-04-09).
> Do NOT modify this doc unless the production code changes first.

## Methods in scope

| Method | Visibility | Lines | Role |
|--------|-----------|-------|------|
| `markProjectsActive(activeNames: string[])` | public (IStorage) | 841–863 | State writer — marks projects active/archived via dual-write |
| `getProjectCounts()` | public (IStorage) | 865–877 | State reader — returns active/historical/total counts |

---

## 1. markProjectsActive — behavior map

### Signature

```typescript
async markProjectsActive(activeNames: string[]): Promise<void>
```

### Empty-input behavior

`activeNames.length === 0` → early return, no DB calls.

### Database operations (4 sequential, no transaction)

| # | Target table | Method | SQL behavior | Platform |
|---|-------------|--------|-------------|----------|
| 1 | `project_info` | Drizzle `.update()` | SET isActive=true, updatedAt=new Date() WHERE project_name IN activeNames | Portable (Drizzle) |
| 2 | `project_info` | Drizzle `.update()` | SET isActive=false WHERE project_name NOT IN activeNames | Portable (Drizzle) |
| 3 | `project_execution_state` | Raw SQL `execute()` | SET deleted_at=NULL, is_active=true, updated_at=NOW() WHERE project_id IN (SELECT id FROM project_info WHERE project_name = ANY(activeNames)) | **PostgreSQL-only** |
| 4 | `project_execution_state` | Raw SQL `execute()` | SET deleted_at=NOW(), is_active=false, updated_at=NOW() WHERE project_id IN (SELECT id FROM project_info WHERE project_name != ALL(activeNames)) AND deleted_at IS NULL | **PostgreSQL-only** |

### CRITICAL BUG: Operations 1 & 2 reference dropped column

- Migration `20260337_drop_moved_columns_project_info.sql` (line 36) dropped `is_active` from `project_info`.
- The Drizzle schema at `shared/schema/projects.ts:100–119` has NO `isActive` column.
- Operations 1 & 2 attempt to set `isActive` on `projectInfo` via Drizzle ORM.
- **Runtime behavior**: Drizzle may silently ignore the unknown field, or may throw. Either way, this is dead code — operations 3 & 4 are the actual state writers.

### Semantic rules

- **"Active"** = `project_execution_state.deleted_at IS NULL` (AND `is_active = true`, deprecated)
- **"Archived"** = `project_execution_state.deleted_at IS NOT NULL` (AND `is_active = false`, deprecated)
- The method marks ALL rows not in `activeNames` as archived (operations 2 & 4)
- Operation 4 has an idempotent guard: `AND deleted_at IS NULL` — already-archived rows are not re-archived

### PostgreSQL-specific constructs

| Construct | Used in | SQLite equivalent |
|-----------|---------|-------------------|
| `= ANY(array)` | Operation 3 | `IN (...)` |
| `!= ALL(array)` | Operation 4 | `NOT IN (...)` |
| `NOW()` | Operations 3 & 4 | `datetime('now')` |

### Transaction safety

There is **no explicit transaction** wrapping the 4 operations. If operation 3 succeeds but operation 4 fails, the database will be in an inconsistent state where:
- Some projects are correctly active in `project_execution_state`
- But non-active projects have not been archived in `project_execution_state`

---

## 2. getProjectCounts — behavior map

### Signature

```typescript
async getProjectCounts(): Promise<{ active: number; historical: number; total: number }>
```

### Database operations (2 queries)

| # | Query | Tables | Join | Filter |
|---|-------|--------|------|--------|
| 1 | Active count | `project_info` LEFT JOIN `project_execution_state` ON `project_id = project_info.id` | LEFT JOIN | `WHERE project_execution_state.deleted_at IS NULL` |
| 2 | Total count | `project_info` | None | None |

### Return shape

```typescript
{
  active: number,      // count from query 1 (default: 0)
  historical: number,  // computed: total - active
  total: number        // count from query 2 (default: 0)
}
```

**Note**: The return key is `historical`, NOT `archived`. Consumers receive `{ active, historical, total }`.

### Semantic definitions

| Term | Definition | Source |
|------|-----------|--------|
| **active** | project_info rows where LEFT JOIN'd project_execution_state.deleted_at IS NULL | Query 1 |
| **total** | All project_info rows (no filter) | Query 2 |
| **historical** | total - active (computed, no separate query) | Derived |

### LEFT JOIN edge case: orphan projects

A `project_info` row with **no matching** `project_execution_state` row:
- LEFT JOIN produces NULL for all execution_state columns
- `isNull(projectExecutionState.deletedAt)` → TRUE (NULL IS NULL → true)
- **Result: orphan projects count as ACTIVE**

This is intentional — newly created projects may not yet have an execution_state row.

### Null/default handling

- `activeResult?.count || 0` — if no rows match, defaults to 0
- `totalResult?.count || 0` — if table is empty, defaults to 0
- `|| 0` treats both `undefined` and `0` the same way (but `count()` never returns undefined for a real table)

---

## 3. Coupling between the two methods

### Shared signal: `project_execution_state.deleted_at`

| Method | Role | Column | Semantic |
|--------|------|--------|----------|
| `markProjectsActive` | Writer | `deleted_at` | NULL = active, NOW() = archived |
| `getProjectCounts` | Reader | `deletedAt` | IS NULL = active, IS NOT NULL = historical |

### Potential disagreement scenarios

| Scenario | markProjectsActive behavior | getProjectCounts behavior | Agreement? |
|----------|---------------------------|--------------------------|------------|
| Normal operation | Sets deleted_at correctly | Reads deleted_at | Yes |
| project_info row with no execution_state | Subquery finds id, but no execution_state row to update | LEFT JOIN → NULL → counts as active | **Possible disagreement** |
| Empty activeNames | Early return (no-op) | Reads current state | N/A |
| Partial failure (op 3 succeeds, op 4 fails) | Some rows updated, some not | Reads inconsistent state | **Disagreement** |

### isActive vs deletedAt divergence

`markProjectsActive` writes BOTH `is_active` and `deleted_at`.
`getProjectCounts` reads ONLY `deleted_at`.

If `is_active` and `deleted_at` somehow diverge (e.g., manual DB edit), `getProjectCounts` will use `deleted_at` only.

---

## 4. Consumer map

All consumers are in `server/routes/imports-admin-extracted-routes.ts`.
All require `requireAuth` + `requireAdmin` middleware.

### markProjectsActive consumers (4 call sites)

| Line | Route/Handler | Context | Input shape |
|------|--------------|---------|-------------|
| 668 | SSE refresh handler | After successful project refresh | `refreshResults.filter(success).map(r => r.projectName)` |
| 742 | Non-SSE refresh handler | After successful project refresh | Same filter/map pattern |
| 1054 | Folder scan handler | After successful folder scan | `results.filter(success).map(r => r.projectName)` |
| 1101 | `POST /api/admin/mark-active` | Direct admin action | `req.body.projectNames` (validated as Array) |

All call sites except line 1101 guard with `.length > 0`.
Line 1101 relies on the method's internal empty-array guard.

### getProjectCounts consumers (2 call sites)

| Line | Route/Handler | Context | Response key |
|------|--------------|---------|-------------|
| 828 | `GET /api/admin/folder-config` | Dashboard info | `projectCounts` in response JSON |
| 1102 | `POST /api/admin/mark-active` | After markProjectsActive | `projectCounts` in response JSON |

### Consumer criticality

| Consumer | Criticality | Notes |
|----------|------------|-------|
| SSE refresh (668) | import-critical | Part of main data refresh flow |
| Non-SSE refresh (742) | import-critical | Fallback refresh path |
| Folder scan (1054) | import-critical | New project discovery |
| Mark-active endpoint (1101) | admin-critical | Direct admin control |
| Folder-config GET (828) | dashboard-critical | Admin dashboard display |
| Mark-active response (1102) | admin-critical | Confirmation counts |

---

## 5. Extraction gates

The following conditions must ALL be true before extracting these methods into a repository:

### Must-fix before extraction

- [ ] **Schema drift resolved**: Drizzle `.update(projectInfo).set({ isActive: ... })` references a dropped column. Must either remove those lines or replace with updatedAt-only update.
- [ ] **Transaction wrapper evaluated**: 4 sequential DB operations with no transaction — document whether partial failure is acceptable or whether extraction should add a transaction.

### Must-verify before extraction

- [ ] **Before/after count equality**: Run `getProjectCounts()` before and after extraction — results must match.
- [ ] **Active/archive semantics documented**: `deleted_at IS NULL` = active (confirmed in this doc).
- [ ] **SQL portability assumptions documented**: `ANY()`, `!= ALL()`, `NOW()` are PostgreSQL-only (confirmed in this doc).
- [ ] **All direct consumers verified**: 6 call sites in 1 file (confirmed in this doc).
- [ ] **Orphan project behavior documented**: projects without execution_state rows count as active (confirmed in this doc).
- [ ] **No unresolved environment-specific behavior**: SQLite will fail on the raw SQL path — confirm dev environment uses PostgreSQL or confirm raw SQL path is not exercised in dev.
- [ ] **isActive deprecation timeline**: is_active column deprecated 2026-03-31, 30-day observation window. Confirm whether dual-write can be removed during extraction.

### Nice-to-have before extraction

- [ ] Add explicit transaction around the 4 DB operations
- [ ] Remove dead Drizzle writes to projectInfo.isActive
- [ ] Collapse dual-write (isActive + deletedAt) to deletedAt-only after observation window

---

## 6. Risks and blind spots

| Risk | Severity | Detail |
|------|----------|--------|
| Schema drift on projectInfo.isActive | HIGH | Drizzle ORM may throw at runtime; needs runtime verification |
| No transaction wrapper | MEDIUM | Partial failure leaves inconsistent state |
| PostgreSQL-only raw SQL | MEDIUM | Dev/test environments using SQLite will fail on raw SQL path |
| Orphan project counting | LOW | Known and intentional, but must be preserved during extraction |
| `|| 0` falsy coercion | LOW | `count()` returns number, but `|| 0` would mask a genuine 0 count if chained differently |
| `!= ALL(empty_array)` | LOW | If `activeNames` somehow passes the empty-array guard, `!= ALL(ARRAY[])` returns true for all rows — every project gets archived |
