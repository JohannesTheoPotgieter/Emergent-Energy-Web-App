# project_info Split — Consumer Report

> Generated: 2026-03-30 | Columns moved: 35 → project_execution_state, 1 → project_settings

## Strategy

- **Columns are NOT dropped** from `project_info` yet — dual-write pattern keeps both in sync
- **Reads**: Continue from `projectInfo` (columns still present); new code should prefer `projectExecutionState`
- **Writes**: Dual-write to both `projectInfo` AND the new table via `syncExecutionState()` helper
- **API shape**: Unchanged — server returns flat object by spreading joined data
- **Frontend**: No changes in this phase

---

## WRITE Operations (33 total across 10 files)

### server/storage.ts (8 operations)
| Line | Method | Columns Written | Action |
|------|--------|----------------|--------|
| 614 | `createProject()` | phase, executionPhase, constructionStartDate, clientHandoverDate | Dual-write via `syncExecutionState()` |
| 638 | `updateProject()` | phase, executionPhase, dates, contractValue | Dual-write via `syncExecutionState()` |
| 647 | `deleteProject()` | isActive, archivedStatus | Dual-write via `syncExecutionState()` |
| 879 | `updateProjectInfoById()` | Dynamic fields | Dual-write via `syncExecutionState()` |
| 1002 | `upsertProjectInfoByName()` (update) | Dynamic updateFields | Dual-write via `syncExecutionState()` |
| 1008 | `upsertProjectInfoByName()` (insert) | Full info + executionEnabled | Dual-write via `syncExecutionState()` |
| 1023 | `markProjectsActive()` (activate) | isActive | Dual-write via `syncExecutionState()` |
| 1027 | `markProjectsActive()` (deactivate) | isActive | Dual-write via `syncExecutionState()` |

### server/lifecycle-routes.ts (8 operations)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 224 | POST .../rag | ragStatus, ragComment, ragUpdatedAt, ragUpdatedByUserId | Dual-write |
| 1131 | POST .../merge (fill) | Dynamic fillFields | Dual-write |
| 1134 | POST .../merge (archive) | archivedStatus, isActive, canonicalProjectId | Dual-write |
| 1191 | POST .../promote-to-lifecycle | phase, isActive, phaseUpdatedAt, phaseUpdatedByUserId | Dual-write |
| 1227 | POST .../promote (insert) | projectName, phase, isActive, phaseUpdatedAt | Dual-write after insert |
| 1297 | PATCH .../:id | Dynamic (phase, ragStatus, escalationLevel, etc.) | Dual-write |
| 1434 | POST .../stage-transition | phase, phaseUpdatedAt, phaseUpdatedByUserId | Dual-write |
| 1563 | PATCH .../execution-gate | executionEnabled, executionGateStatus, signed* | Dual-write |
| 1721 | PATCH .../restore | archivedStatus | Dual-write |

### server/handover-routes.ts (4 operations)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 592 | PUT .../excel-tracker | excelTrackerLink | Dual-write to projectSettings |
| 721 | POST .../accept | executionEnabled, executionGateStatus, phase | Dual-write |
| 772 | POST .../reject | executionEnabled, executionGateStatus | Dual-write |
| 824 | PUT .../excel-tracker | excelTrackerLink | Dual-write to projectSettings |

### server/engineering-routes.ts (4 operations)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 2914 | POST .../cost-proposal/sign | cpSigned, cpSignedDate, cpSignedByUserId, cpEvidence* | Dual-write |
| 2940 | POST .../cost-proposal/sign | pmTaskPackCreated | Dual-write |
| 2957 | POST .../cost-proposal/sign | engPostCpTaskPackCreated | Dual-write |
| 3056 | POST .../phase-transition | phase, phaseUpdatedAt, phaseUpdatedByUserId, phaseNotes | Dual-write |

### server/smart-import-routes.ts (2 operations)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 1595 | POST .../run (create) | projectName, phase, sizeKwp, pd, contractValue | Dual-write after insert |
| 2355 | POST .../run (update) | sizeKwp, pd, pm, dates | Dual-write |

### server/admin-recovery-routes.ts (1 operation)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 495 | PATCH .../recovery/projects/:id | Dynamic (pmUserId, pdUserId, clientId) | Identity-only, no dual-write needed |

