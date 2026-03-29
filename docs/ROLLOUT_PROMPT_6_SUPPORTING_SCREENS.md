# ROLLOUT PROMPT 6 OF 7 — SUPPORTING SCREENS & PERMISSIONS

These screens provide cross-project operational control. They are not stage workspaces — they are management and governance views that pull data from the stage engine.

**Important navigation change:** Department screens (Quality, Compliance, Engineering) are no longer standalone nav destinations. They become role-filtered content within stage workspaces. However, specialist roles still need cross-project governance views — these are accessed from Home (role-specific blocks) or from Gates sub-views, not from a separate top-level nav item.

---

## 1. EXCEPTION QUEUE

**Route:** `/gates/exceptions`

**Purpose:** Manage all exception requests across all projects in one place. Admin uses this to approve/reject bypass requests.

### Columns:
- Project
- Stage
- Blocked item (which checklist requirement is being bypassed)
- Reason
- Risk level (low / medium / high / critical)
- Mitigation text
- Owner (who requested)
- Approver (admin who must decide)
- Status (pending / approved / approved_with_conditions / rejected / closed / re-opened)
- Conditions (if approved with conditions)
- Due date (deadline to close the exception)
- Age (days since created)
- Downstream impact (which future stage this could block)

### Required fields:
- `exception_id`
- `project_id`
- `stage_code`
- `requirement_code` (which checklist item)
- `reason_text`
- `risk_level`
- `mitigation_text`
- `owner_user_id` (requester)
- `approver_user_id` (admin)
- `status`
- `approved_with_conditions` (boolean)
- `conditions_text`
- `closeout_due_date`
- `downstream_blocking_stage` (which stage this could block later)
- `created_at`
- `resolved_at`

### Actions:
- Approve
- Approve with conditions
- Reject
- Return (request more information)
- Close (exception resolved)
- Re-open
- Escalate

### Views:
- All exceptions (default)
- Pending my approval
- Overdue exceptions
- Exceptions by project
- Exceptions by stage
- Exceptions by risk level

### Escalation:
- Exception pending > 3 days → auto-escalate notification to COO

---

## 2. APPROVALS

**Route:** `/?tab=approvals` (Home → Approvals tab)

**Purpose:** Single queue for all approvals the logged-in user must action. Lives inside Home, not as a separate page.

### Approval types:
- Gate approval (stage ready to progress)
- Exception approval (bypass request)
- Review sign-off (quality, engineering, financial)
- Handover acceptance (PD→PM, O&M, Client)
- Post-handover review close
- Client update review (optional)

### Columns per approval:
- Project
- Approval type
- Stage
- Requested by
- Date requested
- Priority
- Age (days pending)
- Summary (one-line description of what needs approval)

### Actions:
- Approve
- Reject
- Return with comments
- Delegate to another user

### Rules:
- Approvals appear on the Home page Approvals tab
- Overdue approvals (> 3 days) flag on Home page top strip
- Approval count shown in Home top strip at all times

---

## 3. QUALITY GOVERNANCE VIEW

**Not a standalone nav destination.** Accessed from:
- Home page → Quality Manager role-specific block → "View all quality items" link
- Gates → any project card → Current Gate (quality section visible within stage workspace)

**Purpose:** Cross-project quality governance for the Quality Manager role.

**Implementation:** This can be a modal/drawer or a filtered view within Gates, not a separate route. If a route is needed for deep linking, use `/gates?filter=quality`.

### Content:
- Commissioning reviews due (projects approaching or in commissioning needing Quality review)
- Open snags (across all projects, with age, severity, owner)
- Open NCRs (across all projects, with status, corrective action status)
- Handover quality blockers (quality items preventing handover progression)
- Closeout quality actions overdue
- Quality checklist completion by project

### Filters:
- Project
- Stage
- Severity
- Owner
- Age
- Status

### Actions:
- Open project Current Gate (jumps directly to quality section)
- Create snag/NCR
- Review and approve/reject
- Assign corrective action
- Close item

### Integration:
- Uses existing `shared/schema/quality.ts` → QC templates, checklists, NCRs
- Quality items created in stage workspaces (especially stages 6, 7, 8) surface here

---

## 4. COMPLIANCE GOVERNANCE VIEW

**Not a standalone nav destination.** Accessed from:
- Home page → Compliance role-specific block → "View all compliance items" link
- Gates → any project card → Current Gate (compliance section visible within stage workspace)

**Purpose:** SSEG and RMA specialist control across all projects.

**Implementation:** Filtered view within Gates or a drawer. If a route is needed: `/gates?filter=compliance`.

### Content:
- SSEG by project (status, submitted date, expected date, actual date)
- Authority submissions tracker
- SSEG overdue (submitted but not approved past expected date)
- RMA open items
- RMA ageing (days since submission)
- Techsitter / metering confirmations pending
- Metering confirmed vs not confirmed

