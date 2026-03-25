# Audit 3: Engineering Stages Integration

**Date:** 2026-03-19
**Scope:** Engineering Stages tab, stage lifecycle, deliverable workflow, task board disconnection
**Status:** Read-only audit — no changes made

---

## 1. Data Model

### Stage Data — `project_eng_stages`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| projectId | int FK → projectInfo.id | |
| stageTemplateId | int FK → engStageTemplates.id | |
| status | enum | not_started, in_progress, blocked, ready_for_review, complete |
| startedAt | timestamp | nullable |
| completedAt | timestamp | nullable |
| overrideReason | text | nullable — stores COO override justification |
| createdBy | int FK → users.id | |
| createdAt | timestamp | |

### Stage Tasks — `project_eng_tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| projectEngStageId | int FK → projectEngStages.id | cascade delete |
| taskTemplateId | int FK → engTaskTemplates.id | |
| status | enum | pending, in_progress, complete, skipped |
| ownerUserId | int FK → users.id | nullable |
| notes | text | nullable |
| dueDate | text | nullable |
| completedAt | timestamp | nullable |
| completedBy | int FK → users.id | nullable |
| hasDeliverable | boolean | default false — requires deliverable approval |
| createdAt | timestamp | |

### Stage Deliverables — `project_eng_deliverables`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| projectEngStageId | int FK → projectEngStages.id | cascade delete |
| deliverableTemplateId | int FK → engDeliverableTemplates.id | nullable |
| projectEngTaskId | int FK → projectEngTasks.id | nullable, on delete set null |
| fileName | text | |
| fileSize | int | nullable |
| mimeType | text | nullable |
| storageRef | text | disk filename reference |
| uploadedBy | int FK → users.id | |
| uploadedAt | timestamp | default now |
| versionTag | text | nullable — e.g., "v1", "v2" |
| notes | text | nullable |
| sharepointFolderPath | text | nullable — **metadata only, no sync** |
| approvalStatus | text | pending, approved, rejected |
| approvedBy | int FK → users.id | nullable |
| approvedAt | timestamp | nullable |

### Stage Approvals — `project_eng_approvals`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| projectEngStageId | int FK → projectEngStages.id | cascade delete |
| approverRole | text | QA_REVIEW or TECHNICAL_SIGNOFF |
| approverUserId | int FK → users.id | nullable |
| status | enum | pending, approved, rejected |
| comments | text | nullable |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### Template Tables
- `eng_stage_templates` — 5 stage definitions
- `eng_task_templates` — task templates per stage
- `eng_deliverable_templates` — deliverable templates per stage

**Are stage tasks linked to work_items or operational_tasks?** NO — completely separate tables with no FK relationships.

---

## 2. Stage Lifecycle

### The 5 Stages (DB-seeded via `seed-eng-templates.ts`)

| # | Stage | Tasks | Deliverables | Special Gates |
|---|-------|-------|-------------|---------------|
| 1 | First Assessment | 3 | 2 | requireAllTasks + requireAllDeliverables |
| 2 | Cost Proposal | 5 | 1 ("CP Pack") | requireAllTasks + requireAllDeliverables |
| 3 | IFC Planning | 9 | 3 | requireAllTasks + requireAllDeliverables |
| 4 | Construction Support | 7 | 3 | requireAllTasks + requireAllDeliverables |
| 5 | Handover Pack | 15 (14 required + 1 optional) | 1 | + requireQaApproval + requireTechnicalSignoff |

### Status Flow
```
not_started → in_progress → blocked → ready_for_review → complete
```
- Auto-transitions to `in_progress` when first task becomes complete or in_progress (eng-stage-routes.ts:600-606)

### Stage Generation
- **Trigger:** POST `/api/projects/:projectId/eng-stages/generate` ("Generate Engineering Checklist" button)
- **Logic:** Creates one instance of each active stage template, along with all associated tasks and approval records
- **Returns:** `{stagesCreated, tasksCreated}`

### Stage Completion Validation (POST `/api/eng-stages/stages/:stageId/complete`)
1. If `requireAllTasks`: all required tasks must have `status = 'complete'`
2. If `requireAllDeliverables`: all required deliverable templates must have uploaded files
3. If `requireQaApproval`: QA_REVIEW approval must be `approved`
4. If `requireTechnicalSignoff`: TECHNICAL_SIGNOFF approval must be `approved`
5. If validation fails → returns missing items list, stage NOT marked complete

