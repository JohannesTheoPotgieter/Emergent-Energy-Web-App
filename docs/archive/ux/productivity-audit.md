# Behavior-Driven UX & Productivity Audit

**Date:** February 2026
**Core Principle:** The system must drive execution discipline, not feel like reporting admin.

---

## A) Observed Behavioral Friction

### 1. Home Screen Overload
The home page attempts to serve every role simultaneously. Users scanning for their next action must mentally filter through Company Priorities, Action Hub stats, My Projects, and notification lists. The signal-to-noise ratio is low for focused operational roles (PM, Engineer).

### 2. Project Detail Navigation Depth
Reaching a specific project's plan tab requires: Home → Projects → Click Project → Plan tab. That's 3-4 clicks minimum. PMs who live in plan data daily lose time navigating repeatedly.

### 3. Dual Dashboard Confusion
PMs are redirected to `/pm-dashboard` but can also reach `/` (Home). These two views show overlapping but different data. Users are unsure which is their "source of truth."

### 4. Finance Fragmentation
Financial information is split across COS Tracker, Revenue Tracker, COS Control, Cashflow, and Cashflow Forecast — five separate pages. Finance users must context-switch to build a complete picture.

### 5. Engineering Task Handoff Opacity
Engineering tasks transition through To Do → In Progress → Needs Approval → Approved, but the handoff between stages is not visually prominent. Approved-but-not-started tasks lack urgency signaling.

### 6. Quality Challenge Gate Friction
Quality Dashboard requires an access code challenge on every session. While security is valid, it creates friction for the Quality Manager who checks this dashboard multiple times daily.

### 7. Smart Import Requires Navigation Away
Users must leave their current context to go to `/smart-import`, upload, review, and commit — then navigate back. No indication on project pages that an import is pending or in progress.

---

## B) Where UX Feels Like Admin

1. **Plan Tab Editing:** Inline plan editing feels like spreadsheet data entry rather than strategic progress tracking. Users update percentages without connecting to milestones or outcomes.

2. **COS Tracker Monthly View:** The COS tracker presents dense financial tables without highlighting which line items need attention. Users scan entire tables to find exceptions.

3. **TR Register:** The action register is a flat table. Users process it row-by-row rather than being guided to the most critical or overdue items first.

4. **Notification Center:** Notifications are chronologically listed. Users must read through all to find actionable items vs. informational ones.

5. **Admin Roles Page:** The permission grid is comprehensive but overwhelming. Admins rarely need to change all permissions at once — most changes are single-role adjustments.

---

## C) Where UX Fails to Drive Action

1. **No "What Should I Do Next" Widget:** Users land on their home screen and must decide their own priorities. The system knows overdue tasks, pending approvals, and at-risk projects but doesn't synthesize this into a single prioritized action list.

2. **Overdue Tasks Not Escalated Visually:** Overdue items appear in lists but don't trigger visual escalation (pulsing, color changes, position changes). They blend into the regular task flow.

3. **Portfolio Health Not Pushed:** Portfolio-level risks are visible only when a user navigates to the portfolio page. Emerging risks (multiple projects behind schedule in the same portfolio) are not surfaced proactively.

4. **Engineering Bottlenecks Hidden:** When an engineer has 5+ active tasks, there's no workload balancing signal. Managers must manually check the standup view to spot overloaded team members.

5. **No Handover Prompts:** When a project phase changes, no automated prompt guides the next responsible party to pick up outstanding tasks.

---

## D) Hidden Risk Areas

1. **Stale Plan Data:** Projects with plan data older than 30 days without an update may silently go stale. No warning surfaces this.

2. **Revenue without COS:** Projects booking revenue but missing corresponding COS entries create invisible margin inflation.

3. **Orphaned Engineering Stages:** If a project moves to a new phase but engineering stages aren't updated, completion metrics become inaccurate.

4. **Unconfirmed Plan Changes:** Plan change tracker notifications await confirmation from 3 roles. If any role doesn't confirm, the change sits in limbo without escalation.

5. **Archived Projects with Active Tasks:** Auto-archiving after 90 days may catch projects that still have active engineering tasks or outstanding payments.

---

## E) Quick Wins (Low Dev Effort)

