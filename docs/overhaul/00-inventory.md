# 00 — Function Inventory

**Phase 0 deliverable.** Read-only discovery pass. No code was modified to produce this.

> **Status:** Draft — §1 scope, lens, brand. §§2–5 appended in subsequent checkpoints.
> **Date started:** 2026-04-21

---

## §1.1 Scope & method

This artefact is the spine for the full Phase 0–4 overhaul. It records what exists today, per function, per role — so later phases can change visual and add functionality **without removing anything that's live**.

**In scope:**

- Every entry in `client/src/config/page-registry.ts` (the authoritative frontend route registry).
- Every server route file — both the 16 new `server/routes/*.routes.ts` and the 57 legacy `server/*-routes.ts`.
- Every `COMPANY_ROLES` entry (16 roles — see `shared/schema/users.ts:77-95`).
- Brand assets as rendered today (hex values extracted; logo path recorded).
- Top-level shape of `client/src/components/` (primitives vs feature modules).

**Out of scope for Phase 0** (and explicitly deferred):

- Per-page visual audit at pixel level. Pages are enumerated here; detailed per-page visual-state notes happen in Phase 2 (`02-function-plan.md`) as each function is planned.
- Per-endpoint behaviour walk for 73 server route files. The route **inventory** is produced in §3; per-endpoint behaviour contract is recorded in Phase 2 as each function is planned.
- Database query-level audit of every read. Entity-level read-path audit is in `00c-source-of-truth-audit.md` (separate artefact) — function-by-function line-level audit is Phase 3 per-function work.

**Method:**

1. Read the canonical config files (`page-registry.ts`, `users.ts`, `index.css`, `App.tsx`) to establish the spine.
2. Enumerate routes via `Glob` on `server/routes/*.routes.ts` + `server/*-routes.ts`.
3. Resolve permission-entity → role mapping from `shared/schema/users.ts` permission-group constants and runtime-access resolver (`client/src/config/runtime-access.ts`, `shared/schema/users.ts:314-1230` defaults).
4. Extract brand hex values from `client/src/index.css:249-254` (verified by grep — no invention).
5. Cross-check page-registry against `client/src/pages/**` for orphans (result: none found — see §5).

---

## §1.2 Lens definition (per user clarification, 2026-04-21)

A **lens** in this project is a **role-based view**. One lens per `COMPANY_ROLES` entry (16 roles). A lens is composed of:

1. A **landing page**, resolved by `ROLE_LANDING_PAGE` (`client/src/config/page-registry.ts:231-238`) for roles with `roleLandingEligibility`, or `/dashboard` → `/gates` fallback otherwise.
2. The **set of pages** the role can view, gated by:
   - `permissionEntity` on each page registry entry, resolved against `ENTITY_PERMISSION_DEFAULTS` (`shared/schema/users.ts:314-1230`) plus any runtime overrides in `role_permissions` / `user_permissions` tables.
   - App-section toggles (`sections` column on `role_permissions` — `shared/schema/users.ts:1329-1344`) — 10 sections (HOME, PROJECT_DELIVERY, PROJECT_DEVELOPMENT, ENGINEERING, QUALITY, HSE, FINANCE, PORTFOLIO, PRIORITIES, REPORTS, ADMIN).
3. The **navigation grouping** surfaced in the sidebar, driven by the 14 `NAV_GROUP_KEYS` and the `NAV_GROUP_TO_SECTION` mapping (`client/src/config/page-registry.ts:9-24, 273-288`).

The `LensProvider` React context (`client/src/hooks/use-lens-context.tsx`, mounted in `App.tsx:18,124`) already exists in code — Phase 1 work will extend it rather than replace it.

**The 16 lenses** (role → display label, from `COMPANY_ROLE_LABELS` at `shared/schema/users.ts:98-115`):

| Role key | Display label | Landing page |
|---|---|---|
| `COO_ADMIN` | COO | `/company-overview` |
| `CEO_ADMIN` | CEO | `/company-overview` |
| `CCO` | CCO | `/pd` |
| `CFO` | CFO | `/cashflow` |
| `PROGRAM_MANAGER` | Program Manager | `/execution-board` |
| `PROGRAM_FINANCE_MANAGER` | Program Finance Manager | `/cashflow` |
| `CONSTRUCTION_MANAGER` | Construction Manager | `/execution-board` |
| `QUALITY_MANAGER` | Quality Manager | `/quality` |
| `ENGINEERING_MANAGER` | Engineering Manager | `/engineering` |
| `KEY_ACCOUNTS_MANAGER` | Key Accounts Manager | `/pd` |
| `ACCOUNTANT` | Accountant | `/cashflow` |
| `ENGINEER` | Engineer | `/engineering` |
| `PROJECT_MANAGER_SITE` | Project Manager | `/execution-board` |
| `PROJECT_DEVELOPER` | Project Developer | `/pd` |
| `HSE_MANAGER` | HSE Manager | `/hse` |
| `SSEG_MANAGER` | SSEG Manager | `/hse` |

---

## §1.3 Brand assets (recorded — not modified)

Values extracted verbatim from `client/src/index.css`. Do not invent variants; Phase 1 tokens.ts must use these exact values as `--ee-brand-primary` etc.

### Logo

- **File:** `client/public/emergent-logo.png` (also at `public/emergent-logo.png` — identical bytes)
- **Dimensions:** 800 × 202 px, 8-bit PNG
- **Usages found:** `client/src/components/layout/AppLayout.tsx:251` (header, `h-7 w-auto`), `client/src/pages/login.tsx:113` (login screen)
- **Rule:** Preserved exactly. No recolouring, no cropping, no regeneration in Phase 1+.

### Primary brand colour

- **Hex:** `#16A34A` (Tailwind `emerald-600`)
- **Source:** `client/src/index.css:249` (`--cmd-brand`), `client/src/index.css:251` (`--cmd-green`)
- **HSL equivalent used for theme tokens:** `145 72% 32%` (`--primary` at `index.css:64`) and `142 76% 36%` (sidebar primary, animations — `index.css:99`). These two HSLs are not identical; the `#16A34A` hex is the canonical rendered colour.

### Brand accent

- **Hex:** `#22C55E` (Tailwind `emerald-500`)
- **Source:** `client/src/index.css:250` (`--cmd-brand-light`)

### Status colours (already in use across dashboards)

| Purpose | Hex | Source |
|---|---|---|
| Amber / warning | `#D97706` | `client/src/index.css:252` (`--cmd-amber`) |
| Red / danger | `#DC2626` | `client/src/index.css:253` (`--cmd-red`) |
| Blue / info | `#2563EB` | `client/src/index.css:254` (`--cmd-blue`) |

Semantic HSL equivalents used for theme tokens at `client/src/index.css:88-91`:

- `--success: 142 64% 36%`
- `--warning: 35 92% 45%`
- `--danger: 0 72% 51%`
- `--info: 214 78% 48%`

### Typography

- **Heading:** Barlow (`--font-heading`, `index.css:8`). Applied via `font-heading` utility + base `h1-h6` styling at `index.css:300-302`.
- **Body:** Inter (`--font-sans`, `index.css:7`). Applied at body root `index.css:268`.
- **Mono:** JetBrains Mono (`--font-mono`, `index.css:9`).

### Surfaces & shadows

