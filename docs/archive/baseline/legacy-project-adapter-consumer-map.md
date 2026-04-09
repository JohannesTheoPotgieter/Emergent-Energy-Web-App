# Legacy Project Adapter — Consumer Dependency Map

> Baseline locked: 2026-04-09
> Source: grep for `storage.(getAllProjects|getProject|createProject|updateProject|deleteProject)` across `server/`

## 1. Live consumers

### `storage.getAllProjects()` — 7 call sites

| # | File | Line | Route / Context | Classification | Shape deps |
|---|------|------|-----------------|----------------|------------|
| 1 | `server/departments/project-routes.ts` | 1802 | `GET /api/dashboard` | **Dashboard-critical** | Full `Project[]` as `projects` key in response |
| 2 | `server/departments/project-routes.ts` | 1829 | `GET /api/projects` | Compatibility | Full `Project[]` returned as-is |
| 3 | `server/departments/admin-routes.ts` | 526 | `buildDataByEntity()` for writeback | Admin-only | `Project[]` mapped to `{ project: projects }` |
| 4 | `server/routes/misc-extracted-routes.ts` | 118 | `GET /api/projects` | Compatibility | `Project[]` with `sourceFile` stripped |
| 5 | `server/routes/support-extracted-routes.ts` | 68 | `buildDataByEntity()` for writeback | Admin-only | `Project[]` mapped to `{ project: projects }` |
| 6 | `server/routes/support-extracted-routes.ts` | 229 | `GET /api/export/projects` (CSV) | Compatibility | Uses all 11 fields as CSV columns |
| 7 | `server/routes/dashboard-routes.ts` | 1258 | `GET /api/dashboard` | **Dashboard-critical** | Full `Project[]` as `projects` key in response |

### `storage.getProject(id)` — 2 call sites

| # | File | Line | Route / Context | Classification | Shape deps |
|---|------|------|-----------------|----------------|------------|
| 1 | `server/departments/project-routes.ts` | 1839 | `GET /api/projects/:id` | **Project-critical** | Single `Project` returned as-is |
| 2 | `server/routes/project-info-extracted-routes.ts` | 366 | `GET /api/projects/:id` | Compatibility | Single `Project` with `sourceFile` stripped |

### `storage.createProject()` — 0 call sites

**No live consumers.** Method exists on `IStorage` interface and `DatabaseStorage` implementation but is not called anywhere in the codebase.

### `storage.updateProject()` — 0 call sites

**No live consumers.** Same as above.

### `storage.deleteProject()` — 0 call sites

**No live consumers.** Same as above.

### `mapProjectInfoToLegacyProject` — internal only

- Declared `private` on `DatabaseStorage` class (`storage.ts:495`)
- Called only within `storage.ts` at 6 internal sites (lines 564, 568, 576, 583, 599, 620)
- Not imported or referenced by any other file

## 2. Duplicate route registrations

Two `GET /api/dashboard` routes exist:
- `server/departments/project-routes.ts:1799` — likely active based on route registration order
- `server/routes/dashboard-routes.ts:1255` — potentially shadowed

Two `GET /api/projects` routes exist:
- `server/departments/project-routes.ts:1827`
- `server/routes/misc-extracted-routes.ts:116` — strips `sourceFile` before response

Two `GET /api/projects/:id` routes exist:
- `server/departments/project-routes.ts:1836`
- `server/routes/project-info-extracted-routes.ts:360` — strips `sourceFile` and validates ID

**Risk**: Express registers both; only the first-registered handler fires for a given path. Route registration order determines which version serves traffic. The `sourceFile`-stripping variants may be inactive.

## 3. Output shape dependencies

### Fields accessed by consumers

| Field | Dashboard | Projects list | Single project | CSV export | Writeback |
|-------|-----------|---------------|----------------|------------|-----------|
| `id` | yes | yes | yes | yes | yes |
| `name` | yes | yes | yes | yes | yes |
| `code` | yes | yes | yes | yes | yes |
| `manager` | yes | yes | yes | yes | yes |
| `site` | yes | yes | yes | yes | yes |
| `status` | yes | yes | yes | yes | yes |
| `stage` | yes | yes | yes | yes | yes |
| `startDate` | yes | yes | yes | yes | yes |
| `completionDate` | yes | yes | yes | yes | yes |
| `budget` | yes | yes | yes | yes | yes |
| `sourceFile` | yes | yes | yes | yes | yes |
| `lastUpdated` | yes | yes | yes | no (not in CSV columns) | yes |

### Consumer-specific shape modifications

- `misc-extracted-routes.ts:120` — strips `sourceFile` via destructure: `({ sourceFile, ...rest })`
- `project-info-extracted-routes.ts:371` — strips `sourceFile` via destructure: `({ sourceFile, ...shaped })`
- `support-extracted-routes.ts:230-233` — includes `sourceFile` in CSV export columns

## 4. Summary

| Metric | Count |
|--------|-------|
| Total call sites (reads) | 9 |
| Total call sites (writes) | 0 |
| Dashboard-critical | 2 |
| Project-critical | 1 |
| Admin-only | 2 |
| Compatibility-only | 4 |
| Duplicate route pairs | 3 |
| Dead write methods | 3 (`createProject`, `updateProject`, `deleteProject`) |
