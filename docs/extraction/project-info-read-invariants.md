# getAllProjectInfo + Fallback Chain — Behavioral Invariants

> Baseline document for extraction wave.
> Source: `server/storage.ts` lines 842-1035 (as of 2026-04-09).
> Do NOT modify this doc unless the production code changes first.

## Methods in scope

| Method | Visibility | Lines | Role |
|--------|-----------|-------|------|
| `getAllProjectInfo()` | public (IStorage) | 842-872 | Canonical read — returns merged project_info + execution_state |
| `shouldUseLegacyProjectInfoReadFallback(error)` | private | 874-920 | Error detector — decides if fallback is safe |
| `listLegacyCompatibleProjectInfo(filters?)` | private | 922-1035 | 3-tier fallback reader with hardcoded defaults |

## 1. getAllProjectInfo — canonical path

### Query
```
SELECT * FROM project_info
LEFT JOIN project_execution_state
  ON project_execution_state.project_id = project_info.id
ORDER BY project_info.updated_at DESC
```

### Merge semantics (lines 849-864)
1. Start with all `project_info` fields (spread)
2. Overlay only non-null, non-undefined `project_execution_state` fields
3. Force `id = project_info.id` (prevents exec-state id from leaking)
4. Force `updatedAt = project_info.updatedAt` (prevents exec-state timestamp from overriding)

### Critical invariant
The null-filter loop means:
- If exec-state has `phase: "Construction"`, it overrides project_info
- If exec-state has `ragStatus: null`, it does NOT overwrite project_info's `ragStatus`
- `id` and `updatedAt` are ALWAYS from project_info regardless

### Return type
`Promise<any[]>` — NOT `ProjectInfo[]`. The actual shape is a union of project_info columns + non-null exec-state columns.

### Ordering
`DESC` by `project_info.updatedAt`. This is guaranteed, not incidental.

## 2. shouldUseLegacyProjectInfoReadFallback — error detection

### Trigger conditions

| DB mode | Error type | Condition | Returns |
|---------|-----------|-----------|---------|
| SQLite | Missing table | `"no such table"` in message | `true` |
| SQLite | Missing column | `"no such column"` in message AND column in allowlist | `true` |
| PostgreSQL | Missing table | Error code `42P01` | `true` |
| PostgreSQL | Missing column | Error code `42703` AND column in allowlist | `true` |
| Any | Any other error | — | `false` |

### Column allowlist (24 entries, snake_case)
```
phase_updated_at, phase_updated_by_user_id, phase_notes, execution_phase,
client_id, archived_status, pm_user_id, pd_user_id,
cp_signed, cp_signed_date, cp_signed_by_user_id, cp_evidence_type, cp_evidence_ref,
pm_task_pack_created, eng_post_cp_task_pack_created,
site_id, opportunity_id, delivery_model, project_code,
site_establishment_date, site_establishment_actual,
financial_review_status, financial_review_id, waiting_on_department
```

### Critical invariant
Errors NOT in this list (e.g., connection errors, permission errors, syntax errors)
are re-thrown. The fallback is NOT a generic error swallower.

## 3. listLegacyCompatibleProjectInfo — 3-tier fallback

### Tier 1 (lines 928-944)
**Query:** `project_info LEFT JOIN project_execution_state` selecting only 8 columns:
`id, projectName, sizeKwp, pd, pm, contractValue, phase (from exec state), updatedAt`

**Fails when:** `project_execution_state` table doesn't exist

### Tier 2 (lines 950-972)
**Query:** Raw SQL against `project_info` only, with dynamic column check:
```sql
SELECT id, project_name, size_kwp, pd, pm, contract_value, updated_at,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='project_info' AND column_name='phase')
  THEN (SELECT phase FROM project_info pi2 WHERE pi2.id = project_info.id)
  ELSE NULL END as phase
FROM project_info ORDER BY updated_at DESC
```

**Fails when:** Raw SQL itself errors (unlikely but handled)

### Tier 3 (lines 975-991)
**Query:** Simple Drizzle select from `project_info` only — 7 columns, no phase.
Sets `phase: null` explicitly.

### Default injection (lines 994-1034)
All three tiers feed into a final `.map()` that injects 33 hardcoded defaults:

**Null defaults (29 fields):**
phaseUpdatedAt, phaseUpdatedByUserId, phaseNotes,
pdHandoverDate, constructionStartDate, commissioningDate, omHandoverDate, clientHandoverDate,
escalationLevel, constructionStartActual, pdHandoverActual, commissioningActual, clientHandoverActual,
ragStatus, ragComment, ragUpdatedAt, ragUpdatedByUserId,
executionGateReason, signedDate, signedDocumentLink, executionPhase, excelTrackerLink,
clientId, pmUserId, pdUserId, cpSignedDate, cpSignedByUserId, cpEvidenceType, cpEvidenceRef

**Non-null defaults (8 fields):**
| Field | Value |
|-------|-------|
| `isActive` | `true` |
| `executionEnabled` | `false` |
| `executionGateStatus` | `"NOT_ELIGIBLE"` |
| `signedStatus` | `"NONE"` |
| `archivedStatus` | `"ACTIVE"` |
| `cpSigned` | `false` |
| `pmTaskPackCreated` | `false` |
| `engPostCpTaskPackCreated` | `false` |

**Identity field:**
| Field | Value |
|-------|-------|
| `canonicalProjectId` | `row.id` |

### Critical invariants
- The defaults are ALWAYS injected in fallback — even if the row already has values for those fields, the spread-then-override pattern means the hardcoded defaults win.
- `isActive: true` means fallback always reports projects as active
- `archivedStatus: "ACTIVE"` means fallback ignores archived state
- Row counts can differ between canonical and fallback if the canonical LEFT JOIN produces different row counts than fallback queries

## 4. Shared coupling

Both private helpers are called from 4 methods:
1. `getAllProjectInfo()` (line 867) — calls without filters
2. `getProjectInfo(projectName)` (line 814) — calls with `{ projectName }`
3. `getProjectInfoById(id)` (line 830) — calls with `{ id }`
4. `getAllProjects()` (line 559) — calls without filters

**Extraction constraint:** These helpers cannot be extracted exclusively with
`getAllProjectInfo` — they must remain accessible to the other 3 methods.

## 5. Consumer map

### Dashboard-critical (highest blast radius)
| Consumer | Line(s) | Field access pattern |
|----------|---------|---------------------|
| `departments/project-routes.ts` | 274, 350, 655, 1179, 1599, 1909 | Full shape passthrough; accesses `contractValue`, `phase`, `ragStatus`, `pm`, `pd`, `pmUserId`, `pdUserId` |
| `routes/project-info-extracted-routes.ts` | 387, 420 | Line 387: full passthrough; Line 420: maps to `{id, projectName, phase, ragStatus, ragComment, clientId}` |
| `routes/dashboard-routes.ts` | 149, 981 | Full shape passthrough |
| `routes/home-extracted-routes.ts` | 33 | Full shape passthrough |
| `departments/exco-routes.ts` | 537 | Full shape passthrough |
| `services/project-platform-summary-service.ts` | 189 | Accesses `id`, `projectName`, `pmUserId`, `pdUserId` |

### Finance-critical (read-only project name lookups)
| Consumer | Line(s) |
|----------|---------|
| `departments/finance-routes.ts` | 3366, 3403, 4077, 4233, 4342, 4834, 4909 |

### Admin-only
| Consumer | Line(s) |
|----------|---------|
| `routes/imports-admin-extracted-routes.ts` | 1208, 1253, 1271, 1315, 1333 |

### Compatibility-only
| Consumer | Line(s) |
|----------|---------|
| `services/promoted-read-compat.ts` | 646, 795 |

### Other
| Consumer | Line(s) |
|----------|---------|
| `routes/operational-tasks-routes.ts` | 55, 218, 370 |
| `routes/mytool-routes.ts` | 962 |
| `routes/overview-extracted-routes.ts` | 27 |

**Total direct consumers:** 30+ call sites across 12+ files.

## 6. Shape difference between canonical and fallback

| Aspect | Canonical path | Fallback path |
|--------|---------------|---------------|
| Source tables | project_info + project_execution_state | project_info only (+ limited exec state in tier 1) |
| Fields returned | All columns from both tables (merged) | 8 real columns + 33 hardcoded defaults |
| `isActive` | Real value from data | Always `true` |
| `archivedStatus` | Real value from data | Always `"ACTIVE"` |
| `executionEnabled` | Real value from data | Always `false` |
| `executionGateStatus` | Real value from data | Always `"NOT_ELIGIBLE"` |
| `ragStatus` | Real value (can be non-null) | Always `null` |
| `phase` | Real value from exec state (non-null only) | From exec state (tier 1), from information_schema check (tier 2), or `null` (tier 3) |
| Row count | 1:1 with project_info rows | Same |
| Ordering | `project_info.updatedAt DESC` | `project_info.updatedAt DESC` (all tiers) |