### Actions:
- Update status
- Flag blocker (creates dependency on project)
- Escalate overdue item
- Mark complete

### Integration:
- Uses existing `shared/schema/handover.ts` → `ssegItems` table
- Compliance items created in stage workspaces (stages 2, 6, 7) surface here

---

## 5. HANDOVER PIPELINE

**Route:** `/gates/handovers`

**Purpose:** Company-wide closeout control.

### Views:
- O&M handover queue (projects in stage 8)
- Client handover queue (projects in stage 9)
- Missing documents (handover packs with < 100% completeness)
- Practical completion pending
- SSEG pending (blocking handover)
- Accepted / closed (completed handovers)
- Waiting on Matriarch (O&M acceptance pending, with SLA clock)
- Waiting on client (client acceptance pending)

### Columns:
- Project
- Client
- PM
- Construction Manager
- Handover type (O&M / Client)
- Pack completeness %
- Open snags
- Acceptance status
- SLA status (within / approaching / overdue)
- Days waiting

### Actions:
- Open project handover workspace (→ Current Gate on that project)
- Request missing document
- Escalate overdue acceptance
- View pack completeness detail

### Integration:
- Reads from existing `shared/schema/handover.ts` → `handoverPacks`, `handoverChecklistItems`
- Extends current handover dashboard — do not replace, add the broader pipeline views

---

## 6. REPORTS

**Route:** `/reports/center` (existing — now accessed under Admin secondary nav)

**Purpose:** Management and board reporting fed by stage engine data.

### New core reports to add:

**Gate Reports:**
- Projects by stage (pipeline view — how many projects at each stage)
- Stage duration analysis (average days per stage, outliers)
- Blocked gates (current blockers, age, owner)
- Exception ageing (open exceptions by age and risk level)

**Operational Reports:**
- Financial reviews due / overdue
- Commissioning queue (upcoming, in progress, completed)
- Handover queue (O&M + Client, by status)
- 3-month reviews due / overdue / completed
- Weekly client updates compliance (on time vs overdue)

**Quality & Compliance Reports:**
- Quality blockers by project and stage
- Compliance blockers by project and stage
- SSEG approval timeline (submission to approval)
- NCR trends (count, severity, resolution time)

**Role-specific Reports:**
- Construction Manager: inflow status, installer performance, schedule adherence
- KAM: post-handover review status, client satisfaction trends, upsell pipeline

### Report format:
- Each report should be a combination of summary metrics (cards/KPIs) and a filterable data table
- Export to PDF/Excel where useful for board reporting

---

## 7. PERFORMANCE SCREEN (V1 — SIMPLE)

**Route:** `/reports/performance` (under Admin → Reports)

**Purpose:** Early version of operational outcomes tracking.

### For V1, keep simple:
- Commissioning done vs planned (chart)
- 3-month reviews completed vs due (chart)
- Count of repeat issues across projects:
  - Metering problems
  - SSEG delays
  - Scope drift
  - Quality defects
  - Installer issues
- Average stage duration by stage (benchmark)
- Projects completed on time vs late

### Future versions can add:
- Energy yield vs modelled
- Margin outcome vs baseline
- Client satisfaction scoring
- Lessons learned pattern analysis

---

## 8. ADMIN EXTENSIONS

**Route:** `/admin/control-center` (existing — extend)

### New admin capabilities for stage engine:

**Stage Definitions:**
- Define/edit the 10 stages (name, code, sequence, description)
- Define mandatory checklist items per stage per department
- Define which items block the gate (`blocks_gate` flag)
- Define evidence requirements per stage
- Define RACI per stage

**Exception Thresholds:**
- Define risk levels and escalation rules
- Define auto-escalation timers (e.g., pending > 3 days → COO)
- Define which roles can approve exceptions (admin only in V1)

**Gate Configuration:**
- Configure which deliverable tracks apply per project type (for Financial Close stage)
- Configure SLA timers (e.g., O&M review = 5-7 days)
- Configure auto-tasking rules (what gets created when a stage transitions)

**Template Management:**
- Stage checklist templates
- Project charter template (6-section structure — see Prompt 3)
- Meeting agenda templates
- Client update templates
- Handover pack templates

**Role Management:**
- Extend existing role management to include stage-level RACI assignments
- Construction Manager role definition
- KAM role definition

---

## 9. ROLES, PERMISSIONS & PROJECT-LEVEL ACCESS CONTROL

**Extends existing:** `shared/schema/users.ts` → `users`, `userRoles`, `rolePermissions`

### Permission model — 3 layers:

**Layer 1 — Global role permissions (existing, extend):**

The existing `rolePermissions` table maps Role → Entity → Action. Extend with new permission entities:

New entities to add:
- `stage_gate` — can view/edit/approve stage workspaces
- `exception` — can view/create/approve exceptions
- `stage_config` — can manage stage definitions (admin)
- `gate_override` — can bypass a gate (admin only)
- `project_charter` — can view/edit charters
- `client_update` — can view/edit/send client updates
- `handover_acceptance` — can accept/reject handovers

New actions per entity: `view`, `create`, `edit`, `delete`, `approve`, `bypass`

Example role mappings:
| Role | stage_gate | exception | gate_override | handover_acceptance |
|------|-----------|-----------|---------------|-------------------|
| CEO/COO/CFO | view, approve | view, approve | bypass | view |
| Admin | all | all | bypass | all |
| PM | view, edit | view, create | — | view, edit (submit) |
| PD | view, edit (stages 1-3) | view, create | — | — |
| Quality Manager | view, edit (quality sections) | view, create | — | approve (quality sign-off) |
| Construction Manager | view, edit (stages 6-9) | view, create | — | — |
| KAM | view, edit (stage 10) | view | — | — |
| Finance | view, edit (financial sections) | view, create | — | — |
| O&M / Matriarch | view (stages 7-8) | view | — | approve (O&M acceptance) |

**Layer 2 — Project-level access (NEW):**

Add a `project_access` table to control who can see and do what on each specific project:

```
project_access:
  id
  project_id → project_info.id
  user_id → users.id
  access_level (owner / contributor / viewer / none)
  role_on_project (pm / pd / construction_manager / quality_lead / compliance / kam / finance / engineering / hse / om)
  stages_visible (text[] — array of stage codes, or 'all')
  can_edit (boolean)
  can_approve (boolean)
  granted_by_user_id → users.id
  granted_at
  expires_at (nullable — for temporary access)
  notes
```

**How it works:**
- Admin (or PM/Program Manager) assigns users to a project with a specific role and access level
- `access_level` controls visibility: owner sees everything, contributor sees their relevant stages, viewer is read-only
- `role_on_project` determines which sections of the stage workspace are prominent (role-filtering in Current Gate)
- `stages_visible` allows restricting a user to only certain stages (e.g., O&M only sees stages 7-8, KAM only sees stage 10)
- `can_edit` and `can_approve` override global permissions at the project level
- A user with no `project_access` record for a project cannot see that project (unless global role grants portfolio-wide access like Exco)

**Layer 3 — Stage-level field visibility (role-filtered content):**

This is not a separate permission table — it's implemented in the UI. When a user opens Current Gate on a project:
- The system checks their `role_on_project` from `project_access`
- Their department's checklist section is shown expanded/prominently
- Other departments' sections are shown collapsed but visible (unless `stages_visible` restricts them)
- `can_edit` determines whether they can modify checklist items and evidence
- `can_approve` determines whether approve/reject buttons are shown

### Admin UI for project access:

**Inside each project (Admin or PM can manage):**
- Team tab showing all users assigned to this project
- For each user: role, access level, stages visible, edit/approve permissions
- Add/remove team members
- Bulk assign from template (e.g., "standard EPC team" template)

**Inside Admin → Role Management:**
- Define default project access templates
- Define which global roles get portfolio-wide access (Exco sees all projects, Finance sees financial data on all projects)
- Define stage-level RACI defaults per role

### Portfolio-wide access (no project_access record needed):
- Exco roles (CEO, COO, CFO) → view all projects, all stages, can approve
- Program Manager → view all projects, all stages, can edit
- Program Finance → view all projects, financial sections only

### Project-level access examples:
- PM assigned to Project X → access_level: owner, role: pm, stages: all, can_edit: true, can_approve: false (can submit for approval but not self-approve)
- Quality Manager assigned to Project X → access_level: contributor, role: quality_lead, stages: [construction, commissioning, om_handover, client_handover], can_edit: true, can_approve: true (quality sign-offs)
- KAM assigned to Project X → access_level: contributor, role: kam, stages: [client_handover, post_handover_review], can_edit: true, can_approve: false
- O&M rep for Project X → access_level: contributor, role: om, stages: [commissioning, om_handover], can_edit: false (view only until acceptance), can_approve: true (O&M acceptance)

### Permission checks — where they apply:

| Screen | Check |
|--------|-------|
| Home page | Show only projects where user has `project_access` record OR global portfolio-wide role |
| Projects list | Filter to projects user can access |
| Project Overview | Check `project_access.access_level` ≠ none |
| Current Gate | Check `stages_visible` includes current stage. Role-filter content based on `role_on_project`. Check `can_edit` for edit controls. Check `can_approve` for approval buttons |
| Gates pipeline | Filter to projects user can access |
| Exception queue | Show exceptions for projects user can access |
| Handover pipeline | Filter by accessible projects |
| Reports | Aggregate data only from projects user can access (except Exco who sees all) |
