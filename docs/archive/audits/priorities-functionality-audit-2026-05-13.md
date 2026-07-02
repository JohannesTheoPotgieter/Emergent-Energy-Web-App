# Priorities Functionality Audit — 2026-05-13

## Scope

This audit reviews the current priorities feature as implemented in the repository, covering:

- Data model and derived metrics
- Server routes and authorization
- List, detail, create, edit, escalation, comments, watches, project/opportunity linking, and progress-source flows
- Current bugs
- Recommended fixes and upgrades
- Suggested removals / simplifications
- Missing features
- UI/UX changes
- Test coverage gaps

Primary files reviewed:

- `shared/schema/mytool.ts`
- `shared/config/priorities.ts`
- `shared/kpi-definitions.ts`
- `server/departments/priority-strategic-routes.ts`
- `server/departments/priority-activity-log.ts`
- `server/lib/priorities/progress-source.ts`
- `client/src/pages/priorities.tsx`
- `client/src/pages/priority-detail.tsx`
- `client/src/components/priorities/*`
- `qa/tests/unit/priority-*.test.ts` and `qa/tests/unit/priorities-*.test.ts`

## Executive summary

The priorities feature is no longer a small “company priorities” list. It has become a strategic operating-system feature with three scopes, roll-up metrics, project/opportunity linking, personal task promotion, activity history, notes, watches, and health/progress derivation.

The foundation is strong, but the implementation has several production-impacting defects:

1. **Progress source options endpoint is unreachable** because it is registered after `GET /api/priorities/:id`; Express will treat `progress-source-options` as an `:id` value and return “Invalid priority id”. This breaks linked progress-source editing.
2. **My Priorities query invalidation is incomplete**. Several mutations invalidate `['/api/priorities']`, but the My tab is powered by `['/api/priorities/my-work']`, so promoted tasks, reopened priorities, escalations, and new role priorities can remain stale until manual refresh/navigation.
3. **Regular users are shown a “Create My Priority” path that the server rejects**. The My tab empty-state opens `CreatePriorityDialog`, but `POST /api/priorities` requires priority creator/admin/dept-head roles.
4. **Regular users cannot escalate their own personal priorities**, even though the page copy describes role → department → company escalation.
5. **Promoting a shared task to a personal priority is global, not per-user**. The idempotency check is only on `linkedTaskId`, and the My Work feed suppresses any linked task for every user, not just the user whose personal priority owns it.
6. **Several sensitive detail/list routes have weaker authorization consistency than the feature’s edit routes**. Many routes use only `requireAuth`, while some sibling routes use `requirePermission('company_priorities', 'view')` or role gates.
7. **Some action endpoints update multiple tables outside a transaction**. Priority updates plus project-link replacement and activity logging can partially succeed.
8. **Legacy priority tables and APIs still coexist with the strategic API**, increasing mental overhead and risking divergent behavior.

Recommended path:

- Treat this as **Tier 1 hardening**, not a redesign.
- Fix route ordering, cache invalidation, regular-user affordances, escalation ownership rules, and shared-task promotion semantics first.
- Then consolidate old `priority_links` / `/api/mytool/company-priorities` surfaces and add integration/API tests around the real workflows.

## Current functionality map

### 1. Data model

`mytool_company_priorities` stores both legacy company-priority fields and newer strategic fields:

- Basic fields: title, description, department, horizon, severity, status, rank, owner role, assigned text, next action, due date, definition of done.
- Strategic fields: accountable executive, owner user, target dates/outcome, manual health/progress.
- Progress source fields: `progress_source_type`, `progress_source_ref`.
- Cascade fields: `scope`, `parent_id`, `department_key`, `assigned_user_id`, `escalated`, `escalated_at`, `escalation_reason`.
- Promoted-task fields: `linked_task_id`, `linked_task_type`.

Related tables:

