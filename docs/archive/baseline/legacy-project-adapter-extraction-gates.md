# Legacy Project Adapter — Extraction Gates

> Baseline locked: 2026-04-09
> Pre-extraction decision pass: 2026-04-09
> Prerequisite for: extracting `mapProjectInfoToLegacyProject`, `getAllProjects`, `getProject` from `server/storage.ts`

## Planning blockers — resolved

### Blocker 1: Duplicate route resolution — RESOLVED

Route registration order verified via `server/bootstrap/startup-orchestrator.ts:2709`
→ `server/routes/register-all-routes.ts` (the sole entry point).

Registration order (relevant steps):

| Step | Call | Source |
|------|------|--------|
| 6 | `registerDepartmentRoutes(app)` → `departments/project-routes.ts` via `app.use(router)` | `register-all-routes.ts:25` → `register-department-routes.ts:13-14` |
| 8 | `registerExtractedRoutes(app)` → Phase 4c: `project-info-extracted-routes.ts`, Phase 5: `misc-extracted-routes.ts` | `register-all-routes.ts:27` → `route-registry.ts:39-44` |
| 9 | `registerRoutes(httpServer, app)` → `routes.ts` → `registerDashboardRoutes` | `register-all-routes.ts:28` → `routes.ts:26` |

**Winner for each duplicate pair** (Express: first-registered handler wins):

| Path | Winner (step 6) | Shadowed (steps 8-9) |
|------|-----------------|----------------------|
| `GET /api/dashboard` | `departments/project-routes.ts:1799` | `routes/dashboard-routes.ts:1255` |
| `GET /api/projects` | `departments/project-routes.ts:1827` | `routes/misc-extracted-routes.ts:116` |
| `GET /api/projects/:id` | `departments/project-routes.ts:1836` | `routes/project-info-extracted-routes.ts:360` |

The shadowed variants (which strip `sourceFile`) are dead code at runtime.

### Blocker 2: Dead write method decision — RESOLVED

Confirmed: `storage.createProject()`, `storage.updateProject()`, `storage.deleteProject()` have **zero callers** in the entire codebase. All occurrences of `createProject`/`updateProject`/`deleteProject` in server code are unrelated functions (`createProjectEvent`, `createProjectQuery`, `updateProjectInfoById`, etc.).

Additionally, these methods are **structurally broken** because:
- `createProject` inserts `phase`, `executionPhase`, `constructionStartDate`, `clientHandoverDate` into `project_info` via `as any` — but these columns have been dropped from `project_info` per `migrations/20260337_drop_moved_columns_project_info.sql`
- `deleteProject` sets `isActive` and `archivedStatus` on `project_info` — also dropped columns

**Decision: EXCLUDE from extraction.** Leave on `IStorage` interface temporarily. Remove in a separate dead-code cleanup task.

### Blocker 3: Migration column timing — RESOLVED

The 6 mapper-input columns (`phase`, `executionPhase`, `constructionStartDate`, `pdHandoverDate`, `clientHandoverDate`, `omHandoverDate`) have already completed migration:

1. `migrations/20260330_split_project_info.sql` — created `project_execution_state`, copied column data
2. `migrations/20260331_convert_project_dates_to_date.sql` — converted text dates to DATE on `project_execution_state`
3. `migrations/20260337_drop_moved_columns_project_info.sql` — dropped columns from `project_info`
4. `shared/schema/projects.ts:100-119` — Drizzle `projectInfo` schema no longer declares these columns

**Current runtime behavior of `getAllProjects`:**
- Primary path (`storage.ts:563`): `select().from(projectInfo)` generates a SELECT with only the columns in the Drizzle schema. The 6 migrated columns are NOT selected.
- The mapper receives `undefined` for `phase`, `executionPhase`, `constructionStartDate`, `pdHandoverDate`, `clientHandoverDate`, `omHandoverDate`.
- Result: `status` = always `"Planning"`, `stage` = always `"Development"`, `startDate` = always `""`, `completionDate` = always `""`.
- The fallback path (`listLegacyCompatibleProjectInfo`) JOINs `project_execution_state` and WOULD provide these fields, but only fires on SELECT errors — which don't occur here.

