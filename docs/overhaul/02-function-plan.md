# 02 — Function Plan

**Phase 2 primary deliverable.** Per-function improvement plans, grouped by lens, prioritised by daily-usage weight.

> **Status:** In progress — plans land in small checkpoints, Tier 1 first.
> **Ground truth:** `00-inventory.md` (what exists) · `01-wireframes.md` (layout direction) · `01-design-system.md` (tokens + primitives + hooks).
> **Protocol:** STOP after each lens's plan is complete. Approve per-lens before Phase 3 implementation.

---

## §1 Method

One entry per **function** — not per page, not per endpoint. A function is one thing a user does (view the gates pipeline, create a priority, approve a PO). Some pages host multiple functions (Project Detail has ~8 tab functions); some "pages" in `PAGE_REGISTRY` are aliases to another function and get no separate entry.

### §1.1 Entry template

Every entry follows this shape. Keep entries tight — 150–250 words each.

```
### F-NNN · Function name
- Path(s):          primary route · any aliases from PAGE_REGISTRY
- Lens (primary):   role that owns this function daily
- Lens (secondary): roles that read/use it
- Archetype:        W1–W6 (AppShell / Dashboard / List / Detail / Form / MyWork)
- User goal:        one sentence — what the user is trying to accomplish here
- Current state:    2–3 lines — visual + behavioural summary
- Data source:      canonical · legacy · mixed (with file:line reference for mixed)
- Visual improvements:
  • 3–5 concrete changes referencing design-system primitives
- Additive functional improvements:
  • 3–5 new affordances; no removals; no behaviour changes
- Half-built work to finish:
  • reference into 00b-half-built.md if applicable, else "n/a"
- Source-of-truth migration:
  • reference into 00c §4 TODO if applicable, else "n/a — already canonical"
- Preserved behaviour contract:
  • explicit list of existing behaviour that must not change
- Risk:    low · medium · high
- Effort:  S · M · L
```

### §1.2 Function numbering

Functions are numbered `F-001 …` in approval order, not by lens. This makes cross-references stable across checkpoints and gives the Phase 3 implementation a single sequence to work through.

### §1.3 Prioritisation within a lens

Inside a lens, sort by:

1. **Daily-usage weight** — the function the role touches most often.
2. **Source-of-truth migration priority** from `00c §4`.
3. **Visible inconsistency** — functions where the current visual is farthest from the archetype target.
4. **Half-built references** — finishing flagged features.
5. **Everything else.**

### §1.4 Scope boundaries

Entries **do not**:

- Propose removals, renames, or breaking API changes (overhaul rule).
- Change behaviour — "visual" and "additive" only.
- Specify pixel-level visuals — that's the primitive's job. They specify primitives and composition.
- Re-plumb data when canonical reads already exist (per `00c` the migration is largely done).

Entries **do**:

- Say which archetype the function maps to.
- Identify the design-system primitives the function should use.
- Call out any half-built work to close.
- Enumerate the preserved-behaviour regression list.

### §1.5 What gets no entry

Some PAGE_REGISTRY rows don't need plans:

- **Aliases** — redirect-only entries in PAGE_REGISTRY (e.g. `/revenue` → `/revenue-tracker`) and LEGACY_REDIRECTS. The destination gets the plan; the alias is tracked in the entry's "Path(s)" field.
- **Retired surfaces** — labelled `(Retired)` in the registry. No plan; flagged if removal is proposed (requires sign-off).
- **Pure parametric details** — `/project/:projectName/gate/:stageCode` etc. are sub-functions under a parent detail page. They're noted inside the parent entry, not separately.
- **Admin/diagnostic utilities** reached only via direct URL (most `SYSTEM` section pages). These get lightweight entries in a single Tier-4 block, not one-each.

Net effect: ~50–60 real function entries across the whole platform.

### §1.6 Per-lens approval gates

Protocol per overhaul prompt §"Phase 2":

- Each lens's plan ends with a short summary (function count, total effort, identified risks).
- **STOP** after each lens. Wait for approval before drafting the next.
- User can redirect scope, priority, or entries mid-lens.
- Once a lens is approved, it becomes Phase 3 input — implementation can start on that lens independently of later lenses.

---

## §2 Lens ordering

Tier 1 (daily cross-surface) first — these are the functions every weekday user lives inside.

### Tier 1

| Order | Lens | Rationale |
|---|---|---|
| **1** | `PROGRAM_MANAGER` | Cross-cutting edit rights; ~25 primary functions; most blocking for Phase 3 |
| **2** | `PROJECT_MANAGER_SITE` | Daily mobile + desktop; PM On-The-Go already discrete |
| **3** | `CFO` / `PROGRAM_FINANCE_MANAGER` / `ACCOUNTANT` (combined) | Finance is one plan — same pages, different edit rights |
| **4** | `COO_ADMIN` / `CEO_ADMIN` (combined) | Exec + admin oversight |

### Tier 2

| Order | Lens | Rationale |
|---|---|---|
| 5 | `CONSTRUCTION_MANAGER` | Field-heavy; HSE / Quality / Commissioning overlap |
| 6 | `ENGINEERING_MANAGER` + `ENGINEER` (combined) | Engineering is a narrow domain; plan together |
| 7 | `CCO` + `KEY_ACCOUNTS_MANAGER` + `PROJECT_DEVELOPER` (combined) | PD is one sales-to-delivery bridge; plan together |

### Tier 3

| Order | Lens | Rationale |
|---|---|---|
| 8 | `QUALITY_MANAGER` | Narrow, domain-specific |
| 9 | `HSE_MANAGER` + `SSEG_MANAGER` (combined) | Compliance-focused |

### Tier 4

| Order | Lens | Rationale |
|---|---|---|
| 10 | Admin / system utilities | Single batch — low user traffic, similar treatment |

---

## §3 Tier 1 · Lens 1 — `PROGRAM_MANAGER`

**Role summary:** Cross-project delivery lead. Landing: `/execution-board`. The single most cross-cutting edit role — 25+ primary functions across gates, lifecycle, approvals, standups, handovers, projects, counterparties, procurement.

**Function count for this lens:** 22 primary functions + 8 Gates sub-lanes + 3 detail pages.

**Lens-level archetype mix (from `00-inventory.md §5.1`):**

- 1 Dashboard — Execution Board
- 1 Dashboard — Lifecycle Board
- 1 Dashboard — Gates Pipeline
- 7 Lists — Gates sub-lanes (Blocked / Ready / Exceptions / Client Updates / Handover Queue / Open Queries / Commitments)
- 2 Lists — Projects, Milestone Tracker
- 2 Lists — Approvals, Financial Review Queue
- 3 Details — Project Detail, Handover Control, Handover & Closeout
- 3 Lists — PO Approvals, Payment Requests, Payment Batches
- 2 Detail / dashboards — Portfolios (list) + Portfolio Detail
- 1 List — Weekly Reviews (Program Manager reviews submitted weeks)

**Upcoming checkpoints for this lens** (each checkpoint ≈ 4–6 functions):

1. **Dashboards** — Execution Board, Lifecycle Board, PM Dashboard (used by PM-Site but Program Manager reads)
2. **Gates — spine** — Gates Pipeline + one representative sub-lane (Blocked), with notes applying to the 7 sub-lane set
3. **Gates — remaining sub-lanes** — Ready / Exceptions / Client Updates / Handover Queue / Open Queries / Commitments
4. **Projects domain** — Projects list, Project Detail (with its 8 tabs), Sites, Clients list + detail
5. **Approvals domain** — Approvals, Financial Review Queue, Weekly Reviews
6. **Handover & Milestones** — Milestone Tracker, Handover Control, Handover & Closeout
7. **Procurement domain** — PO Approvals, Payment Requests, Payment Batches
8. **Portfolios** — Portfolios list + Portfolio Detail
9. **Lens summary** — risks consolidated, Phase 3 ordering recommendation, STOP for approval

---

**End of §1 scope + §2 ordering + §3 Lens 1 roster.**

---

### §3.1 Lens 1 · Batch 1 — Dashboards

#### F-001 · Execution Board

- **Path(s):** `/execution-board` (primary) · aliases `/execution-dashboard`, `/dashboard` (LEGACY_REDIRECTS) · `matchSubRoutes: true` — `/execution-board/program`, `/execution-board/finance`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** `COO_ADMIN`, `CEO_ADMIN`, `CONSTRUCTION_MANAGER`, `PROJECT_MANAGER_SITE` (also landing page for all 5)
- **Archetype:** W2 Dashboard
- **User goal:** Read the state of every active project at a glance; drill into any that needs attention.
- **Current state:** Multi-page `execution-dashboard/` directory with Overview, Program, Construction, Realisation KPI sub-pages (`client/src/pages/execution-dashboard/`). Content-rich; layout inconsistent across sub-pages; density varies.
- **Data source:** Canonical (`project_info` + `project_execution_state` + `normalized_cost_lines` + `normalized_revenue_lines`). See `00c §2` Projects + Costs + Revenue tables.
- **Visual improvements:**
  - Adopt W2 structure uniformly across all 4 sub-pages: status strip → primary grid → secondary panels → full-width.
  - Replace ad-hoc card layouts with the shared `Card` primitive and `ee-page` container.
  - Unify status indicators to `StatusBadge` (dot/chip/pill) — no raw coloured text.
  - Add `DataTrustBadge` strip below PageHeader (mandatory per §1.3 of design system).
  - Consolidate stacked section headings into `ee-section-title` class for consistency.
- **Additive functional improvements:**
  - Persist selected sub-tab in URL query param so deep-links share the same view.
  - Add keyboard shortcut `g p` / `g c` / `g f` / `g r` to jump between sub-pages.
  - Column-fold toggle for users on narrower viewports.
  - "Last touched" filter preset surfaced from existing data.