- Neutral surface ladder: `--background` (white), `--surface` (`210 25% 99%`), `--surface-strong` (`210 25% 97%`), `--surface-tint` (`142 34% 97%` — brand-tinted).
- Shadows: `--shadow-xs`, `--shadow-sm`, `--shadow-md` (defined at `index.css:93-95`). These are the only approved elevation steps. Phase 1 must not add new ones without explicit sign-off.
- Radius scale: `--radius: 0.5rem` base, with `-sm` / `-md` / `-lg` derivatives (`index.css:48-50, 83`).

### Dark mode

Full parallel variable set exists at `index.css:107-158`. Phase 1 design-system tokens must expose both light and dark values — do not regress dark-mode support.

### Reduced-motion support

`@media (prefers-reduced-motion: reduce)` block already exists at `index.css:667-681, 898-910`. Phase 1 primitives must keep this honoured.

---

**End of §1.**

---

## §2 Canonical backend + navigation spine

Phase 0 findings that set the ground truth for every "source-of-truth" decision in later phases. Audit details live in `00c-source-of-truth-audit.md`; this section is the summary an overhaul reader needs without opening that file.

### §2.1 Canonical object-based backend — confirmed pattern

**It is not a single polymorphic "objects" table.** It is a **family of domain write-masters** — "one write-master per domain, everything else is adapter or read-model." (The phrase is from `docs/archive/CANONICAL_MODEL_DECISION_TABLE.md:14`.)

| Domain | Canonical write-master | Location | Notes |
|---|---|---|---|
| Tasks / work | `work_items` | `shared/schema/tasks.ts:147` | Unified across ENG / PM / QUALITY / PERSONAL workstreams. 75+ columns. Writable base table; view-based architecture retired (`migrations/20260409_retire_work_items_view.sql`). |
| Task assignments | `work_item_assignments` | `shared/schema/tasks.ts:319` | Roles: OWNER, ASSIGNEE, REVIEWER, VIEWER. |
| Task domain extensions | `work_item_pm`, `work_item_engineering`, `work_item_scheduling` | `shared/schema/tasks.ts:243-317` | 1:1 with `work_items` via UNIQUE FK; joined in `queryWorkItems()`. |
| Costs | `normalized_cost_lines` | `shared/schema/finance.ts:574` | Temporal snapshot table. `effective_to IS NULL` = current row — MUST be applied on every aggregate read. |
| Revenue | `normalized_revenue_lines` | `shared/schema/finance.ts:489` | Temporal snapshot table. Same `effective_to` guard. |
| Project identity | `project_info` | `shared/schema/projects.ts:169` | Canonical project metadata. Upsert key: `projectCode` (Smart Import v2). |
| Project lifecycle state | `project_execution_state` | `shared/schema/projects.ts:207` | Phase, gate status, RAG, financial review tracking. Split from `project_info` but read together. |
| Approvals | `approvals` | referenced by `server/approvals-routes.ts:18` | Single write-master for finance / delivery / quality / engineering / HSE approvals. |
| Deliverables | `deliverables` | referenced by `server/approvals-routes.ts:16` | Execution board deliverables. |

**Legacy adapter tables** — still exist, still readable for backfill/reference, but new code must NOT read from them once the canonical equivalent is live:

- Tasks: `operational_tasks`, `mytool_tasks`, `normalized_plan_tasks` (backfilled into `work_items` 2026-04-09).
- Costs: `program_expense` / `programExpense` (legacy PE shape — replaced by `normalized_cost_lines`).
- Revenue: `program_inflows` / `programInflows` (legacy PI shape — replaced by `normalized_revenue_lines`).

Per `CLAUDE.md`, `server/work-items-adapter.ts` and `server/work-items-backfill.ts` are "read-only reference; do not extend them for new features."

### §2.2 State of the canonical migration as of 2026-04-21

Much better than anticipated. The SoT audit (`00c-source-of-truth-audit.md`) found:

- **Tasks.** All workstream reads (ENG tasks, PM tasks, My Work, operational) now route through `work_items`. Zero remaining legacy reads on new code paths. Feature flag `canonical_work_items_v1` promotes the surface.
- **Costs.** `normalized_cost_lines` is the sole read source across COS dashboard, Cashflow, Company Overview, Home Dashboard, Data Quality Dashboard. `program_expense` reads decommissioned.
- **Revenue.** `normalized_revenue_lines` is the sole read source across Revenue Tracker, milestone linking, monthly reports. `program_inflows` reads decommissioned.
- **Projects / lifecycle / approvals / deliverables.** All read from canonical tables directly.

**One hybrid remaining** — recorded as the highest-priority canonical clean-up:

- `server/lib/cashflow-helpers.ts:resolveInflowEffectiveDates()` still reads from legacy `operationalTasks` and `normalized_plan_tasks` to resolve milestone → effective-date hierarchy for revenue recognition. This is an internal helper (not a page-level read) but it feeds the Cashflow forecast. Migration target: move task-link resolution into `normalized_revenue_lines` extension or `projectExecutionState.financialReviewId`.

**Practical consequence for Phase 2+ planning:** source-of-truth migration work is nearly done. The overhaul focuses on **visual polish + additive function**, not on rescuing reads. Any screen we touch that still hand-rolls a fetcher should adopt the shared canonical hooks (Phase 1 §1.4 data-access primitives) rather than reroute plumbing.

### §2.3 Navigation spine

The sidebar is **two-layered**:

**Layer 1 — 14 nav groups** (sidebar buckets, `client/src/config/page-registry.ts:9-24`):

`MY_WORK`, `PORTFOLIO`, `PRIORITIES`, `PROJECT_DEVELOPMENT`, `PROJECTS`, `PROJECT_MANAGEMENT`, `GATES`, `FINANCE`, `ENGINEERING`, `QUALITY`, `HSE`, `REPORTS`, `KNOWLEDGE`, `SYSTEM`.

**Layer 2 — 10 app sections** (role-level toggles, source: `NAV_GROUP_TO_SECTION` at `client/src/config/page-registry.ts:273-288`; enum: `shared/schema/users.ts:1329-1344`):

| Section | Nav groups folded into it |
|---|---|
| `HOME` | MY_WORK |
| `PROJECT_DELIVERY` | PROJECTS, PROJECT_MANAGEMENT |
| `PROJECT_DEVELOPMENT` | PROJECT_DEVELOPMENT |
| `ENGINEERING` | ENGINEERING |
| `QUALITY` | QUALITY |
| `HSE` | HSE |
| `FINANCE` | FINANCE |
| `PORTFOLIO` | PORTFOLIO, GATES |
| `PRIORITIES` | PRIORITIES |
| `REPORTS` | REPORTS |
| `ADMIN` | KNOWLEDGE, SYSTEM |

**Access is resolved through** (chain, every link verified):

1. User role (from `users.role` or `company_role` localStorage) → normalized via `normalizeRoleForPermissions` (`shared/schema/users.ts:299-302`).
2. Page path → `permissionEntity` via `getPermissionEntityForPath` (`client/src/config/page-registry.ts:258`).
3. `(entity, action)` → allow / deny via `evaluateEntityAccess` (`client/src/config/runtime-access.ts:37-57`), which checks in order: user override → runtime entity permissions → `ENTITY_PERMISSION_DEFAULTS` (`shared/schema/users.ts:314-1230`).
4. Top-level visibility also gated by `role_permissions.sections` DB column (`shared/schema/users.ts:1329-1344`) — role can have `ADMIN` hidden entirely.

**Implications for Phase 1+:**

