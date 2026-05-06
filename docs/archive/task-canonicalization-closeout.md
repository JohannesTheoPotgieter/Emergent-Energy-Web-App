# Task-System Canonicalization — Final Closeout Pack

**Date:** 2026-04-01
**Branch:** `claude/production-migration-lead-8m1iy`
**Commits:** 9 (f8bc89c → 0d25579)
**Tests:** 252 across 8 test files, all passing

---

## 1. Executive Signoff Note

The personal task system has been fully migrated from the legacy `mytool_tasks` table to the canonical `work_items` table. This was a controlled, phased migration executed across 7 phases over a single session, with live database parity verification between phases.

**What was achieved:**
- `work_items` is now the single source of truth for all task entities across every workstream (PERSONAL, ENG, PM, QUALITY, FINANCE, PD, GOVERNANCE, HANDOVER)
- All end-user runtime reads and writes for personal tasks go through `work_items`
- Personal task dependencies use `work_item_dependencies`
- Legacy tables (`mytool_tasks`, `mytool_task_dependencies`, `mytool_recurrence_instances`) have been archived and dropped in production
- FK references from `mytool_timeblocks` and `mytool_email_links` have been remapped to `work_items`
- KPI and monitoring counts are canonical
- Smart Import is unaffected and confirmed intact
- 252 regression tests guard the entire migration surface

**What was NOT changed:**
- Frontend UI/UX — no visual changes
- Independent mytool features (timeblocks, daily reviews, company priorities, settings, email links, recurrence templates, DOD templates, triage rules)
- Smart Import pipeline
- Engineering, quality, approval, and deliverable systems

**Risk posture:** LOW. Archive tables (`_archive_mytool_tasks`, `_archive_mytool_task_dependencies`, `_archive_mytool_recurrence_instances`) are retained for 30-day rollback window.

---

## 2. Source-of-Truth Note for the Team

### The Rule

**`work_items` is the canonical task table. Period.**

Every task — personal, operational, engineering, PM plan, quality, governance — is a row in `work_items` distinguished by its `workstream` column:

| Workstream | What It Holds |
|-----------|---------------|
| `PERSONAL` | Personal/MyTool tasks (formerly `mytool_tasks`) |
| `ENG` | Engineering tasks |
| `PM` | Project plan tasks (including Smart Import) |
| `QUALITY` | Quality tasks |
| `PD` | Project development tasks |
| `FINANCE` | Finance tasks |
| `GOVERNANCE` | Governance tasks |
| `HANDOVER` | Handover tasks |

### Where to Write

| If you need to... | Use this endpoint | It writes to... |
|-------------------|-------------------|-----------------|
| Create a personal task | `POST /api/mytool/tasks` | `work_items` (workstream=PERSONAL) |
| Create an engineering task | `POST /api/eng/tasks` | `work_items` (workstream=ENG) |
| Create a plan task | `POST /api/planning-tasks` | `work_items` (workstream=PM) |
| Create an operational task | `POST /api/operational-tasks` | `work_items` |
| Create a generic task | `POST /api/tasks` | `work_items` |
| Schedule any task | `PATCH /api/calendar/schedule-task` | `work_items` (or external entity table for QC/approvals) |

### Where to Read

| If you need... | Use this endpoint |
|---------------|-------------------|
| All tasks for current user | `GET /api/my-work/all-tasks` |
| Personal tasks only | `GET /api/mytool/tasks` |
| Engineering tasks | `GET /api/eng/tasks` |
| Plan tasks for a project | `GET /api/planning-tasks/:projectName` |
| Operational tasks for a project | `GET /api/operational-tasks/:projectName` |
| Generic task hub (board/list/calendar) | `GET /api/tasks`, `/api/tasks/board`, `/api/tasks/calendar` |

### What NOT to Do

- Do NOT write to `mytool_tasks` — the table no longer exists
- Do NOT write to `operational_tasks` — the table was dropped earlier
- Do NOT create new screen-specific task tables — use `work_items` with the appropriate `workstream`
- Do NOT bypass screen-specific endpoints to write directly to `work_items` unless you are building a new generic task feature

