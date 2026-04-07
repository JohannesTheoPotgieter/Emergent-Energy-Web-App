# Work Items Extension Tables — Design Report

> Generated: 2026-03-20 | Prompt 5 of 15

## 1. Column Comparison Table

### work_items (66 columns)

| # | Column | Type | Default |
|---|--------|------|---------|
| 1 | id | serial PK | — |
| 2 | clientId | integer FK→clients | — |
| 3 | projectId | integer FK→projectInfo | NOT NULL |
| 4 | workstream | enum | NOT NULL |
| 5 | type | text | — |
| 6 | source | enum | 'UI' |
| 7 | title | text | NOT NULL |
| 8 | description | text | — |
| 9 | status | text | 'Not Started' |
| 10 | priority | text | — |
| 11 | startDate | text | — |
| 12 | endDate | text | — |
| 13 | duration | integer | — |
| 14 | percentComplete | real | 0 |
| 15 | expectedPctComplete | real | — |
| 16 | wbsCode | text | — |
| 17 | outlineNumber | text | — |
| 18 | indentLevel | integer | 0 |
| 19 | parentId | integer | — |
| 20 | isMilestone | boolean | false |
| 21 | phase | text | — |
| 22 | ownerUserId | integer FK→users | — |
| 23 | ownerName | text | — |
| 24 | isShared | boolean | false |
| 25 | externalRef | text UNIQUE | — |
| 26 | legacyTable | text | — |
| 27 | legacyId | integer | — |
| 28 | sourceRow | integer | — |
| 29 | sourceSheet | text | — |
| 30 | importRunId | integer | — |
| 31 | createdBy | integer FK→users | — |
| 32 | createdAt | timestamp | NOW() |
| 33 | updatedAt | timestamp | NOW() |
| 34 | deletedAt | timestamp | — |
| 35 | scheduledDate | text | — |
| 36 | scheduledStartTime | text | — |
| 37 | scheduledEndTime | text | — |
| 38 | baselineStart | text | — |
| 39 | baselineEnd | text | — |
| 40 | baselineDuration | integer | — |
| 41 | taskMode | text | 'auto' |
| 42 | actualStart | text | — |
| 43 | actualEnd | text | — |
| 44 | actualDuration | integer | — |
| 45 | sortOrder | integer | 0 |
| 46 | estimateMinutes | integer | — |
| 47 | taskCategory | text | — |
| 48 | isRecurring | boolean | false |
| 49 | recurrenceFrequency | text | — |
| 50 | recurrenceInterval | integer | 1 |
| 51 | recurrenceDaysOfWeek | text | — |
| 52 | recurrenceEndDate | text | — |
| 53 | recurrenceParentId | integer | — |
| 54 | subProjectName | text | — |
| 55 | holdReason | text | — |
| 56 | blockedType | text | — |
| 57 | approvalRequired | boolean | false |
| 58 | linkedPlanItemId | integer | — |
| 59 | linkedDeliverableId | integer | — |
| 60 | linkedQualityItemInstanceId | integer | — |
| 61 | completedAt | timestamp | — |
| 62 | trackingRag | text | — |
| 63 | taskTypeTag | text | — |
| 64 | blockerReason | text | — |

### operational_tasks (59 columns)

| # | Column | Type | Default |
|---|--------|------|---------|
| 1 | id | serial PK | — |
| 2 | projectId | integer FK→projectInfo | — |
| 3 | projectName | text | NOT NULL |
| 4 | importedTaskId | integer | — |
| 5 | taskNumber | text | — |
| 6 | parentTaskId | integer | — |
| 7 | title | text | NOT NULL |
| 8 | description | text | — |
| 9 | status | text | 'TO DO' |
| 10 | priority | text | 'Med' |
| 11 | phase | text | — |
| 12 | primaryWorkstream | text | — |
| 13 | ownerUserId | integer FK→users | — |
| 14 | requesterUserId | integer FK→users | — |
| 15 | approverUserId | integer FK→users | — |
| 16 | holdReason | text | — |
| 17 | blockedType | text | — |
| 18 | approvalRequired | boolean | false |
| 19 | startDate | text | — |
| 20 | dueDate | text | — |
| 21 | durationDays | integer | — |
| 22 | actualStartDate | text | — |
| 23 | actualEndDate | text | — |
| 24 | actualDurationDays | integer | — |
| 25 | completedAt | timestamp | — |
| 26 | percentComplete | integer | 0 |
| 27 | expectedPercentComplete | integer | — |
| 28 | comment | text | — |
| 29 | assignees | text[] | — |
| 30 | assigneeUserIds | integer[] | — |
| 31 | watchers | text[] | — |
| 32 | tags | text[] | — |
| 33 | blockerReason | text | — |
| 34 | plannedHours | real | — |
| 35 | actualHours | real | — |
| 36 | escalationLevel | text | — |
| 37 | sortOrder | integer | 0 |
| 38 | isBaseline | boolean | false |
| 39 | linkedPlanItemId | integer | — |
| 40 | linkedDeliverableId | integer | — |
| 41 | linkedQualityItemInstanceId | integer | — |
| 42 | externalSource | text | — |
| 43 | externalTaskId | text | — |
| 44 | externalSubtaskIds | text | — |
| 45 | externalSubtaskUrls | text | — |
| 46 | trackingRag | text | — |
| 47 | summaryText | text | — |
| 48 | importedCommentCount | integer | — |
| 49 | taskTypeTag | text | — |
| 50 | domain | text | 'BOTH' |
| 51 | pdTicketId | integer FK→pdTickets | — |
| 52 | createdBy | integer FK→users | — |
| 53 | scheduledDate | text | — |
| 54 | scheduledStartTime | text | — |
| 55 | scheduledEndTime | text | — |
| 56 | deletedAt | timestamp | — |
| 57 | createdAt | timestamp | NOW() |
| 58 | updatedAt | timestamp | NOW() |