- New pages must be added to `PAGE_REGISTRY` with `permissionEntity` + `navGroup`.
- Section-level role visibility is **runtime-configurable** per tenant in `role_permissions`; do not hardcode assumptions based on defaults.
- The `LensProvider` context (`client/src/hooks/use-lens-context.tsx`) is the right hook-point for per-role lens adaptation — extend, do not replace.

---

**End of §2.**

---

## §3 Page inventory — grouped by nav group

Source of truth for this table: `client/src/config/page-registry.ts` (113 PAGE_REGISTRY entries + 15 LEGACY_REDIRECTS, audited 2026-04-21).

### Legend

- **Status**: `Active` = renders a component & shown in sidebar. `Hidden` = renders a component, sidebar suppressed (`showInSidebar: false`). `Alias` = redirect-only entry. `Detail` = parametric route reachable from a parent (`:id`, `:projectName`, etc.).
- **Edit roles** uses the permission-group constants in `shared/schema/users.ts:117-149` where they apply, otherwise lists explicitly:
  - **All** = all 16 `COMPANY_ROLES` (`ALL_STAFF_ROLES`)
  - **Admin** = `COO_ADMIN, CEO_ADMIN` (`ADMIN_ROLES`)
  - **Finance Edit** = `COO_ADMIN, CEO_ADMIN, CFO, PROGRAM_FINANCE_MANAGER, ACCOUNTANT` (`FINANCE_EDIT_ROLES`)
  - **Eng Edit** = `COO_ADMIN, CEO_ADMIN, ENGINEERING_MANAGER, PROGRAM_MANAGER, ENGINEER, SSEG_MANAGER` (`ENG_EDIT_ROLES`)
  - **Q/HSE Edit** = `COO_ADMIN, CEO_ADMIN, QUALITY_MANAGER, CONSTRUCTION_MANAGER, HSE_MANAGER` (`QUALITY_HSE_EDIT_ROLES`)
- **Landing** column lists roles for which this is the post-login default (`roleLandingEligibility`).
- View roles are not column-listed because most pages match a permission group; full view/edit matrix is in §4.

### §3.1 MY_WORK — `Section: HOME`

Daily personal workspace. All staff have access; sub-pages may further gate.

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/my-work` | My Work | `home` | Admin | Active | `matchSubRoutes`. Personal dashboard. |
| `/inbox` | Inbox | `home` | Admin | Hidden | Direct URL only. |
| `/my-work/calendar` | Calendar | `my_work` | All | Active | Personal calendar — Outlook-bridged. |
| `/my-work/tasks` | Tasks | `my_tool` | All | Active | Personal task board (PERSONAL bucket of `work_items`). |
| `/my-work/approvals` | Approvals | `my_work` | All | Alias → `/my-work/tasks?source=approvals` | Duplicate entry-point per Prompt 0.7 — kept for deep links. |
| `/my-work/meetings` | Meetings | `meetings` | All | Active | Outlook calendar surface. |
| `/my-work/email` | Email | `collaboration_hub` | Admin+PM/PFM/CM/PMS | Hidden | Outlook inbox preview. |
| `/my-work/teams` | Teams Chat | `teams_chat` | All | Active | MS Teams chat surface. |
| `/my-work/settings` | Settings | `home` | Admin | Hidden | Per-user My Work prefs. |
| `/admin/my-tool-settings` | My Work Settings | `admin` | Admin | Detail | Admin-only override panel. |

### §3.2 PORTFOLIO — `Section: PORTFOLIO`

Cross-portfolio view (executive lens).

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/company-overview` | Company Overview | `execution_board` | Admin+PM | Active | **Landing**: COO_ADMIN, CEO_ADMIN. |
| `/lifecycle-board` | Lifecycle Board | `lifecycle` | Admin+PM | Active | Cross-project lifecycle stage view. |

### §3.3 PRIORITIES — `Section: PRIORITIES`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/priorities` | Priorities | `company_priorities` | Admin+CCO | Active | Company priorities list. |
| `/priorities/:id` | Priority Detail | `company_priorities` | Admin+CCO | Detail | |
| `/company-priorities` | Company Priorities | `company_priorities` | — | Alias → `/priorities` | Legacy redirect. |

### §3.4 PROJECT_DEVELOPMENT — `Section: PROJECT_DEVELOPMENT`

CCO / KAM / PD lens. Pipedrive is now the source of truth; legacy SharePoint Proposals UI removed 2026-04-19.

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/pd` | PD Dashboard | `pd_dashboard` | Admin | Active | **Landing**: CCO, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER. Aliases `/pd/dashboard`. |
| `/opportunities` | Opportunities | `pd_dashboard` | Admin | Active | Merged Pipeline / Opportunities surface. |
| `/pd/tickets` | PD Tickets (moved) | `pd_dashboard` | — | Alias → `/opportunities` | Legacy. |
| `/pd/tickets/create` | Create Ticket (moved) | `pd_dashboard` | — | Alias → `/opportunities` | Legacy. |
| `/pd/tickets/:id` | Ticket Detail (moved) | `pd_dashboard` | — | Alias → `/opportunities` | Legacy. |
| `/pd/reports` | PD Reports (moved) | `pd_dashboard` | — | Alias → `/opportunities` | Legacy. |

### §3.5 PROJECTS — `Section: PROJECT_DELIVERY`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/projects` | Project List | `projects` | Admin+CCO+PM+PFM+CM | Active | Master project list. |
| `/clients` | Clients | `pd_clients` | Admin+CCO+KAM+PD | Active | Client list. Alias `/pd/clients`. |
| `/clients/:clientId` | Client Detail | `pd_clients` | Admin+CCO+KAM+PD | Detail | |
| `/clients/:clientId/project/:projectId` | Project Departments | `pd_clients` | Admin+CCO+KAM+PD | Detail | |
| `/sites` | Sites | `projects` | Admin+CCO+PM+PFM+CM | Active | Site list (Phase B addition). |
| `/project-lifecycle` | Project Lifecycle | `lifecycle` | Admin+PM | Active | Project-scoped lifecycle. |
| `/project-lifecycle/stage-gates` | Stage Gates | `lifecycle` | Admin+PM | Detail | |
| `/project-lifecycle/latest-updates` | Latest Updates | `projects` | Admin+CCO+PM+PFM+CM | Detail | |
| `/project-lifecycle/client-overview` | Client Overview | `pd_clients` | Admin+CCO+KAM+PD | Detail | |

### §3.6 PROJECT_MANAGEMENT — `Section: PROJECT_DELIVERY`

