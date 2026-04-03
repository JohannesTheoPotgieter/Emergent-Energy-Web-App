# Frontend → Backend → Database Write Map

> Generated from exhaustive codebase audit. 362 frontend mutations, 646 backend write handlers.

---

## 1. PROJECTS

### 1.1 project_info (BASE TABLE — not view-swapped)

| UI Screen / Component | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Lifecycle Board | Update RAG status | `ProjectCommandHeader.tsx:342` | `POST /api/lifecycle-board/projects/:id/rag` | `lifecycle-routes.ts:373` | ragStatus, ragComment, ragUpdatedAt, ragUpdatedByUserId | Via storage.ts → syncProject() |
| Lifecycle Board | Change phase | `lifecycle-board.tsx:621` | `PATCH /api/lifecycle-board/projects/:id/phase` | `lifecycle-routes.ts:1742` | phase, phaseUpdatedAt, phaseUpdatedByUserId, phaseNotes | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Edit project fields | `lifecycle-board.tsx:577` | `PATCH /api/lifecycle-board/projects/:id` | `lifecycle-routes.ts:1598` | Any field: clientId, sizeKwp, contractValue, deliveryModel, etc. | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Archive project | — | `DELETE /api/lifecycle-board/projects/:id` | `lifecycle-routes.ts:1942` | archivedStatus, deletedAt | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Restore project | — | `PATCH /api/lifecycle-board/projects/:id/restore` | `lifecycle-routes.ts:2103` | archivedStatus='ACTIVE', deletedAt=null | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Merge projects | — | `POST /api/lifecycle-board/projects/merge` | `lifecycle-routes.ts:1425-1435` | archivedStatus, executionEnabled, multiple fields | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Promote engineering | — | `POST /api/lifecycle-board/projects/promote-engineering` | `lifecycle-routes.ts:1494` | executionEnabled, executionPhase | Direct db.update — **NO BRIDGE** |
| Lifecycle Board | Stage gate override | — | `POST /api/lifecycle-board/projects/:id/stage-gates/override` | `lifecycle-routes.ts` | gateStatus, gateReadinessPct | Direct db.update — **NO BRIDGE** |
| Project Detail | Edit project inline | `project-detail.tsx:350` | `PATCH /api/project-info/:id` | `routes.ts` → `storage.ts:811` | Any field via updateProjectInfoById | Via storage.ts → **syncProject()** ✅ |
| Project Detail | Save project summary | `projects.tsx:539` | `POST /api/projects-summary/:name/edit` | `routes.ts` | sizeKwp, contractValue, deliveryModel, etc. | Via storage.ts → **syncProject()** ✅ |
| Project Detail | Set escalation | — | `PATCH /api/projects-summary/:id/escalation` | `routes.ts` | escalationLevel | Direct — **NO BRIDGE** |
| Engineering Stages | Mark CP signed | `EngineeringStagesTab.tsx:105` | `POST /api/projects/:id/mark-cp-signed` | `engineering-routes.ts:2848` | cpSigned, cpSignedDate, cpSignedByUserId, cpEvidenceType, cpEvidenceRef | Direct db.update — **NO BRIDGE** |
| Engineering Stages | PM task pack created | — | (internal after CP sign) | `engineering-routes.ts:2868` | pmTaskPackCreated=true | Direct db.update — **NO BRIDGE** |
| Engineering Stages | Eng task pack created | — | (internal after CP sign) | `engineering-routes.ts:2886` | engPostCpTaskPackCreated=true | Direct db.update — **NO BRIDGE** |
| PD-PM Handover | Submit handover | — | `POST /api/pd-pm-handover/:id/submit` | `handover-routes.ts:631` | pdHandoverDate, various tracker fields | Direct db.update — **NO BRIDGE** |
| PD-PM Handover | Accept handover | — | `POST /api/pd-pm-handover/:id/accept` | `handover-routes.ts:793` | pmUserId, executionEnabled, various | Direct db.update — **NO BRIDGE** |
| PD-PM Handover | Reject handover | — | `POST /api/pd-pm-handover/:id/reject` | `handover-routes.ts:867` | rejection fields | Direct db.update — **NO BRIDGE** |
| PD-PM Handover | Set Excel tracker | — | `PUT /api/pd-pm-handover/:id/excel-tracker` | `handover-routes.ts:933` | excelTrackerLink | Direct db.update — **NO BRIDGE** |
| Smart Import | Create new project | — | (internal during commit) | `smart-import-routes.ts:1624` | All fields (INSERT) | Direct db.insert — **NO BRIDGE** |
| Smart Import | Update project during import | — | (internal during commit) | `smart-import-routes.ts:2507` | Various updated fields | Direct db.update — **NO BRIDGE** |
| Template | Create from template | — | `POST /api/projects` | `template-routes.ts:761` | All fields (INSERT) | Direct db.insert — **NO BRIDGE** |
| Admin | Assign PM | — | `PATCH /api/project-info/:id/assign-pm` | `departments/project-routes.ts:1953` | pmUserId | Direct db.update — **NO BRIDGE** |
| Meetings | Create from meeting | — | (internal) | `meeting-routes.ts:377` | projectName, various (INSERT) | Direct db.insert — **NO BRIDGE** |
| SP Sync | Create from SharePoint | — | (internal) | `sync-routes.ts:242` | All fields (INSERT) | Direct db.insert — **NO BRIDGE** |
| V2 API | Update project | — | `PATCH /api/v2/projects/:id/...` | `api/v2/project-v2-repository.ts:55` | Various | Direct db.update — **NO BRIDGE** |