---

## 3. Two-Week Stabilization Watchlist

Monitor these areas for the 14 days following deployment:

| # | What to Watch | How to Check | Action If Anomaly |
|---|--------------|-------------|-------------------|
| 1 | Personal task creation | Create a task in `/my-work/tasks` — should appear immediately | Check `work_items WHERE workstream='PERSONAL'` |
| 2 | Calendar scheduling | Drag a personal task to a calendar slot — should persist on reload | Check `work_items.scheduled_date` is set |
| 3 | Meeting action item conversion | Convert a meeting action item to a personal task | Verify it lands in `work_items` not `mytool_tasks` |
| 4 | Communication follow-up creation | Create a follow-up from an email/Teams item | Verify it lands in `work_items` |
| 5 | Smart Import commit | Import an Excel plan file | Verify tasks appear in plan tab with correct data |
| 6 | KPI personal task count | Check `/api/kpi-traceability` | Count should match `SELECT COUNT(*) FROM work_items WHERE workstream='PERSONAL' AND deleted_at IS NULL` |
| 7 | Engineering task CRUD | Create/edit/delete an engineering task | Normal operation expected |
| 8 | Admin recovery | List deleted personal tasks in admin recovery | Should show `work_items` rows, not empty |
| 9 | 500 errors in logs | Monitor application logs for unexpected errors | Investigate any `mytool_tasks` references in stack traces |
| 10 | Empty task lists | Any screen showing zero tasks when it shouldn't | Check if a query is still targeting a dropped table |

**After 14 days with no anomalies:** Archive tables can be dropped (see Section 4).

---

## 4. Archive Retention and Drop Checklist

These archive tables exist in production as rollback insurance:

| Archive Table | Source | Rows | Drop After |
|--------------|--------|------|-----------|
| `_archive_mytool_tasks` | `mytool_tasks` | All rows (0 active at time of archive) | 30 days post-deploy |
| `_archive_mytool_task_dependencies` | `mytool_task_dependencies` | 0 rows | 30 days post-deploy |
| `_archive_mytool_recurrence_instances` | `mytool_recurrence_instances` | All rows | 30 days post-deploy |

**Drop procedure (after 30 days):**

```sql
DROP TABLE IF EXISTS _archive_mytool_tasks;
DROP TABLE IF EXISTS _archive_mytool_task_dependencies;
DROP TABLE IF EXISTS _archive_mytool_recurrence_instances;
```

**Do NOT drop until:**
- 14-day stabilization watchlist is clear
- No user-reported issues related to personal tasks
- No 500 errors referencing legacy tables in logs

---

## 5. Rollback Posture Summary

| Scenario | Rollback Action | Time to Recover |
|----------|----------------|-----------------|
| Personal tasks not appearing | Check if query targets dropped table; fix the query | Minutes |
| Data missing after migration | Restore from `_archive_mytool_tasks` table | Minutes |
| Full revert needed | Restore DB snapshot taken before migration + revert code to pre-`f8bc89c` | 30 minutes |
| Smart Import broken | Smart Import was NOT changed — investigate other causes | N/A |

**Key fact:** The deployed code works with `work_items` regardless of whether `mytool_tasks` exists. If the archive tables are restored, the code will simply ignore them (no code reads them).

---

## 6. "What Changed" Note for Engineering / Product / Support

### For Engineering

**Backend changes:**
- All personal task CRUD (`/api/mytool/tasks/*`) now reads from and writes to `work_items` with `workstream='PERSONAL'`
- Calendar scheduling (`/api/calendar/schedule-task`) mytool branch writes to `work_items`
- Communication follow-ups and meeting action items create personal tasks in `work_items`
- Personal task dependencies use `work_item_dependencies` (canonical)
- KPI traceability counts from `work_items`
- Admin recovery routes query `work_items` for personal tasks