The biggest delivery group. Site PM / Construction Manager / Program Manager primary lens.

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/execution-board` | Execution Board | `execution_board` | Admin+PM | Active | **Landing**: PROJECT_MANAGER_SITE, COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER, CONSTRUCTION_MANAGER. `matchSubRoutes`, alias `/execution-dashboard`. |
| `/execution-board/program` | Program View | `execution_board` | Admin+PM | Detail | |
| `/execution-board/finance` | Program Finance | `execution_board` | Admin+PM | Detail | |
| `/execution-dashboard` | Execution Dashboard | `execution_board` | Admin+PM | Hidden | Same component, alternate path. |
| `/pm-dashboard` | PM Dashboard | `pm_dashboard` | (entity-specific) | Active | Site-PM dashboard. |
| `/pm/on-the-go` | PM On-The-Go | `pm_on_the_go` | (entity-specific) | Active | Mobile PM workflow. |
| `/pm/on-the-go/project/:projectId` | On-The-Go Project | `pm_on_the_go` | (entity-specific) | Detail | |
| `/pm/approvals` | Approvals | `approvals` | Admin+QM+EngM+CM+PMS | Active | Canonical approvals queue. |
| `/pm/deliverables` | PM Deliverables (Retired) | `deliverables` | — | Alias → `/pm/approvals` | Retired Phase 1 EPC. |
| `/governance/financial-reviews` | Financial Review Queue | `approvals` | Admin+QM+EngM+CM+PMS | Active | Finance approval sub-queue. |
| `/portfolios` | Portfolios | `portfolios` | Admin+PM | Active | Portfolio rollups. |
| `/portfolios/:id` | Portfolio Detail | `portfolio_detail` | Admin+PM | Detail | |
| `/handover` | Handover & Closeout | `handover` | Admin+PM+PD | Active | Top-level handover surface. |
| `/handover-control` | Handover Control | `handover` | Admin+PM+PD | Active | COO control view. |
| `/pd/handover/:projectId` | PD to PM Handover | `handover` | Admin+PM+PD | Detail | v2; v1 removed 2026-03-31. |
| `/pm/handover-review` | PM Handover Review | `handover` | Admin+PM+PD | Detail | |
| `/milestone-tracker` | Milestone Tracker | `execution_board` | Admin+PM | Active | Construction Manager view. |
| `/po-approval-board` | PO Approvals | `procurement` | Admin+PM+PFM | Active | EPC Phase 1. |
| `/payment-request-board` | Payment Requests | `procurement` | Admin+PM+PFM | Active | EPC Phase 1. |
| `/payment-batch-manager` | Payment Batches | `procurement` | Admin+PM+PFM | Active | EPC Phase 1. |
| `/procurement` | Procurement | `execution_board` | — | Alias → `/execution-board` | |
| `/weekly-reviews` | Weekly Reviews | `weekly_review_wizard` | Admin+PM+PFM+CM+PMS | Hidden | |
| `/standups` | Standups | `standups` | Admin+PM+EngM+CM | Alias → `/engineering/standup` | |
| `/project/:projectName` | Project Detail | `projects` | Admin+CCO+PM+PFM+CM | Detail | Per-project drill-in. |
| `/project/:projectName/financial-linking` | Financial Linking | `financial_linking` | Admin+CFO | Detail | |
| `/project/:projectName/gate/:stageCode` | Project Stage Gate | `stage_lifecycle` | Admin+PM+CM+PMS+PD | Detail | |
| `/project-create` | Create Project | `project_creation` | Admin+CCO | Detail | |
| `/actions/launchpad` | Quick Create | `work_items` | (work_items edit) | Detail | Cmd-K creation surface. |

### §3.7 GATES — `Section: PORTFOLIO`

Newer (Prompt 2) workspace. All gated by `lifecycle`. Edit: Admin + PROGRAM_MANAGER.

| Path | Label | Permission entity | Status |
|---|---|---|---|
| `/gates` | Gates Pipeline | `lifecycle` | Active |
| `/gates/blocked` | Blocked Gates | `lifecycle` | Active |
| `/gates/ready` | Ready Gates | `lifecycle` | Active |
| `/gates/exceptions` | Gate Exceptions | `lifecycle` | Active |
| `/gates/client-updates` | Client Updates | `lifecycle` | Active |
| `/gates/handovers` | Handover Queue | `lifecycle` | Active |
| `/gates/queries` | Open Queries | `lifecycle` | Active |
| `/gates/commitments` | Client Commitments | `lifecycle` | Active |

### §3.8 FINANCE — `Section: FINANCE`

CFO / PFM / Accountant primary lens. All edit: **Finance Edit** unless noted.

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/cashflow` | Cashflow | `cashflow` | Finance Edit | Active | **Landing**: CFO, PROGRAM_FINANCE_MANAGER, ACCOUNTANT. |
| `/cos` | COS | `cos` | Finance Edit | Active | Cost-of-sales tracker. |
| `/revenue-tracker` | Revenue | `revenue_tracker` | Finance Edit | Active | |
| `/finance/quickbooks` | QB Throughput | `financials` | Finance Edit | Active | Absorbs QB Mapping, Linking, Counterparties, Subcontractors, Invoice Patterns, Admin QB. |
| `/finance/quickbooks-customer-mapping` | QB Customer Mapping | `financials` | Finance Edit | Hidden | Absorbed; route retained. |
| `/finance/quickbooks-links` | QB Bill Linking | `financials` | Finance Edit | Hidden | Absorbed; route retained. |
| `/invoice-patterns` | Invoice Patterns | `invoice_patterns` | Admin+PFM | Hidden | Absorbed into QB Throughput. |
| `/counterparties` | Counterparties | `counterparties` | Admin+PFM+PM+CM | Hidden | Absorbed into QB Throughput. |
| `/subcontractor-dashboard` | Subcontractors | `subcontractors` | Admin+PFM+PM+CM | Hidden | Absorbed into QB Throughput. |
| `/revenue` | Revenue (Legacy) | `revenue_tracker` | — | Alias → `/revenue-tracker` | |
| `/cos-control` | COS Control (Legacy) | `cos` | — | Alias → `/cos` | |
| `/cashflow-forecast` | Cashflow Forecast (Legacy) | `cashflow` | — | Alias → `/cashflow` | |

### §3.9 ENGINEERING — `Section: ENGINEERING`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/engineering` | Engineering | `engineering` | Eng Edit | Active | **Landing**: ENGINEERING_MANAGER, ENGINEER. |
| `/engineering/tasks` | Task Board | `eng_tasks` | Admin+EngM+PM+Eng | Active | |
| `/engineering/standup` | Engineering Standup | `standups` | Admin+PM+EngM+CM | Active | |
| `/engineering/audit` | Engineering Audit Log | `admin` | Admin | Hidden | |

### §3.10 QUALITY — `Section: QUALITY`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/quality` | Quality | `quality` | Q/HSE Edit | Active | **Landing**: QUALITY_MANAGER. |
| `/quality/dashboard` | Quality Dashboard | `quality` | — | Alias → `/quality` | |
| `/quality/ncrs` | NCR List (Legacy) | `quality` | — | Alias → `/quality` | |
| `/quality/ncr/:id` | NCR Detail (Legacy) | `quality` | — | Alias → `/quality` | |
| `/commissioning-dashboard` | Commissioning | `commissioning` | Admin+PM+CM+PMS | Active | |
| `/commissioning-dashboard/:projectId` | Commissioning Dashboard | `commissioning` | Admin+PM+CM+PMS | Detail | |

### §3.11 HSE — `Section: HSE`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/hse` | Health, Safety & Environment | `hse` | Admin+HSE+CM+QM | Active | **Landing**: HSE_MANAGER, SSEG_MANAGER. |
| `/hse/compliance` | Compliance / SSEG | `hse_compliance` | Admin+HSE+SSEG | Alias → `/hse?tab=compliance` | |

### §3.12 REPORTS — `Section: REPORTS`

All gated by `reports` (view: All staff; edit: Admin + PM + PFM + CM + EngM) unless noted.

