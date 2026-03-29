# ROLLOUT PROMPT 6 OF 7 — SUPPORTING SCREENS

These screens provide cross-project operational control. They are not stage workspaces — they are management and governance views that pull data from the stage engine.

---

## 1. EXCEPTION QUEUE

**Route:** `/lifecycle/exceptions`

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

**Route:** `/my-work/approvals`

**Purpose:** Single queue for all approvals the logged-in user must action.

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
- Approvals appear on the user's home page (role-specific block)
- Approvals appear in My Work → Awaiting My Approval tab
- Overdue approvals (> 3 days) flag on dashboards

---

## 3. QUALITY SCREEN

**Route:** `/quality` (existing — extend, do not replace)

**Purpose:** Quality governance across commissioning to closeout.

### Views:
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
- Open project stage workspace
- Create snag/NCR
- Review and approve/reject
- Assign corrective action
- Close item

### Integration:
- Uses existing `shared/schema/quality.ts` → QC templates, checklists, NCRs
- Quality items created in stage workspaces (especially stages 6, 7, 8) surface here
- This is a cross-project governance view, not a duplicate of per-project quality tabs

---

## 4. COMPLIANCE SCREEN

**Route:** `/compliance` (new — separate from handover dashboard)

**Purpose:** SSEG and RMA specialist control across all projects.

### Views:
- SSEG by project (status, submitted date, expected date, actual date)
- Authority submissions tracker
- SSEG overdue (submitted but not approved past expected date)
- RMA open items
- RMA ageing (days since submission)
- Techsitter / metering confirmations pending
- Metering confirmed vs not confirmed

### Columns:
- Project
- Stage
- Item type (SSEG application, approval, inspection, certificate, connection, RMA)
- Authority
- Reference number
- Submitted date
- Expected date
- Actual date
- Status
- Age

### Actions:
- Update status
- Flag blocker (creates dependency on project)
- Escalate overdue item
- Mark complete

### Integration:
- Uses existing `shared/schema/handover.ts` → `ssegItems` table
- Compliance items created in stage workspaces (stages 2, 6, 7) surface here
- Techsitter/metering confirmations from commissioning (stage 7) visible here

---

## 5. HANDOVER PIPELINE

**Route:** `/lifecycle/handover-pipeline`

**Purpose:** Company-wide closeout control. Evolves the current handover page into a broader lifecycle view.

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
- Open project handover workspace
- Request missing document
- Escalate overdue acceptance
- View pack completeness detail

### Integration:
- Reads from existing `shared/schema/handover.ts` → `handoverPacks`, `handoverChecklistItems`
- Extends current handover dashboard — do not replace, add the broader pipeline views

---

## 6. REPORTS

**Route:** `/reports/center` (existing — extend with new lifecycle reports)

**Purpose:** Management and board reporting fed by stage engine data.

### New core reports to add:

**Lifecycle Reports:**
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

**Route:** `/performance` (new, under Reports or standalone)

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
- Meeting agenda templates
- Client update templates
- Handover pack templates

**Role Management:**
- Extend existing role management to include stage-level RACI assignments
- Construction Manager role definition
- KAM role definition