### COO Override (POST `/api/eng-stages/stages/:stageId/override-complete`)
- **Access:** COO_ADMIN, CEO_ADMIN, admin only
- **Requires:** mandatory reason text
- **Effect:** Sets status to `complete`, stores `overrideReason`, **BYPASSES ALL GATE VALIDATIONS**
- UI shows warning: "Override: [reason]"

---

## 3. Deliverable Workflow

### Upload Flow
1. User selects file → Multer saves to `/uploads/eng-deliverables/`
2. Filename: `{timestamp}_{sanitized-original-name}`
3. DB record created with `approvalStatus: 'pending'`

### Approval Statuses
- **pending** → awaiting review
- **approved** → task can complete
- **rejected** → must re-upload with new `versionTag`

### Who Can Approve
- COO roles: COO_ADMIN, CEO_ADMIN, admin
- Engineer roles: ENGINEER, COO_ADMIN, CEO_ADMIN, admin, PROGRAM_MANAGER
- QA: QUALITY_MANAGER
- **Safeguard:** User cannot approve their own upload

### Version History
- Rejected deliverables can be re-uploaded with different `versionTag` (e.g., "v1" → "v2")
- Old rejected versions remain in DB for audit trail
- No automatic deletion of old versions

### SharePoint Folder Path
- **Stored in:** `sharepointFolderPath` column
- **Status:** Metadata only — **no code integrates this with SharePoint**
- UI persists paths in localStorage (`SP_FOLDER_KEY`)
- Paths are not validated or used by backend

---

## 4. Disconnection from Task Board (CRITICAL FINDING)

### Complete Separation Confirmed

`project_eng_tasks` are **COMPLETELY SEPARATE** from `work_items` and `operational_tasks`.

| Check | Result |
|-------|--------|
| FK from project_eng_tasks to work_items? | **NO** |
| Code that creates work_items when stages generate? | **NO** |
| Code that syncs stage task completion to task board? | **NO** |
| Legacy backfill? | One-time only (`work-items-backfill.ts`) — NOT live sync |

### Impact
- A task completed in Engineering Stages tab does NOT appear as complete on the Engineering Task Board
- Engineers must **manually update both systems** — dual data entry required
- When engineering workstream is initialized, `generateDefaultEngineeringWorkItemsForProject()` creates **16 generic work items** that are NOT tied to stage tasks

---

## 5. CP Signed Gate

### Important: CP Signed Is NOT Part of Engineering Stages

CP Signed lives in the **Intake Request workflow** (`intakeRequests` table), not in the Stages system.

### Implementation
- **Endpoint:** POST `/api/sp-sync/cp-signed/:requestId` (sync-routes.ts:550-621)
- **Access:** COO_ADMIN, CEO_ADMIN, admin
- **Flow:** Marks `cpSigned = true`, sets date/evidence, generates intake tasks if needed
- **DB Fields:** `cpSigned`, `cpSignedDate`, `cpSignedBy`, `cpEvidenceType`, `cpEvidenceRef`

### No Linkage to Engineering Stages
- CP Signed is on intake request → before project creation
- Engineering Stages are generated after project exists
- Different data models, different workflows

### What Would Need to Be Built (if integration desired)
1. FK from Engineering Stages → Intake Request
2. Gate validation: Cannot complete "Cost Proposal" stage unless intake request has CP Signed
3. UI indicator: Show CP Signed status in stage detail
4. Sync: Monitor intake CP Signed changes → update stage gate

---

## 6. Integration Summary

| Component | Linked to Work Items? | Linked to Task Board? | Status Syncs? |
|-----------|----------------------|----------------------|---------------|
| project_eng_tasks | Legacy backfill only | NO | NO |
| projectEngStages | NO | NO | NO |
| projectEngDeliverables | NO | NO | NO |
| projectEngApprovals | NO | NO | NO |
| CP Signed (intakeRequests) | NO | NO | NO |

**Conclusion:** Engineering Stages is a **parallel execution system**. Progress is visible only within the Stages UI. The Task Board sees no updates from stage completion.