| Path | Label | Permission entity | Status | Notes |
|---|---|---|---|---|
| `/reports/programme` | Programme Reports | `reports` | Active | |
| `/reports/center` | Report Center | `reports` | Hidden | |
| `/reports/performance` | Performance | `performance` | Hidden | View: senior roles only. |
| `/reports/pm/monthly` | PM Monthly Report | `reports` | Active | |
| `/reports/pm/monthly/history` | PM Report History | `reports` | Hidden | |
| `/reports/pm/monthly/compare` | PM Report Compare | `reports` | Detail | |
| `/reports/pm/monthly/:month/project/:projectId` | PM Report Project | `reports` | Detail | |
| `/reports/engineering/monthly` | Engineering Monthly Report | `reports` | Active | |
| `/reports/engineering/monthly/history` | Engineering Report History | `reports` | Hidden | |
| `/reports/engineering/monthly/compare` | Engineering Report Compare | `reports` | Detail | |
| `/reports/engineering/monthly/:month/project/:projectId` | Engineering Report Project | `reports` | Detail | |

### §3.13 KNOWLEDGE — `Section: ADMIN`

| Path | Label | Permission entity | Edit roles | Status | Notes |
|---|---|---|---|---|---|
| `/ee-info` | Processes & SOPs | `ee_info` | Admin | Active | |
| `/leaderboard` | Leaderboard | `leaderboard` | Admin | Hidden | |
| `/feedback` | Feedback & Support | `feedback` | All | Hidden | Not actively monitored per Prompt 0.7. |
| `/training` | Training | `training` | Admin | Hidden | |
| `/department-scores` | Department Scores | `leaderboard` | — | Alias → `/leaderboard?tab=departments` | |

### §3.14 SYSTEM — `Section: ADMIN`

All `permissionEntity: admin` (Admin edit) unless noted.

| Path | Label | Permission entity | Status | Notes |
|---|---|---|---|---|
| `/admin/control-center` | Control Center | `admin` | Hidden | Admin landing target (`/admin` → here). |
| `/admin/sharepoint-intake` | SharePoint Intake | `admin` | Hidden | COO-only manual sync trigger. |
| `/admin/smart-import` | Smart Import | `smart_import` | Hidden | Excel pipeline UI. |
| `/admin/activity-log` | Activity Log | `activity_log` | Hidden | |
| `/admin/roles` | Roles & Permissions | `admin_roles` | Hidden | RBAC admin. |
| `/admin/database-migration` | Database Migration | `database_migration` | Detail | |
| `/admin/kpi-traceability` | KPI Traceability | `admin` | Hidden | |
| `/admin/import-control-tower` | Import Control Tower | `admin` | Hidden | |
| `/admin/recovery` | Recovery Center | `admin` | Hidden | |
| `/admin/stage-lifecycle` | Stage Lifecycle | `stage_admin` | Hidden | |
| `/admin/eng-templates` | Engineering Templates | `admin` | Hidden | |
| `/admin/phase-templates` | Phase Templates | `admin` | Hidden | |
| `/admin/lessons` | Lessons Learnt | `handover` | Hidden | PD-PM v2 extension. |
| `/admin/handover-health` | Handover Health Score | `handover` | Hidden | **In-progress**: UI exists, backend wiring incomplete (see `00b-half-built.md`). |
| `/admin/settings` | System Settings | `admin` | Hidden | |
| `/admin/workflow-config` | Workflow Configuration | `admin` | Hidden | |
| `/admin/data-migration-status` | Data Migration Status | `admin` | Hidden | |
| `/admin/pipedrive` | Pipedrive Integration | `admin` | Hidden | |
| `/admin/quickbooks` | QuickBooks Integration | `admin` | Hidden | |

### §3.15 LEGACY_REDIRECTS

Bookmarks/deep-link compatibility. Defined separately at `client/src/config/page-registry.ts:55-73` so they don't pollute the command palette / sidebar.

| From | To | Reason |
|---|---|---|
| `/dashboard` | `/gates` | Old `/dashboard` → `/execution-board` → `/gates` chain collapsed. |
| `/revenue` | `/revenue-tracker` | Path standardised. |
| `/my-tool` | `/` | Workspace renamed → My Work. |
| `/my-tool/week` | `/my-work/calendar` | |
| `/my-tool/backlog` | `/my-work/tasks` | |
| `/my-tool/settings` | `/my-work/settings` | |
| `/my-tool/help` | `/` | |
| `/my-tool/meetings` | `/my-work/meetings` | |
| `/company-priorities` | `/priorities` | |
| `/admin` | `/admin/control-center` | |
| `/admin/legacy-utilities` | `/admin/control-center` | |
| `/exceptions` | `/gates/exceptions` | Prompt 2 reorg. |
| `/project-lifecycle` | `/lifecycle-board` | Prompt 2 reorg. |
| `/command-center` | `/my-work` | Prompt 2 reorg. |
| `/sseg` | `/handover?tab=sseg` | Prompt 2 reorg. |

### §3.16 Counts

| Category | Count |
|---|---|
| Active sidebar pages | ~50 |
| Hidden routable pages | ~46 |
| Detail / parametric routes | ~12 |
| Internal aliases (in PAGE_REGISTRY) | ~18 |
| Legacy redirects (LEGACY_REDIRECTS) | 15 |
| **Total registered routes** | **~141** |

---

**End of §3.**

---

## §4 Server route inventory + access matrix

### §4.1 Server routes — dual-pattern state

Two route conventions coexist today. Per `CLAUDE.md`:

- **New style**: `server/routes/<domain>.routes.ts` (dot-separator). Registered via `server/routes/index.ts`.
- **Legacy style**: `server/<domain>-routes.ts` (hyphen-separator). Mounted via `registerLegacyRoutes()` in `server/routes.ts`.

Per the standing rule: **do not create new files in the legacy style**. Edit legacy files only when extending or fixing legacy domains.

#### New-style routes — 16 files

| File | Domain | Notes |
|---|---|---|
| `server/routes/admin.routes.ts` | Admin / control center | |
| `server/routes/auth.routes.ts` | Authentication (MS SSO + fallback) | |
| `server/routes/dashboard.routes.ts` | Dashboards (home, overview) | |
| `server/routes/documents.routes.ts` | Documents (SharePoint metadata) | |
| `server/routes/engineering.routes.ts` | Engineering domain | **Dual mount** with `server/engineering-routes.ts` (3607 lines). |
| `server/routes/financials.routes.ts` | Finance (canonical normalizedCost/Revenue) | |
| `server/routes/imports.routes.ts` | Smart Import v2 | |
| `server/routes/microsoft.routes.ts` | MS Graph integrations | **Dual mount** with `server/microsoft-integration-enhancements-routes.ts`. |
| `server/routes/notifications.routes.ts` | Notification fan-out | |
| `server/routes/pd-intake.routes.ts` | Project Development intake | |
| `server/routes/pipeline.routes.ts` | Pipedrive pipeline | |
| `server/routes/projects.routes.ts` | Project identity / metadata | |
| `server/routes/quality.routes.ts` | Quality domain | **Dual mount** with `server/quality-routes.ts` (2500 lines). |
| `server/routes/reports.routes.ts` | Monthly & programme reports | |
| `server/routes/tasks.routes.ts` | work_items | |
| `server/routes/users.routes.ts` | User CRUD + role mgmt | |

#### Legacy routes — 57 files

Grouped by intent. Files flagged **(dual)** have a new-style equivalent already present — migration in progress; both files mount handlers today.

**Domain — canonical migration targets:**

