# ROLLOUT PROMPT 7 OF 7 — DATA MODEL, BUILD ORDER, ANTI-ADMIN PRINCIPLES & RISK GUARDRAILS

---

## 1. DATA MODEL

### Existing tables to EXTEND (do not replace):

| Table | File | What to add |
|-------|------|-------------|
| `project_info` | `shared/schema/projects.ts` | No changes needed — identity stays clean |
| `project_execution_state` | `shared/schema/projects.ts` | Add: `current_stage_code`, `gate_status`, `gate_readiness_pct`, `stage_owner_user_id`, `approver_user_id`, `waiting_on_department`, `waiting_on_user_id`, `next_required_action`, `days_in_stage` (computed), `open_exception_count` (computed), `kam_user_id`, `construction_manager_user_id` (already has some role fields) |
| `handover_packs` | `shared/schema/handover.ts` | Already supports pd_to_pm, practical_completion, client_handover, matriarch_handover, sseg_closeout. Extend with stage_code linkage |
| `handover_checklist_items` | `shared/schema/handover.ts` | Add: `department`, `blocks_gate`, `stage_code` |
| `sseg_items` | `shared/schema/handover.ts` | Add: `techsitter_confirmed`, `metering_confirmed` flags if not present |
| `work_items` | `shared/schema/tasks.ts` | Add: `related_stage_code`, `source_screen` for stage-context linking |
| QC tables | `shared/schema/quality.ts` | No schema changes — integrate existing QC/NCR into commissioning stage workspace |

### NEW tables to create:

**`project_stage_instances`** — one row per project per stage:
```
id
project_id → project_info.id
stage_code (first_assessment, design_costing, financial_close, pd_pm_handover, financial_review, construction, commissioning, om_handover, client_handover, post_handover_review)
stage_status (not_started, in_progress, ready_for_review, approved, progressed, exception_approved, blocked)
stage_owner_user_id → users.id
approver_user_id → users.id
readiness_pct (integer 0-100)
started_at (timestamp)
completed_at (timestamp)
target_exit_date (date)
waiting_on_department (text)
waiting_on_user_id → users.id
next_required_action (text)
notes (text)
created_at
updated_at
```

**`project_stage_requirements`** — checklist items per stage per department:
```
id
project_id → project_info.id
stage_instance_id → project_stage_instances.id
stage_code
department
item_name
item_code (unique identifier for the requirement)
owner_user_id → users.id
due_date
status (pending, in_progress, complete, waived, blocked)
blocks_gate (boolean)
evidence_url
evidence_attached (boolean)
completed_by_user_id → users.id
completed_date
notes
created_at
updated_at
```

**`project_stage_evidence`** — evidence documents per stage:
```
id
project_id → project_info.id
stage_instance_id → project_stage_instances.id
stage_code
evidence_type (document, photo, certificate, approval, minutes, report)
title
file_url
uploaded_by_user_id → users.id
uploaded_at
inherited_from_stage (nullable — for evidence inheritance)
review_status (pending, reviewed, accepted, rejected)
reviewed_by_user_id → users.id
reviewed_at
notes
```

**`project_stage_decisions`** — decision register:
```
id
project_id → project_info.id
stage_code
decision_type (scope, tariff, metering, commercial, technical, contract, design, procurement)
decision_summary
decided_by_user_id → users.id
decided_date
rationale
impacted_departments (text[] array)
impacted_downstream_stages (text[] array)
evidence_url
related_exception_id → project_stage_exceptions.id (nullable)
created_at
```

**`project_stage_exceptions`** — exception/bypass records:
```
id
project_id → project_info.id
stage_code
requirement_code (which checklist item is being bypassed)
reason_text
risk_level (low, medium, high, critical)
mitigation_text
owner_user_id → users.id (requester)
approver_user_id → users.id (admin who decides)
status (pending, approved, approved_with_conditions, rejected, closed, re_opened)
conditions_text
closeout_due_date
downstream_blocking_stage
approved_at
closed_at
created_at
updated_at
```

**`project_stage_dependencies`** — cross-department waiting-on:
```
id
project_id → project_info.id
stage_code
from_department
from_user_id → users.id
to_department
to_user_id → users.id
description
due_date
status (open, resolved, escalated, overdue)
escalated (boolean)
escalation_reason
created_at
resolved_at
```

**`project_client_commitments`** — client promise tracking:
```
id
project_id → project_info.id
stage_code_created
commitment_text
committed_by_user_id → users.id
committed_date
delivery_stage_code
status (open, delivered, overdue, cancelled)
delivered_date
notes
created_at
```

