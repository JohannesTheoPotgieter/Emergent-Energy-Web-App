# Dual-Source Audit: Legacy vs Canonical Client Tables

**Date:** 2026-03-31
**Status:** Consolidation in progress
**Risk:** MEDIUM — Two sources of truth is not a source of truth.

---

## Overview

The codebase has **two sets of tables** for client commitments and client updates:

| Legacy Table (deprecated) | Canonical Table | Schema File |
|---|---|---|
| `client_commitments` | `project_client_commitments` | `shared/schema/collaboration-workflow.ts` → `shared/schema/stage-collaboration.ts` |
| `client_updates` | `project_client_updates` | `shared/schema/collaboration-workflow.ts` → `shared/schema/stage-collaboration.ts` |

---

## Legacy Table References

### Schema Definitions

| File | Line(s) | Table | Type |
|---|---|---|---|
| `shared/schema/collaboration-workflow.ts` | 115–130 | `clientCommitments` (→ `client_commitments`) | Schema definition (Drizzle pgTable) |
| `shared/schema/collaboration-workflow.ts` | 132 | `insertClientCommitmentSchema` | Zod insert schema |
| `shared/schema/collaboration-workflow.ts` | 134 | `ClientCommitment` | TypeScript type export |
| `shared/schema/collaboration-workflow.ts` | 166–186 | `clientUpdates` (→ `client_updates`) | Schema definition (Drizzle pgTable) |
| `shared/schema/collaboration-workflow.ts` | 188 | `insertClientUpdateSchema` | Zod insert schema |
| `shared/schema/collaboration-workflow.ts` | 190 | `ClientUpdate` | TypeScript type export |

### Service Layer (Reads & Writes)

| File | Line(s) | Table | Operation |
|---|---|---|---|
| `server/services/collaboration-workflow-service.ts` | 11 | `clientCommitments` | Import |
| `server/services/collaboration-workflow-service.ts` | 14 | `clientUpdates` | Import |
| `server/services/collaboration-workflow-service.ts` | 119 | `clientCommitments` | **WRITE** — `db.insert(clientCommitments)` in `createClientCommitment()` |
| `server/services/collaboration-workflow-service.ts` | 133–138 | `clientCommitments` | **READ** — `db.select().from(clientCommitments)` in `getClientCommitments()` |
| `server/services/collaboration-workflow-service.ts` | 152 | `clientCommitments` | **WRITE** — `db.update(clientCommitments)` in `updateClientCommitment()` |
| `server/services/collaboration-workflow-service.ts` | 153 | `clientCommitments` | **READ** — `db.select().from(clientCommitments)` in `updateClientCommitment()` |
| `server/services/collaboration-workflow-service.ts` | 436–437 | `clientCommitments` | **READ** — `db.select().from(clientCommitments)` in `getAllOverdueCommitments()` |
| `server/services/collaboration-workflow-service.ts` | 310–314 | `clientUpdates` | **READ** — `db.select().from(clientUpdates)` in `createClientUpdate()` (get next number) |
| `server/services/collaboration-workflow-service.ts` | 320 | `clientUpdates` | **WRITE** — `db.insert(clientUpdates)` in `createClientUpdate()` |
| `server/services/collaboration-workflow-service.ts` | 337–342 | `clientUpdates` | **READ** — `db.select().from(clientUpdates)` in `getClientUpdates()` |
| `server/services/collaboration-workflow-service.ts` | 368 | `clientUpdates` | **WRITE** — `db.update(clientUpdates)` in `updateClientUpdate()` |
| `server/services/collaboration-workflow-service.ts` | 369 | `clientUpdates` | **READ** — `db.select().from(clientUpdates)` in `updateClientUpdate()` |

### Route Layer (Legacy — NOT registered in app)

| File | Line(s) | Table | Operation |
|---|---|---|---|
| `server/collaboration-workflow-routes.ts` | 111–121 | `clientCommitments` (via service) | **READ** — GET `/api/projects/:projectId/client-commitments` |
| `server/collaboration-workflow-routes.ts` | 123–138 | `clientCommitments` (via service) | **WRITE** — POST `/api/projects/:projectId/client-commitments` |
| `server/collaboration-workflow-routes.ts` | 140–150 | `clientCommitments` (via service) | **WRITE** — PATCH `/api/projects/:projectId/client-commitments/:id` |
| `server/collaboration-workflow-routes.ts` | 270–280 | `clientUpdates` (via service) | **READ** — GET `/api/projects/:projectId/client-updates` |
| `server/collaboration-workflow-routes.ts` | 282–292 | `clientUpdates` (via service) | **WRITE** — POST `/api/projects/:projectId/client-updates` |
| `server/collaboration-workflow-routes.ts` | 294–308 | `clientUpdates` (via service) | **WRITE** — PATCH `/api/projects/:projectId/client-updates/:id` |
| `server/collaboration-workflow-routes.ts` | 334–342 | `clientCommitments` (via service) | **READ** — GET `/api/gates/commitments` |