### 1.2 project_execution_state (BASE TABLE — not view-swapped)

| UI Screen | User Action | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|
| Lifecycle Board | Change phase | `PATCH /.../phase` | `lifecycle-routes.ts:1771` | phase, phaseUpdatedAt, currentStageCode, executionPhase, gateStatus | Direct — **NO BRIDGE** |
| Lifecycle Board | Change execution gate | `PATCH /.../execution-gate` | `lifecycle-routes.ts` | executionGateStatus, executionGateReason | Via storage.ts → **syncProject()** ✅ |
| Financial Review | Update review status | (internal) | `financial-review-service.ts:156,395` | financialReviewStatus, financialReviewId | Direct — **NO BRIDGE** |
| Stage Lifecycle | Stage transition | (internal) | `stage-lifecycle-service.ts:105,482,632` | currentStageCode, gateStatus, gateReadinessPct, stageOwnerUserId, various | Direct — **NO BRIDGE** |
| Startup | Gate evaluation backfill | (startup) | `gate-evaluation-backfill.ts:81` | gateStatus, gateReadinessPct | Direct — N/A (startup) |
| Startup | Stage instance backfill | (startup) | `stage-instance-backfill.ts:156` | currentStageCode | Direct — N/A (startup) |
| Storage | After project update | (internal) | `lib/project-info-sync.ts:118,156` | Creates/updates PES row when project_info changes | Direct — **NO BRIDGE** |

---

## 2. CLIENTS (BASE TABLE — not view-swapped)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Admin/Clients | Create client | — | `POST /api/clients` | `routes.ts:3578` | name, clientId, createdBy, updatedBy | **syncClient()** ✅ |
| PD Intake | Create client | `project-lifecycle.tsx:1001` | `POST /api/pd/clients` | `pd-routes.ts:179` | name, clientId, createdBy | **syncClient()** ✅ |
| PD Intake | Update client | — | `PATCH /api/pd/clients/:id` | `pd-routes.ts:222` | name, updatedBy | Direct — **NO BRIDGE** |

---