### engineering_tasks (21 columns)

| # | Column | Type | Default |
|---|--------|------|---------|
| 1 | id | serial PK | — |
| 2 | projectId | integer FK→projectInfo | — |
| 3 | projectName | text | — |
| 4 | title | text | NOT NULL |
| 5 | description | text | — |
| 6 | lifecyclePhaseTag | enum | 'EXECUTION' |
| 7 | status | enum | 'NOT_STARTED' |
| 8 | requiresQcApproval | boolean | false |
| 9 | requiresOpsApproval | boolean | false |
| 10 | qcApprovedAt | timestamp | — |
| 11 | qcApprovedByRole | text | — |
| 12 | opsApprovedAt | timestamp | — |
| 13 | opsApprovedByRole | text | — |
| 14 | assigneeUserId | integer FK→users | — |
| 15 | assigneeName | text | — |
| 16 | softDeletedAt | timestamp | — |
| 17 | createdAt | timestamp | NOW() |
| 18 | updatedAt | timestamp | NOW() |
| 19 | scheduledDate | text | — |
| 20 | scheduledStartTime | text | — |
| 21 | scheduledEndTime | text | — |

---

## 2. Column Categorization

### CORE — 20 columns (stays on work_items)

Universal fields every task needs regardless of workstream.

| Column | Rationale |
|--------|-----------|
| id | Primary key |
| projectId | Project FK — mandatory |
| clientId | Client FK — cross-cutting |
| workstream | Discriminator (PD, ENG, PM, etc.) |
| type | Sub-type classifier |
| source | Origin (UI, SMART_IMPORT, etc.) |
| title | Required display field |
| description | Task detail |
| status | Current state |
| priority | Urgency |
| startDate | Planned start |
| endDate | Planned end / due date |
| ownerUserId | Primary owner FK |
| parentId | Hierarchy / subtasks |
| externalRef | Unique external key |
| createdBy | Audit: who created |
| createdAt | Audit: when created |
| updatedAt | Audit: when modified |
| deletedAt | Soft delete |
| sortOrder | UI ordering |

### PM Extension — 19 columns → `work_item_pm`

Project management, tracking, approval, and linking fields.

| Column | Source Table | Rationale |
|--------|-------------|-----------|
| duration | work_items | PM scheduling |
| percentComplete | work_items | Progress tracking |
| expectedPctComplete | work_items | Baseline comparison |
| phase | work_items | Project phase |
| isMilestone | work_items | Milestone flag |
| indentLevel | work_items | WBS hierarchy |
| ownerName | work_items | Denormalized display name |
| isShared | work_items | Visibility flag |
| holdReason | work_items | Blocking detail |
| blockedType | work_items | Block classification |
| blockerReason | work_items | Block explanation |
| approvalRequired | work_items | Workflow gate |
| trackingRag | work_items | RAG status |
| taskTypeTag | work_items | Domain tag |
| subProjectName | work_items | Sub-project grouping |
| completedAt | work_items | Completion timestamp |
| linkedPlanItemId | work_items | Plan item FK |
| linkedDeliverableId | work_items | Deliverable FK |
| linkedQualityItemInstanceId | work_items | QC item FK |

### Engineering Extension — 7 columns → `work_item_engineering`

Import provenance and work-breakdown-structure fields.

| Column | Source Table | Rationale |
|--------|-------------|-----------|
| wbsCode | work_items | Work breakdown code |
| outlineNumber | work_items | Outline hierarchy |
| legacyTable | work_items | Migration provenance |
| legacyId | work_items | Migration provenance |
| sourceRow | work_items | Import source row |
| sourceSheet | work_items | Import source sheet |
| importRunId | work_items | Import run FK |

### Scheduling Extension — 18 columns → `work_item_scheduling`

Calendar, recurrence, baseline/actual tracking, and time estimation.

| Column | Source Table | Rationale |
|--------|-------------|-----------|
| scheduledDate | work_items | Calendar date |
| scheduledStartTime | work_items | Calendar start time |
| scheduledEndTime | work_items | Calendar end time |
| estimateMinutes | work_items | Time estimate |
| taskCategory | work_items | Categorization |
| baselineStart | work_items | Baseline plan start |
| baselineEnd | work_items | Baseline plan end |
| baselineDuration | work_items | Baseline plan duration |
| taskMode | work_items | Auto/manual scheduling |
| actualStart | work_items | Actual start |
| actualEnd | work_items | Actual end |
| actualDuration | work_items | Actual duration |
| isRecurring | work_items | Recurrence flag |
| recurrenceFrequency | work_items | Daily/weekly/monthly |
| recurrenceInterval | work_items | Every N periods |
| recurrenceDaysOfWeek | work_items | Weekday bitmask |
| recurrenceEndDate | work_items | Recurrence stop |
| recurrenceParentId | work_items | Recurrence template FK |

---

## 3. Summary

| Table | Column Count |
|-------|-------------|
| work_items (core) | 20 |
| work_item_pm | 19 + id + work_item_id = 21 |
| work_item_engineering | 7 + id + work_item_id = 9 |
| work_item_scheduling | 18 + id + work_item_id = 20 |
| **Total** | **64 logical columns** (was 66) |

Each extension table uses a **1:1 relationship** via `work_item_id UNIQUE FK` to `work_items.id` with `ON DELETE CASCADE`.

---

## 4. Migration Strategy

- **This prompt**: Create extension tables empty (DDL only)
- **Next prompt**: Backfill data from work_items into extension tables
- **Later prompt**: Drop original columns from work_items, update queries

No data is moved or columns dropped in this prompt.
