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

**End of batch 4.** 6 functions recorded (F-012, F-013, F-013a, F-013b, F-014, F-015). Next batch: Approvals domain — Approvals, Financial Review Queue, Weekly Reviews.