- `priority_activity`: append-only priority event/audit history.
- `priority_projects`: canonical priority ↔ project junction with unique `(priority_id, project_id)`.
- `priority_opportunities`: priority ↔ opportunity junction with unique `(priority_id, opportunity_id)`.
- `priority_comments`: notes with soft delete.
- `priority_watches`: user watch state.
- `priority_links`: legacy/deprecated generic link table still present.

### 2. Shared priority configuration

`shared/config/priorities.ts` defines:

- Scopes: `company`, `department`, `role`.
- Admin roles: `COO_ADMIN`, `CEO_ADMIN`, `CCO`, `CFO`, `PROGRAM_MANAGER`.
- Department-head roles: priority admins plus engineering, quality, construction, HSE, and programme finance managers.
- Department options used by filters/forms.
- Pure helpers for descendant/ancestor traversal, list filtering, and escalation patch calculation.

### 3. Derived health and metrics

Health is computed as a “worst signal wins” result across:

- Manual health
- Linked project RAG
- Overdue due date
- Project blockers
- Engineering blockers
- QC defects
- HSE incidents
- Stalled opportunities / PD tickets

Closed/complete priorities always return healthy.

The `priority_derived_metrics` database view contributes:

- Linked project counts
- At-risk project count
- Derived health from project RAG
- Revenue, COS, GP
- Average progress
- Blocker/open-task counts
- Engineering, quality, HSE, opportunity, and PD-ticket signal counts

Progress can also be computed from selected linked sources:

- Manual progress
- Project lifecycle phase
- Project percent complete
- Revenue milestone payment state
- Roll-up of selected work items

### 4. Server API

Main endpoints include:

- `GET /api/priorities` — list priorities with filters/enrichment.
- `GET /api/priorities/my-work` — unified My Priorities + My Tasks feed.
- `POST /api/priorities/tasks` — create personal task.
- `DELETE /api/priorities/tasks/:id` — soft-delete owned personal task.
- `POST /api/priorities/from-task/:workItemId` — promote owned/assigned work item into role-scope priority.
- `GET /api/priorities/:id` — detail page payload with rolled-up projects/opportunities/metrics.
- `POST /api/priorities` — create priority.
- `PUT /api/priorities/:id` — edit priority and replace project links when supplied.
- `DELETE /api/priorities/:id` — COO/CEO hard delete.
- `POST /api/priorities/:id/projects` / `DELETE /api/priorities/:id/projects/:projectId` — project linking.
- `POST /api/priorities/:id/opportunities` / `DELETE /api/priorities/:id/opportunities/:opportunityId` — opportunity linking.
- `POST /api/priorities/:id/escalate` — promote one scope up.
- `POST /api/priorities/:id/break-down` — create child priorities.
- `GET /api/priorities/:id/tasks`, `/approvals`, `/updates`, `/children`, `/project-ids`, `/activity` — detail subresources.
- Comments and watches routes.

### 5. Frontend surfaces

`/priorities`:

- Tabs: My Priorities, Department, Company.
- My tab combines priority rows with task rows.
- Filters: level, health, show closed.
- Department tab supports department filter for admins.
- Bulk bar supports close/escalate/reassign depending on role.
- Dialogs: create priority, create personal task, assign/reassign, escalate.

`/priorities/:id`:

- Header status/health/progress/finance summary.
- Linked projects and opportunities.
- Tasks + approvals from linked/rolled-up projects.
- Chain/children view.
- Project updates.
- Activity timeline.
- Notes/comments.
- Edit, link project, break down, escalate, watch, delete actions depending on role.

## Bugs and defects

### P0 — Progress source options route is unreachable

**Evidence**

- `GET /api/priorities/:id` is registered before `GET /api/priorities/progress-source-options`.
- In Express, `/api/priorities/progress-source-options` matches the earlier `:id` route first.
- `parseIdParam('progress-source-options')` returns null, so the request fails with “Invalid priority id”.

**Impact**

- The edit-priority progress source picker cannot load milestones/work items.
- Users can see or choose progress-source UI but the supporting API is effectively dead.

**Fix**

