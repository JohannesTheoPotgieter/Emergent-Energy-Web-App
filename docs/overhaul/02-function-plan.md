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

**End of batch 1.** 3 functions recorded. Next batch: Gates Pipeline + Blocked Gates (spine for the 7-lane Gates workspace).