### server/api/v2/repositories/project-v2-repository.ts (1 operation)
| Line | Method | Columns Written | Action |
|------|--------|----------------|--------|
| 42 | promoteProjectToConstruction() | phase, phaseUpdatedAt, phaseUpdatedByUserId, pdHandoverActual | Dual-write |

### server/sync-routes.ts (1 operation)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 239 | POST .../intake-requests | projectName, phase, isActive | Dual-write after insert |

### server/template-routes.ts (1 operation)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 756 | POST .../apply | projectName, clientId, phase, phaseUpdatedAt, phaseUpdatedByUserId, phaseNotes | Dual-write after insert |

### server/meeting-routes.ts (1 operation)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 388 | POST .../convert-to-project | projectName, sizeKwp, pd, pm | Identity-only, no dual-write needed |

### server/departments/project-routes.ts (1 operation)
| Line | Route | Columns Written | Action |
|------|-------|----------------|--------|
| 1888 | PUT .../assign-pm | pmUserId | Identity-only, no dual-write needed |

---

## READ Operations (60+ files — sample of key server files)

### server/routes.ts
- Lines 2586-2619: SELECT projectInfo with phase, escalationLevel, ragStatus, isActive
- Lines 4373-4485: SELECT with executionPhase, ragStatus, archivedStatus

### server/pm-routes.ts
- Lines 55-69: SELECT with phase, escalationLevel, all planned/actual dates
- Lines 329-332: SELECT planned vs actual dates for milestone tracking

### server/lifecycle-routes.ts
- Lines 302-319: SELECT full execution state block for lifecycle board
- Lines 648-685: SELECT phase, ragStatus, executionEnabled, signedStatus, etc.

### server/portfolio-routes.ts
- Lines 110-937: SELECT with phase, constructionStartDate, commissioningDate

### server/report-routes.ts
- Lines 82-473: SELECT phase, dates, ragStatus for reports

### server/departments/fye-revenue-tracking-routes.ts
- Lines 288-885: SELECT constructionStartDate, commissioningDate, signedStatus, isActive

### server/services/project-lifecycle-workspace-service.ts
- Lines 354-482: SELECT phase, executionPhase, isActive, archivedStatus, ragStatus, signedStatus

### server/api/v2/controllers/v2-controller.ts
- Line 77-85: SELECT phase, ragStatus, signedStatus, pdHandoverDate

### Client files (40+ — NO CHANGES needed, read from API response)
- lifecycle-board.tsx, projects.tsx, pm-dashboard.tsx, programme-reports.tsx, etc.
- All read from API response objects, not directly from DB

---

## Column → Table Mapping

| Column | New Table | Write Count |
|--------|-----------|------------|
| phase | project_execution_state | 9 |
| phaseUpdatedAt | project_execution_state | 8 |
| phaseUpdatedByUserId | project_execution_state | 8 |
| phaseNotes | project_execution_state | 2 |
| ragStatus | project_execution_state | 2 |
| ragComment | project_execution_state | 1 |
| ragUpdatedAt | project_execution_state | 1 |
| ragUpdatedByUserId | project_execution_state | 1 |
| isActive | project_execution_state | 6 |
| archivedStatus | project_execution_state | 3 |
| executionEnabled | project_execution_state | 3 |
| executionGateStatus | project_execution_state | 3 |
| executionGateReason | project_execution_state | 1 |
| executionPhase | project_execution_state | 2 |
| signedStatus | project_execution_state | 1 |
| signedDate | project_execution_state | 1 |
| signedDocumentLink | project_execution_state | 1 |
| cpSigned | project_execution_state | 1 |
| cpSignedDate | project_execution_state | 1 |
| cpSignedByUserId | project_execution_state | 1 |
| cpEvidenceType | project_execution_state | 1 |
| cpEvidenceRef | project_execution_state | 1 |
| pmTaskPackCreated | project_execution_state | 1 |
| engPostCpTaskPackCreated | project_execution_state | 1 |
| pdHandoverDate | project_execution_state | 1 |
| constructionStartDate | project_execution_state | 2 |
| commissioningDate | project_execution_state | 1 |
| omHandoverDate | project_execution_state | 1 |
| clientHandoverDate | project_execution_state | 2 |
| constructionStartActual | project_execution_state | 0 |
| pdHandoverActual | project_execution_state | 1 |
| commissioningActual | project_execution_state | 0 |
| clientHandoverActual | project_execution_state | 0 |
| escalationLevel | project_execution_state | 1 |
| excelTrackerLink | project_settings | 2 |