**NOTE:** `registerCollaborationWorkflowRoutes` is **never called** — only `registerStageCollaborationRoutes` is registered in `server/routes/register-project-routes.ts:35-36`. The legacy routes file is dead code but the legacy service functions still exist.

---

## Canonical Table References

### Schema Definitions

| File | Line(s) | Table | Type |
|---|---|---|---|
| `shared/schema/stage-collaboration.ts` | 23–38 | `projectClientCommitments` (→ `project_client_commitments`) | Schema definition |
| `shared/schema/stage-collaboration.ts` | 40 | `insertProjectClientCommitmentSchema` | Zod insert schema |
| `shared/schema/stage-collaboration.ts` | 42 | `ProjectClientCommitment` | TypeScript type export |
| `shared/schema/stage-collaboration.ts` | 47–68 | `projectClientUpdates` (→ `project_client_updates`) | Schema definition |
| `shared/schema/stage-collaboration.ts` | 70 | `insertProjectClientUpdateSchema` | Zod insert schema |
| `shared/schema/stage-collaboration.ts` | 72 | `ProjectClientUpdate` | TypeScript type export |

### Route Layer (Canonical — ACTIVE)

| File | Line(s) | Table | Operation |
|---|---|---|---|
| `server/stage-collaboration-routes.ts` | 52–85 | `projectClientCommitments` | **READ** — GET `/api/projects/:projectId/client-commitments` |
| `server/stage-collaboration-routes.ts` | 88–120 | `projectClientCommitments` | **WRITE** — POST `/api/projects/:projectId/client-commitments` |
| `server/stage-collaboration-routes.ts` | 123–154 | `projectClientCommitments` | **WRITE** — PATCH `/api/projects/:projectId/client-commitments/:id` |
| `server/stage-collaboration-routes.ts` | 161–183 | `projectClientUpdates` | **READ** — GET `/api/projects/:projectId/client-updates` |
| `server/stage-collaboration-routes.ts` | 186–232 | `projectClientUpdates` | **WRITE** — POST `/api/projects/:projectId/client-updates` |
| `server/stage-collaboration-routes.ts` | 235–266 | `projectClientUpdates` | **WRITE** — PATCH `/api/projects/:projectId/client-updates/:id` |
| `server/stage-collaboration-routes.ts` | 269–300 | `projectClientUpdates` | **WRITE** — PATCH `/api/projects/:projectId/client-updates/:id/status` |

### Bootstrap/DDL

| File | Line(s) | Table | Type |
|---|---|---|---|
| `server/bootstrap/startup-orchestrator.ts` | 1741–1757 | `project_client_commitments` | CREATE TABLE DDL |
| `server/bootstrap/startup-orchestrator.ts` | 1759–1781 | `project_client_updates` | CREATE TABLE DDL |

### Migration

| File | Line(s) | Table | Type |
|---|---|---|---|
| `migrations/20260369_prompt7_stage_collaboration_tables.sql` | 20–34 | `project_client_commitments` | CREATE TABLE DDL |
| `migrations/20260369_prompt7_stage_collaboration_tables.sql` | 37–57 | `project_client_updates` | CREATE TABLE DDL |

---

## Frontend References