- `engineering-routes.ts` **(dual with `routes/engineering.routes.ts`)** — 3607 lines
- `quality-routes.ts` **(dual with `routes/quality.routes.ts`)** — 2500 lines
- `microsoft-integration-enhancements-routes.ts` **(dual with `routes/microsoft.routes.ts`)** — 36 lines, feature-gated
- `commissioning-routes.ts` + `commissioning-dashboard-routes.ts` — absorbed into `quality.routes.ts`
- `quality-ncr-routes.ts` — NCR endpoints (quality sub-domain)
- `eng-stage-routes.ts`, `engineering-intake-routes.ts` — engineering sub-domains

**Domain — no new-style equivalent yet:**

- `approvals-routes.ts` — approvals + deliverables (canonical write-master); needs `routes/approvals.routes.ts`
- `payment-batch-routes.ts`, `payment-request-routes.ts`, `po-routes.ts`, `procurement-routes.ts`, `proof-of-payment-routes.ts` — EPC Phase 1 procurement
- `invoice-capture-routes.ts`, `invoice-pattern-routes.ts`, `financial-review-routes.ts` — finance ops
- `quickbooks-routes.ts` — QB sync
- `subcontractor-routes.ts`, `tr-register-routes.ts` — finance sub-domains
- `pd-routes.ts` — PD backend
- `pm-routes.ts`, `pm-on-the-go-routes.ts` — PM backend
- `handover-routes.ts` — handover domain
- `lifecycle-routes.ts`, `stage-lifecycle-routes.ts`, `stage-collaboration-routes.ts`, `stage-data-routes.ts` — lifecycle/stage
- `standup-routes.ts` — engineering standup
- `task-management-routes.ts` — work_items admin
- `meeting-routes.ts` — MS meetings
- `collaboration-workflow-routes.ts` — collab hub
- `portfolio-routes.ts` — portfolio rollup
- `dependency-routes.ts`, `raid-routes.ts` — RAID / dependencies
- `deliverable-capture-routes.ts` — legacy deliverables (canonical now in `approvals`)
- `change-control-routes.ts` — change control
- `weekly-review-routes.ts` — weekly review wizard
- `template-routes.ts` — phase/engineering templates
- `smart-import-routes.ts` — Smart Import v2 runtime (active; not the same as `routes/imports.routes.ts` which handles import metadata/history)
- `role-auth-routes.ts` — role assignment
- `user-dashboard-preferences-routes.ts` — user prefs

**Platform/system (cross-cutting):**

- `platform-routes.ts`, `audit-routes.ts`, `sync-routes.ts`, `ms-sync-routes.ts`, `gamification-routes.ts`, `notification-routes.ts`, `analytics-routes.ts`, `admin-control-routes.ts`, `admin-recovery-routes.ts`, `migration-finalize-routes.ts`, `exception-dashboard-routes.ts`, `kpi-traceability-routes.ts`, `project-events-routes.ts`, `ee-info-routes.ts`

#### Observations

- **73 total server route files.** The new-style migration is ~22% complete by file count, but the new files concentrate the highest-traffic domains (auth, projects, financials, tasks).
- **Dual-mount risk** on `engineering` / `quality` / `microsoft` — both legacy and new files register handlers; handler precedence depends on mount order in `server/routes.ts`. Flagged for backlog audit in `00b-half-built.md §C`.
- **No writes-from-routes rule**: all mutating handlers must go through `server/repositories/*`. Assumed honoured — spot-check during per-function Phase 2 work.

### §4.2 Permission-entity × role access matrix

Source: `ENTITY_PERMISSION_DEFAULTS` at `shared/schema/users.ts:314-1230`, resolved through `evaluateEntityAccess` (`client/src/config/runtime-access.ts:37-57`). Runtime `role_permissions` rows override these defaults per tenant.

**Matrix layout**: one row per permission entity referenced by `PAGE_REGISTRY`. Columns V (view) and E (edit). Cell compression:

- `All` = all 16 `COMPANY_ROLES`
- `Admin` = `COO_ADMIN, CEO_ADMIN`
- Otherwise: explicit role list (short codes — `COO, CEO, CCO, CFO, PM, PFM, CM, QM, EngM, KAM, Acct, Eng, PMS, PD, HSE, SSEG`)

| Entity | View (V) | Edit (E) |
|---|---|---|
| `home` | All | Admin |
| `my_work` | All | All |
| `my_tool` | All | All |
| `meetings` | All | All |
| `collaboration_hub` | All | Admin, PM, PFM, CM, PMS |
| `teams_chat` | All | All |
| `feedback` | All | All |
| `ee_info` | All | Admin |
| `training` | All | Admin |
| `leaderboard` | All | Admin |
| `reports` | All | Admin, PM, PFM, CM, EngM |
| `standups` | All except ACCOUNTANT-edit | Admin, PM, EngM, CM |
| `work_items` | All | Admin, PM, PFM, CM, PMS, Eng |
| `stage_lifecycle` | All | Admin, PM, CM, PMS, PD |
| `projects` | All | Admin, CCO, PM, PFM, CM |
| `company_priorities` | Admin, CCO, CFO, PM, PFM, CM, QM, EngM, KAM, HSE, SSEG | Admin, CCO |
| `engineering` | Admin, CCO, PM, PFM, QM, EngM, PMS, PD, Eng, SSEG | Admin, EngM, PM, Eng, SSEG |
| `eng_tasks` | Admin, CCO, PM, QM, EngM, PMS, PD, Eng | Admin, EngM, PM, Eng |
| `quality` | Admin, CCO, PM, PFM, CM, QM, EngM, PMS, PD, HSE, SSEG | Admin, QM, CM, HSE |
| `hse` | Admin, CCO, PM, PFM, CM, QM, EngM, PMS, HSE, SSEG | Admin, HSE, CM, QM |
| `hse_compliance` | Admin, CCO, PM, PFM, CM, QM, EngM, PMS, HSE, SSEG | Admin, HSE, SSEG |
| `commissioning` | Admin, CCO, PM, PFM, CM, QM, EngM, PMS, PD, Eng, HSE, SSEG | Admin, PM, CM, PMS |
| `cashflow` | Admin, CCO, CFO, PM, PFM, Acct, PMS | Admin, CFO, PFM, Acct |
| `cos` | Admin, CCO, CFO, PM, PFM, Acct, PMS | Admin, CFO, PFM, Acct |
| `revenue_tracker` | Admin, CCO, CFO, PM, PFM, Acct | Admin, CFO, PFM, Acct |
| `financials` | Admin, CCO, CFO, PM, PFM, Acct | Admin, CFO, PFM, Acct |
| `financial_linking` | Admin, CFO, PFM, Acct | Admin, CFO |
| `invoice_patterns` | Admin, CFO, PFM | Admin, PFM |
| `counterparties` | Admin, CCO, CFO, PM, PFM, CM, Acct | Admin, PFM, PM, CM |
| `subcontractors` | Admin, CCO, CFO, PM, PFM, CM, Acct | Admin, PFM, PM, CM |
| `procurement` | Admin, CCO, CFO, PM, PFM, CM | Admin, PFM, PM |
| `lifecycle` | Admin, CCO, CFO, PM, PFM, CM, QM, EngM, KAM, PMS, PD, HSE, SSEG | Admin, PM |
| `execution_board` | All except Eng-edit | Admin, PM |
| `pd_dashboard` | Admin, CCO, PM, KAM, PD | Admin |
| `pd_clients` | Admin, CCO, KAM, PD | Admin, CCO, KAM, PD |
| `handover` | Admin, CCO, PM, PFM, CM, KAM, PMS, PD, HSE | Admin, PM, PD |
| `approvals` | Admin, CCO, CFO, PM, PFM, CM, QM, EngM, PMS, HSE, SSEG | Admin, QM, EngM, CM, PMS |
| `portfolios` | Admin, CCO, CFO, PM, PFM, KAM | Admin, PM |
| `portfolio_detail` | Admin, CCO, CFO, PM, PFM, KAM | Admin, PM |
| `performance` | Admin, CCO, CFO, PM, PFM, CM, QM, EngM, KAM, HSE, SSEG | Admin |
| `weekly_review_wizard` | Admin, CCO, CFO, PM, PFM, CM, QM, EngM, KAM, PMS, PD, HSE, SSEG | Admin, PM, PFM, CM, PMS |
| `smart_import` | Admin, CCO, PM, PFM | Admin, PM, PFM |
| `activity_log` | Admin | Admin |
| `admin` | Admin | Admin |
| `admin_roles` | Admin | Admin |
| `database_migration` | Admin | Admin |
| `stage_admin` | Admin | Admin |
| `project_creation` | Admin, CCO | Admin, CCO |
| `pm_dashboard` | (entity default) | (entity default) |
| `pm_on_the_go` | (entity default) | (entity default) |