Move `GET /api/priorities/progress-source-options` above `GET /api/priorities/:id`, or change the path to an unambiguous namespace such as `/api/priority-progress-source-options` or `/api/priorities/tools/progress-source-options` and register it before dynamic routes.

**Priority**: P0 / immediate.

### P0 — My Priorities cache invalidation misses the actual My Work query

**Evidence**

- My tab uses query key `['/api/priorities/my-work', showClosed]`.
- `invalidateAll()` only invalidates `['/api/priorities']`.
- Promote, escalate, reopen, and several bulk/create flows call `invalidateAll()` but not `['/api/priorities/my-work']`.

**Impact**

- After “Make priority”, the task may remain visible and the new priority may not appear until manual refetch or navigation.
- After reopen/escalate, My tab may show stale records.
- This is perceived as “button did nothing” even when the server succeeded.

**Fix**

Create a single invalidation helper that invalidates:

- `['/api/priorities']`
- `['/api/priorities/my-work']`
- affected detail keys: `['/api/priorities/${id}']`, `activity`, `children`, `project-ids` where relevant
- legacy `/api/mytool/company-priorities` only while that surface remains

**Priority**: P0 / immediate.

### P0 — “Create My Priority” is exposed to users who cannot use it

**Evidence**

- The My tab empty state opens `CreatePriorityDialog` for all users.
- That dialog posts to `POST /api/priorities`.
- `POST /api/priorities` is gated by `requirePriorityCreator`, meaning only priority admins or department heads can use it.
- Regular users can create tasks via `/api/priorities/tasks`, but not direct role-scope priorities.

**Impact**

- Regular users see a primary CTA that fails with 403.
- This undermines trust in the My Priorities surface.

**Fix options**

1. **Preferred:** allow any authenticated user with `company_priorities:view` to create `scope='role'` priority for themselves only, with server-enforced `ownerUserId = assignedUserId = caller.id`.
2. Hide “Create My Priority” for regular users and show “Add Task” as the only direct CTA.

Given the current UX copy, option 1 is more consistent.

**Priority**: P0 / immediate.

### P1 — Regular users cannot escalate personal priorities

**Evidence**

- My tab only shows the Escalate action when `isAdmin || isDeptHead`.
- `POST /api/priorities/:id/escalate` is gated by `requirePriorityAdmin`.
- Page copy describes role → department → company escalation.

**Impact**

- A normal team member can promote a task to a personal priority, but cannot raise it to department level.
- This blocks the intended escalation chain at the most important first hop.

**Fix**

Change escalation authorization to ownership-aware rules:

- Role → Department: owner/assignee can request/escalate; department key should derive from the user’s role/department or route to approval if ambiguous.
- Department → Company: department head or priority admin.
- Company → no further escalation.

Record reason/note in `priority_activity` and consider `pending_approvals` if leadership wants a review step.

**Priority**: P1.

### P1 — Promoting a shared work item is global, not per user

**Evidence**

- `POST /api/priorities/from-task/:workItemId` checks for an existing priority by `linkedTaskId` only.
- `GET /api/priorities/my-work` suppresses a work item if any priority in the entire system has that linked task ID.
- The created priority is owned/assigned to the first promoting user.

**Impact**

- If a task is assigned to multiple people, the first person who promotes it prevents others from seeing/promoting the same task in their My Work feed.
- The second user may receive an existing priority owned by another user, or the task simply disappears from their task list.

**Fix**

Decide the product rule:

- If personal priorities are per user, idempotency must be `(linkedTaskId, ownerUserId)` and suppression must only apply to priorities owned/assigned to the current user.
- If promotion should be shared/team-wide, call it out in the UI as “already promoted by X” and make ownership/visibility explicit.

**Priority**: P1.

### P1 — Priority update and link replacement is not atomic

**Evidence**

`PUT /api/priorities/:id` updates the priority row, records activity events, then deletes/inserts project links in separate operations without one encompassing transaction.

**Impact**

- A partial failure can leave the priority edited but links only partially replaced, or activity history out of sync.

