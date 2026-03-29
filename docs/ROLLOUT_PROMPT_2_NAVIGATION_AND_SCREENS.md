# ROLLOUT PROMPT 2 OF 7 — NAVIGATION & TOP-LEVEL SCREENS

This prompt defines the simplified navigation structure and the top-level screens.

**Current navigation** (in `client/src/config/app-navigation.ts`): Home | My Work | Projects | Finance | Reports | Admin

**New navigation replaces the old structure.** The key changes: merge Home + My Work into one role-aware landing, replace "Lifecycle" with "Gates" (concrete, everyone knows what a gate is), make Projects subnav stage-driven not department-driven, simplify project-level nav to 5 items.

---

## 1. NEW TOP-LEVEL NAVIGATION — 5 ITEMS

| Section | Path | What it answers |
|---------|------|-----------------|
| **Home** | `/` | "What do I owe the system right now?" — role-aware action landing with tabs for tasks, approvals, calendar, meetings |
| **Projects** | `/projects` | "Where are my projects and what's blocking them?" — portfolio list + individual project workspaces |
| **Gates** | `/gates` | "What needs to move across the whole company?" — cross-project stage control and governance |
| **Finance** | `/cashflow` | Keep existing (Cashflow, COS, Revenue, GP, POs, Payments, Procurement) |
| **Admin** | `/admin/control-center` | Keep existing + add: stage definitions, exception thresholds, gate config, Reports, SOPs, Training, Feedback |

### Why this is simpler:
- **Home absorbs My Work** — they answer the same question ("what needs my attention"). One place, not two.
- **"Gates" not "Lifecycle"** — concrete word. Everyone knows what a gate is. "Lifecycle" is abstract.
- **Reports moves under Admin** — consumed mainly by Exco and Finance. Most users never go there. Keeps top nav clean.
- **5 items instead of 7** — less cognitive load, faster navigation.

