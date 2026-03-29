# ROLLOUT PROMPT 2 OF 7 — NAVIGATION & TOP-LEVEL SCREENS

This prompt defines the new navigation structure and the top-level screens: Home, My Work, Lifecycle, and Projects.

**Current navigation** (in `client/src/config/app-navigation.ts`): Home | My Work | Projects | Finance | Reports | Admin

**New navigation replaces the old structure.** Existing Finance, Reports, and Admin sections stay largely as-is. The changes are: adding Lifecycle as a top-level section, and restructuring Projects subnav.

---

## 1. NEW TOP-LEVEL NAVIGATION

| Section | Path | Purpose |
|---------|------|---------|
| Home | `/` | Role-aware, action-driven landing |
| My Work | `/my-work` | Single execution inbox for the logged-in user |
| Lifecycle | `/lifecycle` | Company-wide view of where projects sit in the lifecycle |
| Projects | `/projects` | Portfolio list and project-level workspaces |
| Finance | `/cashflow` | Keep existing (Cashflow, COS, Revenue, GP, POs, Payments, Procurement) |
| Reports | `/reports/center` | Keep existing (Report Center, PM/Eng Monthly, Programme, Priorities, SOPs, Training, Feedback) |
| Admin | `/admin/control-center` | Keep existing + add stage definitions, exception thresholds, gate config |

### Lifecycle secondary nav (new):
- Overview → `/lifecycle`
- Stage Readiness → `/lifecycle/readiness`
- Blocked Gates → `/lifecycle/blocked`
- Ready to Progress → `/lifecycle/ready`
- Exception Queue → `/lifecycle/exceptions`
- Client Communication → `/lifecycle/client-updates`
- Handover Pipeline → `/lifecycle/handover-pipeline`
- 3-Month Reviews → `/lifecycle/reviews`

### Projects secondary nav (restructured):
- Project List → `/projects`
- Project Development → `/pd`
- Engineering → `/engineering`
- Engineering Standup → `/engineering/standup`
- Construction → `/construction`
- Quality → `/quality`
- Handover & Closeout → `/handover`
- Clients → `/clients`

### My Work secondary nav (keep existing, extend):
- My Tasks → `/my-work`
- Approvals → `/my-work/approvals`
- Calendar → `/my-work/calendar`
- Meetings → `/my-work/meetings`
- Inbox → `/inbox`

### Path matching for Lifecycle section:
Add to match function: `/lifecycle`, `/lifecycle/readiness`, `/lifecycle/blocked`, `/lifecycle/ready`, `/lifecycle/exceptions`, `/lifecycle/client-updates`, `/lifecycle/handover-pipeline`, `/lifecycle/reviews`

### What moves:
- "Execution Board" (`/execution-board`) — absorbed into Lifecycle Overview
- "Lifecycle Board" (`/lifecycle-board`) — replaced by new Lifecycle section
- "Exceptions" (`/exceptions`) — moves to `/lifecycle/exceptions`
- "Deliverables" (`/pm/deliverables`) — stays accessible via project-level nav
- "Weekly Reviews" (`/weekly-reviews`) — absorbed into Client Communication under Lifecycle

---

## 2. HOME PAGE BLUEPRINT

**File to modify:** `client/src/pages/home.tsx` + `client/src/config/role-dashboard-config.ts`

**Purpose:** Show the user what needs attention now, by role. Content logic must become stage-driven, not just page-driven.

### Common sections for ALL roles:
- My overdue actions (count + list)
- My approvals pending (count + list)
- Projects waiting on me (count + list)
- Projects I am blocking (count + list)
- Stage deadlines in next 7 days
- Open exceptions involving me
- Weekly client updates overdue (flag)
- Company priorities

### Role-specific blocks:

**Exco (CEO / COO / CFO):**
- Projects blocked by gate (count + drill-down)
- Exception approvals pending
- Margin-risk projects
- Handover bottlenecks
- Department delay summary (which dept is causing the most waiting)
- Systemic issues summary (count of projects where SSEG caused delay, Techsitter issues, repeated QA defects)