### E1. Prioritized Action List on Home
**Effort:** 2-3 hours
Combine overdue tasks, pending approvals, and unread action-required notifications into a single "Your Priority Queue" section, sorted by urgency. Show at most 5 items. This replaces cognitive scanning with a directed action list.

### E2. Overdue Visual Escalation
**Effort:** 1-2 hours
Add a red left-border and position overdue items at the top of every task list. Add "X days overdue" badge in red. Apply consistently across engineering tasks, operational tasks, and PD tickets.

### E3. Stale Data Warning Badge
**Effort:** 1-2 hours
On project cards and detail pages, show a yellow "Data may be stale — last import X days ago" badge when the most recent import is older than 14 days.

### E4. COS Exception Highlighting
**Effort:** 1 hour
In COS Tracker, highlight rows where variance exceeds ±15% in amber and ±25% in red. Move exception rows to the top of the table.

### E5. Quick Navigation Breadcrumbs
**Effort:** 1 hour
Add "Last visited project" quick-link on the home page so PMs can return to their most-used project in one click.

---

## F) Workflow Improvements (Medium Effort)

### F1. Smart Import Status on Project Detail
**Effort:** 4-6 hours
Show a small "Import Status" indicator on the project detail page header: last import date, whether an import is pending review, and a link to the import wizard pre-filtered to that project.

### F2. Unified Finance View
**Effort:** 6-8 hours
Create a single "Financial Health" tab that combines COS summary, revenue tracking, and cashflow projection for a single project. Reduces the 5-page fragmentation to one contextual view.

### F3. Engineering Workload Heatmap
**Effort:** 4-5 hours
On the Engineering Dashboard, add a visual heatmap or workload bar for each engineer showing their task count vs. capacity. Flag engineers with >5 active tasks in red.

### F4. Notification Categorization
**Effort:** 3-4 hours
Split notification center into tabs: "Action Required", "For Your Information", "Completed". Auto-categorize based on notification type. Action-required notifications should show the action button inline.

### F5. Phase Change Handover Checklist
**Effort:** 5-6 hours
When a project's phase changes on the lifecycle board, auto-generate a handover checklist for the incoming responsible party. Show pending handover items on their home screen.

---

## G) Structural Improvements (High Leverage)

### G1. Role-Specific Home Screen Layout
**Effort:** 2-3 days
Instead of one universal home page, render role-optimized layouts:
- **PM:** My projects (with progress), overdue tasks, pending confirmations
- **Engineer:** My assigned tasks (sorted by priority/deadline), approval status
- **Finance:** Cash position, COS exceptions, revenue at risk
- **COO/CEO:** Portfolio health, escalations, company priorities progress
Each layout shows only what that role needs to act on.

### G2. Project Health Score
**Effort:** 1-2 days
Compute a single 0-100 health score per project combining: schedule delta, COS variance, quality pass rate, engineering completion, and data freshness. Display as a colored badge on every project reference. This replaces the cognitive overhead of mentally combining 5+ metrics.

### G3. Automated Escalation Engine
**Effort:** 2-3 days
When conditions are met (task overdue >7 days, COS variance >25%, quality warning unresolved >14 days), automatically create escalation notifications for the next management level. Track escalation state and resolution.

### G4. Daily Digest Email
**Effort:** 1-2 days (with Outlook integration already in place)
Send each user a daily email summary at 7 AM: "You have X overdue items, Y pending approvals, Z projects behind schedule." Include direct links. This pulls users into the system with purpose rather than requiring them to check proactively.

---

## H) Role-Based Dashboard Recommendations

### Project Manager (PM_SITE)
**Current:** Redirected to PM Dashboard showing all assigned projects in cards.
**Recommendation:**
- Show top 3 priority actions above project cards (overdue tasks, pending approvals, stale imports)
- Add "Quick Update" button on each project card to jump directly to plan editing
- Show commissioning countdown for projects within 30 days
- Remove information they can't act on (financial details beyond spend %)

### Engineer
**Current:** No dedicated engineer home view; they use Engineering Tasks page.
**Recommendation:**
- Show "My Tasks" sorted by deadline with clear status badges
- Highlight tasks in NEEDS APPROVAL state (waiting on others)
- Show "Blocked" tasks prominently with blocker description
- Add daily/weekly task completion counter (gamification reinforcement)

