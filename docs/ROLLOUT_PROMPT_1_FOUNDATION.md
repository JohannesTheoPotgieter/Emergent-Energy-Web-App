# ROLLOUT PROMPT 1 OF 7 — FOUNDATION: OPERATING MODEL, LIFECYCLE SPINE, GATE ENGINE & ROLES

You are restructuring an existing React + Node + Supabase/Drizzle web app for Emergent Energy, a solar EPC and O&M company. The app already has 144 routes, role-based dashboards, financial modules, engineering workflows, quality/NCR tracking, handover packs, and a task management system.

**The job is not to rebuild from scratch. The job is to restructure the UX, navigation, and workflow control around the real project lifecycle stages and handoffs.**

## Design philosophy

**"One project journey, many role views, zero ambiguous handoffs."**

- Stage-led at the operating system level.
- Role-led at the user experience level.
- Collaboration-led in the handoffs between them.

The app must become a gate-driven project operating system where every role can instantly see: what stage the project is in, what is missing, who owns it, and whether it is allowed to move.

---

## 1. LIFECYCLE SPINE — 10 STAGES

Every project always has one current stage. The primary project spine is these 10 stages in order:

| # | Stage | Purpose |
|---|-------|---------|
| 1 | First Assessment | Qualify the opportunity — site viability, client fit, rough feasibility |
| 2 | Design & Cost Proposal Build | Ensure the proposal is accurate, buildable, commercially safe, and aligned to client need |
| 3 | Signature & Financial Close | Confirm the project is commercially live and executable |
| 4 | PD → PM Handover | Transfer complete project context into execution |
| 5 | Financial Review | Protect margin and forecast before execution pain arrives |
| 6 | Construction | Execute the build — manage inflows, installer relations, timelines, and plan adherence |
| 7 | Commissioning | Control the move from "installed" to "safe, tested, producing, proven" |
| 8 | O&M Handover | Transfer the site properly to Matriarch/O&M |
| 9 | Client Handover | Close the project with the client properly |
| 10 | 3-Month Post-Handover Review | Close the loop between promise and reality |

**Weekly Client Communication** is NOT a stage. It is a recurring obligation surfaced during stages 4–9. Overdue updates raise a health flag and appear on Exco dashboard.

Every project must always show:
- Current stage
- Next stage
- Gate status
- Blockers
- Overdue decisions
- Missing evidence
- Stage owner
- Approver
- Next milestone / next action
- Days in stage
- Days to next milestone

---

## 2. GATE ENGINE — SAME PATTERN EVERY STAGE

Each stage follows this identical operating pattern:

| Element | Description |
|---------|-------------|
| **Purpose** | What this stage is meant to achieve |
| **Inputs** | What must already exist from the prior stage |
| **Checklist** | Mandatory items to complete, organized by department (not one flat list) |
| **Evidence** | Docs, links, approvals, certificates, minutes, photos, trackers |
| **Decision** | Ready / Not Ready / Exception Approved |
| **Outputs** | What gets passed forward to the next stage |
| **Roles** | A (Accountable) / R (Responsible) / C (Consulted) / I (Informed) per stage |
| **Tools/Docs** | Exactly where the truth is read from |

Each stage has:
- One accountable owner
- Required contributors from other departments
- Cross-department sign-offs enforced by the system
- Bypass always allowed with reason (logged as exception)

---

## 3. GATE MODEL — ALL SOFT GATES WITH ADMIN OVERRIDE

**Every gate is a soft gate.** Any gate can be progressed, but:
- Only an **admin user** can override/bypass
- Admin **must provide a reason**
- The bypass is logged as a formal exception

**Gate statuses:**
`Not Started` → `In Progress` → `Ready for Review` → `Approved` → `Progressed` → `Exception Approved` → `Blocked`

**Cross-department sign-offs** are enforced by the system (system blocks progression until sign-offs are collected), but always allow bypass with reason. Every bypass creates an exception record.

**Exception records must capture:**
- Who approved the bypass
- Reason
- Risk level
- Mitigation text
- Deadline to close the exception
- Which downstream stage it could block if not resolved
- Conditions attached to the approval

---

## 4. CRITICAL CONTROL PANEL — TOP OF EVERY PROJECT

This sits at the top of every project page and never moves.

**Fields:**
- `current_stage_code`
- `current_stage_label`
- `gate_status` (Not Started / In Progress / Ready for Review / Approved / Progressed / Exception Approved / Blocked)
- `gate_readiness_pct`
- `stage_owner_user_id`
- `stage_owner_role`
- `approver_user_id`
- `approver_role`
- `waiting_on_department`
- `waiting_on_user_id`
- `next_required_action`
- `days_in_stage`
- `days_to_next_milestone`
- `open_exception_count`
- `open_blocker_count`
- `pending_approval_count`

**The one sentence that matters** — at the top, show one clear system sentence:
- "Cannot progress because: [missing items]"
- "Ready for approval"
- "Progressed under approved exception"
- "Waiting on: [department / person]"

That is the operational truth.

---

## 5. V1 ROLES & DEPARTMENT STRUCTURE

### Departments and roles in V1:

| Department | Roles | Notes |
|-----------|-------|-------|
| **Exco** | CEO, COO, CFO | Strategic oversight, exception approvals, blocked gate view |
| **Project Development (PD)** | Project Developer, Head of PD | Owns stages 1-3, contributes to stage 4 |
| **Engineering** | Engineering Manager, Design Engineer, Engineer | Design, technical review, commissioning checks, lessons learned |
| **Project Management** | Program Manager, Project Manager, Construction Manager | PM owns stages 4-9. Construction Manager under PM — owns oversight from Construction (stage 6) through Client Handover (stage 9), manages inflows/timelines, installer relations |
| **PM sub-functions** | HSE (under PM), SSEG/Compliance (under PM), Procurement (under PM) | HSE: construction + commissioning safety. Compliance: SSEG, RMA, authority approvals. Procurement: PO/supplier management |
| **Quality** | Quality Manager | Commissioning governance (dual ownership with PM), QC checklists, NCRs, snags, handover quality |
| **Finance** | Program Finance, Accountant | Financial close, financial review, billing readiness, margin tracking |
| **KAM** | Key Account Manager | Standalone role. Owns post-handover client relationship, 3-month reviews, after-sales opportunity, unresolved client concerns |
| **O&M / Matriarch** | Asset Manager, O&M representative | Receives O&M handover, acceptance decision, monitoring, targets |

### Construction Manager detail:
- Falls under Project Management
- In charge of inflows — ensures materials, equipment, and subcontractors arrive on time
- Ensures plans go accordingly during build phase
- Becomes oversight of projects between Construction phase (stage 6) and Client Handover (stage 9)
- In charge of installer relations (subcontractor coordination, quality of work, scheduling)

### Commissioning dual ownership:
- PM owns operationally (scheduling, coordination, evidence collection)
- Quality Manager is governance control (acceptance criteria, defect review, sign-off authority)

### 3-Month Post-Handover Review:
- Owner is **assignable per project** at the point of client handover acceptance
- Not fixed to a role — could be KAM, PM, or Matriarch depending on project

---

## 6. EXISTING CODEBASE TO BUILD ON

**Do not rebuild from scratch.** Extend these existing foundations:

| What exists | Where | How to use it |
|------------|-------|---------------|
| Project identity & metadata | `shared/schema/projects.ts` → `projectInfo` table | Keep as-is, extend with stage references |
| Phase/lifecycle tracking | `shared/schema/projects.ts` → `projectExecutionState` table | Extend with new stage fields, gate status, stage owner, approver |
| Handover packs (pd_to_pm, practical_completion, client_handover, matriarch_handover, sseg_closeout) | `shared/schema/handover.ts` → `handoverPacks`, `handoverChecklistItems`, `ssegItems` | Build stage workspaces on top of these |
| Task management | `shared/types/unified-task.ts` → `UnifiedTask`, `shared/schema/tasks.ts` → `workItems` | This IS the execution backbone — ClickUp is being replaced |
| Quality (QC templates, NCRs, checklists) | `shared/schema/quality.ts` | Integrate into commissioning stage workspace |
| Financial modules (cashflow, COS, revenue, GP) | `shared/schema/finance.ts` + financial pages | Feed into Financial Review and Financial Close workspaces |
| PD-PM Handover v2 | Recently landed — extend, do not replace |
| Financial Review routes | Recently landed — extend, do not replace |
| Role-based home page | `client/src/pages/home.tsx` + `client/src/config/role-dashboard-config.ts` | Restructure content to be stage-driven |
| Navigation | `client/src/config/app-navigation.ts` | Replace structure (see Prompt 2) |
| Page registry (144 routes) | `client/src/config/page-registry.ts` | Add new routes, keep existing where still relevant |
| UI component library | `client/src/components/ui/` (40+ shadcn components) | Use for all new screens |
| Permission system | `shared/schema/users.ts` → roles, permissions | Extend with new permission entities for stages |

---

## 7. DATA REUSE — PULL ONCE, REUSE EVERYWHERE

**Rules:**
- Only ask for data once, then reuse it across stages
- Stage workspaces should mostly read existing truth and only ask users to capture: decision, exception, missing item owner, meeting notes, approval
- Auto-generate meeting packs from project records instead of retyping notes
- Turn approvals into simple accept/reject/comment actions, not forms
- Use defaults, prefilled templates, and evidence inheritance from earlier stages (e.g., proposal docs feeding commissioning appendices and handover packs)
- Map every stage field to one of: imported tracker field, project record, SharePoint doc, generated field, or manual entry only where unavoidable

---

## 8. NON-NEGOTIABLE PRINCIPLES

1. **Do not break existing working features.** All changes are additive or extensions.
2. **Do not create admin sludge.** If the data already exists, read it — don't make users re-enter it.
3. **Every screen answers these 5 questions:** Where are we? What must be true to leave this stage? What is missing? Who is waiting on whom? What decision is next?
4. **Collaboration appears as shared responsibility with explicit boundaries:** One owner. Named contributors. Due-by dates. Visible status. Escalation if overdue. Acceptance when complete.
5. **The real value is in making cross-department obligations visible and unavoidable before the project moves forward.**