## 3. COST LINES — normalized_cost_lines (BASE TABLE — not view-swapped)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Expenditure Tab | Inline edit field | `ExpenditureEditableTab.tsx:466` | `POST /api/expenditure/overrides` | `finance-routes.ts` → `storage.ts:1229` | amountExVat, invoiceDate, paidDate, counterpartyName, description, etc. | Via storage.ts → **syncCostLine()** ✅ |
| Expenditure Tab | Toggle font color | `ExpenditureEditableTab.tsx:1014` | `PATCH /api/expenditure/font-color-toggle` | `finance-routes.ts` | invoiceDateFontColor, paidDateFontColor, invoiceDateConfirmed, paidDateConfirmed | Direct manual_edit_flags — **NO BRIDGE to cost_lines** |
| Expenditure Tab | Add line | `ExpenditureEditableTab.tsx:550` | `POST /api/expenses/add-line` | `routes.ts` | projectName, description, amountExVat (INSERT) | Direct — **NO BRIDGE** |
| Expenditure Tab | Add category | `ExpenditureEditableTab.tsx:569` | `POST /api/expenses/add-category` | `routes.ts` | projectName, costCategory (INSERT) | Direct — **NO BRIDGE** |
| Expenditure Tab | Insert task as line | `ExpenditureEditableTab.tsx:587` | `POST /api/expenses/insert-task-as-line` | `routes.ts` | projectName, description from task (INSERT) | Direct — **NO BRIDGE** |
| Expenditure Tab | COS status override | `ExpenditureEditableTab.tsx:609` | `POST /api/cos-status-override` | `routes.ts` | cosStatusOverride, cosStatusOverrideBy, cosStatusOverrideAt, cosStatusOverrideReason | Direct cos_status_overrides table — **separate table** |
| Expenditure Tab | No revenue linked | `ExpenditureEditableTab.tsx:642` | `PATCH /api/cost-lines/:id/no-revenue-linked` | `routes.ts` | noRevenueLinked | Direct — **NO BRIDGE** |
| Expenditure Tab | Date override | `ExpenditureEditableTab.tsx:2065` | `POST /api/expense-task-links/.../date-override` | `routes.ts` | date_overrides table — separate | N/A |
| Smart Import | Bulk commit expenses | — | (internal) | `smart-import-routes.ts:2240` | All columns (bulk INSERT) | Direct — **NO BRIDGE** |
| Smart Import | Update during commit | — | (internal) | `smart-import-routes.ts:2266` | Various fields | Direct — **NO BRIDGE** |
| Data Import | Bulk import | — | `POST /api/refresh` (internal) | `routes.ts:2867` | All columns (bulk INSERT) | Direct — **NO BRIDGE** |
| Invoice Patterns | Classify invoice | — | (internal) | `invoice-pattern-routes.ts:342,628,743,1175` | patternRuleId, patternClassifiedAt, patternInferredType, inferredCounterpartyId | Direct — **NO BRIDGE** |
| Subcontractor | Add cost lines | — | (internal) | `subcontractor-routes.ts:467` | All columns (bulk INSERT) | Direct — **NO BRIDGE** |
| Subcontractor | Update cost line | — | (internal) | `subcontractor-routes.ts:531,596,600,672,678,767` | counterpartyName, counterpartyId, counterpartyType, amountExVat, etc. | Direct — **NO BRIDGE** |
| Deliverable Capture | Link to cost line | — | (internal) | `deliverable-capture-routes.ts:182` | linkedDeliverableId | Direct — **NO BRIDGE** |
| Finance Routes | Direct edit | — | (internal) | `departments/finance-routes.ts:1065` | Various via mapped fields | Direct — **NO BRIDGE** |

---

## 4. REVENUE LINES — normalized_revenue_lines (BASE TABLE — not view-swapped)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Revenue Tab | Inline edit field | `RevenueTrackingEditableTab.tsx:151` | `POST /api/revenue-tracking/overrides` | `finance-routes.ts` → `storage.ts:1292` | amountExVat, invoiceDate, paidDate, milestoneName, etc. | Via storage.ts → **syncRevenueLine()** ✅ |
| Revenue Tab | Delete override | `RevenueTrackingEditableTab.tsx:193` | `DELETE /api/revenue-tracking/overrides/:name` | `finance-routes.ts` | (deletes override) | N/A |
| Revenue Tab (read-only) | Link task | `RevenueTrackingTab.tsx:357` | `POST /api/revenue-tab/.../link-task` | `routes.ts` | milestone_task_links (separate table) | N/A |
| Revenue Tab (read-only) | Date override | `RevenueTrackingTab.tsx:415` | `POST /api/revenue-tab/.../date-override` | `routes.ts` | adminDateOverride, adminDateOverrideAt, adminDateOverrideBy, adminDateOverrideReason | Direct — **NO BRIDGE** |
| Revenue Tab (read-only) | Mark costed | `RevenueTrackingTab.tsx:452` | `POST /api/revenue-tab/.../costed` | `routes.ts` | cashflowConfirmed | Direct — **NO BRIDGE** |
| Smart Import | Bulk commit revenue | — | (internal) | `smart-import-routes.ts:1987` | All columns (bulk INSERT) | Direct — **NO BRIDGE** |
| Smart Import | Update during commit | — | (internal) | `smart-import-routes.ts:2000` | Various fields | Direct — **NO BRIDGE** |
| Data Import | Bulk import | — | `POST /api/refresh` (internal) | `routes.ts:2849` | All columns (bulk INSERT) | Direct — **NO BRIDGE** |
| Deliverable Capture | Link to revenue line | — | (internal) | `deliverable-capture-routes.ts:186` | linkedDeliverableId | Direct — **NO BRIDGE** |
| Finance Routes | Direct edit | — | (internal) | `departments/finance-routes.ts:1185,3238` | Various via mapped fields | Direct — **NO BRIDGE** |

