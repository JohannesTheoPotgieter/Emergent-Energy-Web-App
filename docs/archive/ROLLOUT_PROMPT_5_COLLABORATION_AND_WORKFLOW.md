# ROLLOUT PROMPT 5 OF 7 — COLLABORATION ENGINE, CROSS-FUNCTIONAL FEATURES & WORKFLOW RULES

The app must include collaboration mechanics, not just visibility. Failures happen at the interfaces between departments — scope changes, billing readiness, metering confirmation, handover acceptance, and post-handover responsibilities crossing team boundaries. Collaboration must be engineered into the workflow.

---

## 1. CROSS-FUNCTIONAL GATE CHECKLIST

Each stage has tasks organized by department, not one flat checklist. Every checklist item has:

| Field | Description |
|-------|-------------|
| `stage_code` | Which stage this belongs to |
| `department` | Which department owns this item |
| `item_name` | What must be done |
| `owner_user_id` | One accountable person |
| `contributors` | Named contributors from other departments |
| `due_date` | When it must be done |
| `status` | pending / in_progress / complete / waived / blocked |
| `evidence_attached` | boolean — is proof uploaded |
| `blocks_gate` | boolean — does this item block stage progression |
| `completed_by_user_id` | Who completed it |
| `completed_date` | When |
| `notes` | Context |

**Key principle:** Shared responsibility with explicit boundaries. Not "everyone can edit everything." One owner per item, clear contributors, clear due dates.

---

## 2. DEPENDENCY TRACKER

Track cross-department "waiting on" dependencies explicitly within each stage.

### Dependency record fields:
- `id`
- `project_id`
- `stage_code`
- `from_department` — who is waiting
- `from_user_id` — specific person waiting
- `to_department` — who must deliver
- `to_user_id` — specific person who must deliver
- `description` — what the item is
- `due_date`
- `status` (open / resolved / escalated / overdue)
- `created_at`
- `resolved_at`
- `age_days` (computed)
- `escalated` (boolean)
- `escalation_reason`

### Examples:
- "PM waiting on Design for final SLD"
- "Finance waiting on PM for milestone evidence"
- "O&M waiting on Commissioning for acceptance pack"
- "Construction Manager waiting on Procurement for panel delivery"
- "PM waiting on Compliance for SSEG approval"

### Display:
- Each dependency shows: who is waiting, who must deliver, what, when due, status, age
- Dependencies surface on: project overview, stage workspace (right column), role dashboards, Lifecycle blocked view

### Auto-creation:
- When a checklist item is assigned to a different department than the stage owner, automatically create a dependency record

---

## 3. ACCEPTANCE WORKFLOW

Every handover stage must end with a formal acceptance outcome. This applies to stages 4, 8, 9, and 10 (PD→PM Handover, O&M Handover, Client Handover, 3-Month Review).

### Acceptance options:
- **Accepted** — all clear, proceed
- **Accepted with reservations** — can proceed but open items must be tracked:
  - Each reservation: item description, owner, deadline, status
  - Reservations surface on downstream stages as carried-forward items
- **Rejected** — cannot proceed:
  - Reason captured
  - Actions created back to submitting party
  - Stage remains with current owner until re-submitted

### Rules:
- Handover is NOT "done" when the meeting is held. It is done when the receiving party confirms acceptance.
- Reservations must have owners and deadlines. They are tracked until closed.
- Rejection creates work items assigned back to the submitter.
- Bypass (progression despite rejection) requires admin override with reason.

---

## 4. DECISION REGISTER

Log decisions once and make them visible everywhere downstream. Prevents hidden changes creating service-scope mismatches and accountability drift.

### Decision record fields:
- `id`
- `project_id`
- `stage_code` — stage where decision was made
- `decision_type` (scope / tariff / metering / commercial / technical / contract / design / procurement)
- `decision_summary`
- `decided_by_user_id`
- `decided_date`
- `rationale`
- `impacted_departments` (array)
- `impacted_downstream_stages` (array)
- `evidence_url`
- `related_exception_id` (if decision resulted from exception)

### Display:
- Decision log visible on every stage workspace (lower section)
- Decisions tagged to a stage propagate forward — visible on all subsequent stages
- Filtering by decision type and department

### Key decision types to track:
- Scope changes between stages
- Tariff changes
- Metering decisions
- Commercial deviations from proposal
- Technical design changes
- Contract amendments
- Material/equipment substitutions
- Schedule changes with commercial impact

---

## 5. CLIENT COMMITMENT MEMORY

Any promise made to a client must be tracked and surfaced at relevant stages.

### Client commitment fields:
- `id`
- `project_id`
- `stage_code_created` — when the promise was made
- `commitment_text` — what was promised
- `committed_by_user_id`
- `committed_date`
- `delivery_stage_code` — when it should be delivered
- `status` (open / delivered / overdue / cancelled)
- `delivered_date`
- `notes`

### Rules:
- Commitments made during PD stages surface during PM execution, commissioning, and handover
- Overdue commitments flag on project overview and on PM/KAM dashboards
- Client Handover stage shows all commitments with delivery status