### Quality Manager
**Current:** Quality Dashboard behind access code gate.
**Recommendation:**
- Cache QM access code for the session (don't require re-entry on page refresh)
- Show "Warnings requiring action" count on sidebar badge
- Add a "Quick Review" mode that presents items one-by-one for batch processing
- Surface quality pass rate trend (improving/declining) visually

### COO / CEO
**Current:** Full access to all pages; Home shows everything.
**Recommendation:**
- Lead with portfolio-level health indicators (projects behind, cashflow risk, quality failures)
- Show "Decisions Needed" section: pending approvals, escalations, phase change reviews
- Reduce noise from operational details they shouldn't be processing daily
- Add weekly trend indicators (improving/stable/declining) for key metrics

### Program Manager
**Current:** Full access; uses execution board and project list primarily.
**Recommendation:**
- Show cross-project task pipeline (total tasks by status across all projects)
- Highlight resource conflicts (same person assigned to overlapping deadlines)
- Add TR Register items assigned to them inline

### Finance Roles (CFO, PFM, Accountant)
**Current:** Access to all finance pages separately.
**Recommendation:**
- Lead with cashflow position and upcoming payment obligations
- Show COS exceptions requiring attention
- Provide invoice aging summary
- Surface revenue forecast accuracy trends

---

## I) Portfolio Oversight Enhancements

1. **Portfolio Risk Heatmap:** Show all portfolio projects in a grid where color intensity represents risk level (composite of schedule, cost, quality). Allow drill-down on any cell.

2. **Cross-Portfolio Comparison:** Enable side-by-side comparison of portfolio performance metrics. Useful for exec reviews.

3. **Portfolio Timeline Milestones:** Add key milestone dates (commissioning, handover) to portfolio-level Gantt view. Currently only available at project level.

4. **Portfolio Financial Summary Card:** Single card showing: Total Budget, Total Spent, Remaining, Projected Finish Cost. Available without entering the portfolio detail page.

5. **Portfolio Alert Digest:** When 2+ projects in the same portfolio are behind schedule, generate a portfolio-level alert rather than individual project alerts. This reduces notification noise and highlights systemic issues.

---

## J) Escalation Visibility Improvements

1. **Escalation Lane on Execution Board:** Add a dedicated "Escalated" column on the execution board. Items that have been overdue >7 days automatically move here with visual urgency markers.

2. **Escalation Chain Visualization:** For escalated items, show who was notified and when. Track response time. Surface items where no response has been received within 48 hours.

3. **COO Escalation Dashboard:** Dedicated section on COO home showing all active escalations across the organization, grouped by severity and age.

4. **Automated Escalation Rules:**
   - Task overdue 3 days → Notify owner (reminder)
   - Task overdue 7 days → Notify owner's manager
   - Task overdue 14 days → Notify COO
   - COS variance >25% → Notify Finance Manager + COO
   - Quality warning unresolved 14 days → Notify Quality Manager + COO

5. **De-escalation Tracking:** When an escalated item is resolved, record resolution time and resolution action. Feed this into performance metrics and the gamification system.

---

## Summary: Impact vs. Effort Matrix

| Recommendation | Impact | Effort | Priority |
|---------------|--------|--------|----------|
| E1. Priority Queue on Home | HIGH | LOW | DO FIRST |
| E2. Overdue Visual Escalation | HIGH | LOW | DO FIRST |
| E3. Stale Data Warning | MEDIUM | LOW | DO FIRST |
| E4. COS Exception Highlighting | MEDIUM | LOW | DO FIRST |
| E5. Quick Navigation | LOW | LOW | DO FIRST |
| F1. Import Status on Project | MEDIUM | MEDIUM | PLAN NEXT |
| F2. Unified Finance View | HIGH | MEDIUM | PLAN NEXT |
| F3. Engineering Workload Heatmap | MEDIUM | MEDIUM | PLAN NEXT |
| F4. Notification Categorization | HIGH | MEDIUM | PLAN NEXT |
| F5. Phase Change Handover | MEDIUM | MEDIUM | PLAN NEXT |
| G1. Role-Specific Home Layout | HIGH | HIGH | STRATEGIC |
| G2. Project Health Score | HIGH | HIGH | STRATEGIC |
| G3. Automated Escalation Engine | HIGH | HIGH | STRATEGIC |
| G4. Daily Digest Email | MEDIUM | HIGH | STRATEGIC |