### Home secondary nav (tabs within the page):
- Actions → `/` (default — overdue actions, tasks assigned to me, projects I'm blocking)
- Approvals → `/?tab=approvals` (all pending approvals)
- Calendar → `/?tab=calendar` (upcoming dates, meetings, milestones)
- Meetings → `/?tab=meetings` (scheduled meetings, handover meetings, review meetings)
- Inbox → `/?tab=inbox` (notifications, escalations)

### Projects secondary nav (STAGE-DRIVEN, not department-driven):
- All Projects → `/projects`
- PD Pipeline → `/projects/pd-pipeline` (projects in stages 1–3: First Assessment, Design, Financial Close)
- Execution → `/projects/execution` (projects in stages 4–6: Handover, Review, Construction)
- Closeout → `/projects/closeout` (projects in stages 7–9: Commissioning, O&M, Client Handover)
- Post-Handover → `/projects/post-handover` (projects in stage 10)
- Clients → `/clients`

### Gates secondary nav:
- Pipeline → `/gates` (all projects by stage — kanban or table)
- Blocked → `/gates/blocked` (projects where gate_status = Blocked)
- Ready → `/gates/ready` (projects ready for review or progression)
- Exceptions → `/gates/exceptions` (all open exceptions)
- Client Updates → `/gates/client-updates` (weekly update compliance)
- Handovers → `/gates/handovers` (O&M + Client handover queue)

### Finance secondary nav (keep existing):
- Cashflow → `/cashflow`
- COS → `/cos`
- Revenue → `/revenue-tracker`
- GP Tracker → `/gp-tracker`
- FYE Revenue → `/fye-revenue-tracking`
- PO Approvals → `/po-approval-board`
- Payment Requests → `/payment-request-board`
- Payment Batches → `/payment-batch-manager`
- Counterparties → `/counterparties`
- Invoice Patterns → `/invoice-patterns`
- Procurement Hub → `/procurement`
- Subcontractors → `/subcontractor-dashboard`

### Admin secondary nav (extended):
- Control Center → `/admin/control-center`
- Stage Definitions → `/admin/stages` (define stages, checklists, evidence, RACI)
- Gate Config → `/admin/gate-config` (exception thresholds, SLA timers, auto-tasking rules)
- Templates → `/admin/templates` (charter, meeting, client update, handover pack templates)
- Report Center → `/reports/center`
- PM Monthly Report → `/reports/pm/monthly`
- Eng Monthly Report → `/reports/engineering/monthly`
- Programme Reports → `/reports/programme`
- Processes & SOPs → `/ee-info`
- Training → `/training`
- Feedback → `/feedback`

### What gets absorbed (no longer standalone top-level or secondary nav items):
- "My Work" (`/my-work`) → absorbed into Home tabs
- "Execution Board" (`/execution-board`) → absorbed into Gates Pipeline
- "Lifecycle Board" (`/lifecycle-board`) → replaced by Gates
- "Exceptions" (`/exceptions`) → moves to `/gates/exceptions`
- "Weekly Reviews" (`/weekly-reviews`) → absorbed into Gates → Client Updates
- "Engineering" (`/engineering`) → accessed inside project stage workspaces (not a standalone nav destination)
- "Engineering Standup" (`/engineering/standup`) → keep as a direct route, accessible via Home quick action for engineering roles
- "Construction" (`/construction`) → accessed inside project stage workspaces
- "Quality" (`/quality`) → accessed inside project stage workspaces (Quality Manager sees quality items within commissioning/handover stages)
- "Handover & Closeout" (`/handover`) → replaced by Gates → Handovers + project-level handover stages

### Key principle: department views become role-filtered content WITHIN stage workspaces, not separate destinations.

The Quality Manager doesn't go to "/quality" — they open the commissioning stage workspace and see the quality checklist. The engineer doesn't go to "/engineering" — they see engineering tasks within the relevant stage. This is what "stage-led, role-filtered" means in practice.

---

## 2. HOME PAGE BLUEPRINT

**File to modify:** `client/src/pages/home.tsx` + `client/src/config/role-dashboard-config.ts`

**Purpose:** Single role-aware landing page. Absorbs the current Home + My Work into one screen. The user opens the app and immediately sees what they owe, what's blocked, and what's next.

### Layout:

**Top strip — personal status:**
- Welcome, [Name] — [Role]
- Overdue actions: [count]
- Approvals pending: [count]
- Projects I'm blocking: [count]
- Next deadline: [date + project + description]

**Main area — tabs:**

#### Tab: Actions (default)
- My overdue actions (count + list, sorted by urgency)
- Tasks assigned to me across all projects (grouped by project, showing stage context)
- Projects waiting on me (with "waiting on" detail)
- Projects I am blocking (with what's blocked)
- Stage deadlines in next 7 days
- Quick actions: Approve, Complete, Escalate, Open project

#### Tab: Approvals
- All pending approvals (gate approvals, exception approvals, handover acceptances, review sign-offs)
- Columns: Project, Type, Stage, Requested by, Date, Age, Summary
- Actions: Approve, Reject, Return with comments, Delegate

#### Tab: Calendar
- Upcoming milestones, meetings, handover dates, commissioning dates, review dates
- Timeline or calendar view

#### Tab: Meetings
- Scheduled meetings (handover meetings, alignment meetings, commissioning reviews, client updates)
- Actions: View agenda, Record minutes, Create follow-up actions

#### Tab: Inbox
- Notifications, escalations, mentions
- Filtered by: unread, action required, informational

### Role-specific content blocks (shown on the Actions tab):

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
- Clarifications to answer (TQs)
- Commissioning checks assigned
- Lessons learned reviews due
- Quick link: Engineering Standup

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

### Key actions (all roles — always visible):
- Open blocked projects
- Approve / reject next approval
- Open next stage action
- Open gates view

---

## 3. GATES WORKSPACE BLUEPRINT

**Purpose:** Company-wide view of where projects sit in the lifecycle. Replaces the current execution board and lifecycle board with a unified, gate-driven view. This is the management control screen.

### Screen: Gates Pipeline (`/gates`)

**Main view:** Visual stage pipeline — all 10 stages as columns, projects as cards within each column.

**Each project card shows:**
- Project name + client
- Gate status (colour-coded: green/amber/red)
- Readiness %
- Waiting on [department]
- Days in stage
- Open exceptions count

**Alternative views:**
- Kanban by stage (default)
- Table by gate status
- Table: blocked only
- Table: ready for review
- Table: ready to progress
- Table: exception approved

**Filters:**
- Client
- PM / PD / Construction Manager / Quality Manager / KAM
- Project type
- Funding type
- Stage
- Gate status
- Exception status
- Date range

**Actions:**
- Open project
- Request update
- Escalate blocker
- Open gate review
- View exceptions

### Sub-screens:

**Blocked** (`/gates/blocked`):
- Projects where gate_status = Blocked, sorted by days_in_stage descending
- Columns: Project, Stage, Blocker, Owner, Waiting on, Days blocked, Escalation status

**Ready** (`/gates/ready`):
- Projects where gate_status = Ready for Review or Approved
- Columns: Project, Stage, Readiness %, Approver, Submitted date

**Exceptions** (`/gates/exceptions`):
- All open exception requests across all projects (full spec in Prompt 6)

**Client Updates** (`/gates/client-updates`):
- All projects with: last update sent, next due, status (on time / overdue / draft pending)
- Sorted by overdue first

**Handovers** (`/gates/handovers`):
- O&M handover queue (projects in stage 8)
- Client handover queue (projects in stage 9)
- Columns: Project, Handover type, Pack completeness %, Acceptance status, SLA status, Days waiting
- Sub-views: Missing documents, Waiting on Matriarch, Waiting on client, Completed

---

## 4. PROJECT LIST BLUEPRINT

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
- Weekly Update Status
- Handover Status
- Last Update
- 3-Month Review Status
- Margin Flag (ok / at risk)

### Stage-driven filters (replace department filters):
- **PD Pipeline** → stages 1–3 only
- **Execution** → stages 4–6 only
- **Closeout** → stages 7–9 only
- **Post-Handover** → stage 10 only

### Role toggles:
- **Exco toggle:** Only show projects with overdue gates, margin risk, rejected/reserved handovers, commissioning/billing readiness risk
- **Construction Manager toggle:** Projects in stages 6–9 where logged-in user is assigned Construction Manager. Shows: inflow status, installer compliance, schedule adherence, practical completion status
- **My Projects toggle:** Projects where logged-in user is PM, PD, Quality lead, or Construction Manager

### Actions:
- Open project
- Quick update
- Open current gate
- Open exception queue
- Open weekly update draft

---

## 5. PROJECT WORKSPACE SHELL — SIMPLIFIED TO 5 ITEMS

**This is the main thing the dev team must get right.**

### Screen: Project Overview (`/project/:projectId`)

**Purpose:** Single operational cockpit for the project. The user lands here, sees the blocker in 5 seconds, clicks Current Gate to action it. Two clicks to resolve.

### Layout:

**Top strip (Critical Control Panel — always visible, never moves):**
- Project identity (name, client, type, funding type)
- Current stage + gate status + RAG
- Next milestone date
- Owner map (PM, PD, Construction Manager, Quality Manager, KAM)
- **The one sentence that matters:** "Cannot progress because: X, Y, Z" / "Ready for approval" / "Waiting on: [person]"

**Top horizontal stage bar (always visible):**
- Visual lifecycle progression across all 10 stages
- Current stage highlighted
- Completed stages marked with check
- Clickable — clicking a completed or future stage opens that stage's workspace in read/preview mode

### Inside a project — 5 navigation items:

| Item | Route | What it shows |
|------|-------|--------------|
| **Overview** | `/project/:id` | The cockpit — gate readiness panel, "cannot progress because X", waiting-on, recent decisions, latest client update summary, key contacts |
| **Current Gate** | `/project/:id/gate` | The active stage workspace — whichever stage the project is in. One screen that dynamically renders the correct stage content (see Prompts 3 & 4 for per-stage detail) |
| **Timeline** | `/project/:id/timeline` | All 10 stages in sequence — completed/in-progress/upcoming, key dates (planned vs actual), evidence summary per stage, decision history per stage |
| **Files & Evidence** | `/project/:id/files` | All documents, evidence, certificates across all stages. Organized by stage, searchable, filterable by type |
| **History** | `/project/:id/history` | Decision log, meeting log, client update archive, action history, exception history, stage progression log |

### Why 5 items instead of 9:

**Old approach (9 items):** Overview, Current Gate, Commercial, Delivery, Quality, Compliance, Handover, Post-Handover, History — mixes stage views with department views. User browses departments.

**New approach (5 items):** Overview, Current Gate, Timeline, Files, History — everything is stage-driven. Department-specific content (quality checklists, compliance items, commercial data) appears WITHIN the Current Gate workspace, filtered by the logged-in user's role.

**How role-filtering works inside Current Gate:**
- The Quality Manager opens Current Gate on a project in commissioning → sees the quality checklist section prominently, with PM and engineering sections collapsed
- The PM opens the same screen → sees all sections, with their PM checklist at top
- The Compliance Manager opens it → sees SSEG/metering items prominently
- Everyone sees the full picture, but their responsibilities are visually prioritized

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
- KAM
- O&M status
- Next milestone date

### Overview page detail:

**Left / center column:**
- Current Gate card (readiness %, missing items, checklist progress by department)
- Missing items list (what's preventing progression)
- Waiting on (department + person + item)
- Recent decisions (last 5)
- Latest client update summary (date sent, next due, status)

**Right rail:**
- Pending approvals for this project
- Open exceptions for this project
- Open tasks (from workItems)
- Key contacts (PM, PD, CM, QM, KAM, client contact)
- Next meeting / next action

### Current Gate page detail:

This is the workhorse screen. It dynamically renders the stage workspace for whatever stage the project is currently in. The layout is always:

- **Top:** Stage header (stage name, owner, approver, status, readiness %, target exit date, "Request review" / "Approve / send back" buttons)
- **Main area:** Department checklists (organized by department, role-filtered for prominence), evidence upload area, stage-specific fields (see Prompts 3 & 4)
- **Right column:** Dependencies (waiting-on), open blockers, overdue items
- **Bottom:** Meeting log, decision log, notes

When the stage progresses, this screen automatically updates to show the next stage's workspace. The user never has to find the right screen — it's always "Current Gate."

### Timeline page detail:

- All 10 stages displayed vertically or horizontally
- Each stage shows: status (completed/in-progress/not started), start date, completion date, duration, key evidence uploaded, key decisions made
- Planned vs actual dates comparison
- Visual indicators for stages that took longer than expected
- Clickable — opens read-only view of that stage's completed workspace

### Files & Evidence page detail:

- All evidence and documents across all stages
- Organized by stage (collapsible sections)
- Filterable by: stage, document type (certificate, photo, report, minutes, approval), upload date
- Search by filename or description
- Evidence inheritance visible (shows which stage a document originated from)

### History page detail:

- Combined chronological log of:
  - Stage progressions (who moved it, when, from what to what)
  - Decisions made (from decision register)
  - Meetings held (with links to minutes)
  - Client updates sent
  - Exceptions raised and resolved
  - Approvals given
  - Key actions completed
- Filterable by: type, date range, person, stage