**Fix**

Wrap the row update, project-link replacement, and activity insertions in one transaction.

**Priority**: P1.

### P1 — Route authorization is inconsistent across read/detail subresources

**Evidence**

- `GET /api/priorities/my-work`, personal task create/delete, comments, and watches require `company_priorities:view`.
- `GET /api/priorities`, `GET /api/priorities/:id`, tasks, approvals, updates, children, project IDs, activity, and progress-source options mostly use only `requireAuth`.
- Some routes expose rolled-up financials, project metrics, assignees, and activity history.

**Impact**

- Any authenticated user may access more priority/project detail than intended if role permissions are expected to matter.
- The codebase has no single policy line for “all authenticated users can view priorities” versus “only roles with company_priorities:view can view priorities”.

**Fix**

Codify one rule:

- If all users should view company priorities, make that explicit and add project-scope filtering for detail resources.
- Otherwise add `requirePermission('company_priorities', 'view')` consistently to list/detail/subresource routes.

**Priority**: P1.

### P1 — Bulk selection is available to regular users with no useful bulk action

**Evidence**

- The My tab passes `selectable` unconditionally.
- The bulk bar only shows Close for admins, Escalate for admins/dept heads, and Reassign for dept heads.

**Impact**

- Regular users can select cards but can only clear selection.
- This looks broken.

**Fix**

Only enable `selectable` when at least one bulk action is available, or add user-level bulk actions such as “mark complete”, “move to task”, or “clear selection” hidden until meaningful.

**Priority**: P1 / UX.

### P2 — “Show closed” does not include `complete` consistently

**Evidence**

- My-work priorities hide only `status === 'closed'` unless `include_closed=true`.
- Cards and counts treat both `closed` and `complete` as done.
- Some child/project/task queries filter only `status != 'closed'`.

**Impact**

- Complete priorities may still appear in active views.
- Counts and tabs can disagree.

**Fix**

Create a shared `PRIORITY_DONE_STATUSES = ['closed', 'complete']` helper and use it across server and client filters.

**Priority**: P2.

### P2 — Parent/child cycle prevention is incomplete

**Evidence**

- Traversal helpers defend against malformed cycles.
- Create/update endpoints only check that `parent_id` exists; they do not prevent setting a priority’s parent to itself or to a descendant.

**Impact**

- Data can contain cycles that traversal merely survives rather than prevents.
- UI tree/chain semantics become misleading.

**Fix**

On update/create, reject `parent_id === id` and reject any parent that is already a descendant of the edited priority.

**Priority**: P2.

### P2 — `progress_source_ref` is structurally validated but not semantically authorized on update

**Evidence**

- The progress-source options route checks project access before returning options.
- `PUT /api/priorities/:id` accepts `progress_source_type` and `progress_source_ref` and writes them without verifying that referenced projects/work items/milestones are linked to the priority and visible to the actor.

**Impact**

- A caller with edit rights could point a priority’s progress source at an unrelated project/work item/milestone.
- The server-side compute function is defensive, but semantic integrity is weak.

**Fix**

Validate source refs on update:

- `projectId` must be linked directly or via allowed roll-up.
- Work items must belong to the referenced project.
- Milestones must belong to the referenced project.
- Actor must be allowed to view that project.

**Priority**: P2.

### P2 — Delete is hard-delete even though most domain actions are soft/recorded

**Evidence**

- Priority comments and personal tasks are soft-deleted.
- Priority delete uses COO/CEO-only hard delete.
- The guardrails emphasize recording/evidence and override patterns.

**Impact**

- Deleting a priority cascades related links/activity/comments/watches and removes operational evidence.

**Fix**

Prefer soft delete/archive for priorities:

- Add `deleted_at` / `archived_at` / `archived_by` / `archive_reason`.
- Keep hard delete only for admin recovery/test data with explicit audit.

**Priority**: P2 governance.

## Current upgrades worth keeping

These are good investments already present in the feature:

- Three-tier scope model (`role`, `department`, `company`).
- Pure traversal helpers for descendants/ancestors with cycle-safe bounds.
- Derived health engine that combines project, overdue, blocker, engineering, quality, HSE, and PD signals.
- Priority activity log with clear event types.
- Roll-up detail view that aggregates descendant priorities and linked projects.
- Bottom-up project priorities route that can show which priorities a project feeds.
- Project/opportunity link tables with unique constraints.
- Personal task creation and task promotion to priority.
- URL filter parser tests for `/priorities?level=&health=` deep links.
- Unit tests for role lists, escalation patches, list filtering, health rules, activity diffs, ancestor/descendant traversal.

## Suggested removals / simplifications

### 1. Retire or isolate legacy `priority_links`

`priority_links` remains in the schema and older routes, while `priority_projects` / `priority_opportunities` are the richer canonical model.

Recommendation:

- Mark `priority_links` read-only compatibility in code comments.
- Add a migration/backfill plan.
- Remove client usage.
- Delete only after a reconciliation report proves no live records are only represented there.

### 2. Remove duplicate “assigned” fields from new flows

The model has both text fields (`assigned_to`, `owner_role`) and user-ID fields (`assigned_user_id`, `owner_user_id`, `accountable_exec_id`).

Recommendation:

- Keep user-ID fields as canonical for new UI.
- Show text legacy fields only as migration fallback.
- Stop writing `assigned_to` from new flows unless preserving imported data.

### 3. Consolidate `/api/mytool/company-priorities`

The strategic API lives under `/api/priorities`, but the client still invalidates `/api/mytool/company-priorities`, and `storage.ts` still has company-priority functions.

Recommendation:

- Identify all live callers.
- Add compatibility wrapper or redirect if necessary.
- Remove duplicate storage methods after all callers move.

### 4. Simplify severity labels

Data uses `important`; UI labels it as “High”; task priority uses `high`.

Recommendation:

- Keep DB enum as-is if migration cost is high.
- Add a single shared mapping for `important ↔ High` and `high task ↔ important priority`.
- Avoid ad hoc conversions in components.

## Missing features

### 1. Ownership-aware personal priority creation

Regular users need a clean path to create a role-scope priority, not only a task that can later be promoted.

Minimum rule:

- User can create only `scope='role'`.
- Server forces `ownerUserId` and `assignedUserId` to caller.
- Optional department derives from role map.

### 2. Escalation request workflow

Escalation should support:

- User raises role priority to department.
- Department head accepts/rejects/edits assignment.
- Department head raises department priority to company.
- Priority admin accepts/rejects.

Use existing `pending_approvals` or priority activity rather than inventing a parallel approval table.

### 3. De-escalation / return path

The current `computeEscalatePatch` moves upward only. There is no explicit way to return a company priority to a department or a department priority to a user with a reason.

Recommended actions:

- Add “Return to department/user” action for admins/dept heads.
- Require reason.
- Record activity.

### 4. Priority SLA / review cadence

There is no explicit “last reviewed”, “next review”, or “review cadence” field.

Recommendation:

- Add `last_reviewed_at`, `next_review_due_at`, `review_cadence` or derive from activity.
- Surface stale priorities on Home/COO dashboards.

### 5. Watch notifications

Watches exist, but the audit did not find a notification fan-out tied to watch rows.

Recommendation:

- Notify watchers on status, health, due date, assignment, comments, escalation, and project link changes.
- Start with in-app notifications if email/Teams is too expensive.

### 6. Saved views and search

The list page has filters but no search or saved filter presets.

Recommendation:

- Add search by title/project/opportunity/assignee.
- Add saved views: “Overdue”, “Escalated”, “No owner”, “Needs review”, “My department critical”.

### 7. Bulk endpoint

Bulk close/escalate/reassign currently loops per item from the client.

Recommendation:

- Add server bulk endpoints that validate all IDs and apply changes transactionally.
- Return per-item success/failure summary.

### 8. Priority templates

There is no obvious template flow for recurring operating priorities.