**Schema changes:**
- `mytool_tasks` table: archived to `_archive_mytool_tasks`, dropped
- `mytool_task_dependencies` table: archived, dropped
- `mytool_recurrence_instances` table: archived, dropped
- `mytool_timeblocks.linked_task_id` FK: remapped to `work_items(id)`
- `mytool_email_links.linked_task_id` FK: remapped to `work_items(id)`

**No frontend changes.** All UI screens work exactly as before.

### For Product

- No visible changes to any user-facing screen
- Personal tasks, calendar scheduling, and task management all work the same way
- The underlying data storage is now unified, which means better data consistency and simpler future feature development

### For Support

- If a user reports "my tasks disappeared," check `work_items WHERE workstream='PERSONAL' AND owner_user_id = {userId} AND deleted_at IS NULL`
- The old `mytool_tasks` table no longer exists — do not try to query it
- All task-related support queries should target `work_items`

---

## 7. FAQ for Future Developers

### Why is `work_items` the canonical task spine?

Before this migration, personal tasks lived in `mytool_tasks`, engineering tasks were in `operational_tasks`, imported tasks went to `normalized_plan_tasks`, and various other tables held task-like data. This caused data drift, duplicate logic, and inconsistent reads across screens.

`work_items` consolidates all task entities into one table, distinguished by the `workstream` enum (PERSONAL, ENG, PM, QUALITY, etc.). This means:
- One place to query for "all tasks assigned to me"
- One assignment model (`work_item_assignments`)
- One dependency model (`work_item_dependencies`)
- One status history model (`work_item_status_history`)
- One set of child entities (comments, checklists, attachments, activity log)

### Why do frontend task mutations remain multi-endpoint by screen?

The unified task view (`/my-work/tasks`) shows tasks from multiple sources: personal, operational, engineering, plan, quality, TR register, approvals, deliverables, and Microsoft items. Each source has different:
- **Status semantics** (personal uses inbox/planned/done; engineering uses TO DO/IN PROGRESS/DONE; plan uses Not Started/In Progress/Done)
- **Validation rules** (operational tasks have workflow guards; engineering tasks have hold/blocked tracking)
- **Field mappings** (personal uses `dueAt`; plan uses `dueDate`; canonical uses `endDate`)
- **Business logic** (completing a plan task sets percentComplete=100; completing a TR item requires outcome comments)

A single `PATCH /api/tasks/:id` endpoint would need to absorb all of this logic, which would be a regression risk with no data-integrity benefit. The current pattern — screen-specific adapter endpoints that all write to `work_items` — is the intended final architecture.

### Why is Smart Import still valid?

Smart Import was never affected by the personal task migration. It writes directly to `work_items` with `source='SMART_IMPORT'` and `workstream='PM'`. It sets `legacyTable=null` and `legacyId=null`. It uses `work_item_dependencies` and `work_item_assignments`. It has zero references to any dropped table.

### Which independent mytool entities remain intentionally active?

These tables are NOT task tables and were NOT part of the canonicalization:

| Table | Purpose | Still Active? |
|-------|---------|--------------|
| `mytool_recurrence_templates` | Recurrence scheduling templates | Yes |
| `mytool_timeblocks` | Calendar time blocks | Yes (FK remapped to `work_items`) |
| `mytool_email_links` | Email-to-entity links | Yes (FK remapped to `work_items`) |
| `mytool_daily_reviews` | Daily review journaling | Yes |
| `mytool_company_priorities` | Strategic company priorities | Yes |
| `priority_links` / `priority_projects` | Priority-to-project linking | Yes |
| `mytool_user_preferences` | User UI preferences | Yes |
| `mytool_settings` | Feature settings | Yes |
| `mytool_dod_templates` | Definition of Done templates | Yes |
| `triage_rules` | Email triage automation rules | Yes |

These are independent features that happen to share the "mytool" naming prefix. They do not store task data and were never in scope for canonicalization.