**Project Manager:**
- My projects by current stage
- Weekly client updates due
- Commissioning dates approaching
- Handover packs incomplete
- Waiting on Quality / Compliance / Engineering / Finance
- Construction Manager items needing attention

**Project Developer (PD):**
- Cost proposals in build (stage 2)
- Deals awaiting signature (stage 3)
- Financial close outstanding
- Handover packs waiting PM review (stage 4)

**Construction Manager:**
- Projects in construction phase (stage 6)
- Inflow status (materials, equipment on track / delayed)
- Installer schedule compliance
- Projects approaching commissioning
- Open items blocking practical completion

**Engineering Manager / Engineer:**
- Designs to complete
- Clarifications to answer
- Commissioning checks assigned
- Lessons learned reviews due

**Quality Manager:**
- Commissioning reviews due
- Snags/NCRs blocking handover
- Handover quality readiness
- Closeout quality actions overdue

**Compliance (under PM):**
- SSEG status by project
- RMA open items
- Authority approvals overdue
- Techsitter / metering confirmations pending

**HSE (under PM):**
- Safe to energise confirmations due
- Open HSE incidents
- Last site HSE check dates

**KAM:**
- Projects in post-handover review window
- Client follow-ups due
- 3-month reviews overdue
- After-sales opportunities / risk notes
- Unresolved client concerns

**Finance / Program Finance:**
- Financial reviews due
- Margin drift items
- Cost evidence missing
- Invoice / COS realization exceptions
- Billing readiness risks

### Key actions (all roles):
- Open My Work
- Open Lifecycle
- Open blocked projects
- Approve / reject exception
- Open next stage action

---

## 3. MY WORK BLUEPRINT

**Files to modify:** `client/src/pages/my-work-home.tsx`, `client/src/pages/my-work-tasks.tsx`

**Purpose:** Single execution inbox for the logged-in user. This reduces the hunting problem.

### Tabs:
- Assigned to Me
- Awaiting My Approval
- Watching
- Overdue
- Meetings
- Notes / Decisions
- Exceptions

### Required fields per work item:
- `work_item_type`
- `related_project_id`
- `related_stage_code`
- `title`
- `description`
- `owner_user_id`
- `due_date`
- `status`
- `priority`
- `department`
- `source_screen`
- `source_record_id`

### Actions:
- Mark complete
- Request rework
- Reassign
- Link evidence
- Escalate
- Convert to exception request
- Open project/stage

### Filters:
- Project
- Stage
- Department
- Priority (critical, important, normal)

---

## 4. LIFECYCLE WORKSPACE BLUEPRINT

**Purpose:** Company-wide view of where projects sit in the lifecycle. This replaces the current execution board and lifecycle board with a unified, gate-driven view.

### Screen: Lifecycle Overview (`/lifecycle`)

**Main blocks:**
- Projects by stage (visual stage pipeline — counts per stage)
- Projects by gate status (cards: In Progress, Ready for Review, Blocked, Overdue)
- Projects by department waiting state
- Projects missing latest client update
- Projects ready to progress
- Projects progressed by exception
- Clients with active projects
- Handover queue
- 3-month review queue

**Filters:**
- Client
- PM
- PD
- Quality Manager
- Compliance Manager
- KAM
- Construction Manager
- Project type
- Funding type
- Stage
- Gate status
- Exception status
- Date range

**Views:**
- Kanban by stage
- Table by gate status
- Queue: blocked
- Queue: ready for review
- Queue: ready to progress
- Queue: exception approved

**Actions:**
- Open project
- Request update
- Escalate blocker
- Open gate review
- View exceptions

### Sub-screens:

**Stage Readiness** (`/lifecycle/readiness`):
- Table of all projects with: stage, readiness score (%), missing items count, primary owner, key blockers (top 2)