Entities marked "(entity default)" need a direct lookup in `ENTITY_PERMISSION_DEFAULTS`; their grants didn't surface cleanly in the discovery pass and are flagged for the backlog.

### §4.3 Known matrix edge cases

- **ACCOUNTANT** has `execution_board` view but no edit — correct per design. Noted because it's the only delivery-heavy entity where Accountant sees read but not write.
- **ENGINEER** view scope intentionally narrow (engineering, eng_tasks, standups, work_items, home, my_work). Not a cross-functional viewer.
- **PROJECT_DEVELOPER** has unusual edit rights on `pd_clients` AND `handover` AND `stage_lifecycle` — this is because PD sits across the deal → project handoff boundary. Worth confirming with the product owner in Phase 2 whether `stage_lifecycle` edit is still intended (a candidate for the source-of-truth audit cross-check).
- **KEY_ACCOUNTS_MANAGER** has `portfolio_detail` view but cannot edit portfolios — deliberate, per the access-matrix defaults.
- **CCO** has broad view (pipeline + delivery + quality + lifecycle) but narrow edit (priorities + PD clients + project creation).

---

**End of §4.**

---

## §5 Per-role map + components + cross-cutting observations

### §5.1 Per-role functional map

One paragraph per role. Read: "what this role is primarily trying to accomplish in the app, given their edit rights." Derived from the §4 access matrix, not invented. Used by Phase 2 to prioritise visual polish by daily-usage weight.

1. **COO_ADMIN** — Full administrative authority across every domain. Primary flows: Company Overview (landing), Gates pipeline management, Control Center, Roles & Permissions, data migration. Views everything; edits everything. Phase 2 priority: **high** (platform-shaping user).

2. **CEO_ADMIN** — Strategic oversight. Same landing and near-identical edit rights as COO_ADMIN. Primary flows: Company Overview, Portfolios, Reports, Priorities. Phase 2 priority: **high**.

3. **CCO** — Head of Project Development. Primary flows: PD Dashboard (landing), Opportunities, Clients, Priorities (edit), Project Creation. Views portfolio and finance; doesn't manage engineering. Phase 2 priority: **high** — bridges sales ↔ delivery.

4. **CFO** — Finance authority. Primary flows: Cashflow (landing), COS, Revenue Tracker, QB Throughput, Financial Linking (sole editor). Views portfolios and lifecycle for context. Phase 2 priority: **high** — financial UI is decision-grade.

5. **PROGRAM_MANAGER** — Cross-project delivery lead. Primary flows: Execution Board (landing), Lifecycle, Gates, Approvals, Standups, Projects. The single most cross-cutting edit role (approval queues, lifecycle gates, counterparties, subcontractors, procurement). Phase 2 priority: **highest** — daily driver across 12+ surfaces.

6. **PROGRAM_FINANCE_MANAGER** — Program finance expert. Primary flows: Cashflow (landing), COS, Revenue, QB Throughput, Counterparties, Subcontractors, Invoice Patterns, Smart Import, Weekly Reviews. Phase 2 priority: **high**.

7. **CONSTRUCTION_MANAGER** — Construction site lead. Primary flows: Execution Board (landing), Milestone Tracker, HSE, Quality, Commissioning, Approvals, Projects, Handover. Phase 2 priority: **high** — field workflow, often mobile.

8. **QUALITY_MANAGER** — Quality workspace owner. Primary flows: Quality (landing), Commissioning, Approvals, Engineering (view), HSE (edit). Phase 2 priority: **medium-high**.

9. **ENGINEERING_MANAGER** — Engineering design authority. Primary flows: Engineering (landing), Task Board, Standup, Approvals, Engineering Templates, Engineering Audit. Phase 2 priority: **high**.

10. **KEY_ACCOUNTS_MANAGER** — Client relationship manager. Primary flows: PD Dashboard (landing), Opportunities, Clients (edit), Portfolios (view). Phase 2 priority: **medium**.

11. **ACCOUNTANT** — Finance operations. Primary flows: Cashflow (landing), COS, Revenue, Counterparties (view), Subcontractors (view), Financial Linking. Narrow scope — live-ready. Phase 2 priority: **medium**.

12. **ENGINEER** — Engineering execution. Primary flows: Engineering (landing), Task Board, Standups, My Work. Narrowest edit scope after Admin specialists. Phase 2 priority: **high** — concurrent user count is large in the engineering team.

13. **PROJECT_MANAGER_SITE** — Site delivery leader. Primary flows: Execution Board (landing), PM Dashboard, PM On-The-Go (mobile), Approvals, Standups (view), Commissioning, Projects. Second-most cross-cutting edit role. Phase 2 priority: **highest** — daily mobile + desktop usage.

14. **PROJECT_DEVELOPER** — Deal → project bridging. Primary flows: PD Dashboard (landing), Opportunities, Clients (edit), PD-PM Handover (edit), Stage Lifecycle (edit — edge-case noted §4.3). Phase 2 priority: **medium**.

15. **HSE_MANAGER** — Health & Safety authority. Primary flows: HSE (landing), HSE Compliance, Quality (edit), Approvals. Phase 2 priority: **medium** — single-surface.

16. **SSEG_MANAGER** — SSEG compliance specialist. Primary flows: HSE (landing), HSE Compliance (edit), Engineering (edit — atypical), Quality. Phase 2 priority: **medium** — domain-specialist.

**Grouping for Phase 2 sequencing** (highest daily-usage weight first):

1. **Tier 1 (every weekday, cross-surface):** PROGRAM_MANAGER, PROJECT_MANAGER_SITE, COO_ADMIN, CEO_ADMIN, CFO.
2. **Tier 2 (daily, domain-focused):** PROGRAM_FINANCE_MANAGER, CONSTRUCTION_MANAGER, ENGINEERING_MANAGER, ENGINEER, CCO.
3. **Tier 3 (daily, narrow):** QUALITY_MANAGER, ACCOUNTANT, HSE_MANAGER, SSEG_MANAGER, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER.

### §5.2 Component inventory

Derived from `client/src/components/`. Intentionally shallow — deeper per-component audit lives in Phase 1 design-system planning.

#### Existing UI primitives — `client/src/components/ui/`

shadcn/ui-derived library already in place. By category:

- **Inputs & form**: Button, Input, Checkbox, Radio-group, Select, Searchable-select, Toggle, Textarea, Slider, Kbd
- **Feedback & status**: Badge, Alert, Alert-dialog, Toast (Sonner backend), Toaster, Status-badge, Status-chip, Maturity-badge, Data-trust-badge, Progress, Spinner, Energy-loader, Carousel
- **Overlay & navigation**: Dialog, Confirm-dialog, Drawer, Sheet, Popover, Dropdown-menu, Command, Breadcrumb, Tabs, Sidebar
- **Layout & structure**: Card, Separator, Scroll-area, Aspect-ratio, Avatar, Skeleton, Page-header, Page-states, Empty-state
- **Data display**: Table, Table-pagination, Financial-data-grid, Export-dropdown, Chart
- **Loading**: Loading-state, EnergyLoader (domain-specific)

**Implication for Phase 1**: Phase 1 does NOT need to build a design-system from scratch — `ui/` is the substrate. Phase 1 adds tokens, formalises usage rules, fills gaps (any primitive not yet present), and writes `01-design-system.md` referencing the existing library.

#### Feature components — `client/src/components/`

Each subdirectory is a feature-scoped component bundle:

| Subdir | Description |
|---|---|
| `admin/` | Admin console widgets (sessions, feature flags, system health, dangerous actions, import governance) |
| `approvals/` | Unified approvals queue components |
| `cashflow/` | Cashflow date-override popovers, cell editing |
| `cos/` | Cost/P&L views |
| `dashboard/` | Dashboard widgets, attention panels, financial summary tiles, lifecycle gates checklist |
| `engineering/` | Engineering-specific views |
| `governance/` | Governance / stage config panels |
| `guidance/` | Guidance / help surfaces |
| `layout/` | AppLayout shell, page-shell, navbar customisation, onboarding tour |
| `mytool/` | Custom user tools |
| `opportunities/` | Opportunity management |
| `priorities/` | Priority filtering & management |
| `project/` | Project team assignment |
| `reports/` | Report cards, KPI tiles, delta indicators, beta banners |
| `smart-import/` | Excel import pipeline UI |
| `stage-lifecycle/` | Stage progression & task workflows |
| `stage-workspaces/` | Stage-specific workspace views |
| `tabs/` | Feature-specific editable tabs (expenditure, revenue, financial review) |
| `tasks/` | Task-related types |

Plus ~25 root-level components (BoardView, ErrorBoundary, PermissionGate, ProtectedRoute, NetworkStatus, etc.).

#### Conventions — healthy

- `ErrorBoundary` wrap at the top of `ProtectedPages` in `App.tsx:127` catches chunk-load and runtime errors.
- `Suspense` + `LoadingState` skeleton fallback for lazy-loaded pages (`App.tsx:128`).
- `@tanstack/react-query` consistent for all server state.
- `react-hook-form` + Zod for form validation.
- `wouter` for routing (not React Router).

#### Red flags — captured for Phase 1 cleanup, NOT fixed here

1. **Duplicate `StatusBadge`** — root-level `client/src/components/StatusBadge.tsx` wraps the ui version at `client/src/components/ui/status-badge.tsx`. Legacy imports still reference the root. **Do not silently swap** in Phase 2 — flag for design-system migration plan.
2. **Hand-rolled `RAGBadge`** at `client/src/components/reports/RAGBadge.tsx:7-11` duplicates `RagBadge()` from `ui/status-badge.tsx`. Same story.
3. **No shared data-fetching layer** — every feature component calls `useQuery` / `useMutation` directly with inline `apiRequest` (`client/src/lib/queryClient.ts`). ~99 call-sites across `components/`. Phase 1.4 data-access primitives (`useEntity`, `useEntityList`) will address this; migration is opt-in per Phase 3.
4. **Domain-specific "energy-*" animation / decoration CSS** in `index.css:720-790` (energy-flow, energy-glow-border, energy-progress-bar, renewable-badge). Decorative — per the prompt's "professional, clean, no decoration" brief these need a review in Phase 1. Flag only — do not remove without sign-off (legacy-removal rule).

### §5.3 Cross-cutting observations

Platform-wide patterns relevant to the overhaul. None are defects — all are observations for Phase 2 planning.

1. **Version update banner + network-status banner** both render as fixed top elements (`App.tsx:199-231`, `NetworkStatus` component). Phase 1 AppShell primitive must respect both z-indexes and stacking order (documented in-file at `App.tsx:178-185`).

2. **Role normalisation.** `normalizeRoleForPermissions` (`shared/schema/users.ts:299-302`) exists because the `users.role` column can hold generic values (`member`, `admin`) while `company_role` holds the 16-role key. Phase 2 work touching auth must route through this helper.

3. **localStorage for role** (`App.tsx:46, 94`). `company_role` is read from localStorage in the render path — SSR-safe via `typeof window !== "undefined"` guards. Any Phase 2 changes to this storage key must bump a migration key to avoid stale-role landing.

4. **Scroll restoration + page title** centralised via `useScrollRestoration` + `usePageTitle` hooks (`App.tsx:120-121`). Phase 2 per-page overrides must not bypass these.

5. **Mobile navigation mode** is a first-class platform concern. `NAVIGATION_MODE.mobile = "capture-check-approve-update-escalate"` (`App.tsx:34-37`). PM On-The-Go is a full mobile workflow. Phase 1 primitives must be touch-ready (44px min-height already enforced in `index.css:305-318`).

6. **Dark mode is live** — complete variable override set in `index.css:107-158`, plus domain-specific engineering dark-mode overrides in `index.css:160-238`. Phase 1 must preserve parity.

7. **Reduced-motion.** Already honoured at `index.css:667-681, 898-910`. Phase 1 animations must keep this gate.

8. **Feature flag layer.** `shared/feature-flags.ts` is the canonical gate for in-progress features (detailed in `00b-half-built.md`). 38 migration-bridge flags, plus domain flags (task_management_hub, pd_pm_handover_v2, etc.).

9. **No orphan pages.** Every `client/src/pages/**/*.tsx` is registered in `PAGE_REGISTRY` (verified by the half-built-feature agent).

10. **Legacy terminology in code.** `my_tool` / `my-tool` still appears as a `permissionEntity` key even though the UX is now "My Work". The entity key is stable (DB-persisted); do not rename. Any renames must go via runtime permission-entity migrations — flagged to `backlog.md`.

### §5.4 Inventory deferrals (explicitly not captured here)

For transparency — things Phase 0 is **NOT** recording, with reasoning:

- **Per-page visual-state notes** (layout, density, hierarchy): Recorded function-by-function in `02-function-plan.md` (Phase 2), not here. Capturing for 113 pages in Phase 0 is weeks of work and the output is stale by Phase 3.
- **Per-endpoint behaviour walk for 73 server route files**: Recorded per-function in Phase 2 as each function is planned. Phase 0 stays at the file / domain level.
- **Known bugs**: Bugs-in-flight are tracked in the team's issue tracker, not `00-inventory.md`. Only observed **during** discovery are flagged here (e.g. `/admin/handover-health` backend wiring incomplete).
- **Test coverage levels per function**: Recorded in `02-function-plan.md`'s "Preserved behaviour contract" field, not here.

---

**End of `00-inventory.md`.** Companion artefacts: `00b-half-built.md`, `00c-source-of-truth-audit.md`, `backlog.md`.