---

## 5. APPROVALS (VIEW → documentation.document_approvals via INSTEAD OF trigger)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Approvals Tab | Create approval | `ProjectApprovalsTab.tsx` | `POST /api/approvals/general` | `approvals-routes.ts:388` | type, title, description, status, requestedBy, assignedApprover, dueDate, projectId, approvalCategory, relatedEntityType, relatedEntityId | **YES — via view trigger** ✅ |
| Approvals Tab | Approve/reject | `ProjectApprovalsTab.tsx:98` | `PATCH /api/approvals/general/:id` | `approvals-routes.ts:544` | status, decisionNote, decidedAt, decidedBy | **YES — via view trigger** ✅ |
| Approvals Tab | Delete | — | `DELETE /api/approvals/general/:id` | `approvals-routes.ts:630` | deletedAt, deletedBy, deleteReason | **YES — via view trigger** ✅ |
| Approvals Tab | Schedule | — | `PATCH /api/calendar/schedule-task` | `routes.ts:6550` | scheduledDate, scheduledStartTime, scheduledEndTime | **YES — via view trigger** ✅ |
| Commissioning Tab | Create closeout approval | `ProjectCommissioningTab.tsx` | `POST /api/commissioning` (internal) | `commissioning-routes.ts:202` | type, title, projectId, requestedBy, status | **YES — via view trigger** ✅ |
| Financial Review | Create gate approval | — | (internal) | `financial-review-service.ts:358` | type='gate', title, projectId, approvalCategory | **YES — via view trigger** ✅ |
| Assignment | Update approver | — | (internal) | `assignment-service.ts:989` | assignedApprover | **YES — via view trigger** ✅ |
| Approval Service | Generic create | — | (internal) | `approval-service.ts:31` | All standard fields (INSERT) | **YES — via view trigger** ✅ |

---

## 6. DELIVERABLES (VIEW → documentation.documents via INSTEAD OF trigger)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Engineering | Create deliverable | — | `POST /api/deliverables` | `engineering-routes.ts:1790` | projectId, title, deliverableType, description, phase, ownerUserId, reviewerUserId, status | **YES — via view trigger** ✅ |
| Engineering | Update deliverable | — | `PATCH /api/deliverables/:id` | `engineering-routes.ts:1836` | status, title, description, phase, reviewerUserId, qcReviewerUserId | **YES — via view trigger** ✅ |
| Engineering | Provide feedback | — | `POST /api/deliverables/:id/feedback` | `engineering-routes.ts:1868` | status='PROVIDE FEEDBACK' | **YES — via view trigger** ✅ |
| Engineering | Revise | — | `POST /api/deliverables/:id/revise` | `engineering-routes.ts:1919` | currentVersion (increment), status | **YES — via view trigger** ✅ |
| Engineering | Upload files | — | `POST /api/deliverables/:id/files` | `engineering-routes.ts:1940` | deliverable_files table (NOT deliverables) | N/A — separate table |
| Engineering | Approve file | `EngineeringStagesTab.tsx:703` | `PATCH /api/deliverables/files/:id/approve` | `engineering-routes.ts` | deliverable_files.approval_status | N/A — separate table |
| Template | Create from template | — | `POST /api/templates/apply` | `template-routes.ts:240` | All fields (INSERT) | **YES — via view trigger** ✅ |
| Deliverable Capture | Upload capture | `CaptureDeliverable.tsx:147` | `POST /api/deliverable-capture/upload` | `deliverable-capture-routes.ts:148` | projectId, title, deliverableType, ownerUserId, filePath, fileSize, mimeType | **YES — via view trigger** ✅ |
| Assignment | Update owner/reviewer | — | (internal) | `assignment-service.ts:981` | ownerUserId, reviewerUserId | **YES — via view trigger** ✅ |
| Calendar | Schedule deliverable | — | `PATCH /api/calendar/schedule-task` | `routes.ts:6491` | scheduledDate, scheduledStartTime, scheduledEndTime | **YES — via view trigger** ✅ |