**`project_client_updates`** — weekly client communication:
```
id
project_id → project_info.id
update_number (sequential)
due_date
status (draft, pending_review, approved, sent, overdue)
progress_summary_text
completed_this_period_text
next_7_days_text
blockers_text
client_actions_required_text
attachment_urls (text[] array)
sent_by_user_id → users.id
reviewer_user_id → users.id (optional)
sent_date
created_at
updated_at
```

**`project_queries`** — structured query routing:
```
id
project_id → project_info.id
stage_code
query_type (technical, commercial, compliance, quality, design)
raised_by_user_id → users.id
raised_by_department
assigned_to_user_id → users.id
assigned_to_department
subject
description
priority (normal, urgent)
status (open, in_progress, answered, closed)
response_text
responded_by_user_id → users.id
responded_date
created_at
```

**`stage_definitions`** — admin-managed stage configuration:
```
id
stage_code
stage_name
stage_sequence (integer 1-10)
description
default_owner_role
default_approver_role
is_active (boolean)
created_at
updated_at
```

**`stage_checklist_templates`** — admin-managed default checklists:
```
id
stage_code
department
item_name
item_code
blocks_gate (boolean)
is_required (boolean)
sort_order
created_at
updated_at
```

### Financial Close deliverable tracks:

Add to `project_stage_instances` or a linked table:
```
project_stage_financial_close_tracks:
  id
  project_id → project_info.id
  stage_instance_id → project_stage_instances.id
  track_code (cost_proposal, epc, funding_contract, om)
  track_label
  is_required (boolean — configured per project)
  signed (boolean)
  signed_date
  document_url
  notes
```

---

## 2. BUILD ORDER

### Phase 1 — Foundation (build first, everything depends on this):

**Owner:** Dev lead + COO

1. **Stage data model** — create `project_stage_instances`, `project_stage_requirements`, `project_stage_exceptions` tables + Drizzle schema + migration
2. **Project header critical control panel** — the persistent top strip on every project page showing current stage, gate status, readiness %, the one sentence that matters
3. **Current Gate card** — the main widget showing checklist progress by department, missing items, waiting-on
4. **Stage status model** — state machine for gate statuses (Not Started → In Progress → Ready for Review → Approved → Progressed → Exception Approved → Blocked)
5. **Waiting-on model** — `project_stage_dependencies` table + display on project pages
6. **Exception object** — `project_stage_exceptions` table + create/approve/reject workflow
7. **Approval object** — unified approval queue pulling from gate approvals, exception approvals, handover acceptances

### Phase 2 — Highest-value stages (build these first because they fill the biggest gaps):

1. **Financial Close workspace** (stage 3) — 4 configurable deliverable tracks, CP management, commercial exceptions
2. **PD → PM Handover workspace upgrade** (stage 4) — extend existing PD-PM Handover v2 with full acceptance workflow, reservation tracking
3. **Commissioning workspace** (stage 7) — dual PM/Quality ownership, Techsitter/metering gates, evidence pack with inheritance, integration with existing quality schema
4. **Construction workspace** (stage 6) — Construction Manager as owner, inflow tracking, installer relations, schedule management

### Phase 3 — Closeout control:

5. **O&M Handover workspace** (stage 8) — SLA clock, soft monitoring control, Matriarch acceptance, extend existing handover schema
6. **Client Handover workspace** (stage 9) — O&M gates client messaging, auto-trigger 3-month review
7. **3-Month Post-Handover Review** (stage 10) — auto-scheduled, assignable owner, multi-department input

### Phase 4 — Opening stages and recurring:

8. **First Assessment workspace** (stage 1) — basic qualification gate
9. **Design & Cost Proposal workspace** (stage 2) — shared proposal room, dual PD/Engineering confirmation
10. **Financial Review workspace upgrade** (stage 5) — extend existing financial review routes
11. **Weekly Client Communication engine** — auto-generation from project state, recurring obligation enforcement

### Phase 5 — Management control and navigation:

12. **Navigation restructure** — add Lifecycle top-level, restructure Projects subnav, replace old nav
13. **Home page redesign** — stage-driven role-specific blocks
14. **Lifecycle Overview screen** — company-wide stage pipeline, blocked/ready views
15. **Exception Queue screen**
16. **Handover Pipeline screen** — evolved from current handover page
17. **Compliance screen** — new, separate from handover
18. **Reports** — lifecycle and operational reports
19. **Admin extensions** — stage definitions, checklist templates, gate configuration

### Phase 6 — Collaboration features:

20. **Dependency tracker** — cross-department waiting-on with auto-creation
21. **Decision register** — log once, visible downstream
22. **Client commitment memory** — promise tracking across stages
23. **Evidence requests** — formal inter-team requests
24. **Query routing** — structured communication within project context

---

## 3. ANTI-ADMIN PRINCIPLES

The app must add operational value, not more admin. Test every feature against these rules:

1. **Only ask for data once.** If it exists in a tracker, project record, SharePoint doc, or earlier stage, read it — don't make users re-enter it.

2. **Evidence inheritance.** Documents uploaded in earlier stages auto-populate into later stage evidence requirements. Proposal docs feed commissioning appendices and handover packs.

3. **Auto-generate, don't re-type.** Meeting packs, client updates, and status summaries should be generated from project state data. Users only edit what matters.

4. **Approvals are actions, not forms.** Accept / reject / comment. Three clicks maximum.

5. **Defaults and prefilled templates.** New stage instances inherit checklist templates from admin configuration. Only capture deviations.

6. **The app is the execution system.** ClickUp is being replaced. The existing `workItems` / `UnifiedTask` system is the task backbone. Stage workspaces create and link to work items — they don't duplicate task management.

7. **Stage workspaces mostly read existing truth.** Users only capture: decisions, exceptions, missing item owners, meeting notes, and approvals.

---

## 4. FAILURE MODES TO DESIGN AGAINST

Every design decision must be tested against this list:

| Failure mode | Prevention |
|-------------|-----------|
| Every stage becomes a giant form → users bypass it | Keep workspaces focused on decisions, evidence, and approvals — not data entry forms |
| Stages progress without evidence → gates become theatre | Evidence must be uploaded or linked, not just checked off. `blocks_gate` items enforce this |
| Tracker data duplicated in app → source of truth drifts | Read from source systems. Don't copy data into parallel stores |
| Client handover and O&M handover mixed into one "closeout" → accountability blurs | Keep them as separate stages (8 and 9) with separate owners |
| "Owner" and "approver" not separated → everyone assumes someone else has it | Every task, every gate: exactly one owner, exactly one approver |
| Weekly client updates manual from scratch → PMs stop doing them | Auto-generate drafts from project state |
| 3-month reviews not auto-scheduled → they vanish | System auto-creates review record at client handover acceptance |
| Scope changes between quote and signature not flagged → PM inherits mismatched expectations | Decision register + "changes since proposal" summary in Financial Close |
| Billing starts before metering is active → revenue recognition wrong | Techsitter/metering confirmation is an EXPLICIT GATE in commissioning |
| Design/performance queries go through side channels → decisions without project context | Query routing engine with defined paths |
| EE soft monitoring switched off before O&M acceptance → monitoring gap | `soft_monitoring_end_date` can only be set AFTER O&M acceptance |
| Navigation becomes a maze → users can't find what matters | Top nav = where you're working. Stage bar = where the project is. Role dashboard = what you owe. Three layers, not thirty buttons |

---

## 5. ACCEPTANCE CRITERIA FOR PILOT

Test against real projects (one per scenario):
- One project in first assessment / proposal
- One in financial close
- One in PD-PM handover
- One in construction
- One at commissioning
- One at O&M / client handover
- One post-handover

**Measure:**
1. Can the user see the next blocker in under 30 seconds?
2. Can they see who owns the blocker?
3. Can they progress a stage cleanly without asking around?
4. Did admin reduce instead of grow?
5. Can Exco see blocked projects and exception queue without drilling into each project?
6. Can the Construction Manager see inflow status and installer issues across projects?
7. Can KAM see post-handover review pipeline?
8. Does the weekly client update generate a usable draft automatically?

---

## 6. WHAT THIS TOUCHES

| Dimension | Impact |
|-----------|--------|
| **Process** | Stage gates become the main spine of the UX |
| **People** | Role clarity at each gate — who owns, who approves, who waits on whom |
| **Tools** | App becomes the operating system, replacing ClickUp for execution |
| **Governance** | Soft gates with admin override, evidence enforcement, exception tracking |
| **Strategy** | Predictable delivery, margin protection, quality, safety, smooth handover to Matriarch |

---

## 7. DESIGN PHILOSOPHY — ALWAYS RETURN TO THIS

**"One project journey, many role views, zero ambiguous handoffs."**

- Stage-led at the operating system level.
- Role-led at the user experience level.
- Collaboration-led in the handoffs between them.

The real value is in making cross-department obligations visible and unavoidable before the project moves forward.

Do not redesign the app as "better pages." Redesign it as a gate-driven project operating system where every role can instantly see: what stage the project is in, what is missing, who owns it, and whether it is allowed to move.
