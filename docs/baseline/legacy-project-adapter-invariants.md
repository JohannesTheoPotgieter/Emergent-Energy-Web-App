# Legacy Project Adapter — Behavioral Invariants

> Baseline locked: 2026-04-09
> Source: `server/storage.ts:495-634`
> Prior waves: canonical project-info reads/writes, project-state/count extraction

## 1. In-scope methods

| Method | Lines | Role | Table(s) touched | Type |
|--------|-------|------|-------------------|------|
| `mapProjectInfoToLegacyProject` | 495-511 | Shape adapter | None (pure transform) | Adapter |
| `getAllProjects` | 561-572 | Read all + fallback | `project_info` (+ fallback join to `project_execution_state`) | Read / Compatibility |
| `getProject` | 574-577 | Read one by ID | `project_info` | Read |
| `createProject` | 586-600 | Insert + sync | `project_info`, `project_execution_state`, `project_settings` | Write / Sync |
| `updateProject` | 602-621 | Update + sync | `project_info`, `project_execution_state`, `project_settings` | Write / Sync |
| `deleteProject` | 623-634 | Soft-delete + sync | `project_info`, `project_execution_state`, `project_settings` | Write / Sync |

## 2. Mapper shape: `mapProjectInfoToLegacyProject`

### Output fields (exact legacy `Project` interface)

| Field | Source | Fallback chain | Default |
|-------|--------|----------------|---------|
| `id` | `project.id` | — | — |
| `name` | `project.projectName` | — | — |
| `code` | Synthetic: `PI-${id.padStart(5,'0')}` | — | — |
| `manager` | `project.pm` | `project.pd` | `"Unassigned"` |
| `site` | Hardcoded | — | `"N/A"` |
| `status` | `project.phase` | — | `"Planning"` |
| `stage` | `project.executionPhase` | `project.phase` | `"Development"` |
| `startDate` | `project.constructionStartDate` | `project.pdHandoverDate` | `""` |
| `completionDate` | `project.clientHandoverDate` | `project.omHandoverDate` | `""` |
| `budget` | `project.contractValue` | — | `"0"` |
| `sourceFile` | Hardcoded | — | `"project_info"` |
| `lastUpdated` | `project.updatedAt` | — | — |

### Critical observations

- `manager` maps to `pm` (not `pd`) as primary — but `createProject` writes `manager` to the `pd` column. This is a **known asymmetry**.
- `site` is always `"N/A"` — dead field in legacy shape.
- `sourceFile` is always `"project_info"` — internal marker, stripped by some consumers before API response.
- The mapper does **not** filter by `isActive` or `archivedStatus` — archived projects produce valid legacy shapes.
- Columns `phase`, `executionPhase`, `constructionStartDate`, `pdHandoverDate`, `clientHandoverDate`, `omHandoverDate` are being migrated to `project_execution_state`. The mapper currently reads them from the `project_info` SELECT which still carries them during dual-write.

## 3. Write method field mappings

### `createProject` (InsertProject -> project_info)

| InsertProject field | project_info column |
|---------------------|---------------------|
| `name` | `projectName` |
| `manager` | `pd` |
| `status` | `phase` |
| `stage` | `executionPhase` |
| `startDate` | `constructionStartDate` |
| `completionDate` | `clientHandoverDate` |
| `budget` | `contractValue` (stringified) |
| — | `updatedAt` = `new Date()` |

After insert: calls `syncProjectSplitTablesAfterInsert(id, fields, db)` which upserts into `project_execution_state` and `project_settings`.

### `updateProject` (Partial<InsertProject> -> project_info)

Same field mapping as create, but only for fields that are `!== undefined`. Always sets `updatedAt`.

After update: calls `syncProjectSplitTables(id, payload, db)` only if a row was returned.

### `deleteProject` — Soft delete

Sets `{ isActive: false, archivedStatus: "ARCHIVED", updatedAt: new Date() }` on `project_info`. Does NOT hard-delete the row. After update: calls `syncProjectSplitTables(id, fields, db)` if result was returned.

## 4. `getAllProjects` behavior

1. Primary path: `SELECT * FROM project_info ORDER BY updated_at DESC`
2. Maps each row through `mapProjectInfoToLegacyProject`
3. On error: checks `shouldUseLegacyProjectInfoReadFallback(error)`
   - If fallback-eligible: uses `listLegacyCompatibleProjectInfo(db)` with 3-tier degradation
   - Tier 1: LEFT JOIN `project_execution_state` for phase
   - Tier 2: Raw SQL with `information_schema` column check
   - Tier 3: `project_info` only, phase = null, hardcoded defaults for 20+ fields
4. Returns **all** projects including archived — no `isActive` filter

## 5. `getProject` behavior

1. `SELECT * FROM project_info WHERE id = ?`
2. Maps through `mapProjectInfoToLegacyProject` if found
3. No fallback path (unlike `getAllProjects`)
4. Returns `undefined` if not found

## 6. Dual-write / sync coupling

All three write methods depend on `server/lib/project-info-sync.ts`:

- `syncProjectSplitTables`: extracts execution-state fields and settings fields from the update payload, upserts into `project_execution_state` and `project_settings`
- `syncProjectSplitTablesAfterInsert`: same but uses `onConflictDoNothing` and always creates rows

Execution-state columns synced: `phase`, `phaseUpdatedAt`, `phaseUpdatedByUserId`, `phaseNotes`, `pdHandoverDate`, `constructionStartDate`, `commissioningDate`, `omHandoverDate`, `clientHandoverDate`, `constructionStartActual`, `pdHandoverActual`, `commissioningActual`, `clientHandoverActual`, `escalationLevel`, `ragStatus`, `ragComment`, `ragUpdatedAt`, `ragUpdatedByUserId`, `isActive`, `archivedStatus`, `executionEnabled`, `executionGateStatus`, `executionGateReason`, `executionPhase`, `signedStatus`, `signedDate`, `signedDocumentLink`, `cpSigned`, `cpSignedDate`, `cpSignedByUserId`, `cpEvidenceType`, `cpEvidenceRef`, `pmTaskPackCreated`, `engPostCpTaskPackCreated`

Settings columns synced: `excelTrackerLink`

## 7. Fallback helper dependency

`server/lib/project-info-fallback.ts`:
- `shouldUseLegacyProjectInfoReadFallback(error)` — checks for missing-table or missing-column errors against a hardcoded allowlist of 23 column names
- `listLegacyCompatibleProjectInfo(db, filters?)` — 3-tier degradation reader that injects hardcoded defaults for all missing fields
- Only used by `getAllProjects` — `getProject` has **no** fallback path

## 8. Asymmetries and risks

| Risk | Detail |
|------|--------|
| Manager write asymmetry | `createProject` writes `manager` -> `pd`, but mapper reads `pm` first. A project created via legacy API will show "Unassigned" unless `pm` is set separately. |
| No fallback on `getProject` | `getAllProjects` has 3-tier fallback; `getProject` does not. Column migration failures affect single-project reads. |
| Mapper reads migration columns | 6 of 12 input columns (`phase`, `executionPhase`, `constructionStartDate`, `pdHandoverDate`, `clientHandoverDate`, `omHandoverDate`) are in the process of migrating to `project_execution_state`. The SELECT still reads them from `project_info`. |
| Write methods have zero callers | `createProject`, `updateProject`, `deleteProject` have no call sites in the current codebase. They are dead code but still on the `IStorage` interface. |