---

## 7. WORK ITEMS (VIEW → core.work_items via INSTEAD OF trigger)

| UI Screen | User Action | Frontend Call | API Endpoint | Backend File:Line | Columns Written | Reaches Promoted? |
|---|---|---|---|---|---|---|
| Task Management | Create task | `task-management-routes.ts` | `POST /api/tasks` | `task-management-routes.ts:368` | title, description, status, priority, workstream, type, ownerUserId, dueDate, projectId, clientId | **YES — via view trigger** ✅ |
| Task Management | Update task | — | `PATCH /api/tasks/:id` | `task-management-routes.ts` | Any field | **YES — via view trigger** ✅ |
| Task Management | Bulk update | — | `POST /api/tasks/bulk-update` | `task-management-routes.ts` | status, priority, ownerUserId (batch) | **YES — via view trigger** ✅ |
| Operational Tasks | Create | — | `POST /api/operational-tasks` | `operational-tasks-routes.ts` | title, description, status, priority, phase, projectId, ownerUserId, workstream, dueDate | **YES — via view trigger** ✅ |
| Operational Tasks | Update | — | `PATCH /api/operational-tasks/:id` | `operational-tasks-routes.ts` | Various fields | **YES — via view trigger** ✅ |
| Operational Tasks | Delete | — | `DELETE /api/operational-tasks/:id` | `operational-tasks-routes.ts` | deletedAt | **YES — via view trigger** ✅ |
| My Work | Reassign | `UserAssignmentPicker.tsx:141` | `PATCH /api/tasks/reassign` | `routes.ts` | work_item_assignments (separate table) | N/A — separate table |
| Project Plan | Create plan tasks | `ProjectPlanTab.tsx:134` | `POST /api/planning-tasks` | `routes.ts:2810` | All plan columns (bulk INSERT) | **YES — via view trigger** ✅ |
| Project Plan | Update plan task | `ProjectPlanTab.tsx:134` | `PATCH /api/planning-tasks/:id` | `routes.ts` | percentComplete, status, startDate, endDate, title | **YES — via view trigger** ✅ |
| Project Plan | Delete plan tasks | — | `POST /api/project-plan/delete-tasks` | `routes.ts` | DELETE | **YES — via view trigger** ✅ |
| Working Plan | Update task | — | `PATCH /api/working-plan/tasks/:id` | `routes.ts` | percentComplete, startDate, endDate | **YES — via view trigger** ✅ |
| Working Plan | Delete task | — | `DELETE /api/working-plan/tasks/:id` | `routes.ts` | DELETE | **YES — via view trigger** ✅ |
| Work Items | Soft delete | — | `POST /api/work-items/delete` | `routes.ts:4316` | deletedAt = NOW() | **YES — via view trigger** ✅ |
| Work Items | Restore | — | `POST /api/work-items/restore` | `routes.ts:4336` | deletedAt = NULL | **YES — via view trigger** ✅ |
| Smart Import | Bulk create | — | (internal) | `smart-import-routes.ts:1880` | All columns (bulk INSERT) | **YES — via view trigger** ✅ |
| Smart Import | Hard delete | — | (internal) | `smart-import-routes.ts:1814` | DELETE | **YES — via view trigger** ✅ |
| Data Import | Bulk import | — | `POST /api/refresh` (internal) | `routes.ts:2810,5397` | All columns (bulk INSERT) | **YES — via view trigger** ✅ |
| Engineering | Create eng task | `EngineeringStagesTab.tsx` | `POST /api/eng/tasks` | `engineering-routes.ts` | work_items INSERT + project_eng_tasks | **YES — via view trigger** ✅ |
| Engineering | Update eng task | `EngineeringStagesTab.tsx:604` | `PATCH /api/eng/tasks/:id` | `engineering-routes.ts` | status, notes, completedAt | **YES — via view trigger** ✅ |
| MyTool | Create task | — | `POST /api/mytool/tasks` | `routes.ts` | work_items INSERT (workstream=PERSONAL) | **YES — via view trigger** ✅ |
| MyTool | Update task | — | `PATCH /api/mytool/tasks/:id` | `routes.ts` | Various | **YES — via view trigger** ✅ |
| Meetings | Create from action | — | `POST /api/meetings/action-items/:id/convert-to-task` | `meeting-routes.ts:275` | title, description, status, projectId (INSERT) | **YES — via view trigger** ✅ |
| PD Tickets | Spawn tasks | — | `POST /api/pd/tickets/:id/spawn-tasks` | `pd-routes.ts:968` | work_items INSERT from template | **YES — via view trigger** ✅ |
| TR Register | Create action | — | `POST /api/tr-register/:id/link` | `tr-register-routes.ts:423` | work_items INSERT from TR action | **YES — via view trigger** ✅ |