Recommendation:

- Add priority templates for standard EXCO/company objectives, department weekly priorities, and handover checklists.

## UI/UX recommendations

### 1. Fix role-specific CTAs

- Regular user My tab: primary CTA should be “Add Task” and/or “Create My Priority” only if the server supports role priority creation.
- Department heads: “Create Department Priority” and “Reassign” should be clearly department-scoped.
- Admins: Company and Department creation should show scope explicitly.

### 2. Show the escalation chain visually

On cards and detail header, show:

`My → Department → Company`

with the current scope highlighted and the next allowed action clearly labeled.

### 3. Make cache states visible

After mutations, optimistically update the card/task row or show “Updating…” until the correct query refetches.

### 4. Add search and sort controls

Current sorting is server-defined and implicit. Add visible sort options:

- Health
- Due date
- Severity
- Escalated first
- Owner
- Progress

### 5. Make health reasons first-class

Cards currently expose health reasons mainly via tooltip/dense details. Add a visible one-line reason such as:

- “14d overdue”
- “3 blockers”
- “Project RAG red”
- “Critical HSE incident”

### 6. Improve empty states

Each tab needs an empty state that says what to do next:

- My: “Add a task or create a personal priority.”
- Department: “Create department priority or escalate from My Priorities.”
- Company: “Create company priority or escalate from departments.”

### 7. Separate personal tasks from strategic priorities more clearly

The My tab mixes work items and priorities, which is useful but can confuse users.

Recommendation:

- Keep the unified feed but add section-level counts and explanations.
- Make “task” vs “priority” badges highly visible.
- Explain “Make priority” as “adds to My Priorities and starts escalation path”.

### 8. Add mobile affordances

The filter row and bulk bar are dense. On smaller screens:

- Collapse filters into a drawer/sheet.
- Keep bulk bar bottom-sticky instead of top-sticky.
- Use full-width action buttons in dialogs.

## Test coverage gaps

Existing unit coverage is useful but mostly pure-helper coverage. Missing high-value tests:

1. **Route-order regression test** for `/api/priorities/progress-source-options` resolving before `/:id`.
2. **My Work mutation invalidation/component test** for “Make priority” removing the task and showing the priority.
3. **Regular-user create role priority API test** once behavior is decided.
4. **Escalation authorization tests** for role → department and department → company.
5. **Shared-task promotion tests** for multiple assignees.
6. **PUT transaction test** for priority update + project link replacement.
7. **Project scope tests** for priority detail subresources.
8. **Progress-source semantic validation tests**.
9. **Complete/closed visibility tests** across list, my-work, children, detail counts.
10. **Watch notification tests** if notifications are added.

## Recommended implementation sequence

### Sprint 1 — production hardening

1. Move/fix progress-source options route.
2. Fix query invalidation for My Work and affected detail subresources.
3. Hide or enable Create My Priority for regular users.
4. Disable bulk selection for users with no bulk actions.
5. Normalize closed/complete filtering.
6. Add route-order and cache-invalidation tests.

### Sprint 2 — escalation and ownership correctness

1. Implement ownership-aware role priority creation.
2. Implement role → department escalation for owners/assignees.
3. Decide and fix shared-task promotion semantics.
4. Add transactional bulk endpoints.
5. Add API tests for escalation and shared-task promotion.

### Sprint 3 — governance and cleanup

1. Convert priority delete to archive/soft delete.
2. Consolidate legacy `priority_links` and `/api/mytool/company-priorities` callers.
3. Add semantic validation for progress sources.
4. Add watch notifications.
5. Add saved views/search/sort.

## Final recommendation

Do not remove the priorities feature. The direction is right and the business value is high.

Do remove or quarantine legacy duplicate surfaces and fix the P0/P1 defects before adding more new UI. The current feature has enough breadth; the next value comes from making the critical flows reliable:

- create → see immediately
- task → priority → see immediately
- role → department → company escalation
- linked progress source works
- health reasons are trusted
- every action leaves an audit trail
