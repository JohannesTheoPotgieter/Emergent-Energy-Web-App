# Dual-Source Audit: Client Commitments & Client Updates

## Audit Date: 2026-03-31

## Problem

Two sets of tables serve the same purpose (client commitments and client updates):

### Legacy Tables (ACTIVE — currently serving API requests)
- `project_client_commitments` → Drizzle: `projectClientCommitments` (stage-collaboration.ts)
- `project_client_updates` → Drizzle: `projectClientUpdates` (stage-collaboration.ts)

### Canonical Tables (INACTIVE — service exists but routes never registered)
- `client_commitments` → Drizzle: `clientCommitments` (collaboration-workflow.ts)
- `client_updates` → Drizzle: `clientUpdates` (collaboration-workflow.ts)

## Critical Finding

`registerCollaborationWorkflowRoutes()` (collaboration-workflow-routes.ts) is **never imported
or called** — the export is dead code. Only `registerStageCollaborationRoutes()` is registered
via `register-project-routes.ts:35-36`. The frontend calls the same API paths, but Express
routes them to the legacy handlers.

## File-by-File Audit

### Reads from Legacy Tables

| File | Line | Table | Operation |
|------|------|-------|-----------|
| server/stage-collaboration-routes.ts | 64-77 | projectClientCommitments | SELECT (list) |
| server/stage-collaboration-routes.ts | 144 | projectClientCommitments | SELECT (after update) |
| server/stage-collaboration-routes.ts | 172-174 | projectClientUpdates | SELECT (list) |
| server/stage-collaboration-routes.ts | 199-200 | projectClientUpdates | SELECT (next number) |
| server/stage-collaboration-routes.ts | 256 | projectClientUpdates | SELECT (after update) |
| server/stage-collaboration-routes.ts | 292 | projectClientUpdates | SELECT (after send) |

### Writes to Legacy Tables

| File | Line | Table | Operation |
|------|------|-------|-----------|
| server/stage-collaboration-routes.ts | 103 | projectClientCommitments | INSERT |
| server/stage-collaboration-routes.ts | 143 | projectClientCommitments | UPDATE |
| server/stage-collaboration-routes.ts | 210 | projectClientUpdates | INSERT |
| server/stage-collaboration-routes.ts | 255 | projectClientUpdates | UPDATE |
| server/stage-collaboration-routes.ts | 291 | projectClientUpdates | UPDATE (send) |
| server/bootstrap/startup-orchestrator.ts | 1741-1780 | project_client_commitments, project_client_updates | CREATE TABLE |

### Reads from Canonical Tables (dead code)

| File | Line | Table | Operation |
|------|------|-------|-----------|
| server/services/collaboration-workflow-service.ts | 134-138 | clientCommitments | SELECT |
| server/services/collaboration-workflow-service.ts | 153 | clientCommitments | SELECT (after update) |
| server/services/collaboration-workflow-service.ts | 337-342 | clientUpdates | SELECT |
| server/services/collaboration-workflow-service.ts | 369 | clientUpdates | SELECT (after update) |
| server/services/collaboration-workflow-service.ts | 437 | clientCommitments | SELECT (overdue) |

### Writes to Canonical Tables (dead code)

| File | Line | Table | Operation |
|------|------|-------|-----------|
| server/services/collaboration-workflow-service.ts | 119-128 | clientCommitments | INSERT |
| server/services/collaboration-workflow-service.ts | 152 | clientCommitments | UPDATE |
| server/services/collaboration-workflow-service.ts | 320-332 | clientUpdates | INSERT |
| server/services/collaboration-workflow-service.ts | 368 | clientUpdates | UPDATE |

### Frontend References

| File | Line | API Path | Operation |
|------|------|----------|-----------|
| client/src/hooks/use-collaboration-workflow.ts | 93 | GET /api/projects/:id/client-commitments | READ |
| client/src/hooks/use-collaboration-workflow.ts | 108 | POST /api/projects/:id/client-commitments | WRITE |
| client/src/hooks/use-collaboration-workflow.ts | 119 | PATCH /api/projects/:id/client-commitments/:id | WRITE |
| client/src/hooks/use-collaboration-workflow.ts | 233 | GET /api/projects/:id/client-updates | READ |
| client/src/hooks/use-collaboration-workflow.ts | 250 | POST /api/projects/:id/client-updates | WRITE |
| client/src/hooks/use-collaboration-workflow.ts | 271 | PATCH /api/projects/:id/client-updates/:id | WRITE |
| client/src/hooks/use-collaboration-workflow.ts | 281 | POST /api/projects/:id/client-updates/generate-draft | WRITE |

## Resolution Strategy

Since the canonical tables were never wired up and contain no data, the simplest and
safest approach is:

1. **Make the canonical service the active one** — register its routes
2. **Migrate existing data** from legacy tables to canonical tables
3. **Deprecate and guard legacy routes** — fail loudly on legacy writes
4. **Drop legacy after 90 days** of zero usage

## Unique Constraints (Canonical Tables)

- `client_commitments`: NO unique constraint (duplicates possible — use projectId + commitmentText + committedDate)
- `client_updates`: NO unique constraint
- `project_client_updates`: Has unique constraint `pcu_project_update_uq` on (projectId, updateNumber)
