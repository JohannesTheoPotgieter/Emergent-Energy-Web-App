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

**End of §3.** Next checkpoint: §4 — server route inventory + permission-entity × role access matrix.