**This means the legacy adapter is already returning degraded data on 4 of 12 output fields.** The migration is complete. There is no timing dependency to wait for. The mapper output shape is stable — it has been returning defaults for these fields since the Drizzle schema was updated.

## Extraction gates

### Gate 1: Mapper shape equality (before/after)

- [x] The baseline test passes (23 tests, all green as of baseline lock)
- [ ] After extraction, the same test passes with identical snapshot expectations
- [ ] No field added, removed, renamed, or re-defaulted during extraction

### Gate 2: All live consumers verified

- [x] All 9 read call sites confirmed (7x `getAllProjects`, 2x `getProject`)
- [x] Duplicate route registrations resolved — `departments/project-routes.ts` wins all 3 pairs
- [x] Route registration order confirmed via `register-all-routes.ts` → startup-orchestrator
- [ ] No new callers introduced between baseline lock and extraction

### Gate 3: Mapper location decided

- [ ] Decision made: mapper can remain in extracted repository alongside read methods
- [ ] All internal call sites updated if mapper moves
- [ ] Import paths verified

**Pre-extraction recommendation:** Mapper moves with the read methods. It is private, has no external callers, and is used exclusively by the in-scope read methods (plus `getProjectByCode` which stays in `storage.ts` and will need its own copy or import).

### Gate 4: Write/sync behavior pinned

- [x] `createProject`, `updateProject`, `deleteProject` confirmed as dead code (0 call sites)
- [x] Decision made: **EXCLUDE** from extraction — structurally broken (writes to dropped columns)
- [ ] Leave on `IStorage` interface temporarily; remove in separate dead-code cleanup

### Gate 5: Fallback path preserved

- [ ] `getAllProjects` fallback preserved in extracted location
- [x] `getProject` has no fallback — accepted (migration is complete, fallback unnecessary)
- [ ] The 3-tier degradation works with the extracted code path

### Gate 6: Migration column dependency resolved

- [x] 6 mapper input columns confirmed DROPPED from `project_info` (migration `20260337`)
- [x] 6 columns confirmed PRESENT on `project_execution_state` (migration `20260330`)
- [x] Mapper already receives `undefined` for all 6 and uses defaults — shape is stable
- [x] No further column migration expected for these fields

### Gate 7: Dead code explicitly excluded

- [ ] `getProjectByCode` remains in `storage.ts` (out of scope)
- [ ] `deleteProjectInfo` remains (out of scope)
- [ ] `createProject`, `updateProject`, `deleteProject` excluded from extraction (dead + broken)

### Gate 8: Interface cleanup coordinated

- [ ] `IStorage` interface updated after extraction
- [ ] No TypeScript compile errors after interface change
- [ ] Transaction support verified

## Risks that must be accepted or mitigated

| Risk | Severity | Mitigation |
|------|----------|------------|
| Manager write asymmetry (`manager` -> `pd` on write, `pm` -> `manager` on read) | **Moot** | Write methods excluded from extraction (dead + broken) |
| No fallback on `getProject` | **Low** | Migration complete; columns dropped; fallback not needed |
| Duplicate route handlers | **Resolved** | `departments/project-routes.ts` wins all 3 pairs; shadowed routes are dead |
| Migration columns on `project_info` | **Resolved** | Columns already dropped; Drizzle schema already updated; mapper shape stable at defaults |
| `getProjectByCode` shares the mapper | **Low** | Stays in `storage.ts`; will need its own mapper copy or import from extracted module |
| Degraded output on 4 fields | **Accept** | Legacy adapter already returns defaults; canonical reads serve real data |

## Recommendation

**Ready for extraction.** All three planning blockers resolved. Extract `mapProjectInfoToLegacyProject`, `getAllProjects`, and `getProject` in the next PR. Exclude `createProject`, `updateProject`, `deleteProject` (dead + structurally broken).