---

## 8. RELATED TABLES (not part of the 7 spine domains)

These tables are written directly and have no promoted counterparts:

| Table | Written From | Notes |
|---|---|---|
| `work_item_assignments` | assignment-service.ts, routes.ts | Task assignments/reassignments |
| `work_item_dependencies` | routes.ts, dependency routes | Task dependency links |
| `work_item_comments` | task-management-routes.ts, engineering-routes.ts | Comments on tasks |
| `work_item_attachments` | routes.ts | File attachments |
| `work_item_status_history` | (auto via trigger/service) | Status change log |
| `deliverable_files` | engineering-routes.ts | File uploads for deliverables |
| `deliverable_versions` | engineering-routes.ts | Version tracking |
| `deliverable_events` | engineering-routes.ts | Event log |
| `entity_assignments` | assignment-service.ts | Generic assignment table |
| `manual_edit_flags` | finance-routes.ts | Smart import conflict tracking |
| `change_sets` / `field_changes` | finance-routes.ts | Audit trail |
| `cashflow_planning_overrides` | cashflow routes | Cashflow overrides |
| `cos_status_overrides` | routes.ts | COS override table |
| `procurement_items` | procurement routes | Procurement management |
| `purchase_orders` | PO routes | Purchase orders |
| `payment_requests` / `payment_batches` | payment routes | Payment processing |
| `raid_items` | raid routes | Risk/action/issue/decision items |
| `change_requests` | change control routes | Variation orders |
| `commissioning_items` | commissioning routes | Commissioning checklist |
| `qc_*` tables | quality routes | Quality management (15 tables) |
| `project_eng_*` tables | engineering routes | Engineering stages/tasks/deliverables |
| `weekly_reviews` | weekly review wizard | Weekly review workflow |

---

## COVERAGE SUMMARY

| Domain | Table | Type | Total Write Paths | Bridged | Coverage |
|--------|-------|------|------------------|---------|----------|
| **Work Items** | work_items | VIEW | ~40+ | ALL (trigger) | **100%** ✅ |
| **Approvals** | approvals | VIEW | 9 | ALL (trigger) | **100%** ✅ |
| **Deliverables** | deliverables | VIEW | 9 | ALL (trigger) | **100%** ✅ |
| **Projects** | project_info | BASE TABLE | ~36 | ~6 via storage.ts | **~17%** ⚠️ |
| **Projects** | project_execution_state | BASE TABLE | ~10 | ~2 via storage.ts | **~20%** ⚠️ |
| **Cost Lines** | normalized_cost_lines | BASE TABLE | ~27 | ~4 via storage.ts | **~15%** ⚠️ |
| **Revenue Lines** | normalized_revenue_lines | BASE TABLE | ~10 | ~3 via storage.ts | **~30%** ⚠️ |
| **Clients** | clients | BASE TABLE | 3 | 2 | **67%** ⚠️ |

### What's fully covered (100%)
- work_items, approvals, deliverables — view triggers catch every write from every file

### What has gaps
- project_info (30 unbridged direct db.update paths)
- project_execution_state (8 unbridged paths)
- normalized_cost_lines (23 unbridged paths)
- normalized_revenue_lines (7 unbridged paths)
- clients (1 unbridged update path)

### Recommended fix
Apply the same view swap pattern to these 5 tables:
- Rename to `_project_info_legacy`, `_project_execution_state_legacy`, etc.
- Create views with INSTEAD OF triggers that write to promoted + legacy
- This achieves 100% coverage with zero code changes