**Blocked Gates** (`/lifecycle/blocked`):
- Projects where gate_status = Blocked, sorted by days_in_stage descending

**Ready to Progress** (`/lifecycle/ready`):
- Projects where gate_status = Ready for Review or Approved, awaiting progression

**Exception Queue** (`/lifecycle/exceptions`):
- All exception requests across all projects (see Prompt 6 for full spec)

**Client Communication** (`/lifecycle/client-updates`):
- All projects with: last update sent, next due, status (on time / overdue / draft pending)

**Handover Pipeline** (`/lifecycle/handover-pipeline`):
- O&M handover queue, Client handover queue, missing documents, practical completion pending, SSEG pending, accepted/closed, waiting on Matriarch, waiting on client

**3-Month Reviews** (`/lifecycle/reviews`):
- All reviews: scheduled, overdue, in progress, completed

---

## 5. PROJECT LIST BLUEPRINT

**File to modify:** Extend existing projects list page.

**Purpose:** Portfolio list with enough truth to avoid opening every project blindly.

### Required columns:
- Project Name
- Client
- PM
- PD
- Construction Manager
- Current Stage
- Gate Status
- RAG
- Next Milestone
- Waiting On
- Open Exceptions
- Quality Blockers
- Compliance Blockers
- Weekly Update Status
- Handover Status
- Last Update
- 3-Month Review Status
- Margin Flag (ok / at risk)

### Exco toggle:
Only show projects with: overdue gates, margin risk, rejected/reserved handovers, commissioning/billing readiness risk.

### Construction Manager toggle:
Filter to projects in stages 6–9 (Construction through Client Handover) where the logged-in user is the assigned Construction Manager. Shows: inflow status, installer compliance, schedule adherence, practical completion status, and handover readiness.

### Actions:
- Open project
- Quick update
- Open current gate
- Open exception queue
- Open handover
- Open weekly update draft

---

## 6. PROJECT WORKSPACE SHELL

**This is the main thing the dev team must get right.**

### Screen: Project Overview (`/project/:projectId`)

**Purpose:** Single operational cockpit for the project.

### Layout:

**Top strip (Critical Control Panel — see Prompt 1 section 4):**
- Project identity (name, client, type, funding type)
- Current stage + gate status + RAG
- Next milestone date
- Owner map (PM, PD, Construction Manager, Quality Manager, Compliance, KAM)
- The one sentence that matters

**Top horizontal stage bar:**
- Visual lifecycle progression across all 10 stages (always visible)
- Current stage highlighted
- Completed stages marked
- Clickable to navigate to any stage workspace

**Left / center column:**
- Current Gate card (readiness %, missing items, checklist progress by department)
- Stage timeline
- Missing items list
- Waiting on (department + person)
- Recent decisions
- Latest client update summary

**Right rail:**
- Pending approvals
- Open exceptions
- Open tasks (from workItems)
- Linked evidence
- Meeting log
- Key contacts

**Must-have widgets:**
- Gate readiness %
- Missing mandatory items
- Stage owner
- Approver
- Waiting on department
- Last decision
- Last update sent to client
- Last quality review
- Last compliance update
- O&M handover state
- Post-handover review due date

### Inside a project — left subnav:
- Overview → `/project/:id`
- Current Gate → `/project/:id/current-gate`
- Commercial → `/project/:id/commercial`
- Delivery → `/project/:id/delivery`
- Quality → `/project/:id/quality`
- Compliance → `/project/:id/compliance`
- Handover → `/project/:id/handover`
- Post-Handover → `/project/:id/post-handover`
- History → `/project/:id/history`

### Project header (shown on every project sub-page):
- Project Name
- Client Name
- Project Type
- Funding Type
- Current Stage
- Gate Status
- RAG Status
- PM
- PD
- Construction Manager
- Quality Manager
- Compliance Manager
- KAM
- O&M status
- Next milestone date