- **Half-built work to finish:** n/a directly; indirectly related to `task_management_hub` flag (`00b §A` top-5 #2) which surfaces `/my-work/tasks` — doesn't block.
- **Source-of-truth migration:** n/a — already canonical.
- **Preserved behaviour contract:**
  - 5 landing roles (PROGRAM_MANAGER, COO_ADMIN, CEO_ADMIN, CONSTRUCTION_MANAGER, PROJECT_MANAGER_SITE) still land here.
  - Aliases `/execution-dashboard`, `/dashboard` resolve to this page.
  - Sub-page routing (`/program`, `/finance`) continues to work.
  - `matchSubRoutes: true` flag honoured for nav highlight.
  - Existing `ExecutionBoardPage` + `execution-dashboard/*` components remain importable.
- **Risk:** Medium — high-traffic, 5 landing roles, easy to regress.
- **Effort:** L — spans 4 sub-pages.

#### F-002 · Lifecycle Board

- **Path(s):** `/lifecycle-board` (primary) · alias `/project-lifecycle` (LEGACY_REDIRECTS)
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** `COO_ADMIN`, `CEO_ADMIN`, `CCO`, `CFO`, `PROGRAM_FINANCE_MANAGER`, `CONSTRUCTION_MANAGER`, `QUALITY_MANAGER`, `ENGINEERING_MANAGER`, `KEY_ACCOUNTS_MANAGER`, `PROJECT_MANAGER_SITE`, `PROJECT_DEVELOPER`, `HSE_MANAGER`, `SSEG_MANAGER` — broad view scope
- **Archetype:** W2 Dashboard (matrix-style)
- **User goal:** See every project's position on the stage-gate lifecycle, identify where each is blocked.
- **Current state:** `client/src/pages/lifecycle-board.tsx` renders a wide matrix of projects × stages with gate status badges. Dense but legible; mobile rendering cramped.
- **Data source:** Canonical (`project_execution_state.phase`, `gate_status`, `financial_review_status`). Already on canonical — see `00c §2` Projects.
- **Visual improvements:**
  - Standardise gate-state cells with `StatusBadge` dot variant.
  - Sticky column for project name + code (so horizontal scroll keeps context).
  - Add `PageHeader` with summary counts (total / blocked / ready / at-risk).
  - Dark-mode pass — current matrix hard-codes light backgrounds in some cells.
  - Add "Show only my projects" toggle using existing role-scoped project list.
- **Additive functional improvements:**
  - Cell click opens the project's gate-detail page in a Drawer (not full navigation) for quick triage.
  - Keyboard arrows move focus across the matrix for scan-reading.
  - Export matrix to PNG / PDF for weekly ops reports (uses existing `ExportDropdown`).
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS entry `/project-lifecycle` → `/lifecycle-board` preserved.
  - Gate-status click-throughs to project stage-gate page continue to work.
  - 14 view roles retain access.
- **Risk:** Low.
- **Effort:** M.

#### F-003 · PM Dashboard

- **Path(s):** `/pm-dashboard`
- **Lens (primary):** `PROJECT_MANAGER_SITE` (landing — will revisit in Lens 2)
- **Lens (secondary):** `PROGRAM_MANAGER` reviews Site-PM status; plan this entry from PM lens perspective.
- **Archetype:** W2 Dashboard (site-PM focused)
- **User goal:** A Site-PM opens this as their daily home; reads their own project's state + their own task queue + their own approvals.
- **Current state:** `client/src/pages/pm-dashboard.tsx`. Scoped to the logged-in PM. Layout mixes tiles, lists, and a calendar strip. Mobile-first origin visible in structure.
- **Data source:** Canonical (`work_items` filtered by assignee + `project_info` filtered by PM).
- **Visual improvements:**
  - Adopt W6 "My Work" structure (Today's focus + action queues + this-week strip) on top of project-scoped content — this is an operational-home dashboard, not a portfolio dashboard.
  - Consolidate top cards into a single `ee-data-trust-grid` KPI strip.
  - Unify action rows across queues (each action uses `Button variant="ghost" size="sm"`).
- **Additive functional improvements:**
  - Cross-link to `/pm/on-the-go` for mobile field workflow (already exists — make the entry point first-class).
  - Weekly burn-down chart (additive — uses existing `Chart` primitive).
  - "Escalate to Program Manager" quick action on overdue items.
- **Half-built work to finish:** Related to `task_management_hub` (00b §A #2) — when enabled, this page becomes a lens-specialised view of that hub.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Scoped to logged-in PM (server-side filter), not all projects.
  - `pm_dashboard` permission entity defaults unchanged — view gated per existing roles.
  - Quick actions that currently work (task create, standup add) still work.
- **Risk:** Low.
- **Effort:** M.

**End of batch 1.** 3 functions recorded.

---

### §3.2 Lens 1 · Batch 2 — Gates spine (Pipeline + Blocked)

The Gates workspace is 8 pages in the `GATES` nav group. They share an archetype — list-view with gate-specific columns and filters. This batch plans the two "spine" pages in detail; the remaining 6 sub-lanes inherit the same plan with per-lane filter/column differences — they're entered in §3.3.

#### F-004 · Gates Pipeline

- **Path(s):** `/gates` (primary) · alias `/dashboard` (LEGACY_REDIRECTS) · `matchSubRoutes: true`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** All 14 roles with `lifecycle` view (COO/CEO/CCO/CFO/PM/PFM/CM/QM/EngM/KAM/PMS/PD/HSE/SSEG)
- **Archetype:** W3 List
- **User goal:** See every gate across the portfolio at a glance, sorted by the most time-sensitive.
- **Current state:** `client/src/pages/gates/gates-pipeline.tsx`. Dense table per gate with state chips. Toolbar + filters + export present. Quality of filter persistence inconsistent vs sub-lane pages.
- **Data source:** Canonical (`project_execution_state` — phase, gate_status, gate_severity, age). Already canonical.
- **Visual improvements:**
  - Adopt W3 `TableLayout` composition once the primitive ships (Phase 3).
  - Active-filter chip row below toolbar (existing inline chips become the canonical pattern).
  - Replace raw coloured text cells with `StatusBadge` chip variants.
  - Sticky header confirmed via existing `index.css:493-501`; ensure horizontal scroll preserves sticky.
  - Dense-row mode toggle (44px → 36px) for power users; respects accessibility minimum via `data-density` attribute.
- **Additive functional improvements:**
  - Saved views per user — persist filter + sort to server-side `user_dashboard_preferences` (existing table).
  - Bulk reassign to another owner (opens `ConfirmDialog` with count).
  - "Snooze until" on a gate row — sets a server-side reminder visible in My Work.
  - Export canonical CSV / XLSX with trust envelope in footer (per design-system W-C4 rule).
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS `/dashboard` → `/gates` continues.
  - `matchSubRoutes: true` keeps nav highlight through sub-lanes.
  - All 14 view roles retain access.
  - Sidebar sub-items for Blocked / Ready / Exceptions / etc. still render.
- **Risk:** Low–medium — it's the default landing after the `/dashboard` collapse, so regressions affect everyone.
- **Effort:** M — most composition already exists.

#### F-005 · Blocked Gates

- **Path(s):** `/gates/blocked` · also reached from alias `/exceptions` (no — that one redirects to `/gates/exceptions`)
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** all 14 `lifecycle` view roles; primary attention from CCO/COO/PM/PMS (they act on blockers)
- **Archetype:** W3 List (sub-lane of F-004)
- **User goal:** See only blocked gates — who's blocked, how long they've been blocked, who can unblock.
- **Current state:** `client/src/pages/gates/gates-blocked.tsx`. Lane-filtered version of Pipeline. Same table as F-004 pre-filtered to `gate_status='blocked'`.
- **Data source:** Canonical (same as F-004).
- **Visual improvements:**
  - Inherit every F-004 visual improvement (shared archetype).
  - Blocker column becomes the prominent secondary identifier (bold, left-aligned, in `ee-surface-muted` card).
  - "Blocked for" age column with RAG-coloured age chips (green <3d, amber 3–7d, red >7d) — `StatusChip` variants.
  - PageHeader sub-line surfaces aggregate "12 blocked · oldest 19 days · R 48M locked" — high-level impact visible.
- **Additive functional improvements:**
  - Inline "Add unblock note" row action — opens Drawer with pre-filled template; posts to canonical gate activity log.
  - "Mark ready" action when unblock criteria met — transitions to `/gates/ready` via a state change through repository layer (no direct table writes in route).
  - Email escalation to the blocker-owner (single-click from row) uses existing MS Graph mail send.
- **Half-built work to finish:** n/a — but closely connected to the half-built `/admin/handover-health` backend endpoint (00b §A #3) if escalation targets include handover-stage blockers.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Lane filter (`gate_status='blocked'`) stays a server-side filter — never client-only.
  - Sidebar item remains under GATES nav group.
  - Severity/age sort order preserved.
- **Risk:** Low.
- **Effort:** M.

**End of batch 2.** 2 functions recorded.

---

### §3.3 Lens 1 · Batch 3 — Gates remaining sub-lanes

Six sub-lane pages. All inherit the F-004 archetype + F-005 visual-improvement pattern. This batch records per-lane differences only. Each is a lane-filtered `W3 List` on `project_execution_state` or related canonical tables.

**Shared attributes** (all six):

- Lens (primary) — `PROGRAM_MANAGER`
- Lens (secondary) — 14 `lifecycle` view roles
- Archetype — W3 List
- Data source — canonical
- Effort — S (each one; inheritance keeps work small)
- Risk — Low
- **Shared Preserved behaviour** — each sub-lane remains sidebar-visible; permission entity `lifecycle` unchanged; route paths unchanged; server-side lane filter preserved.
- **Shared additive behaviour** — saved views, bulk actions, CSV export, snooze-until (all from F-004 inheritance).

#### F-006 · Ready Gates — `/gates/ready`

- **User goal:** Find gates ready to advance — hand them to the review owner.
- **Current state:** `gates-ready.tsx`. Lane filter = `gate_status='ready'`.
- **Per-lane visual:** Add "Promote to next stage" primary inline action (opens `ConfirmDialog`); age column becomes "Ready since" descending.
- **Per-lane additive:** "Batch promote eligible" bulk action — promotes multiple gates in one confirmed action (uses canonical state transition).

#### F-007 · Gate Exceptions — `/gates/exceptions`

- **User goal:** See projects with exceptions raised at a gate (failed criteria, deferred decision).
- **Current state:** `gates-exceptions.tsx`. Lane filter = exceptions-flagged rows. Legacy route `/exceptions` redirects here (LEGACY_REDIRECTS).
- **Per-lane visual:** Exception reason as primary identifier column; severity chip (`StatusBadge` chip variant).
- **Per-lane additive:** "Assign exception to" row action (drops a linked `work_items` row to the assignee's My Work).
- **Preserved behaviour:** LEGACY_REDIRECTS `/exceptions` → `/gates/exceptions` continues to resolve.

#### F-008 · Client Updates — `/gates/client-updates`

- **User goal:** Track every client-facing update commitment and its due date.
- **Current state:** `gates-client-updates.tsx`.
- **Per-lane visual:** "Next update due" column as primary RAG (green ≥3d, amber 1–3d, red <24h / overdue); client column sticky-left alongside project.
- **Per-lane additive:** "Mark update sent" row action logs an audit entry to `project_info.updates` (or equivalent canonical table — confirm in Phase 3 per actual schema).

#### F-009 · Handover Queue — `/gates/handovers`

- **User goal:** Ready-to-handover gates waiting on PM acceptance or PD→PM sign-off.
- **Current state:** `gates-handovers.tsx`.
- **Per-lane visual:** Readiness % column (uses `Progress` primitive); handover status chip (not started / in progress / pending sign-off / signed).
- **Per-lane additive:** Deep-link to `/pd/handover/:projectId` or `/pm/handover-review` per row state. Tied to F-016 Handover Control entry (batch 6).

#### F-010 · Open Queries — `/gates/queries`

- **User goal:** Client or internal queries blocking decision progression.
- **Current state:** `gates-queries.tsx`.
- **Per-lane visual:** Query age column, owner column, "awaiting response from" column (client vs internal).
- **Per-lane additive:** Inline reply-via-email (Outlook integration through existing MS Graph) — pre-fills reply with query context.

#### F-011 · Client Commitments — `/gates/commitments`

- **User goal:** Every commitment made to a client and whether it's being honoured.
- **Current state:** `gates-commitments.tsx`.
- **Per-lane visual:** Commitment text as primary identifier; honour-status chip (on track / at risk / missed); due-date sort asc.
- **Per-lane additive:** "Flag at-risk" row action escalates to COO via server-side notification.

**End of batch 3.** 6 functions recorded (F-006 through F-011).

---

### §3.4 Lens 1 · Batch 4 — Projects domain

#### F-012 · Projects list

- **Path(s):** `/projects`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** All 16 roles (view); edit roles per `projects` entity — Admin, CCO, PM, PFM, CM.
- **Archetype:** W3 List
- **User goal:** Browse every project; filter, sort, and open a specific one.
- **Current state:** Primary landing surface for project navigation. Existing dense table with filters, sort, pagination. Some columns vary per role.
- **Data source:** Canonical — `project_info` + `project_execution_state`.
- **Visual improvements:**
  - Adopt W3 `TableLayout` composition (Phase 3).
  - Active-filter chip row below toolbar.
  - Standardise RAG column to `StatusBadge`.
  - Tabular-nums on Value column; right-aligned.
  - Sticky first 2 columns (Code + Name) on horizontal scroll.
- **Additive functional improvements:**
  - Saved views per user.
  - Quick-peek Drawer on row action that shows Project summary without leaving the list.
  - "Create similar project" row action — opens project-create wizard pre-filled.
  - Bulk export (uses `ExportDropdown` with trust envelope footer).
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - All 16 view roles retain access.
  - Edit action visibility follows `projects` permission entity edit roles.
  - Existing row-click → Project Detail unchanged.
- **Risk:** Low.
- **Effort:** M.

#### F-013 · Project Detail (with 8 tabs)

- **Path(s):** `/project/:projectName` (primary). Sub-routes: `/project/:projectName/financial-linking` (F-013a — treated as dedicated function since it has its own permission entity `financial_linking`), `/project/:projectName/gate/:stageCode` (F-013b — parametric sub-function within the Detail).
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** All 16 roles (scoped view + scoped edit per sub-tab).
- **Archetype:** W4 Detail
- **User goal:** A single project's full state — any role drills in to see and act on their domain of it.
- **Current state:** Rich detail page with multiple visual patterns across tabs. Layout inconsistent between Overview vs Finance vs Engineering vs Documents.
- **Data source:** Canonical — per-tab:
  - Overview: `project_info` + `project_execution_state`
  - Tasks: `work_items` filtered to project
  - Finance: `normalized_cost_lines` + `normalized_revenue_lines` + `approvals` (financial_review category)
  - Engineering: `work_items` filtered to ENG workstream
  - Quality: `quality` entity tables (audit during Phase 3)
  - HSE: `hse` entity tables
  - Documents: `documents` via MS Graph metadata (stored as links only, never bodies per CLAUDE.md)
  - Log: project audit events via canonical activity log
- **Visual improvements:**
  - Adopt W4 `DetailLayout` composition with sticky-compress summary header + tabs + tab content.
  - Summary KPI strip: RAG / Value / GP margin / Next gate / Go-live (per wireframe W4).
  - URL-reflective tabs (`?tab=finance`) for deep-linking.
  - Per-tab content adopts matching archetype — Tasks tab = W3 table, Finance tab = W3 table with trust strip, Documents tab = grid, Log tab = timeline.
  - Tab count badges (e.g., `Tasks (23)`).
- **Additive functional improvements:**
  - Tab content lazy-loads — faster initial render.
  - "Follow" toggle per project (adds to My Work → Watching tab).
  - Inline comment thread in Log tab for out-of-channel notes that shouldn't go to Teams.
  - Breadcrumb-level "copy deep link" action.
- **Half-built work to finish:** n/a (but indirectly affects `/admin/handover-health` backend work — F-013 Handover tab triggers the scoring that page reads).
- **Source-of-truth migration:** n/a — all per-tab canonical.
- **Preserved behaviour contract:**
  - Per-tab permission gates preserved (e.g., Finance tab needs `financials` view).
  - Sub-route `/project/:projectName/financial-linking` resolves to the Financial Linking function (F-013a).
  - Sub-route `/project/:projectName/gate/:stageCode` resolves to the Gate Detail function (F-013b).
  - Existing `ProjectDetailPage` component export remains importable.
- **Risk:** High — broadest surface in the platform, 8 tabs × permission variance.
- **Effort:** L — largest in Phase 3 for this lens.

#### F-013a · Project Financial Linking

- **Path(s):** `/project/:projectName/financial-linking`
- **Lens (primary):** `CFO` (edit) · `PROGRAM_MANAGER` (view-context)
- **Archetype:** W3 List (within project detail context)
- **User goal:** Link project's imported finance lines to QuickBooks invoices or manual journal entries.
- **Current state:** `client/src/pages/financial-linking.tsx`. Dense grid per line; separate permission entity `financial_linking` (edit: Admin + CFO only).
- **Data source:** Canonical — `normalized_cost_lines` + `normalized_revenue_lines` + QB link metadata.
- **Visual improvements:** Adopt W3 composition; unlinked-first default sort; trust strip mandatory; tabular-nums on money columns.
- **Additive functional improvements:** Bulk auto-link (pattern-match by reference); one-row-undo last link.
- **Preserved behaviour:** CFO-only edit; accessible from Project Detail tab.
- **Risk:** Medium — finance write.
- **Effort:** M.

#### F-013b · Project Stage Gate detail

- **Path(s):** `/project/:projectName/gate/:stageCode`
- **Archetype:** W4 Detail (parametric sub-function of F-013)
- **User goal:** Drill into a single gate's state and act on it.
- **Current state:** Route exists; rendered via `ProjectStageGatePage`. Content consists of stage criteria checklist + activity log + sign-off.
- **Data source:** Canonical — `project_execution_state` + `work_items` filtered to stage.
- **Visual improvements:** DetailLayout summary strip (stage name / phase / readiness % / blocker / owner); tabs for Criteria / Activity / Sign-off.
- **Additive:** "Go to next unready criterion" keyboard shortcut (`j`); stage comparison against template.
- **Preserved:** Permission entity `stage_lifecycle`; accessible from F-004 Gates Pipeline cells and from F-013 summary.
- **Risk:** Low.
- **Effort:** S.

#### F-014 · Sites

- **Path(s):** `/sites`
- **Lens (primary):** `PROGRAM_MANAGER`, `CONSTRUCTION_MANAGER`
- **Archetype:** W3 List
- **User goal:** List of physical sites (may be 1:1 with projects or 1:N — some projects have multi-site).
- **Current state:** `client/src/pages/` — Phase B addition (registry line 193).
- **Data source:** Canonical — `sites` table (confirm schema domain in Phase 3).
- **Visual improvements:** Standard W3 composition; map-view toggle (uses existing `Chart` primitive — additive, not replacing table).
- **Additive:** Location clustering; "sites needing HSE check" filter preset.
- **Preserved:** `projects` permission entity shared with Projects list.
- **Risk:** Low.
- **Effort:** S–M (depends on map integration scope).

#### F-015 · Clients (list + detail)

- **Path(s):** `/clients` (list) · `/clients/:clientId` (detail) · `/clients/:clientId/project/:projectId` (detail → project departments view)
- **Lens (primary):** `KEY_ACCOUNTS_MANAGER`, `CCO` · **Lens (secondary):** `PROGRAM_MANAGER` (view)
- **Archetype:** W3 (list) + W4 (detail)
- **User goal:** Browse client accounts; open a client to see their projects, contacts, opportunities, documents.
- **Current state:** Existing list + detail; detail uses a departments-view variant for drill-through.
- **Data source:** Canonical — `clients`/`project_info` (confirm during Phase 3 per actual schema split).
- **Visual improvements:** List adopts W3; detail adopts W4 with tabs per wireframe W4 variations table.
- **Additive:** "Last contact" aging chip; bulk reassign to another KAM.
- **Preserved:** Alias `/pd/clients` still resolves; permission entity `pd_clients` unchanged.
- **Risk:** Low.
- **Effort:** M.

**End of batch 4.** 6 functions recorded.

---

### §3.5 Lens 1 · Batch 5 — Approvals domain

#### F-016 · Approvals

- **Path(s):** `/pm/approvals` · aliased from `/my-work/approvals` (redirect) · retired predecessor `/pm/deliverables` (now alias)
- **Lens (primary):** `PROGRAM_MANAGER`, `PROJECT_MANAGER_SITE`
- **Lens (secondary):** CFO, PFM, CM, QM, EngM, HSE, SSEG (edit roles vary per `approvals` entity)
- **Archetype:** W3 List
- **User goal:** See every approval waiting on me or my team; approve / reject inline where safe; drill in where context needed.
- **Current state:** Canonical approvals page (replaced the retired PM Deliverables surface 2026-04-19). Table filtered to logged-in user's approval queue by default.
- **Data source:** Canonical — `approvals` table (single write-master per `00c §1`).
- **Visual improvements:**
  - W3 `TableLayout` composition.
  - Category chips — `StatusChip` variants for `financial_review`, `engineering_signoff`, `quality_signoff`, `hse_signoff`, `handover_signoff`.
  - Due-date column with RAG-aged chip (overdue / due today / due ≤3d / due >3d).
  - Amount column tabular-nums + right-aligned for financial approvals.
- **Additive functional improvements:**
  - Bulk Approve — opens `ConfirmDialog` with list + total amount + 2s undo toast after submit.
  - "Delegate to" row action opens person-picker using existing `SearchableSelect`.
  - Saved filter for "my approvals this week."
  - **Inline single-click approve from list was considered and deferred** (owner decision 2026-04-21): no Rand-value thresholds will be introduced; users continue to click through to the approval detail before approving. Revisit if/when a safety model for inline approval is defined.
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a — already canonical.
- **Preserved behaviour contract:**
  - `/my-work/approvals` alias → `/my-work/tasks?source=approvals` continues.
  - `/pm/deliverables` (retired) alias → `/pm/approvals` continues.
  - Edit roles unchanged per `approvals` entity matrix.
  - Approval-state transitions continue to route through repository layer (no direct table writes in handler).
- **Risk:** Medium — approvals change money, state.
- **Effort:** M–L.

#### F-017 · Financial Review Queue

- **Path(s):** `/governance/financial-reviews`
- **Lens (primary):** `PROGRAM_MANAGER`, `CFO`, `PROGRAM_FINANCE_MANAGER`
- **Archetype:** W3 List (specialised slice of Approvals)
- **User goal:** The sub-queue for finance-specific approvals — monthly close reviews, PO authorisations, budget adjustments.
- **Current state:** `client/src/pages/financial-review-queue.tsx`. Similar shape to Approvals but filtered to `approvalCategory === 'financial_review'`.
- **Data source:** Canonical — `approvals` filtered.
- **Visual improvements:**
  - Inherit F-016 pattern.
  - `DataTrustBadge` strip mandatory — this is a money surface.
  - Amount column always right-aligned tabular-nums with currency prefix (`R`).
  - Balance-impact preview (inline micro-chart showing effect on monthly GP).
- **Additive functional improvements:**
  - Monthly close submit flow — wraps all category items in a single close action.
  - Auto-flag "over-threshold" items (>R X) that require additional sign-off.
- **Preserved:** Permission entity `approvals` shared with F-016; row-click → approval detail unchanged.
- **Risk:** Medium — finance queue.
- **Effort:** M.

#### F-018 · Weekly Reviews

- **Path(s):** `/weekly-reviews`
- **Lens (primary):** `PROGRAM_MANAGER` (reviews) · `PROJECT_MANAGER_SITE` (submits)
- **Archetype:** W3 List — but the review submission uses W5b Wizard
- **User goal:** Each Site-PM submits a weekly review; Program Manager approves; the aggregation feeds monthly reports.
- **Current state:** `client/src/pages/weekly-reviews.tsx` — list surface. Submission is a separate wizard flow. Hidden from sidebar (`showInSidebar: false`).
- **Data source:** Canonical — weekly review snapshots tied to `project_info`.
- **Visual improvements:**
  - List: W3 composition with week-number + state + submitter columns.
  - Wizard: W5b `WizardLayout` composition — Scope → Tasks → Risks → Finance → Summary → Review & submit (6 steps per W5 wireframe).
  - Draft auto-save every 10s with "Last saved" footer.
  - Help panel right-side documents the data source for each step (Finance step: "pre-populated from normalized_revenue_lines / normalized_cost_lines current rows").
- **Additive functional improvements:**
  - Compare-to-last-week mode in summary step — shows delta per metric.
  - "Copy forward" action bootstraps next week's draft from this week's numbers.
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Hidden from sidebar (`showInSidebar: false`) — keep.
  - Permission entity `weekly_review_wizard` edit roles unchanged.
  - Finance snapshot locks every Friday 17:00 per existing rules.
- **Risk:** Medium — feeds monthly close.
- **Effort:** L (wizard is the largest piece).

**End of batch 5.** 3 functions recorded.

---

### §3.6 Lens 1 · Batch 6 — Handover & Milestones

#### F-019 · Milestone Tracker

- **Path(s):** `/milestone-tracker`
- **Lens (primary):** `CONSTRUCTION_MANAGER` (daily driver — owner decision 2026-04-21), `PROGRAM_MANAGER`
- **Lens (secondary):** all `execution_board` view roles
- **Archetype:** W3 List (time-sequenced; may use a Gantt view as additive mode)
- **User goal:** See every project's milestones on one view; identify which are on track, slipping, or missed.
- **Current state:** `client/src/pages/milestone-tracker.tsx`. List of milestones across projects. Uses existing sort + filter patterns.
- **Data source:** Canonical — `project_execution_state` milestones + `work_items` milestone workstream.
- **Visual improvements:**
  - W3 `TableLayout` composition.
  - RAG column via `StatusBadge`.
  - "Days until / since target" chip column (green ≥7d, amber ≤7d, red overdue).
  - Project + milestone as sticky leading columns on horizontal scroll.
- **Additive functional improvements:**
  - Gantt-view toggle (additive, not replacing table) using `Chart` primitive in a horizontal bar layout.
  - Batch-shift milestones (apply N-day shift to multiple) — opens `ConfirmDialog` with diff preview.
  - "Notify owner" action — Teams/email via existing MS Graph.
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `execution_board`.
  - Sidebar visible.
  - Row-click → Project Detail → Overview tab (anchored to milestone).
- **Risk:** Low–medium.
- **Effort:** M.

#### F-020 · Handover Control

- **Path(s):** `/handover-control`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** COO, CEO, CCO, PD, PMS, CM, KAM, HSE (view)
- **Archetype:** W2 Dashboard (COO-facing readiness dashboard)
- **User goal:** The operational control view for handover health across all in-flight handovers.
- **Current state:** `client/src/pages/handover-control.tsx`. Renders tiles + progress but **`/api/pd-pm-handover/control` returns undefined** — identified finish-it candidate in `00b §A #3`. UI is built; backend wiring incomplete.
- **Data source:** Canonical — handover-related rows in `project_info` + `project_execution_state` + a new aggregation endpoint. The endpoint needs to be implemented.
- **Visual improvements:**
  - Adopt W2 structure — status strip + tile grid + exceptions panel.
  - Readiness progress cells use `Progress` primitive with RAG colour.
  - Handover score chip with tooltip explaining calculation.
- **Additive functional improvements:**
  - The backend aggregation itself (see "Half-built work" below).
  - "Drill into handover" row action → F-021 (Handover & Closeout detail).
  - COO-only action: override readiness score with justification.
  - **Readiness score is informational only** (owner decision 2026-04-21). No action on the platform blocks / gates / prevents itself based on the score. A COO can proceed with a handover at any readiness percentage. The score exists to *inform* decisions, never to enforce them.
  - **v1 formula: 4 components weighted equally (25% each)** — (a) all stage-gate criteria marked complete, (b) finance snapshot locked for current week, (c) required handover documents uploaded to SharePoint, (d) PM sign-off on the readiness checklist. Label shown in UI as "Readiness v1" so it's clear this is a first-pass number.
  - **Tuneable in `/admin/settings`** — component weights and inclusion are editable by COO admin without a code change, so v2/v3 can iterate after real-use feedback.
- **Half-built work to finish:** **YES — this is `00b §A #3`, a top-5 finish-it candidate.** Phase 2 plan owns the frontend; Phase 3 implementation wires the backend endpoint (`/api/pd-pm-handover/control`) + aggregation. Server-side work belongs in `server/handover-routes.ts` or a new `server/routes/handover.routes.ts` wrapping `approvals-routes.ts`.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `handover`.
  - Page renders even without data (shows `EmptyState` variant, not blank).
- **Risk:** Medium — backend work has database-query-level implications.
- **Effort:** M on frontend; additional M on backend endpoint (count separately in Phase 3 estimate).

#### F-021 · Handover & Closeout

- **Path(s):** `/handover` · also accessible via `/sseg` → `/handover?tab=sseg` (LEGACY_REDIRECTS)
- **Lens (primary):** `PROGRAM_MANAGER` · **Lens (secondary):** many roles for visibility
- **Archetype:** W4 Detail (top-level handover surface — uses tabs for SSEG / Checklist / Sign-off / Lessons)
- **User goal:** The top-level handover workspace — view and progress every handover stage.
- **Current state:** `client/src/pages/handover-dashboard.tsx`. Existing tabs for SSEG, checklist; some tabs more complete than others.
- **Data source:** Canonical — handover metadata in `project_info` + related tables.
- **Visual improvements:**
  - W4 `DetailLayout` with tabs: Overview / SSEG / Checklist / Lessons Learnt / Sign-off.
  - Lessons Learnt tab pulls from `/admin/lessons` canonical store (Phase D registry addition).
  - URL-reflective tabs (`?tab=sseg`) — aligns with existing LEGACY_REDIRECTS.
- **Additive:** Compare-to-lessons suggestion panel on Sign-off tab (pre-close checks).
- **Half-built work to finish:** n/a direct, but `pd_pm_handover_v2` flag (00b §A #2 finish-it) unlocks the v2 sign-off flow; this page is where it surfaces.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:** LEGACY_REDIRECTS `/sseg` → `/handover?tab=sseg` continues; permission entity `handover` unchanged.
- **Risk:** Low–medium.
- **Effort:** M.

#### F-021a · PD→PM Handover detail (v2)

- **Path(s):** `/pd/handover/:projectId` · counterpart `/pm/handover-review`
- **Archetype:** W4 Detail + W5b Wizard (dual-sign-off flow)
- **User goal:** Complete the PD→PM handover wizard for a specific project; opposite end is the PM review/accept.
- **Current state:** v2 pages exist (PdPmHandoverPage, PmHandoverReviewPage) — feature-flagged behind `pd_pm_handover_v2` (`00b §A #2`). v1 removed 2026-03-31.
- **Data source:** Canonical — `project_info` + sign-off records.
- **Visual improvements:** W5b Wizard composition; dual-sign-off screens share a locked summary view.
- **Additive:** Readiness gate auto-checks certain criteria from canonical data (e.g., no blocking gates open, no overdue tasks, finance reviewed).
- **Half-built work to finish:** Flag `pd_pm_handover_v2` — enable in Phase 3 after QA (finish-it candidate).
- **Preserved:** Route paths; permission entity `handover`.
- **Risk:** Medium — completes a deferred flow.
- **Effort:** M (frontend polish + flag enable; backend already substantial).

**End of batch 6.** 4 functions recorded (F-019, F-020, F-021, F-021a).

Two notable callouts:

- **F-020 Handover Control** is the clearest Phase-3 "finish it" target in this lens — a UI that's built but reads nothing. Small, well-scoped, high COO value.
- **F-021a PD→PM Handover v2** is the second — the flag is the only remaining gate; UI is ready.

---

### §3.7 Lens 1 · Batch 7 — Procurement domain (EPC Phase 1)

These three pages are live UI but per `00b §C` their handlers still live in legacy `payment-*-routes.ts` and `po-routes.ts`. Phase 3 per-page polish is fine; the handler-consolidation from legacy → `routes/financials.routes.ts` (or a new `routes/approvals.routes.ts`) is a backlog item, not part of the overhaul.

#### F-022 · PO Approvals

- **Path(s):** `/po-approval-board`
- **Lens (primary):** `PROGRAM_MANAGER`, `PROGRAM_FINANCE_MANAGER`
- **Lens (secondary):** `COO_ADMIN`, `CEO_ADMIN`, `CFO`, `CM` (view)
- **Archetype:** W3 List
- **User goal:** See every PO awaiting approval with cost + supplier + project context; approve, reject, or ask for revision.
- **Current state:** `client/src/pages/po-approval-board.tsx`. Columns for PO ref, supplier, project, amount, requested by, age. Table driven from legacy `po-routes.ts`.
- **Data source:** Canonical — `approvals` table filtered to PO category. Legacy handler remains — flagged in `backlog.md` #6 / #7.
- **Visual improvements:**
  - W3 `TableLayout` composition.
  - `DataTrustBadge` strip (money surface).
  - Amount column tabular-nums, right-aligned, with currency prefix.
  - Age chip (green <3d, amber 3–7d, red >7d).
  - Supplier column sticky-left.
- **Additive functional improvements:**
  - Inline approve below single-click threshold.
  - Bulk approve with confirmation dialog showing total.
  - "Open PO in QB" deep-link row action when a QB ref exists.
  - Saved filter "My approvals today."
- **Half-built work to finish:** indirectly `00b §D Phase 1 EPC Workflow` — handlers currently in legacy files. Consolidation is backlog.
- **Source-of-truth migration:** n/a — already canonical via `approvals`.
- **Preserved behaviour contract:**
  - Permission entity `procurement` (edit: Admin + PM + PFM).
  - Sidebar visible under PROJECT_MANAGEMENT group.
- **Risk:** Medium — PO approvals affect commitments + cash.
- **Effort:** M.

#### F-023 · Payment Requests

- **Path(s):** `/payment-request-board`
- **Lens (primary):** `PROGRAM_FINANCE_MANAGER`, `PROGRAM_MANAGER`
- **Archetype:** W3 List
- **User goal:** See every payment request waiting on authorisation; approve into a payment batch.
- **Current state:** `client/src/pages/payment-request-board.tsx`. Table driven from legacy `payment-request-routes.ts`.
- **Data source:** Canonical — `approvals` filtered to payment_request category.
- **Visual improvements:** Inherit F-022 pattern; add "Pay-by" date column (required for batching logic).
- **Additive functional improvements:**
  - "Add to batch" row action that opens payment-batch picker (`SearchableSelect`).
  - "Split this payment" action (for partial authorisations).
  - Supplier-last-paid summary in row drawer peek.
- **Half-built work to finish:** same as F-022.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour:** Permission entity `procurement`; sidebar visible.
- **Risk:** Medium.
- **Effort:** M.

#### F-024 · Payment Batches

- **Path(s):** `/payment-batch-manager`
- **Lens (primary):** `PROGRAM_FINANCE_MANAGER`, `CFO` (view)
- **Archetype:** W3 List + W4 Detail (batch opens into its constituent payments)
- **User goal:** Group approved payment requests into weekly payment batches for finance execution.
- **Current state:** `client/src/pages/payment-batch-manager.tsx`. Handlers in legacy `payment-batch-routes.ts`.
- **Data source:** Canonical — payment-batch tables (confirm exact schema during Phase 3 touch).
- **Visual improvements:**
  - List of batches (W3), each batch clickable to a W4 detail view of the constituent payments.
  - Detail view shows: batch status, total amount, approved by, submission state, QB sync state.
  - Currency totals with tabular-nums; RAG on QB sync state.
- **Additive functional improvements:**
  - "Finalise batch" action — confirms and locks (state transition through repository).
  - "Download batch report" — PDF generation using existing template pattern.
  - Compare-to-last-week's-batch mode in detail view.
- **Half-built work to finish:** same as F-022.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `procurement`.
  - Batch state transitions remain server-side only.
  - QB sync remains gated by QB credentials + feature flag (connector-mode).
- **Risk:** Medium — batching affects outbound payments.
- **Effort:** L — detail view is non-trivial; QB integration touches multiple systems.

**End of batch 7.** 3 functions recorded (F-022, F-023, F-024).

---

### §3.8 Lens 1 · Batch 8 — Portfolios

#### F-025 · Portfolios (list)

- **Path(s):** `/portfolios`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Lens (secondary):** Admin, CCO, CFO, PFM, KAM (view); Admin + PM (edit)
- **Archetype:** W3 List
- **User goal:** Browse portfolios (client or segment groupings of projects); open one to see its rollup.
- **Current state:** Portfolio list surface (registry entry `portfolios`). Standard table.
- **Data source:** Canonical — portfolios metadata joined to `project_info`.
- **Visual improvements:**
  - W3 `TableLayout`.
  - Columns: Name, Project count, Total value, RAG spread (mini `Progress` bar), Revenue MTD.
  - Active filter chips; saved views.
- **Additive:**
  - "Compare portfolios" bulk action opens a side-by-side comparison view (uses Drawer).
  - Export to CSV/XLSX with trust envelope.
- **Half-built:** n/a.
- **Preserved:** Permission entity `portfolios`.
- **Risk:** Low.
- **Effort:** S–M.

#### F-026 · Portfolio Detail

- **Path(s):** `/portfolios/:id`
- **Lens (primary):** `PROGRAM_MANAGER`
- **Archetype:** W4 Detail
- **User goal:** Drill into one portfolio — see its projects, finance rollup, performance trends, log.
- **Current state:** Detail page with tabs. Tabs vary in completeness.
- **Data source:** Canonical — `project_info` filtered to portfolio + `normalized_cost_lines` + `normalized_revenue_lines` aggregated.
- **Visual improvements:**
  - W4 `DetailLayout` with sticky summary KPI strip: Project count, Total value, RAG spread, GP margin, Revenue MTD.
  - Tabs: Overview / Projects / Finance / Performance / Log.
  - Projects tab embeds F-012 table scoped to portfolio.
  - Finance tab uses `FinancialDataGrid` primitive with `DataTrustBadge` strip.
- **Additive:**
  - "Rebalance forecast" tool — propose reallocation given portfolio-level constraints (additive tool, not replacing underlying data).
  - Per-project RAG history sparkline in Overview.
- **Half-built:** n/a.
- **Preserved:** Permission entity `portfolio_detail`.
- **Risk:** Low–medium.
- **Effort:** M.

**End of batch 8.** 2 functions recorded (F-025, F-026).

---

### §3.9 Lens 1 summary — `PROGRAM_MANAGER`

**Total functions planned:** 26 (F-001 through F-026, including 3 sub-functions F-013a, F-013b, F-021a).

**Effort distribution:**

| Effort | Count | Functions |
|---|---|---|
| S | 7 | F-006, F-007, F-008, F-009, F-010, F-011, F-013b |
| M | 13 | F-002, F-003, F-004, F-005, F-013a, F-014, F-015, F-017, F-019, F-020, F-021, F-021a, F-022, F-023, F-025 (S–M), F-026 |
| L | 3 | F-001, F-013, F-018, F-024 |

**Risk distribution:**

| Risk | Count | Notable |
|---|---|---|
| Low | 9 | Gates sub-lanes, Lifecycle Board, Milestone Tracker, Portfolios |
| Medium | 16 | Most core surfaces — Approvals, Finance review, Handover, Procurement, Projects list, Payment Batches |
| High | 1 | F-013 Project Detail (8 tabs × permission variance) |

**Finish-it candidates in this lens (high ROI):**

1. **F-020 Handover Control** — UI built, backend endpoint missing. Quick win.
2. **F-021a PD→PM Handover v2** — flag-enable only; UI ready.

**Source-of-truth migration required:** None in this lens. Every canonical read is already canonical per `00c §2`.

**Dual-mount handler risks noted:**

- Procurement (F-022–F-024) — handlers in legacy files; consolidation tracked in `backlog.md` #6, not part of Phase 2/3 scope.

**Proposed Phase 3 ordering for this lens:**

1. **Wave 1 — foundation:** `AppShell` + `LensNav` + `PageHeader` + `PageLayout` primitives (land on any one page first; F-002 Lifecycle Board is the simplest candidate).
2. **Wave 2 — list primitive proving:** build `TableLayout` on F-004 Gates Pipeline; roll through F-005–F-011 (7 sub-lane pages) in a single sustained wave since they share the archetype.
3. **Wave 3 — detail primitive proving:** build `DetailLayout` on F-013 Project Detail (largest surface). Then F-015, F-021, F-026 inherit.
4. **Wave 4 — wizard primitive proving:** build `WizardLayout` on F-018 Weekly Reviews.
5. **Wave 5 — approvals domain:** F-016, F-017, F-022, F-023, F-024 (sequenced; Payment Batches last due to QB integration complexity).
6. **Wave 6 — finish-it:** F-020 Handover Control backend + UI; F-021a flag enable.
7. **Wave 7 — remainder:** F-001 Execution Board (4 sub-pages), F-003 PM Dashboard, F-012 Projects list, F-014 Sites, F-019 Milestone Tracker, F-025 Portfolios, F-013a/b sub-functions.

Ordering rationale: each wave proves exactly one new layout primitive, then harvests it across pages that share the archetype. This keeps the primitive library honest (validated against real use-sites) and the per-page work incremental.

---

## §4 STOP — Lens 1 (PROGRAM_MANAGER) complete

**26 functions planned.** Awaiting approval to continue to Lens 2 (`PROJECT_MANAGER_SITE`).

Open questions resolved (owner decisions 2026-04-21):

1. **Inline-approve threshold ladder (F-016)** — **not proceeding**. No Rand-value thresholds introduced. Users continue to click through to approve. Documented in F-016 entry.
2. **F-020 Handover readiness score** — **v1 ships informational only**, 4 components equally weighted, no action gating on score, COO can override / proceed regardless. Tuneable via `/admin/settings`. Documented in F-020 entry.
3. **Wave 2 kick-off** — **Gates Pipeline** (owner deferred to recommendation). Matches the §3.9 Phase 3 ordering above; no change needed.

All three decisions baked into the plan. Ready for Lens 2.

---

## §5 Tier 1 · Lens 2 — `PROJECT_MANAGER_SITE`

**Role summary:** Site Project Manager. Landing: `/execution-board`. Primary tools: PM Dashboard, PM On-The-Go (mobile field workflow), site-scoped Approvals, Tasks, Milestones. This lens is **mobile-first for field work** and **desktop for review / planning**.

**Function count for this lens:** 2 new + 7 cross-referenced from Lens 1. Several functions the Site PM uses daily are already planned under Lens 1 and not re-planned here.

### §5.1 Cross-references (no re-planning)

Functions the Site PM uses daily that are already planned under Lens 1:

| Ref | Function | Site-PM use |
|---|---|---|
| F-001 | Execution Board | Their landing page |
| F-003 | PM Dashboard | Their personal project home |
| F-013 | Project Detail | Drill-in for their assigned projects |
| F-016 | Approvals | Their approvals queue (filtered to them) |
| F-018 | Weekly Reviews | They **submit** the weekly reviews F-018 lists |
| F-019 | Milestone Tracker | Their milestones sub-view |
| F-021a | PD→PM Handover (v2) | They receive incoming handovers here |

Plan entries above apply verbatim. The permission filter is server-side and the UI already respects it — nothing Site-PM-specific to re-plan.

### §5.2 Lens 2 · Batch 1 — Site-PM dedicated functions

#### F-027 · PM On-The-Go (home)

- **Path(s):** `/pm/on-the-go`
- **Lens (primary):** `PROJECT_MANAGER_SITE`
- **Lens (secondary):** `CONSTRUCTION_MANAGER` (uses in field)
- **Archetype:** W6 My Work (mobile-first variant)
- **User goal:** On a phone on site, see my projects, act on the next thing, capture field data.
- **Current state:** `client/src/pages/pm-on-the-go-home.tsx`. Existing mobile-first surface. Grid of project cards + quick-capture actions.
- **Data source:** Canonical — `project_info` filtered to PM + `work_items` filtered to PM.
- **Visual improvements:**
  - Adopt W6 mobile-first structure — today's focus (what needs me today on each site) + action queues + quick-capture panel.
  - Large touch targets throughout (44px minimum already enforced at `index.css:305-318`).
  - RAG on project cards via `StatusBadge` dot + colour.
  - Offline-aware banner when network drops (wrap existing `NetworkStatus` component).
- **Additive functional improvements:**
  - "Capture photo → task" — take a photo, attach to an auto-created `work_items` row linked to the project.
  - "Voice note → task" — mobile browser speech-to-text API as additive, not required.
  - Offline draft queue — notes/tasks captured offline sync when network returns. Rides on `local_synced_save_flow` beta (00b §A #5) when graduated.
- **Half-built work to finish:** Tangential — `local_synced_save_flow` beta underlies the offline queue. Enable as it rolls out.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `pm_on_the_go`.
  - Existing deep links to project cards continue to work.
  - Mobile navigation bottom-tab slot reserved for this page in the `PROJECT_MANAGER_SITE` lens (per wireframe W7 mobile tabs table).
- **Risk:** Medium — field-critical surface.
- **Effort:** M.

#### F-028 · PM On-The-Go Project detail

- **Path(s):** `/pm/on-the-go/project/:projectId`
- **Lens (primary):** `PROJECT_MANAGER_SITE`
- **Archetype:** W4 Detail (mobile-optimised variant)
- **User goal:** Drill into one project on mobile — see what I need to do, capture what happened.
- **Current state:** `client/src/pages/pm-on-the-go-project.tsx`. Existing mobile project drill-in.
- **Data source:** Canonical — same as F-013 Project Detail, scoped to one project.
- **Visual improvements:**
  - Adopt mobile-first W4 (summary header + tabs collapsed to select dropdown + 2×2 KPI tiles per wireframe W4 mobile).
  - Sticky FAB bottom-right for primary "capture" action (photo / note / task).
  - Per-tab content adopts simplified archetypes for touch (Tasks = card list, Log = timeline).
- **Additive functional improvements:**
  - "Report incident" quick-capture — creates HSE incident linked to project, surfaces in HSE manager's queue.
  - Sticky "Next action" card at top of every tab — the single most pressing item for this project.
  - Share-sheet integration for pictures / voice-notes to iOS/Android native share.
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `pm_on_the_go`.
  - Parametric route stable — external deep links (MS Teams / SMS) continue to work.
  - Existing tabs preserve their data sources.
- **Risk:** Medium.
- **Effort:** M.

### §5.3 Lens 2 summary

**Total functions:** 2 new (F-027, F-028) + 7 cross-referenced.

| Metric | |
|---|---|
| Effort | 2 × M |
| Risk | 2 × Medium |
| SoT migrations | 0 — all canonical |
| Finish-it candidates | None new; `local_synced_save_flow` (00b #5) tangential |

**Proposed Phase 3 ordering (this lens):**

- **Rides on Lens 1 primitives.** No new layout primitives for this lens.
- **After Wave 3 (DetailLayout built):** layer mobile-first variant onto F-028.
- **Parallel with Wave 1 (AppShell mobile-ready):** F-027 adopts W6 mobile composition.

Both functions harvest from the same primitives Lens 1 builds — zero duplicate primitive work.

---

**End of Lens 2.**

---

## §6 Tier 1 · Lens 3 — `CFO` + `PROGRAM_FINANCE_MANAGER` + `ACCOUNTANT` (Finance)

**Role summary:** Finance operations across three seniority tiers. Finance is one set of pages — the three roles differ in edit rights, not in which pages they use. Planning combined keeps data-consistency rules and trust envelope in one place.

- **CFO** — highest-authority; all finance views + `financial_linking` edit. Lands at `/cashflow`.
- **PROGRAM_FINANCE_MANAGER (PFM)** — program-level finance operations. Edits on all finance entities.
- **ACCOUNTANT** — day-to-day finance ops; narrow scope. Lands at `/cashflow`.

**Function count:** 9 functions + 3 already cross-referenced from Lens 1 (F-017 Financial Review Queue, F-022 PO Approvals, F-023 Payment Requests, F-024 Payment Batches — finance uses those heavily but PM lens owns the plan).

### §6.1 Finance-specific invariant (across every function in this lens)

**`DataTrustBadge` strip is non-optional on every finance page.** Per design system §2.2 and wireframe W-C4, every page that displays money shows: Source / Last updated / Scope / Trust, always. The strip renders even when data is loading (as skeleton).

**Tabular-nums on every money column.** Right-aligned. Currency prefix `R`. Negative values in parentheses, not minus sign.

**`effective_to IS NULL` enforcement.** Every aggregate on `normalized_cost_lines` / `normalized_revenue_lines` / snapshot tables filters historical rows — the `finance-snapshot-queries` skill + CI guard enforce this. Flagged here because finance is where regression would hurt most.

### §6.2 Lens 3 · Batch 1 — Core finance pages

#### F-029 · Cashflow

- **Path(s):** `/cashflow` (primary) · alias `/cashflow-forecast` (LEGACY_REDIRECTS)
- **Lens (primary):** `CFO`, `PROGRAM_FINANCE_MANAGER`, `ACCOUNTANT` (all 3 landing)
- **Lens (secondary):** `PROGRAM_MANAGER` (view) — cross-ref from Lens 1
- **Archetype:** W2 Dashboard (with embedded `FinancialDataGrid`)
- **User goal:** See current and forecast cashflow — weekly buckets of inflows / outflows / balance. Drill into any bucket to see the lines making it up.
- **Current state:** `client/src/pages/cashflow.tsx`. Rich surface with weekly / monthly bucketing, forecast vs actual, QB reconciliation markers.
- **Data source:** Canonical — `normalized_revenue_lines` + `normalized_cost_lines` + `cashflow_points`. **Note:** `resolveInflowEffectiveDates()` hybrid at `server/lib/cashflow-helpers.ts:38` is the single outstanding SoT migration (00c §3 obs 1) — Phase 3 work should NOT introduce new reads from it; it's a Priority 1 server-side backlog item.
- **Visual improvements:**
  - Adopt W2 structure — top status strip (cash in / cash out / balance / weekly need) → primary weekly bucket grid → secondary overdue/forecast panel → full-width chart.
  - `DataTrustBadge` strip mandatory below PageHeader.
  - Weekly bucket cells use `FinancialDataGrid` primitive — tabular-nums, right-aligned, RAG on forecast-vs-actual variance.
  - Chart toggle: weekly bars / monthly bars / cumulative line (uses existing `Chart`).
- **Additive functional improvements:**
  - Saved views per user — custom bucket ranges, custom scope filter.
  - "What-if" scenario overlay — add a proposed future payment and see the effect on balance curve.
  - Drill-in row action → opens `FinancialDataGrid` of constituent lines in a Drawer without leaving the page.
- **Half-built work to finish:** n/a directly.
- **Source-of-truth migration:** **Ensure new code doesn't read `resolveInflowEffectiveDates()` legacy outputs.** Server-side migration is Priority 1 in `00c §4` — tracked in `backlog.md` #9.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS `/cashflow-forecast` → `/cashflow` continues.
  - Landing for CFO, PFM, Accountant.
  - Edit gated per `cashflow` entity (Admin + CFO + PFM + Acct).
  - QB reconciliation markers unchanged.
- **Risk:** High — highest-stakes finance surface.
- **Effort:** L.

#### F-030 · COS (Cost of Sales)

- **Path(s):** `/cos` · alias `/cos-control` (LEGACY_REDIRECTS)
- **Lens (primary):** `CFO`, `PFM`, `ACCOUNTANT` · `PM` (view)
- **Archetype:** W3 List (heavily financial — uses `FinancialDataGrid`)
- **User goal:** Every cost line — see commitments, actuals, forecasts per project.
- **Current state:** `client/src/pages/cos.tsx` (via CostTracker). Dense financial grid.
- **Data source:** Canonical — `normalized_cost_lines` with `effective_to IS NULL` guard.
- **Visual improvements:**
  - Adopt W3 `TableLayout` + `FinancialDataGrid` composition.
  - `DataTrustBadge` strip mandatory.
  - Variance column (actual vs committed, %) with RAG chip.
  - Sticky project + line-category columns.
- **Additive functional improvements:**
  - Saved views, bulk export with trust envelope in footer.
  - Multi-period comparison mode (this month vs last month, this quarter vs last quarter).
  - Drill-in → cost-line detail Drawer.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a — already canonical.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS `/cos-control` → `/cos` continues.
  - Edit gated per `cos` entity.
  - Smart Import v2 writes unchanged (go through canonical pipeline).
- **Risk:** Medium — core finance surface.
- **Effort:** M–L.

#### F-031 · Revenue Tracker

- **Path(s):** `/revenue-tracker` (primary) · alias `/revenue` (LEGACY_REDIRECTS)
- **Lens (primary):** `CFO`, `PFM`, `ACCOUNTANT`
- **Archetype:** W3 List
- **User goal:** Every revenue line — see recognised, forecast, and milestone-linked revenue per project.
- **Current state:** `client/src/pages/revenue-tracker.tsx`. Grid with milestone-link state and QB invoice state.
- **Data source:** Canonical — `normalized_revenue_lines` with `effective_to IS NULL` guard.
- **Visual improvements:**
  - W3 `TableLayout` + `FinancialDataGrid`.
  - `DataTrustBadge` strip mandatory.
  - Milestone-link status chip; QB-invoice status chip.
  - Tabular-nums on Amount / Recognised / Outstanding columns.
- **Additive:**
  - Saved views; multi-period compare.
  - "Recognise now" inline action (Admin + CFO only) — records revenue recognition with audit trail; uses `ConfirmDialog`.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS `/revenue` → `/revenue-tracker` continues.
  - Edit per `revenue_tracker` entity.
- **Risk:** Medium.
- **Effort:** M.

### §6.3 Lens 3 · Batch 2 — QB integration pages

#### F-032 · QB Throughput

- **Path(s):** `/finance/quickbooks`
- **Lens (primary):** `CFO`, `PFM`, `ACCOUNTANT`
- **Archetype:** W4 Detail with tabs — each tab is itself a W3 list
- **User goal:** The single surface for every QuickBooks integration view. Tabs absorb what used to be 5+ separate pages (QB Customer Mapping, QB Bill Linking, Counterparties, Subcontractor Dashboard, Invoice Patterns, Admin QB).
- **Current state:** `client/src/pages/finance-quickbooks-throughput.tsx`. Consolidation page. Absorbed pages still have direct routes (hidden) that render this page's tab content.
- **Data source:** Canonical — QB link metadata + `normalized_*_lines` joins.
- **Visual improvements:**
  - W4 `DetailLayout` — sticky summary bar with throughput KPIs (sync state / pending / failed / last sync).
  - Tabs: Mapping / Bill Linking / Suppliers / Invoice Patterns / Settings.
  - Each tab adopts W3 `TableLayout` internally.
  - `DataTrustBadge` with source = "Canonical + QB".
- **Additive:**
  - Tab content loads lazily on tab activation.
  - "Retry failed sync" bulk action.
  - Export sync report.
- **Half-built:** indirectly connects to `smart_import_qb_precedence` flag (00b §A #4) — QB taking precedence on Paid invoices during Smart Import. Flag-enable is Phase 3 work on Smart Import side.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Absorbed legacy routes (`/finance/quickbooks-customer-mapping`, `/finance/quickbooks-links`, `/counterparties`, `/subcontractor-dashboard`, `/invoice-patterns`, `/admin/quickbooks`) remain valid — they render this page's tab content.
  - Edit per `financials` entity.
- **Risk:** Medium — integration-heavy.
- **Effort:** L.

#### F-033 · Counterparties (absorbed tab)

- **Path(s):** `/counterparties` (hidden, absorbed into F-032 Suppliers tab)
- **Archetype:** W3 List (rendered inside F-032)
- **User goal:** Every supplier / vendor / client counterparty with QB sync state.
- **Plan:** Inherits F-032 Suppliers tab treatment. Direct route stays for backward-compat deep links.
- **Preserved:** `counterparties` permission entity.
- **Risk:** Low.
- **Effort:** S (inherited).

#### F-034 · Subcontractors (absorbed tab)

- **Path(s):** `/subcontractor-dashboard` (hidden, absorbed into F-032)
- **Archetype:** W3 List
- **User goal:** Subcontractor-specific counterparty view with project-allocation context.
- **Plan:** Part of F-032 Suppliers tab, filtered to subcontractor counterparty-type.
- **Preserved:** `subcontractors` permission entity.
- **Risk:** Low.
- **Effort:** S.

#### F-035 · Invoice Patterns (absorbed tab)

- **Path(s):** `/invoice-patterns` (hidden, absorbed into F-032 Patterns tab)
- **Archetype:** W3 List
- **User goal:** Invoice recognition patterns used by Smart Import to auto-link QB invoices to lines.
- **Plan:** Inherits F-032 Patterns tab.
- **Preserved:** `invoice_patterns` permission entity.
- **Risk:** Low.
- **Effort:** S.

### §6.4 Lens 3 summary — Finance

**Total functions:** 7 new (F-029 through F-035) + 4 cross-referenced (F-017, F-022, F-023, F-024).

| Metric | |
|---|---|
| Effort | 1 L-high (F-029) · 2 M–L (F-030, F-032) · 1 M (F-031) · 3 S (F-033, F-034, F-035) |
| Risk | 1 High (F-029 Cashflow) · 3 Medium · 3 Low |
| SoT migrations | 0 direct; F-029 flags the cross-cutting server-side Priority 1 (`resolveInflowEffectiveDates` — `00c §4`) |
| Finish-it candidates | None new (`smart_import_qb_precedence` tangential to F-032) |

**Finance-specific risks to track in Phase 3:**

1. **Number formatting regressions.** Tabular-nums, right-alignment, currency prefix, parentheses for negatives — any drift breaks readability and trust.
2. **DataTrustBadge drift.** If finance pages ever ship without it, finance trust is compromised.
3. **`effective_to IS NULL` skill enforcement.** Any new aggregate query on snapshot tables MUST run the `finance-snapshot-queries` skill.
4. **QB sync integrity.** F-032 handles a live integration — Phase 3 work must preserve mock-connector-in-dev (`USE_MOCK_CONNECTORS` per `CLAUDE.md`) and retry logic.

**Proposed Phase 3 ordering (this lens):**

1. **After Wave 3 (DetailLayout built):** F-032 QB Throughput (tabs are W4 Detail-style; absorbs F-033/F-034/F-035).
2. **After Wave 2 (TableLayout built):** F-030 COS, F-031 Revenue Tracker (harvest TableLayout).
3. **Dedicated wave — "Finance wave":** F-029 Cashflow. Largest and highest-risk finance work. Do last in the finance block so all prerequisite primitives (TableLayout, DetailLayout, FinancialDataGrid-usage-patterns) are proven.

---

**End of Lens 3.**

---

## §7 Tier 1 · Lens 4 — `COO_ADMIN` + `CEO_ADMIN` (Executive)

**Role summary:** Company oversight + platform admin authority. Both roles land at `/company-overview`. Nearly every other page is cross-referenced from Lens 1–3 (they see everything). This lens plans only the executive-dedicated surfaces.

**Function count:** 3 new (F-036 · F-037 · F-038) + virtually every Lens 1–3 function cross-referenced for visibility.

### §7.1 Cross-references

Every Lens 1–3 function is accessible to COO/CEO with full view rights. No re-planning needed. Notably:

- F-001 Execution Board — reviewed for portfolio-level signal
- F-004 Gates Pipeline + 7 sub-lanes — weekly scan
- F-016 Approvals — top-of-threshold approvals roll up to COO/CEO
- F-029 Cashflow — financial oversight
- F-025/F-026 Portfolios — rollup read

### §7.2 Lens 4 · Batch 1 — Executive-specific functions

#### F-036 · Company Overview

- **Path(s):** `/company-overview`
- **Lens (primary):** `COO_ADMIN`, `CEO_ADMIN` (landing for both)
- **Lens (secondary):** all finance-view roles (CFO / PFM / CCO) read for context
- **Archetype:** W2 Dashboard
- **User goal:** The full state of the company — every department's health, every finance line, every exception at once.
- **Current state:** `client/src/pages/company-overview/index.tsx` + sub-components (`DepartmentHealthGrid`, `DepartmentKpiTable`, `ExceptionsAndPriorities`, `ExecutiveSummaryRow`, `PortfolioFinanceRow`, `RecentSignals`). Already structured around W2.
- **Data source:** Canonical across the board — via `server/services/company-overview-service.ts` + `server/services/dashboard-metrics.ts` (both canonical readers per `00c §2`).
- **Visual improvements:**
  - Formalise W2 structure per wireframe W2 — already ~80% there.
  - Replace any remaining ad-hoc status colouring with `StatusBadge`.
  - `DataTrustBadge` strip below PageHeader — this is a money + state page.
  - Consolidate section heading treatment using `ee-section-title`.
  - Fix any dark-mode gaps in the existing department-health grid.
- **Additive functional improvements:**
  - Drill-in via row action → department-specific dashboard (not via full navigation — keeps COO in the oversight view).
  - "Take a snapshot" action generates a PDF of the current overview for board packs.
  - Saved-views per user — custom department subsets.
  - Compare-to-last-week mode with delta chips on every KPI.
- **Half-built work to finish:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Landing for COO_ADMIN + CEO_ADMIN.
  - Permission entity `execution_board`.
  - Sub-components remain importable (they're used elsewhere).
- **Risk:** Medium — highly visible exec surface.
- **Effort:** M.

#### F-037 · Priorities

- **Path(s):** `/priorities` (list) · `/priorities/:id` (detail) · alias `/company-priorities` (LEGACY_REDIRECTS)
- **Lens (primary):** `COO_ADMIN`, `CEO_ADMIN`, `CCO` (edit rights — `company_priorities` entity)
- **Lens (secondary):** 12 view roles
- **Archetype:** W3 List + W4 Detail
- **User goal:** Manage company priorities — top-level strategic focus items with linked projects.
- **Current state:** `client/src/pages/company-priorities.tsx` / `/priorities` route. List + detail pattern. PageHeader with [+ New priority] action.
- **Data source:** Canonical — priorities table + linked `project_info` FKs.
- **Visual improvements:**
  - List: W3 `TableLayout`. State / Owner / Due / Impact columns.
  - Detail: W4 `DetailLayout` with tabs Overview / Updates / Linked projects / Log.
  - Create flow (F-037a — new priority) uses W5a `FormLayout` (2/3 form + 1/3 context) per wireframe W5a.
- **Additive functional improvements:**
  - "Link project" inline action on detail's Linked projects tab.
  - Per-priority activity feed on Updates tab.
  - Share / export to board-pack one-click.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - LEGACY_REDIRECTS `/company-priorities` → `/priorities` continues.
  - Edit gated to Admin + CCO per `company_priorities` entity.
- **Risk:** Low.
- **Effort:** M.

#### F-038 · Admin Control Center

- **Path(s):** `/admin/control-center` · alias `/admin` (LEGACY_REDIRECTS) · alias `/admin/legacy-utilities` (LEGACY_REDIRECTS)
- **Lens (primary):** `COO_ADMIN`, `CEO_ADMIN`
- **Archetype:** W2 Dashboard (admin cockpit)
- **User goal:** The admin home — system health, active sessions, feature flags, dangerous actions, import governance.
- **Current state:** `client/src/pages/admin-control-center.tsx` + `components/admin/*`. Multi-panel cockpit. Hidden from sidebar but reached via `/admin` redirect.
- **Data source:** Canonical — mix of platform telemetry + auth state + feature flag state.
- **Visual improvements:**
  - W2 structure — system health strip + primary grid (feature flags / active sessions / import state / recent errors) + secondary panel (dangerous actions gated behind confirmation).
  - `StatusBadge` everywhere for health indicators.
  - Reduce visual noise — current cockpit has dense mixed sections; W2 gives clear structure.
- **Additive:**
  - Search across the admin widgets (command-palette scoped to admin).
  - "One-click copy diagnostic bundle" action for support incidents.
  - Feature-flag timeline view — see when flags were flipped and by whom.
- **Half-built:** The 38 `promoted_*` migration-bridge flags (00b §A #9) show here — watch them but don't flip them; Phase 2 schema work owns them.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Hidden from sidebar.
  - Permission entity `admin`.
  - LEGACY_REDIRECTS `/admin`, `/admin/legacy-utilities` → here.
  - Dangerous actions (resets, purges) continue to require `ConfirmDialog` + typed confirmation.
- **Risk:** Medium — admin surface.
- **Effort:** M.

### §7.3 Lens 4 summary — Executive

**Total functions:** 3 new (F-036 · F-037 · F-038) + virtually every Lens 1–3 function cross-referenced.

| Metric | |
|---|---|
| Effort | 3 × M |
| Risk | 2 × Medium · 1 × Low |
| SoT migrations | 0 — all canonical |
| Finish-it candidates | None new |

**Proposed Phase 3 ordering (this lens):**

- **After Wave 3 (DetailLayout built):** F-036 Company Overview adopts formalised W2 + DetailLayout embed for drill-ins.
- **Harvest from Wave 2 + Wave 3:** F-037 Priorities (uses TableLayout + DetailLayout + FormLayout).
- **Last in Tier 1:** F-038 Admin Control Center — admin-only, low user traffic, defer behind higher-traffic work.

---

## §8 Tier 1 — COMPLETE

All four Tier 1 lenses planned. Tier 1 totals:

| Metric | Value |
|---|---|
| Functions planned (primary entries) | 37 (F-001 through F-038) |
| Cross-referenced | ~80 Lens 1-2-3-4 mentions; every function is read-consistent across lenses |
| High-risk functions | 2 (F-013 Project Detail, F-029 Cashflow) |
| Finish-it candidates flagged | F-020 Handover Control, F-021a PD→PM v2 |
| Source-of-truth migrations required on UI | 0 direct (all canonical); 1 server-side flagged (`resolveInflowEffectiveDates`) |
| New layout primitives needed | 5 (`AppShell`, `PageLayout`, `TableLayout`, `DetailLayout`, `FormLayout`, `WizardLayout`) |

**Phase 3 ordering across Tier 1 — unified:**

1. **Wave 1 — Foundation primitives.** Build AppShell + LensNav + PageHeader + PageLayout on a single low-risk page (F-002 Lifecycle Board).
2. **Wave 2 — List primitive.** Build TableLayout on F-004 Gates Pipeline; harvest across F-005–F-011 (7 sub-lanes), F-012 Projects, F-019 Milestone Tracker, F-030 COS, F-031 Revenue Tracker, F-037 Priorities.
3. **Wave 3 — Detail primitive.** Build DetailLayout on F-013 Project Detail (largest surface). Harvest across F-015 Clients, F-021 Handover & Closeout, F-026 Portfolio Detail, F-028 PM On-The-Go Project, F-032 QB Throughput, F-036 Company Overview, F-037 Priorities detail.
4. **Wave 4 — Wizard + Form primitives.** Build WizardLayout on F-018 Weekly Reviews. FormLayout harvested for F-037 New Priority + many Phase 3 new forms.
5. **Wave 5 — Approvals domain.** F-016 Approvals, F-017 Financial Review Queue, F-022 PO Approvals, F-023 Payment Requests, F-024 Payment Batches (sequenced; Payment Batches last due to QB).
6. **Wave 6 — Finance wave.** F-030 COS, F-031 Revenue Tracker, F-032 QB Throughput, F-029 Cashflow (largest finance page last).
7. **Wave 7 — Finish-it.** F-020 Handover Control backend + UI; F-021a PD→PM v2 flag enable; F-036 Company Overview polish.
8. **Wave 8 — Mobile + remainder.** F-027/F-028 PM On-The-Go (mobile variants), F-001 Execution Board (4 sub-pages), F-014 Sites, F-033/F-034/F-035 (absorbed tabs), F-038 Admin Control Center.

**STOP for Tier 1 approval before Tier 2.** Lens 2 (PM-Site), Lens 3 (Finance), Lens 4 (Exec) approvable together or individually.

---

**End of Tier 1 (§§3–8).**

---

## §9 Tier 2 · Lens 5 — `CONSTRUCTION_MANAGER`

**Role summary:** Construction site leader. Landing: `/execution-board`. Almost every CM function overlaps PM lens — CM is PM's construction-focused sibling. Only **one** function is CM-primary and not already planned above.

**Function count:** 1 new + 10+ cross-referenced from Lens 1, Lens 2, Lens 3.

### §9.1 Cross-references

CM works daily inside these — all already planned:

| Ref | Function | CM use |
|---|---|---|
| F-001 | Execution Board | Landing; Construction sub-tab primary |
| F-013 | Project Detail | Drill-in for their projects (HSE + Quality tabs weighted) |
| F-016 | Approvals | Their construction-scope approvals |
| F-019 | Milestone Tracker | **CM daily driver** — primary site-progress surface (owner note 2026-04-21). Already annotated in F-019 entry. |
| F-021 | Handover & Closeout | Outgoing construction → ops handovers |
| F-022 | PO Approvals | Construction-site POs |
| F-023 | Payment Requests | Site subcontractor payments |
| F-027 | PM On-The-Go | Field mobile (secondary use — PM-Site primary) |
| F-028 | PM On-The-Go Project | Same |
| F-051 | HSE Dashboard | (planned in Tier 3) |
| F-054 | Quality | (planned in Tier 3 — CM has edit rights) |

Plan entries above apply verbatim.

### §9.2 Lens 5 · Batch 1 — CM dedicated

#### F-039 · Commissioning Dashboard

- **Path(s):** `/commissioning-dashboard` (list) · `/commissioning-dashboard/:projectId` (detail)
- **Lens (primary):** `CONSTRUCTION_MANAGER` · **co-primary:** `PROGRAM_MANAGER`, `PROJECT_MANAGER_SITE`
- **Lens (secondary):** `QUALITY_MANAGER`, `ENGINEERING_MANAGER`, `ENGINEER`, 9 other view roles
- **Archetype:** W3 List (top-level) + W4 Detail (per-project) + embedded checklists on detail
- **User goal:** Track every project's commissioning state — tests completed, outstanding issues, sign-offs.
- **Current state:** `client/src/pages/commissioning-dashboard.tsx`. Route group under QUALITY nav but CM/PM own the work. Existing detail view uses a checklist + activity log pattern.
- **Data source:** Canonical — commissioning tables (confirm domain: `shared/schema/commissioning-source.ts`) + `work_items` filtered to commissioning bucket + `project_info` / `project_execution_state` joins.
- **Visual improvements:**
  - W3 `TableLayout` on top-level list — columns: Project / Commissioning stage / Progress % / Outstanding issues / Last tested / Sign-off state.
  - Progress column uses `Progress` primitive.
  - Sign-off state chip via `StatusBadge`.
  - W4 `DetailLayout` on per-project view — summary KPI strip (Stage / Progress / Outstanding / Next test / Sign-off owner) + tabs: Overview / Tests / Issues / Sign-off / Log.
  - Tests tab is a checklist with inline check-off (row action); issues tab is a W3 list of open items.
- **Additive functional improvements:**
  - "Schedule test" row action — opens existing calendar integration (MS Graph).
  - Bulk check-off of related tests when a parent test passes (configurable per template).
  - Export commissioning report PDF (feeds handover packs — links to F-021 Handover & Closeout).
  - "Escalate issue" inline action routes to QM + PM.
- **Half-built work to finish:** n/a direct. Indirectly feeds F-020 Handover Control readiness-score component 3 ("documents complete") and component 4 ("PM sign-off") — accurate commissioning state is necessary for F-020's v1 formula to produce meaningful numbers.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `commissioning` (edit: Admin + PM + CM + PMS).
  - Under QUALITY nav group (registry places it there).
  - Parametric `/commissioning-dashboard/:projectId` route stable.
  - Existing checklist submission flow continues.
- **Risk:** Medium — feeds handover decisions + HSE sign-off.
- **Effort:** M.

### §9.3 Lens 5 summary — CM

**Total functions:** 1 new (F-039) + 10+ cross-referenced.

| Metric | |
|---|---|
| Effort | 1 × M |
| Risk | 1 × Medium |
| SoT migrations | 0 |
| Finish-it candidates | None new |

**Proposed Phase 3 ordering (this lens):** F-039 falls in **Wave 3** (DetailLayout) / **Wave 8** (remainder). The list view rides TableLayout from Wave 2; detail rides DetailLayout from Wave 3. Can slot in either wave since there's no hard dependency.

---

**End of Lens 5.**

---

## §10 Tier 2 · Lens 6 — `ENGINEERING_MANAGER` + `ENGINEER` (Engineering)

**Role summary:** Engineering-domain management + execution. Both roles land at `/engineering`. Engineering is one of the narrowest lenses — roughly 7 functions across dashboard, tasks, standup, reports, and templates. The two roles differ only in edit scope (Engineer narrower).

**Function count:** 7 new (F-040 · F-041 · F-042 · F-043 · F-044 · F-045 · F-046).

### §10.1 Lens 6 · Batch 1 — Core engineering surfaces

#### F-040 · Engineering Dashboard

- **Path(s):** `/engineering`
- **Lens (primary):** `ENGINEERING_MANAGER`, `ENGINEER` (landing for both)
- **Lens (secondary):** `PROGRAM_MANAGER`, `PROJECT_MANAGER_SITE`, `QUALITY_MANAGER`, `CCO`, `SSEG_MANAGER`, 5 other view roles
- **Archetype:** W2 Dashboard
- **User goal:** Daily engineering operational overview — task lanes, blockers, team load, incoming requests.
- **Current state:** `EngineeringDashboardPage`. Mix of task lanes (todo/doing/review/done) + blocker strip + standup queue.
- **Data source:** Canonical — `work_items` filtered to ENG workstream + `work_item_assignments` + `work_item_engineering` extension.
- **Visual improvements:**
  - Adopt W2 structure — status strip (tasks by state counts) → primary: 4-column lane grid (todo / doing / review / done) → secondary: blockers + standup queue + team load → full-width: weekly burn-down chart.
  - `StatusBadge` across all state cells.
  - `LoadingState` skeleton matching lane layout.
  - Dark-mode pass — the existing dashboard hard-codes some light-mode backgrounds.
- **Additive functional improvements:**
  - Filter presets: "My queue", "Team queue", "By project", "Blocked only".
  - Drag-to-reorder within lanes (EngMgr only) — respects existing priority numeric field; audited in `work_items.updated_at`.
  - Team-load view as toggle — shows assignments × capacity.
  - Keyboard shortcuts: `j`/`k` move across cards, `Enter` open detail.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Landing for EngineeringManager + Engineer.
  - Permission entity `engineering`.
  - Existing standup-strip component importable.
- **Risk:** Medium.
- **Effort:** M–L.

#### F-041 · Engineering Task Board

- **Path(s):** `/engineering/tasks`
- **Lens (primary):** `ENGINEERING_MANAGER`, `ENGINEER`
- **Lens (secondary):** PM / PMS / PD / QM (view)
- **Archetype:** W3 List (with board-view toggle)
- **User goal:** Full engineering task workload — table view for filtering/exporting, board view for flow.
- **Current state:** `client/src/pages/engineering-tasks.tsx` + sub-components (`EngineeringTaskTable`, `EngineeringBulkActions`, `EngineeringTaskDialogs`, `EngineeringTaskFilters`, `TaskDependenciesPanel`). Feature-rich.
- **Data source:** Canonical — `work_items` ENG workstream.
- **Visual improvements:**
  - W3 `TableLayout` for table mode (harvest from Wave 2).
  - Board view toggle (additive — uses existing Kanban-style component).
  - Active-filter chip row.
  - `TaskDependenciesPanel` surfaces in a Drawer, not inline — keeps main board clean.
- **Additive:**
  - Saved views per user.
  - Bulk dependencies — add/remove dependencies across multiple selected tasks.
  - Import tasks from CSV (additive — uses Smart Import v2 pipeline for validation).
- **Half-built:** `local_synced_save_flow` beta (00b #5) is tested on this page — offline drafts + sync.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `eng_tasks`.
  - Existing bulk action component continues importable.
  - Dark-mode overrides at `index.css:161-238` honoured (existing engineering-specific dark rules).
- **Risk:** Medium.
- **Effort:** L (feature-rich, multi-component).

#### F-042 · Engineering Standup

- **Path(s):** `/engineering/standup` · alias `/standups` (redirects here)
- **Lens (primary):** `ENGINEERING_MANAGER` · **co-primary:** `ENGINEER`
- **Archetype:** W2 Dashboard (standup-focused)
- **User goal:** Run a standup — see each engineer's state, queue blockers, queue "what I'm doing today" updates.
- **Current state:** `client/src/pages/engineering/standup/*` (BlockerStrip, StandupQueue, TaskLanes). Existing standup surface.
- **Data source:** Canonical — `work_items` + standups tables (confirm domain in Phase 3).
- **Visual improvements:**
  - W2 structure — blocker strip at top (attention focus) + queue grid + task lanes per engineer.
  - Name + avatar heading each engineer's column via `Avatar` primitive.
  - Timer for standup pace (additive — non-blocking).
- **Additive:**
  - Post-standup summary export to Teams channel (MS Graph).
  - "Carry over yesterday's blocker" shortcut.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `standups`.
  - Alias `/standups` → `/engineering/standup` continues.
  - Mobile rendering preserves horizontal scroll for lane strips.
- **Risk:** Low–medium.
- **Effort:** M.

### §10.2 Lens 6 · Batch 2 — Reports + Admin surfaces

#### F-043 · Engineering Monthly Report

- **Path(s):** `/reports/engineering/monthly` (list) · `/reports/engineering/monthly/history` · `/reports/engineering/monthly/compare` · `/reports/engineering/monthly/:month/project/:projectId` (per-project view)
- **Lens (primary):** `ENGINEERING_MANAGER` (submits) · `PROGRAM_MANAGER`, `COO`, `CEO` (read)
- **Archetype:** W3 List (top-level) + W4 Detail (per-month) + W5b Wizard (submission flow per project)
- **User goal:** Monthly engineering narrative per project — hours, blockers, risks, planned vs actual, documents delivered. Aggregates into programme + company reports.
- **Current state:** `engineering-monthly-report-history.tsx`, `-compare.tsx`, `-project.tsx`. Existing set of 3 related pages + a list.
- **Data source:** Canonical — engineering monthly snapshots tied to `project_info` + `work_items` aggregations.
- **Visual improvements:**
  - Treat as a single functional suite in W4 Detail — top list of months, tabs Overview / History / Compare.
  - Per-project view (W4 Detail variant) — summary KPI strip (Hours / Tasks closed / Risks / Sign-off state) + tabs.
  - Compare view uses `FinancialDataGrid`-style side-by-side delta columns.
- **Additive:**
  - PDF export with brand logo + trust envelope footer.
  - "Copy last month forward" bootstrap for next draft.
  - Keyboard shortcut `c` to compare current with prior.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Permission entity `reports`.
  - Parametric routes (`:month/project/:projectId`) stable.
  - Report-history shape preserved (existing data visible in new UI).
- **Risk:** Low–medium.
- **Effort:** M–L.

#### F-044 · Engineering Templates (admin)

- **Path(s):** `/admin/eng-templates`
- **Lens (primary):** `ENGINEERING_MANAGER` (edit) · COO/CEO (admin)
- **Archetype:** W3 List + W4 Detail (per-template)
- **User goal:** Manage task-type templates (engineering deliverables, design reviews, site-survey checklists) that seed new projects.
- **Current state:** `client/src/pages/eng-template-admin.tsx`. Hidden from sidebar; Admin + EngMgr reach via direct URL.
- **Data source:** Canonical — templates in `shared/schema/template-overrides.ts` or similar (confirm Phase 3).
- **Visual improvements:**
  - W3 List with columns Template name / Category / Last edited / Used by N projects.
  - W4 Detail with tabs: Structure (items/sections) / Preview / History / Linked projects.
  - Item editor uses `Form` primitive + drag-sort.
- **Additive:**
  - Template versioning — edits create new versions rather than overwriting (existing `template-overrides` pattern).
  - Compare between versions.
  - "Apply to N projects" bulk propagate with diff preview + confirm.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Hidden from sidebar.
  - Permission entity `admin`.
  - Existing template-override behaviour (see `server/imports/` and Smart Import v2 rules) preserved.
- **Risk:** Medium — templates affect many projects.
- **Effort:** M.

#### F-045 · Engineering Audit Log (admin, view-only)

- **Path(s):** `/engineering/audit`
- **Lens (primary):** `COO_ADMIN`, `CEO_ADMIN`
- **Lens (secondary):** `ENGINEERING_MANAGER` (audit own team)
- **Archetype:** W3 List (read-only)
- **User goal:** See every engineering state change — who changed what, when, with the before/after values.
- **Current state:** Existing audit log page (`EngineeringAuditPage`). Dense table of events.
- **Data source:** Canonical — audit log tables.
- **Visual improvements:**
  - W3 `TableLayout` composition.
  - Event type chips (`StatusChip`).
  - Expand-row to show full payload diff.
  - Sticky user + timestamp columns on horizontal scroll.
- **Additive:**
  - Saved filters per user.
  - Export to CSV with trust envelope footer.
- **Half-built:** n/a.
- **Source-of-truth migration:** n/a.
- **Preserved behaviour contract:**
  - Hidden from sidebar.
  - Permission entity `admin` — read-only surface.
- **Risk:** Low.
- **Effort:** S–M.

#### F-046 · Engineering Intake (SharePoint)

- **Path(s):** `/admin/sharepoint-intake`
- **Lens (primary):** `COO_ADMIN` only (COO-only sync per CLAUDE.md Microsoft Integration rules)
- **Archetype:** W3 List with sync action panel
- **User goal:** Trigger and review the SharePoint "Proposals Pipeline" intake that seeds Engineering Support queue.
- **Current state:** `client/src/pages/SharePointIntakePage.tsx`. COO-only manual Pull/Push. Hidden from sidebar.
- **Data source:** MS Graph metadata + canonical intake tables.
- **Visual improvements:**
  - W3 List of pending intake items.
  - Sync status strip with `DataTrustBadge` (source = "SharePoint + Canonical").
  - Pull / Push actions in PageHeader — confirmation dialog with item count.
  - Mock-connector-in-dev preserved per `CLAUDE.md` rules.
- **Additive:**
  - Sync log — last N syncs with diff counts + duration.
  - "Dry-run" mode — preview effect of sync without applying.
- **Half-built:** Tangential to MS feature flags (`00b §A` #6, #11) — stays gated behind them.
- **Source-of-truth migration:** n/a (intake writes canonical).
- **Preserved behaviour contract:**
  - COO-only per `CLAUDE.md`.
  - Hidden from sidebar.
  - Never stores full email bodies / attachment content per `CLAUDE.md` rules.
- **Risk:** Medium — integration-gated.
- **Effort:** S.

### §10.3 Lens 6 summary — Engineering

**Total functions:** 7 new (F-040 · F-041 · F-042 · F-043 · F-044 · F-045 · F-046).

| Metric | |
|---|---|
| Effort | 1 L (F-041) · 3 M–L · 2 M · 1 S |
| Risk | 5 Medium · 2 Low |
| SoT migrations | 0 — all canonical |
| Finish-it candidates | `local_synced_save_flow` beta on F-041 (tangential) |

**Proposed Phase 3 ordering (this lens):**

- **Wave 1 foundation:** no specific target; rides Tier 1 Wave 1.
- **Wave 2 harvest:** F-041 Task Board (after TableLayout), F-045 Audit Log, F-046 SharePoint Intake.
- **Wave 3 harvest:** F-040 Engineering Dashboard (W2), F-042 Standup (W2), F-043 Monthly Report (W4 with tabs), F-044 Templates (W3 + W4).
- No new primitives needed for this lens.

---

**End of Lens 6.**

---

## §11 Tier 2 · Lens 7 — `CCO` + `KEY_ACCOUNTS_MANAGER` + `PROJECT_DEVELOPER` (Project Development)

**Role summary:** The sales → delivery bridge. All three land at `/pd`. Pipedrive is the source of truth for pipeline state; legacy SharePoint Proposals UI removed 2026-04-19. Roles vary in edit scope:

- **CCO** — head of PD; cross-cutting priorities + project creation authority
- **KAM** — client-relationship specialist; edits `pd_clients`, views portfolios
- **PD (Project Developer)** — deal executor; edits clients, lifecycle, handover

**Function count:** 2 new (F-047 · F-048) + several cross-references.

### §11.1 Cross-references

| Ref | Function | PD-lens use |
|---|---|---|
| F-015 | Clients (list + detail) | Primary surface for KAM/PD |
| F-021a | PD→PM Handover (v2) | PD executes handovers into delivery |
| F-037 | Priorities | CCO-primary edit rights |
| F-013 | Project Detail | Read-context for projects they developed |
| F-025/F-026 | Portfolios | KAM-primary view |

### §11.2 Lens 7 · Batch 1 — PD dedicated

#### F-047 · PD Dashboard

- **Path(s):** `/pd` · alias `/pd/dashboard` · LEGACY_REDIRECTS `/pd/tickets`, `/pd/tickets/create`, `/pd/tickets/:id`, `/pd/reports` all → `/opportunities`
- **Lens (primary):** `CCO`, `KEY_ACCOUNTS_MANAGER`, `PROJECT_DEVELOPER` (landing for all three)
- **Lens (secondary):** `PROGRAM_MANAGER`, `PROGRAM_FINANCE_MANAGER` (view)
- **Archetype:** W2 Dashboard
- **User goal:** Pipeline overview — stages / values / win rate / this-week closes — all from Pipedrive, rendered in-platform for context alongside projects.
- **Current state:** `PdDashboardPage`. Points at the merged Opportunities/Pipeline page. Pipedrive is source of truth.
- **Data source:** Canonical (for internal side) + Pipedrive integration (for pipeline side) via `server/routes/pipeline.routes.ts`. Mock connector in dev.
- **Visual improvements:**
  - W2 structure — status strip (pipeline value / weighted value / open deals / win rate / this-week closes) → primary: stage funnel chart → secondary: top opportunities list + recent activity → full-width: monthly trend.
  - `DataTrustBadge` strip with source = "Pipedrive + Canonical".
  - `Chart` primitive for the funnel (horizontal bar chart).
  - Stage chips via `StatusBadge`.
- **Additive functional improvements:**
  - "Open in Pipedrive" deep-link on any opportunity row.
  - Win/loss reason breakdown panel.
  - Pipeline-to-project conversion funnel (how many opps became projects).
  - Export pipeline snapshot to PDF for weekly sales meetings.
- **Half-built:** n/a direct.
- **Source-of-truth migration:** n/a — Pipedrive remains the pipeline source of truth (per `00-inventory.md §3.4` PD-PM Handover removed SharePoint Proposals 2026-04-19).
- **Preserved behaviour contract:**
  - Landing for CCO, KAM, PD.
  - Permission entity `pd_dashboard`.
  - All LEGACY_REDIRECTS from old PD routes continue to resolve.
  - Pipedrive sync mock-connector-in-dev preserved.
- **Risk:** Medium — integration-backed.
- **Effort:** M.

#### F-048 · Opportunities

- **Path(s):** `/opportunities`
- **Lens (primary):** `CCO`, `KEY_ACCOUNTS_MANAGER`, `PROJECT_DEVELOPER`
- **Lens (secondary):** PROGRAM_MANAGER (view)
- **Archetype:** W3 List + W4 Detail
- **User goal:** The full list of opportunities (merged Opportunities / Pipeline surface). Absorbed the legacy PD Tickets and SharePoint Proposals UI.
- **Current state:** `OpportunitiesPage`. Canonical merge surface — LEGACY_REDIRECTS from `/pd/tickets`, `/pd/tickets/create`, `/pd/tickets/:id`, `/pd/reports` all point here.
- **Data source:** Pipedrive via integration + canonical metadata (local project link, owner).
- **Visual improvements:**
  - W3 `TableLayout` for list — columns Name / Client / Stage / Value / Weighted value / Owner / Close date / Last activity.
  - `DataTrustBadge` with source = "Pipedrive + Canonical".
  - Stage chips via `StatusBadge`.
  - Value column tabular-nums with `R` prefix.
  - W4 `DetailLayout` per opportunity — summary strip (Stage / Value / Probability / Close date / Owner) + tabs Overview / Contacts / Activities / Documents / Linked project / Log.
- **Additive:**
  - Saved views per user (e.g. "This quarter closes", "At-risk opps").
  - Inline "Convert to project" action for won-stage opportunities (opens `/project-create` pre-filled).
  - Bulk reassign to another KAM / PD.
  - Export pipeline to CSV/XLSX.
- **Half-built:** n/a direct.
- **Source-of-truth migration:** n/a — Pipedrive is canonical for this entity.
- **Preserved behaviour contract:**
  - All 4 LEGACY_REDIRECTS from `/pd/tickets*` + `/pd/reports` continue to resolve here.
  - Permission entity `pd_dashboard` shared with F-047.
  - Pipedrive sync cadence + mock-connector preserved.
- **Risk:** Medium — integration-backed.
- **Effort:** M–L.

### §11.3 Lens 7 summary — Project Development

**Total functions:** 2 new (F-047 · F-048) + 5 cross-referenced.

| Metric | |
|---|---|
| Effort | 1 M · 1 M–L |
| Risk | 2 × Medium (both integration-backed) |
| SoT migrations | 0 — Pipedrive is canonical for pipeline; no internal-table migration needed |
| Finish-it candidates | None new |

**Proposed Phase 3 ordering (this lens):**

- **Wave 2 harvest:** F-048 Opportunities (after TableLayout).
- **Wave 3 harvest:** F-047 PD Dashboard (W2 composition), F-048 Opportunity detail (DetailLayout).

---

## §12 Tier 2 — COMPLETE

All three Tier 2 lenses planned. Totals:

| Lens | New functions | Cross-refs |
|---|---|---|
| 5 · `CONSTRUCTION_MANAGER` | 1 | 10+ |
| 6 · `ENGINEERING_MANAGER` + `ENGINEER` | 7 | minor |
| 7 · `CCO` + `KAM` + `PROJECT_DEVELOPER` | 2 | 5 |
| **Tier 2 total** | **10 new** | |

Running total across Tier 1+2: **47 functions planned** (F-001 through F-048). Zero new layout primitives needed beyond the 5 already specified in Tier 1.

**STOP for Tier 2 approval before Tier 3** (QM + HSE/SSEG) — smaller still, roughly 5 new functions.

---

**End of Tier 2 (§§9–12).**