| File | Line(s) | API Path | Notes |
|---|---|---|---|
| `client/src/hooks/use-collaboration-workflow.ts` | 93 | `/api/projects/${projectId}/client-commitments` | READ (React Query) |
| `client/src/hooks/use-collaboration-workflow.ts` | 108 | POST `/api/projects/${projectId}/client-commitments` | WRITE (mutation) |
| `client/src/hooks/use-collaboration-workflow.ts` | 119 | PATCH `/api/projects/${projectId}/client-commitments/${id}` | WRITE (mutation) |
| `client/src/hooks/use-collaboration-workflow.ts` | 233 | `/api/projects/${projectId}/client-updates` | READ (React Query) |
| `client/src/hooks/use-collaboration-workflow.ts` | 250 | POST `/api/projects/${projectId}/client-updates` | WRITE (mutation) |
| `client/src/hooks/use-collaboration-workflow.ts` | 271 | PATCH `/api/projects/${projectId}/client-updates/${id}` | WRITE (mutation) |
| `client/src/hooks/use-collaboration-workflow.ts` | 281 | POST `/api/projects/${projectId}/client-updates/generate-draft` | WRITE (mutation) |
| `client/src/hooks/use-gates.ts` | 72 | `/api/gates/client-updates` | READ (React Query) |
| `client/src/pages/gates/gates-commitments.tsx` | 2 | (via hook) | UI component |
| `client/src/pages/gates/gates-client-updates.tsx` | (implied) | (via hook) | UI component |
| `client/src/components/stage-workspaces/ClientCommitmentTracker.tsx` | 11 | (via hook) | UI component |
| `client/src/components/stage-workspaces/ClientUpdateEditor.tsx` | 11 | (via hook) | UI component |

**Frontend is safe:** All frontend API calls hit the canonical route endpoints in `stage-collaboration-routes.ts`.

---

## Field Mapping: Legacy → Canonical

### client_commitments → project_client_commitments

| Legacy Column | Canonical Column | Transform |
|---|---|---|
| `id` | `id` | New auto-increment ID in canonical |
| `project_id` | `project_id` | Direct copy |
| `stage_code_created` (NOT NULL) | `stage_code_created` (nullable) | Direct copy |
| `commitment_text` | `commitment_text` | Direct copy |
| `committed_by_user_id` | `committed_by_user_id` | Direct copy |
| `committed_date` | `committed_date` | Direct copy |
| `delivery_stage_code` | `delivery_stage_code` | Direct copy |
| `status` (lowercase: open/delivered/overdue/cancelled) | `status` (uppercase: OPEN/DELIVERED) | `UPPER(status)` |
| `delivered_date` | `delivered_date` | Direct copy |
| `notes` | `notes` | Direct copy |
| `created_at` | `created_at` | Direct copy |
| — | `migrated_from_legacy` | Set to `TRUE` for migrated rows |

### client_updates → project_client_updates

| Legacy Column | Canonical Column | Transform |
|---|---|---|
| `id` | `id` | New auto-increment ID in canonical |
| `project_id` | `project_id` | Direct copy |
| `update_number` | `update_number` | Direct copy |
| `last_client_update_date` | — | **Dropped** (no equivalent) |
| `next_client_update_due_date` | `due_date` | Cast timestamp → date |
| `client_update_status` (lowercase) | `status` (uppercase) | `UPPER(client_update_status)` |
| `progress_summary_text` | `progress_summary_text` | Direct copy |
| `completed_this_period_text` | `completed_this_period_text` | Direct copy |
| `next_7_days_text` | `next_7_days_text` | Direct copy |
| `blockers_text` | `blockers_text` | Direct copy |
| `client_actions_required_text` | `client_actions_required_text` | Direct copy |
| `attachment_urls` | `attachment_urls` | Direct copy (jsonb) |
| `client_update_sent_by` | `sent_by_user_id` | Direct copy (rename) |
| `reviewer_user_id` | `reviewer_user_id` | Direct copy |
| `sent_date` | `sent_date` | Direct copy |
| `created_at` | `created_at` | Direct copy |
| — | `updated_at` | Set to legacy `created_at` |
| — | `migrated_from_legacy` | Set to `TRUE` for migrated rows |

---

## Unique Constraints / Conflict Targets

| Table | Constraint | Columns |
|---|---|---|
| `project_client_commitments` | **None** (only PK + indexes) | Migration uses `(project_id, commitment_text, committed_date)` as dedup key |
| `project_client_updates` | `pcu_project_update_uq` | `(project_id, update_number)` |

---

## Consolidation Decision

The legacy routes file (`collaboration-workflow-routes.ts`) is **dead code** — `registerCollaborationWorkflowRoutes` is never called. All active traffic goes through `stage-collaboration-routes.ts` which uses canonical tables.

The legacy service (`collaboration-workflow-service.ts`) still contains functions that read/write legacy tables, but these are only reachable through the dead legacy routes file.

**Action:** Migrate any existing legacy data, redirect the legacy service to canonical tables, add runtime guards, and deprecate.