---

## 6. EVIDENCE REQUESTS BETWEEN TEAMS

Any team member can formally request evidence from another team within the stage workspace.

### Evidence request fields:
- `id`
- `project_id`
- `stage_code`
- `requested_by_user_id`
- `requested_from_department`
- `requested_from_user_id`
- `description` — what is needed
- `due_date`
- `status` (requested / uploaded / overdue / waived)
- `evidence_url` — link to uploaded evidence when fulfilled
- `fulfilled_date`

### Rules:
- Unfulfilled evidence requests appear in the "waiting on" panel
- Overdue requests escalate automatically (appear on dashboards)
- Evidence requests create corresponding dependency records

---

## 7. ROUTING RULES FOR QUERIES

Design/performance queries must follow a defined path rather than side channels. The app must enforce structured communication within project context.

### Query record fields:
- `id`
- `project_id`
- `stage_code`
- `query_type` (technical / commercial / compliance / quality / design)
- `raised_by_user_id`
- `raised_by_department`
- `assigned_to_user_id`
- `assigned_to_department`
- `subject`
- `description`
- `priority` (normal / urgent)
- `status` (open / in_progress / answered / closed)
- `response_text`
- `responded_by_user_id`
- `responded_date`
- `created_at`

### Routing rules:
- Technical queries → Engineering
- Commercial queries → PD or Finance
- Compliance queries → Compliance (under PM)
- Quality queries → Quality Manager
- Design queries → Design Engineer → Engineering Manager (escalation path)

### Rules:
- All queries visible within project context
- Response tracking with age awareness
- Unanswered queries > 3 days flag as dependency blockers

---

## 8. WEEKLY CLIENT COMMUNICATION (RECURRING OBLIGATION)

Not a stage — a recurring discipline enforced during stages 4–9.

### Client update record fields:
- `id`
- `project_id`
- `update_number`
- `last_client_update_date`
- `next_client_update_due_date`
- `client_update_status` (draft / pending_review / approved / sent / overdue)
- `progress_summary_text`
- `completed_this_period_text`
- `next_7_days_text`
- `blockers_text`
- `client_actions_required_text`
- `attachment_urls` (array)
- `client_update_sent_by`
- `reviewer_user_id` (optional — PM can request review before send)
- `sent_date`

### Auto-generation:
- The update draft should be auto-generated from project state data:
  - Recent completed tasks / milestones
  - Current stage and progress
  - Open blockers
  - Upcoming milestones
- PM only edits what matters — do not make them write from scratch

### Rules:
- Overdue updates (> 7 days since last sent) raise a health flag on the project
- Overdue flag appears on PM dashboard and Exco dashboard
- PM owns client communication until formal O&M handover is accepted (stage 8). Only then does Asset Manager become day-to-day contact.

### Actions:
- Generate draft
- Edit draft
- Request review (optional)
- Approve draft
- Send / mark sent
- Log follow-up action

---

## 9. WORKFLOW RULES

### Progression rule:
A stage can move to the next only when:
- All mandatory checklist items (where `blocks_gate = true`) are complete
- OR an exception is approved by admin with reason

### Waiting-on rule:
Every stage must support one visible waiting state:
- Waiting on Engineering
- Waiting on Quality
- Waiting on Compliance
- Waiting on Finance
- Waiting on Client
- Waiting on O&M / Matriarch
- Waiting on Procurement
- Waiting on PD
- Waiting on PM
- Waiting on Construction Manager
- Waiting on HSE

The waiting state is visible on: project header, project list, lifecycle views, role dashboards.

### Decision rule:
Every progression or rejection must log:
- Who decided
- When
- Why (reason text)
- Evidence (link)
- Follow-up conditions (if any)

### Auto-tasking:
When a stage changes, auto-create the next key actions:

| Trigger | Auto-created action |
|---------|-------------------|
| First Assessment → Design & Cost Proposal | Create design brief task for Engineering |
| Financial Close approved | Create PD-PM Handover pack preparation tasks |
| PM Handover accepted | Create stage setup tasks for PM, create financial baseline task for Finance |
| Financial Review approved | Create construction schedule task for Construction Manager |
| Construction nearing completion | Create commissioning plan task for PM, create Quality review task |
| Commissioning started | Create Quality review task, notify O&M of upcoming handover |
| O&M handover requested | Create Matriarch acceptance task with SLA clock |
| Client handover completed | Create 3-month review record and assign owner |
| 3-month review completed | Create follow-up actions, notify Exco of lessons |

### Escalation rules:
- Stage in "Blocked" status > 5 days → escalate to Program Manager
- Stage in "Blocked" status > 10 days → escalate to COO
- Exception request pending > 3 days → escalate to COO
- Handover acceptance pending > SLA (5-7 days) → escalate to receiving party's manager
- Weekly client update overdue > 7 days → flag on Exco dashboard
- 3-month review overdue > 14 days → flag on Exco dashboard
