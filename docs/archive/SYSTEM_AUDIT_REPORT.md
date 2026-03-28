# EMERGENT ENERGY WEB APP — FULL SYSTEM AUDIT REPORT

**Date:** 2026-03-18
**Auditor:** Staff Engineer / Solutions Architect Review
**Branch:** claude/elastic-fermi
**Scope:** Full codebase, architecture, business rules, UX, permissions, financial logic, production readiness

---

## 1. EXECUTIVE SUMMARY

### What the application is
The Emergent Energy Dashboard is an operational control system for a South African C&I solar and BESS EPC company. It aims to replace fragmented Excel trackers, SharePoint, ClickUp, and Pipedrive with a single unified platform covering project lifecycle management, financial tracking, procurement, engineering, quality, approvals, and operational reporting.

### What it currently does well
- **[CODE CONFIRMED]** Comprehensive data model — 125+ tables covering projects, finance, procurement, quality, engineering, work items, approvals, and audit trails
- **[CODE CONFIRMED]** Mature import pipeline — Smart Import system with Excel parsing, hash-based deduplication, preview-before-commit, and override pattern (imported data preserved, user edits in separate override tables)
- **[CODE CONFIRMED]** Strong audit trail — `audit_events` table with actor, entity, action, changes JSON, and request context
- **[CODE CONFIRMED]** Well-structured API — v2 controller/service/repository pattern with Drizzle ORM, input validation, async error handling
- **[CODE CONFIRMED]** Feature-rich frontend — 105+ registered pages covering every major business domain
- **[CODE CONFIRMED]** Role-based UI gating — 14 system roles with entity-action permission matrix (47 permission entities)
- **[CODE CONFIRMED]** Stage gate engine — Configurable gate requirements with override audit trail
- **[CODE CONFIRMED]** Entity assignment model — Generic assignment table supporting internal users, external counterparties, and contacts with role-based assignments (OWNER, ASSIGNEE, APPROVER, REVIEWER, VIEWER)
- **[CODE CONFIRMED]** Token revocation — Three-tier JWT revocation (individual tokens, sessions, user version floors)
- **[CODE CONFIRMED]** Phase transition history — Full audit of project phase changes with actor and reason

### What is broken or risky
- **[RISK]** No row-level security — All projects and financial data returned to any authenticated user with entity-level permission; no scoping by assigned projects, department, or team
- **[RISK]** `canEditData: false` is UI-only — Backend does not enforce the read-only flag for PROJECT_MANAGER_SITE role
- **[RISK]** Sep-Aug fiscal year hardcoded — Cannot be changed without code modifications across multiple files
- **[GAP]** Several unmapped pages exist (role-settings, phase-templates, notification-center, project-create, exceptions) — built but not routed
- **[GAP]** No variation order (VO) workflow — Fields exist but no approval/workflow enforcement
- **[GAP]** No retention/holdback tracking
- **[GAP]** No multi-currency support
- **[GAP]** No HSE-specific role — Quality Manager handles HSE, no distinct governance
- **[RISK]** KPI consistency risk — Dashboard, project detail, and portfolio views compute KPIs independently; no single canonical KPI service enforces consistency across all screens

### Readiness Score (out of 10)

| Area | Score | Notes |
|------|-------|-------|
| Data/Reporting | 7/10 | Strong import pipeline, good override model, but KPI consistency not guaranteed cross-screen |
| Engineering Task Management | 7/10 | Functional, 203KB page, deliverables + stages tracked, but no assignment scoping |
| Project Management | 8/10 | Strongest area — lifecycle, work items, milestones, phase gates, handover all implemented |
| Quality Management | 7/10 | Templates, checklists, evidence, risk scoring, postmortems — all present; handover blocking works |
| Permissions/Access | 4/10 | UI gating good; backend enforcement weak; no row-level security; edit restrictions UI-only |
| Procurement | 6/10 | Status transitions defined, counterparty model exists, but no budget-to-PO reconciliation workflow |
| UX / Product Flow | 7/10 | Clean, modern, role-based home page; some inconsistent loading/empty states; large page files |
| Production Readiness Overall | 5/10 | Core workflows function but permission gaps, missing RLS, and KPI consistency issues block safe production use |

---

## 2. REPO / STACK MAP

### Framework & Libraries
| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19.2.0 |
| Routing | Wouter | 3.3.5 |
| State | TanStack React Query | 5.60.5 |
| UI Components | Radix UI (20+ packages) | Latest |
| Styling | Tailwind CSS | 4.1.14 |
| Forms | React Hook Form + Zod | 7.66.0 |
| Charts | Recharts | 2.15.4 |
| Build | Vite | 7.1.9 |
| Backend | Express | 5.0.1 |
| ORM | Drizzle ORM | 0.39.3 |
| Database | PostgreSQL (prod) / SQLite (dev fallback) | — |
| Auth | Passport.js + JWT + MSAL (Microsoft SSO) | — |
| TypeScript | — | 5.6.3 |
| Testing | Playwright | 1.58.2 |
| Runtime | tsx (TypeScript execution) | — |

### Key Folders
```
/
├── client/src/
│   ├── pages/              # 79 page files (105+ registered routes)
│   ├── components/
│   │   ├── tabs/           # Project detail tab components (16+)
│   │   ├── ui/             # 60+ shared UI primitives (Radix-based)
│   │   ├── layout/         # AppLayout, Sidebar, PageShell
│   │   └── admin/          # Admin panel components
│   ├── hooks/              # use-auth, use-permissions, use-program-data, use-access-matrix
│   ├── config/             # page-registry, app-navigation, admin-surfaces
│   └── lib/                # queryClient, access-control, apiRequest
├── server/
│   ├── api/v2/
│   │   ├── controllers/    # HTTP handlers
│   │   ├── services/       # Business logic
│   │   ├── repositories/   # Data access (Drizzle queries)
│   │   ├── policies/       # access-policy, permission-catalog
│   │   ├── validators/     # Input validation
│   │   └── routes/         # v2 endpoint definitions
│   ├── services/           # Domain services (lifecycle, assignment, KPI, audit, etc.)
│   ├── repositories/       # Legacy data access layer
│   ├── lib/calculations/   # COS aggregator, state classifier, cashflow engine
│   ├── bootstrap/          # Auth, backfills, seed data
│   ├── seed/               # Engineering, quality, intake templates
│   └── routes.ts           # Main route registration (v1 + v2)
├── shared/
│   ├── schema.ts           # Complete Drizzle ORM schema (5,624 lines)
│   ├── permission-resolver.ts
│   ├── quality-governance.ts
│   └── kpi-definitions.ts
├── migrations/             # 25 SQL migration files
└── package.json
```

### Key Entry Points
- **Server start:** `server/index.ts` → Express app on port 5000
- **Client entry:** `client/src/App.tsx` → Router + AuthProvider + RoleGuard
- **Schema:** `shared/schema.ts` — single source for all table definitions
- **Routes:** `server/routes.ts` (v1) + `server/api/v2/routes/` (v2)
- **Dev:** `npm run dev` — Vite HMR + tsx server
- **Prod:** `npm run start` — prebuilt `dist/index.cjs`

---

## 3. DATABASE / DOMAIN MAP

### 3.1 Users & Authentication
- **Purpose:** Identity, auth, role assignment
- **Tables:** `users`, `role_permissions`, `qc_access_challenge`, `audit_events`
- **Key fields:** email, password (hashed), role, department, token_version, microsoftId
- **Relationships:** users → role_permissions (by role string); users → audit_events (by userId)
- **Constraints:** Unique email, unique username; token_version for bulk revocation
- **[GAP]** No `user_projects` or `project_team_members` join enforced at query level — team membership exists but isn't used for data filtering

### 3.2 Projects (The Spine)
- **Purpose:** Central relational object — everything ties back here
- **Tables:** `project_info`, `project_phase_history`, `project_rag_audit`, `project_events`, `project_notes`, `project_editable_fields`, `project_team_members`
- **Key fields:** projectName (legacy key), id (integer PK), phase, executionStatus, contractValue, pmUserId, pdUserId
- **Relationships:** project_info → ALL other domain tables (by projectName or projectInfoId)
- **Constraints:** projectName is unique, used as join key across most tables
- **[RISK]** Dual key pattern — some tables join on `projectName` (string), others on `projectInfoId` (integer). Migration to integer FK is incomplete.
- **[GAP]** No formal "project status" state machine — phase transitions recorded but not enforced by constraint

### 3.3 Financial Domain
- **Purpose:** Revenue, COS, cashflow, expenditure, GP tracking
- **Tables:** `program_expense`, `program_inflows`, `project_revenue_summary`, `expenditure_overrides`, `revenue_tracking_overrides`, `cashflow_points`, `cashflow_planning_overrides`, `cashflow_weekly_manual`, `cashflow_balance_history`, `finance_revenue_monthly`, `finance_cos_monthly`, `finance_revenue_overrides`, `finance_cos_overrides`, `opex_budget_monthly`, `opex_weekly_manual`, `trackerMonthlyManual`
- **Key pattern:** Base imported data + separate `*_overrides` tables for user edits
- **Relationships:** All linked to project by projectName or projectInfoId
- **[CODE CONFIRMED]** Revenue states: Planned → Invoiced → Paid → In Bank (based on invoice number + date + payment date + font color confirmation)
- **[CODE CONFIRMED]** COS states: Planned → Committed → Invoiced → Paid (same confirmation pattern)
- **[CODE CONFIRMED]** GP = Revenue - COS (simple subtraction, no margin tiers)
- **[CODE CONFIRMED]** Fiscal year: Sep-Aug hardcoded
- **[GAP]** No multi-currency fields
- **[GAP]** No retention/holdback columns
- **[GAP]** No budget variance alerting thresholds

### 3.4 Work Items & Tasks
- **Purpose:** Milestones, tasks, operational execution
- **Tables:** `work_items`, `operational_tasks`, `task_comments`, `task_checklists`, `task_checklist_items`, `task_attachments`, `task_deliverables`, `task_activity_log`, `mytool_tasks`, `mytool_task_dependencies`
- **Key fields:** workstream, status, priority, assigneeUserId, isMilestone, softDelete (deletedAt)
- **Workstreams:** PD, Engineering, Quality, PM, Procurement, Construction, Commissioning, Handover
- **[CODE CONFIRMED]** Soft delete pattern with `deletedAt` column
- **[CODE CONFIRMED]** Activity log tracks field-level changes

### 3.5 Planning & Scheduling
- **Purpose:** Imported project plans with scenario-based overrides
- **Tables:** `project_plan`, `project_plan_overrides`, `project_plan_dependency`, `working_plan_scenario`, `working_plan_task_override`, `schedule_change_notice`, `date_overrides`, `normalized_plan_tasks`
- **Key pattern:** Imported plan items + user overrides + scenario branches
- **[CODE CONFIRMED]** Deduplication via hash computation on import

### 3.6 Procurement
- **Purpose:** PO lifecycle, supplier management, invoice capture
- **Tables:** `procurement_items`, `invoice_captures`, `invoice_pattern_rules`, `invoice_pattern_matches`, `payment_terms`, `counterparties`, `counterparty_contacts`, `line_item_overrides`
- **Status transitions:** requested → quoted → approved → ordered → partially_received → received → invoiced → closed
- **[CODE CONFIRMED]** Valid transitions hardcoded in `server/procurement-routes.ts`
- **[GAP]** No budget-to-PO reconciliation — PO amounts not validated against project budget
- **[GAP]** No committed expenditure view linking POs to cashflow forecast

### 3.7 Quality & Compliance
- **Purpose:** QC checklists, evidence, risk scoring, postmortems
- **Tables:** `qc_template`, `qc_template_phase`, `qc_template_group`, `qc_template_item`, `qc_template_risk_question`, `qc_checklist`, `qc_item_instance`, `qc_item_evidence`, `qc_risk_answer`, `qc_postmortem`, `qc_postmortem_metric_value`, `qc_postmortem_summary`, `qc_warning`, `qc_warning_event`
- **[CODE CONFIRMED]** Quality items: NOT_STARTED → REVIEW → FAIL/PASS/N/A
- **[CODE CONFIRMED]** Quality blocks handover via regex pattern matching on rejection reasons
- **[CODE CONFIRMED]** Evidence scoring model exists
- **[GAP]** No HSE-specific tables or workflows — HSE is handled within quality templates
- **[USER BUSINESS RULE]** HSE only begins after PD→PM handover — no code enforces this timing

### 3.8 Engineering
- **Purpose:** Engineering deliverables, stages, approvals
- **Tables:** `deliverables`, `project_eng_stages`, `project_eng_deliverables`, `project_eng_approvals`
- **[CODE CONFIRMED]** Engineering progress = complete_stages / total_stages * 100
- **[GAP]** No Helioscope/PV*SOL integration — engineering tools referenced in business context but not connected

### 3.9 Data Import & Sync
- **Purpose:** Excel import pipeline, SharePoint sync, normalization
- **Tables:** `smart_import_runs`, `import_issues`, `import_runs`, `snapshots`, `change_ledger`, `snapshot_metrics`, `sp_files`, `sp_settings`, `normalized_plan_tasks`, `normalized_revenue_lines`, `normalized_cost_lines`, `normalized_execution_phases`, `template_profiles`, `mapping_rules`
- **[CODE CONFIRMED]** Full ETL: File upload → hash → parse → normalize → preview → commit
- **[CODE CONFIRMED]** Import governance with sync state tracking (in_sync, stale, conflicted, awaiting_acknowledgement)

### 3.10 Approvals
- **Purpose:** Multi-category approval workflows
- **Tables:** `approvals`, `project_eng_approvals`
- **Categories:** governance, financial, quality, engineering, commercial, legal, health_safety, environmental
- **Statuses:** pending, approved, rejected, withdrawn
- **[GAP]** No escalation rules — approval sits in pending indefinitely
- **[GAP]** No SLA/timeout on approvals

### 3.11 Audit & Admin
- **Tables:** `audit_events`, `error_logs`, `upload_metadata`, `refresh_logs`, `home_notes`, `calendar_holiday`
- **[CODE CONFIRMED]** Comprehensive audit with actor, entity, action, changes_json, request context

---

## 4. API MAP

### 4.1 V2 API (Modern Layer)
| Endpoint | Purpose | Auth | Validation |
|----------|---------|------|-----------|
| `GET /api/v2/me` | Current user profile | JWT | — |
| `GET /api/v2/me/permissions` | User permission matrix | JWT | — |
| `GET /api/v2/projects` | Paginated project list with search | JWT + projects.read | Pagination params |
| `GET /api/v2/projects/:id` | Project detail with finance/lifecycle | JWT + projects.read | projectId |
| `GET /api/v2/projects/:id/health` | RAG status + margin calculations | JWT + projects.read | projectId |
| `GET /api/v2/projects/:id/lifecycle` | Phase transition history | JWT + projects.read | projectId |
| `GET /api/v2/projects/:id/work-items` | Milestones and tasks | JWT + work_items.read | projectId |
| `POST /api/v2/projects/:id/work-items` | Create work item | JWT + work_items.write | Zod schema |
| `PATCH /api/v2/projects/:id/work-items/:wid` | Update work item | JWT + work_items.write | Zod partial |
| `GET /api/v2/projects/:id/procurement` | Procurement summary | JWT + procurement.read | projectId |
| `POST /api/v2/projects/:id/engineering-designs/create` | Create eng deliverable | JWT + engineering.write | Zod schema |
| `POST /api/v2/projects/:id/development/handover` | PD→PM handover | JWT + pd.write | Handover data |

**[RISK]** V2 endpoints check entity-level permission but do NOT validate user's project assignment — any user with `projects.read` sees all projects.

### 4.2 V1 API (Legacy Layer — still active)
| Endpoint Group | Purpose | Auth Pattern |
|---------------|---------|-------------|
| `/api/program-dashboard` | Dashboard KPIs | JWT |
| `/api/projects-summary` | Project list + edits | JWT + requireAdmin (for edits) |
| `/api/tracker-monthly` | Revenue/COS monthly edit | JWT + requireTrackerPermission |
| `/api/cashflow/*` | Cashflow CRUD | JWT + requirePermission |
| `/api/revenue-tracking/*` | Revenue overrides | JWT + requireAdmin |
| `/api/expenditure/*` | Expenditure overrides | JWT + requireAdmin |
| `/api/work-items/*` | Work item CRUD | JWT + requireAdmin |
| `/api/project-plan/*` | Plan CRUD | JWT + requireAdmin |
| `/api/operational-tasks/*` | Operational task CRUD | JWT |
| `/api/procurement/*` | Procurement CRUD | JWT + requireAdmin |
| `/api/quality/*` | Quality CRUD | JWT + requirePermission |
| `/api/approvals/*` | Approval CRUD | JWT |
| `/api/admin/*` | User/role/import management | JWT + requireAdmin |
| `/api/auth/*` | Login, logout, token refresh | Public/JWT |

**[RISK]** Many V1 mutation endpoints use `requireAdmin` as the only gate — no entity-level or project-level scoping.

### 4.3 Missing Endpoints
- **[GAP]** No endpoint for "my assigned projects" filtered view
- **[GAP]** No endpoint for department-scoped data queries
- **[GAP]** No approval escalation or SLA endpoints
- **[GAP]** No variation order workflow endpoints
- **[GAP]** No O&M/Matriarch handover endpoints

### 4.4 Data Write Paths
- **[CODE CONFIRMED]** Writes persist properly — Drizzle ORM with PostgreSQL transactions
- **[CODE CONFIRMED]** Override pattern preserves imported data — user edits go to separate `*_overrides` tables
- **[CODE CONFIRMED]** Optimistic updates used on some frontend mutations (via React Query's `onMutate`)
- **[RISK]** No validation that financial edits stay within contract value bounds

---

## 5. FRONTEND MAP

### 5.1 Home / Dashboard
- **Purpose:** Role-based morning landing page
- **Intended user:** All roles
- **Data source:** `/api/program-dashboard`, `/api/company-priorities`
- **Key actions:** View KPIs, navigate to quick-access modules
- **[CODE CONFIRMED]** Personalized greeting, role-specific KPIs (Executive, Finance, PM, Engineering, Quality, BD), company priorities, quick-access cards
- **UX assessment:** Well-designed, answers "what should I do this morning?" effectively

### 5.2 Projects List
- **Purpose:** Browse all projects with search, filter, sort
- **Intended user:** All roles with projects.view
- **Data source:** `/api/v2/projects` (paginated)
- **Key actions:** Search, filter by status/phase, navigate to detail
- **[CODE CONFIRMED]** Functional with search and pagination
- **[GAP]** No "my projects only" filter tied to user assignment

### 5.3 Project Detail (16+ tabs)
- **Purpose:** Complete project workspace
- **Intended user:** PM, Construction Manager, Finance, Engineering, Quality
- **Tabs and status:**

| Tab | Size | Status | Key Issues |
|-----|------|--------|-----------|
| Execution Plan (Unified) | 113KB | Functional | Kanban + timeline; very large file |
| Quality & Checklists | 89KB | Functional | Evidence, risk scoring, postmortems |
| Revenue Tracking | 72KB | Functional | Editable grid with override pattern |
| Expenditure | 96KB | Functional | Editable grid, dual budget/actual |
| Procurement | 93KB | Functional | PO management, status transitions |
| Monthly Realisation | — | Functional | Forecast vs actual |
| Subcontractors | — | Functional | Counterparty list with filtering |
| Approvals | — | Functional | Approval queue per project |
| RAID Log | — | Functional | Risk/issue tracking |
| Change Control | — | Functional | Modification tracking |
| Commissioning | — | Functional | Phased checklist |
| Timeline | — | Functional | Gantt/milestone view |
| History | — | Functional | Audit trail |
| Chat/Collaboration | — | Functional | Project-level messaging |
| Local Files/SharePoint | — | Functional | Document linking |
| Notifications | — | Functional | System alerts |

### 5.4 Finance Pages
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Cashflow | `/cashflow` | Functional | Weekly chart + manual override; OPEX integration; FY hardcoded |
| Cost of Sales | `/cos` | Functional | Monthly COS breakdown with detail drawer |
| Revenue Tracker | `/revenue-tracker` | Functional | Revenue milestones by project |
| GP Tracker | `/gp-tracker` | Functional | Monthly GP grid + YTD; simple Revenue-COS formula |
| Invoice Patterns | `/invoice-patterns` | Functional | Pattern-based invoice classification |
| Counterparties | `/counterparties` | Functional | Supplier/installer management |
| Procurement Hub | `/subcontractor-dashboard` | Functional | Dashboard + detail views |

### 5.5 Engineering
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Engineering Overview | `/engineering` | Functional | Dashboard with deliverables, stages |
| Engineering Tasks | `/engineering/tasks` | Functional | 203KB page; stub redirect file but actual component works |

### 5.6 Quality
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Quality Dashboard | `/quality` | Functional | QA workspace with checklists, warnings |

### 5.7 Project Development
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| PD Dashboard | `/pd` | Functional | PD analytics |
| PD Tickets | `/pd/tickets` | Functional | List/create/detail CRUD |
| PD→PM Handover | `/pd/handover/:projectId` | Functional | Readiness checking, handover workflow |
| PM Handover Review | `/pm/handover-review` | Functional | Handover acceptance queue |

### 5.8 My Work / Personal Workspace
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| My Work Home | `/my-work` | Functional | Personal task hub |
| My Work Tasks | `/my-work/tasks` | Functional | 133KB page; comprehensive task management |
| My Work Calendar | `/my-work/calendar` | Functional | Calendar view |
| My Work Approvals | `/my-work/approvals` | Redirect | → `/my-work/tasks?source=approvals` |

### 5.9 Admin
| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Control Center | `/admin/control-center` | Functional | 65KB system admin |
| Smart Import | `/admin/smart-import` | Functional | 159KB data import wizard |
| Roles & Permissions | `/admin/roles` | Functional | 58KB RBAC management |
| Activity Log | `/admin/activity-log` | Functional | Audit trail viewer |
| KPI Traceability | `/admin/kpi-traceability` | Functional | KPI debugging |
| Recovery Center | `/admin/recovery` | Functional | Data recovery |

### 5.10 Unmapped/Orphan Pages
| File | Purpose | Issue |
|------|---------|-------|
| `role-settings.tsx` (51KB) | Role configuration UI | Not in PAGE_REGISTRY, no route |
| `phase-templates.tsx` (53KB) | Phase template editor | Not in PAGE_REGISTRY, no route |
| `notification-center.tsx` (20KB) | Notification hub | Not in PAGE_REGISTRY, no route |
| `project-create.tsx` (10KB+) | Project creation form | Not in PAGE_REGISTRY, no route |
| `exceptions.tsx` (134 lines) | Exception viewer | Not in PAGE_REGISTRY, no route |

### 5.11 UX Issues Summary
- **[RISK]** Inconsistent loading states — some pages use skeleton loaders, others show "Loading..." text, others use EnergyLoader animation
- **[RISK]** Empty state handling varies — some pages lack useful empty states
- **[GAP]** No "Latest Update" column visible on project list (business requirement for Construction Manager)
- **[CODE CONFIRMED]** Latest update is editable via project detail page but not surfaced on the list view prominently
- **[RISK]** Large monolithic page files (100-200KB) — high maintenance cost, hard to test
- **[CODE CONFIRMED]** Proper 404 page exists
- **[CODE CONFIRMED]** Legacy route redirects work correctly (15+ redirects configured)

---

## 6. FEATURE / BUSINESS RULE MAP

### 6.1 Project Lifecycle
- **What it should do:** Projects move through Development → Construction → Commissioning → Handover → O&M with stage gates
- **Current implementation:** [CODE CONFIRMED] Phase history tracked, stage gate engine with configurable requirements (required_field, required_linked_record, required_approval, required_document, required_milestone_state, required_commercial_control, required_role_signoff)
- **Business rule alignment:** Mostly aligned — gates exist but transitions are manual, not automated
- **[GAP]** No auto-blocking of later-phase work when earlier gates haven't passed
- **[GAP]** No O&M/Matriarch handover workflow — lifecycle stops at project closeout
- **[RECOMMENDATION]** Add Matriarch handover as a formal phase with its own gate requirements

### 6.2 PD→PM Handover
- **What it should do:** Project Development hands over to Project Management with readiness checks
- **Current implementation:** [CODE CONFIRMED] Readiness states (NOT_READY, READY_WITH_ACTIONS, READY_FOR_HANDOVER), checklist validation, quality blocker checking
- **Business rule alignment:** Well-implemented — quality gates block handover unless execution override is enabled
- **[CODE CONFIRMED]** COO/CEO can override via executionEnabled flag

### 6.3 Financial Tracking
- **What it should do:** Track revenue, COS, GP, cashflow aligned with Sep-Aug fiscal year
- **Current implementation:** [CODE CONFIRMED] Full revenue state machine (Planned→Invoiced→Paid→InBank), COS state machine (Planned→Committed→Invoiced→Paid), GP = Revenue - COS, weekly cashflow with forecast engine
- **Business rule alignment:**
  - [CODE CONFIRMED] Sep-Aug fiscal year hardcoded in multiple files
  - [CODE CONFIRMED] Font color confirmation ("black" = confirmed, "red" = forecast) inherited from Excel tracker logic
  - [GAP] No Finance Manager approval gate for pulling COS forward (user business rule)
  - [GAP] No contract value validation against revenue milestone totals
  - [RISK] GP calculation is simple subtraction — no margin tiers, contract-level GP, or product-line analysis

### 6.4 Procurement
- **What it should do:** Full PO lifecycle with counterparty assignment and expenditure linkage
- **Current implementation:** [CODE CONFIRMED] 8-state transition machine (requested→closed), counterparty model with contacts, invoice capture with pattern matching
- **Business rule alignment:** Partially aligned
- **[GAP]** No budget-to-PO reconciliation
- **[GAP]** Procurement lives in Finance section in navigation — may confuse ownership between Procurement and Finance teams
- **[RECOMMENDATION]** Add procurement budget validation and consider separate top-level Procurement section

### 6.5 Quality Management
- **What it should do:** QC checklists, evidence capture, risk scoring, handover blocking
- **Current implementation:** [CODE CONFIRMED] Template-based QC system with phases, groups, items; evidence tracking with scoring model; risk assessment; postmortems; handover blocking via quality reason pattern matching
- **Business rule alignment:** Well-implemented
- **[USER BUSINESS RULE]** HSE processes only begin after PD→PM handover — no code enforces this timing constraint
- **[RECOMMENDATION]** Add lifecycle-phase guard on HSE checklist activation

### 6.6 Approvals
- **What it should do:** Route approvals to correct authority by category
- **Current implementation:** [CODE CONFIRMED] Multi-category approval system (governance, financial, quality, engineering, commercial, legal, health_safety, environmental) with pending/approved/rejected/withdrawn states
- **[GAP]** No escalation rules or SLA timeouts
- **[GAP]** My Approvals sits within My Work tasks — could feel detached per user business rule concern
- **[RECOMMENDATION]** Add approval SLA tracking and escalation to manager after N days

### 6.7 Assignment Model
- **What it should do:** Assign work items to users/counterparties using stable IDs
- **Current implementation:** [CODE CONFIRMED] Entity assignments table with internal_user, external_counterparty, external_contact types; OWNER/ASSIGNEE/APPROVER/REVIEWER/VIEWER roles; multi-assignment support for tasks
- **Business rule alignment:** Well-designed — matches requirements for stable ID-based assignment with internal/external switching
- **[CODE CONFIRMED]** Backfill scripts exist for migrating legacy name-string assignments to ID-based

### 6.8 Engineering
- **What it should do:** Track engineering deliverables, stages, and task execution
- **Current implementation:** [CODE CONFIRMED] Engineering stages with completion tracking, deliverable CRUD, engineering approval workflow
- **[GAP]** No integration with Helioscope or PV*SOL
- **[GAP]** No costing template integration (Emergent's Excel template for proposals)
- **[INFERRED]** Engineering quality vs project engineering quality are not distinguished in the data model

### 6.9 Latest Update / Field Reality
- **What it should do:** Visible, editable "latest update" on project list and detail
- **Current implementation:** [CODE CONFIRMED] `latestUpdate` field on `project_info`, editable via project detail page
- **[GAP]** Not prominently visible on the project list view — Construction Manager workflow requires seeing it at list level without drilling into detail
- **[RECOMMENDATION]** Add latest update column or preview to project list table

### 6.10 Weekly Operational Reporting
- **What it should do:** Support weekly client updates and operational reports
- **Current implementation:** [CODE CONFIRMED] Weekly review wizard exists (28KB), project notes system
- **[INFERRED]** Board-pack level ops data traceable through KPI traceability admin page

---

## 7. ROLE / PERMISSION REVIEW

### Role-by-Role Assessment

| Business Role | System Role | Operational Need | Code Reality | Mismatch |
|--------------|-------------|-----------------|--------------|----------|
| COO | COO_ADMIN | Full access, settings, all data | [CODE CONFIRMED] Wildcard `["*"]` permissions | Aligned |
| CEO / MD | CEO_ADMIN | Full access, strategic oversight | [CODE CONFIRMED] Wildcard `["*"]` permissions | Aligned |
| CCO | CCO | Projects, finance, engineering, quality (no settings) | [CODE CONFIRMED] Broad access minus admin | Aligned |
| CFO | CFO | Financial oversight, cashflow, budgets | [CODE CONFIRMED] dashboard, projects, finance (r/w), procurement, invoice | Aligned |
| Program Manager | PROGRAM_MANAGER | Projects, finance, PM, engineering, quality, work items | [CODE CONFIRMED] Comprehensive operational access | Aligned |
| Project Finance | PROGRAM_FINANCE_MANAGER | Finance, projects, PM, engineering, governance | [CODE CONFIRMED] Finance-focused with project read | Aligned |
| Construction Manager | CONSTRUCTION_MANAGER | Projects, PM, engineering, governance | [CODE CONFIRMED] Operational focus, no MONEY section | **[GAP]** Construction Manager needs finance visibility for cost control per business rule |
| Site PM | PROJECT_MANAGER_SITE | View-only for assigned projects | [CODE CONFIRMED] canEditData=false, limited sections | **[RISK]** Backend doesn't enforce canEditData |
| Head of PD | PROJECT_DEVELOPER | PD section, projects, finance, engineering | [CODE CONFIRMED] PD-focused access | Aligned |
| Engineering Manager | ENGINEERING_MANAGER | Engineering tasks, deliverables, approvals | [CODE CONFIRMED] Engineering + project read | Aligned |
| Engineer | ENGINEER | Engineering + collaboration | [CODE CONFIRMED] Minimal access set | Aligned |
| Quality Manager | QUALITY_MANAGER | Quality + governance + projects | [CODE CONFIRMED] QA-focused access | Aligned, but also handles HSE |
| Accountant | ACCOUNTANT | Finance team (cashflow, COS, invoices) | [CODE CONFIRMED] Finance read/write | Aligned |
| Key Accounts Manager | KEY_ACCOUNTS_MANAGER | Client relations | [CODE CONFIRMED] Limited access | Aligned |

### Critical Permission Gaps
1. **[RISK]** No row-level security — PROJECT_MANAGER_SITE sees ALL projects, not just assigned ones
2. **[RISK]** `canEditData: false` not enforced on backend — API accepts writes from read-only roles
3. **[GAP]** No distinct HSE role — Quality Manager handles HSE with no governance separation
4. **[GAP]** No Procurement Manager role — procurement authority split between Program Manager and Construction Manager
5. **[GAP]** Construction Manager lacks MONEY section access but needs cost visibility per business rules
6. **[RISK]** Financial mutation endpoints use `requireAdmin` only — non-admin finance roles may be blocked from legitimate edits, or admin roles may bypass entity-level permissions

---

## 8. TOP RISKS / FAILURE MODES

### R1: Data Access Without Row-Level Security [CRITICAL]
- **Risk:** Any user with `projects.read` permission sees all projects and all financial data
- **Impact:** Sensitive financial data (contract values, margins, expenditure) visible to site PMs, engineers, or anyone with basic access
- **Failure mode:** Confidentiality breach, regulatory risk
- **Mitigation:** Implement query-level filtering by user's assigned projects and department

### R2: canEditData Not Backend-Enforced [HIGH]
- **Risk:** PROJECT_MANAGER_SITE (view-only) can submit API mutations directly
- **Impact:** Unauthorized data modifications from read-only roles
- **Failure mode:** Data integrity compromise
- **Mitigation:** Add `canEditData` check to all POST/PATCH/DELETE middleware

### R3: KPI Consistency Across Screens [MEDIUM]
- **Risk:** Dashboard, project detail, portfolio, and GP tracker compute KPIs independently
- **Impact:** COO sees different numbers on different screens → loss of trust in system
- **Failure mode:** Decision-making based on inconsistent data
- **Mitigation:** Create single canonical KPI service that all screens consume

### R4: Financial Year Hardcoded [MEDIUM]
- **Risk:** Sep-Aug fiscal year hardcoded across client and server — `FY26_MONTHS` constant, YTD logic
- **Impact:** Cannot change fiscal year without multi-file code change
- **Failure mode:** Year-end rollover requires developer intervention
- **Mitigation:** Extract fiscal year config to database or environment variable

### R5: No O&M/Matriarch Handover Workflow [MEDIUM]
- **Risk:** Project lifecycle ends at closeout — no formal handover to O&M/Matriarch
- **Impact:** Post-completion obligations (warranties, maintenance, documentation) lost
- **Failure mode:** Operational gap between project and O&M teams
- **Mitigation:** Add Matriarch handover phase with documentation checklist and gate requirements

### R6: Orphan Pages [LOW-MEDIUM]
- **Risk:** 5 substantial pages (role-settings 51KB, phase-templates 53KB, notification-center 20KB, project-create 10KB+, exceptions 134 lines) exist but have no routes
- **Impact:** Features built but inaccessible; user confusion if discovered via URL; maintenance burden
- **Failure mode:** Dead code, incomplete features
- **Mitigation:** Route them or delete them

### R7: Large Monolithic Page Files [LOW]
- **Risk:** Multiple 100-200KB single-file components
- **Impact:** Hard to maintain, test, and review; long compile times
- **Failure mode:** Developer productivity loss, regression risk
- **Mitigation:** Split into subcomponents over time (not urgent for production)

### R8: Approval Workflow Has No Escalation [MEDIUM]
- **Risk:** Approvals sit in pending state indefinitely with no SLA or escalation
- **Impact:** Blocked work items, delayed procurement, stalled handovers
- **Failure mode:** Operational bottleneck
- **Mitigation:** Add approval SLA tracking and auto-escalation rules

### R9: No Finance Manager Approval Gate for COS Pull-Forward [MEDIUM]
- **Risk:** [USER BUSINESS RULE] Finance Manager should approve pulling COS forward, but no code enforces this
- **Impact:** COS timing manipulation without financial oversight
- **Failure mode:** Financial control breach
- **Mitigation:** Add approval workflow for COS timing changes

### R10: Dual Key Pattern (projectName vs projectInfoId) [MEDIUM]
- **Risk:** Some tables join on string `projectName`, others on integer `projectInfoId`
- **Impact:** Data integrity risk if project renamed; join performance issues
- **Failure mode:** Orphaned records if projectName changes
- **Mitigation:** Complete migration to integer FK; add foreign key constraints

---

## 9. RECOMMENDED CHANGE PLAN

### P0 — Must Fix Before Trusting Production

#### P0-1: Implement Row-Level Security
- **Problem:** All data returned to any authenticated user with entity permission
- **Why it matters:** Confidentiality of financial data, project margins, contract values
- **Proposed fix:** Add `requireProjectAccess(projectId)` middleware; filter queries by user's assigned projects via `project_team_members` or new `user_project_access` table
- **Affected layers:** API middleware, all v1 and v2 query endpoints
- **Risk:** High — touches many endpoints; need comprehensive testing
- **Test cases:** Site PM can only see assigned projects; Engineer sees only their engineering projects; CFO sees all financial data
- **Rollback:** Feature-flag the RLS middleware; disable to revert to current behavior

#### P0-2: Enforce canEditData on Backend
- **Problem:** Read-only roles can submit writes via API
- **Why it matters:** Data integrity — unauthorized modifications
- **Proposed fix:** Add `requireEditPermission()` middleware that checks `canEditData` flag from role_permissions table on all POST/PATCH/DELETE routes
- **Affected layers:** Server middleware, all mutation routes
- **Risk:** Low — additive check; existing admin roles unaffected
- **Test cases:** PROJECT_MANAGER_SITE POST to `/api/projects-summary/:name/edit` returns 403
- **Rollback:** Remove middleware check

#### P0-3: Verify KPI Consistency
- **Problem:** KPIs computed independently on multiple screens
- **Why it matters:** COO/CEO trust in the system depends on consistent numbers
- **Proposed fix:** Audit all KPI computation paths; create shared `canonical-kpi-service` that dashboard, project detail, portfolio, and GP tracker all call; add KPI traceability tests
- **Affected layers:** Server services, frontend data hooks
- **Risk:** Medium — may surface existing discrepancies that need resolution
- **Test cases:** Revenue total on dashboard === sum of revenue on GP tracker === sum of revenue on revenue tracker for same date range
- **Rollback:** Per-screen fallback to existing computation

### P1 — Should Fix Next

#### P1-1: Route Orphan Pages or Remove Them
- **Problem:** 5 built pages with no routes
- **Why it matters:** Dead code, incomplete features, maintenance burden
- **Proposed fix:** Add routes for role-settings, phase-templates, notification-center to PAGE_REGISTRY with appropriate permission gating; evaluate project-create and exceptions for inclusion or deletion
- **Affected layers:** Frontend routing, PAGE_REGISTRY
- **Risk:** Low
- **Test cases:** Navigate to each newly routed page; verify permission gating
- **Rollback:** Remove route entries

#### P1-2: Add O&M/Matriarch Handover Phase
- **Problem:** No post-completion workflow
- **Why it matters:** Operational gap between project closeout and O&M
- **Proposed fix:** Add "O&M Handover" phase to lifecycle; create gate requirements for documentation, warranties, system handover; add Matriarch as a counterparty type
- **Affected layers:** Schema (phase enum), stage gate definitions, frontend lifecycle board
- **Risk:** Low — additive change
- **Test cases:** Project can transition to O&M Handover; gate blocks without required documentation
- **Rollback:** Remove phase from enum and gate definitions

#### P1-3: Add Approval SLA and Escalation
- **Problem:** Approvals sit indefinitely with no timeout
- **Why it matters:** Operational bottleneck — blocked work, delayed procurement
- **Proposed fix:** Add `due_date` and `escalated_to` columns to approvals table; background job checks overdue approvals and escalates
- **Affected layers:** Schema, background job, frontend notification
- **Risk:** Low-Medium
- **Test cases:** Approval older than 3 days triggers escalation notification
- **Rollback:** Ignore new columns

#### P1-4: Add Finance Manager Approval for COS Pull-Forward
- **Problem:** No approval gate for COS timing changes
- **Why it matters:** [USER BUSINESS RULE] Financial control requirement
- **Proposed fix:** When COS line date is moved earlier than original, trigger financial approval workflow; Finance Manager must approve before commit
- **Affected layers:** Server COS routes, approval workflow, frontend COS editor
- **Risk:** Medium — changes existing edit flow
- **Test cases:** Moving COS payment date earlier triggers approval; original date unchanged until approved
- **Rollback:** Remove approval trigger; allow direct edit

#### P1-5: Surface Latest Update on Project List
- **Problem:** Construction Manager needs to see latest update without drilling into project detail
- **Why it matters:** Daily operational visibility requirement
- **Proposed fix:** Add `latestUpdate` column (truncated) to project list table; add tooltip for full text; add last-updated timestamp
- **Affected layers:** Frontend project list, API project list response
- **Risk:** Low
- **Test cases:** Latest update visible on list; editable from detail; changes reflect on list
- **Rollback:** Hide column

#### P1-6: Construction Manager Finance Visibility
- **Problem:** CONSTRUCTION_MANAGER role lacks MONEY section access
- **Why it matters:** Construction Manager needs cost visibility for margin control on site
- **Proposed fix:** Add MONEY section (read-only) to CONSTRUCTION_MANAGER default permissions; add `cashflow.read`, `cos.read`, `revenue_tracker.read` to permission defaults
- **Affected layers:** Role defaults, permission catalog
- **Risk:** Low — additive permission
- **Test cases:** Construction Manager can view finance pages but not edit
- **Rollback:** Remove section from role defaults

### P2 — Improvements / Polish

#### P2-1: Extract Fiscal Year Configuration
- **Problem:** Sep-Aug hardcoded
- **Proposed fix:** Move fiscal year start month to system config table; compute FY boundaries dynamically
- **Affected layers:** All financial services, frontend month arrays
- **Risk:** Medium — touches many calculations

#### P2-2: Split Large Page Files
- **Problem:** 100-200KB single-file components
- **Proposed fix:** Extract subcomponents (tab panels, modals, data grids) into separate files
- **Affected layers:** Frontend only
- **Risk:** Low — refactoring, no logic change

#### P2-3: Standardize Loading/Empty States
- **Problem:** Inconsistent loading and empty state UX
- **Proposed fix:** Create shared `<EmptyState>` and `<PageSkeleton>` components; replace ad-hoc loading patterns
- **Affected layers:** Frontend components
- **Risk:** Low

#### P2-4: Complete Integer FK Migration
- **Problem:** Dual key pattern (projectName vs projectInfoId)
- **Proposed fix:** Migrate remaining tables to use projectInfoId as FK; add foreign key constraints; add migration for data backfill
- **Affected layers:** Schema, migrations, all queries using projectName as join key
- **Risk:** High — wide-reaching; requires careful data migration

#### P2-5: Add HSE-Specific Role and Lifecycle Guard
- **Problem:** No distinct HSE role; HSE not lifecycle-gated
- **Proposed fix:** Create HSE_MANAGER role with appropriate permissions; add lifecycle-phase guard that prevents HSE checklist activation before PD→PM handover
- **Affected layers:** Schema (role enum), permission defaults, quality/HSE routes
- **Risk:** Low-Medium

#### P2-6: Add Multi-Currency Support
- **Problem:** All amounts assumed single currency
- **Proposed fix:** Add `currency` column to financial tables; add exchange rate table; display currency in UI
- **Affected layers:** Schema, financial services, frontend display
- **Risk:** Medium — requires careful handling of aggregation across currencies

---

## 10. QUESTIONS / ASSUMPTIONS

### Grounded Assumptions (from code analysis)

1. **[INFERRED]** The system is currently used by a small team (< 30 users) based on the in-memory permission caching strategy (60s TTL) and lack of pagination on user management. If scaling beyond 100+ users, caching and query patterns will need review.

2. **[INFERRED]** SharePoint is the document storage system — `sp_files` and `sp_settings` tables suggest SharePoint integration for document management. No local file storage for project documents.

3. **[INFERRED]** Microsoft 365 is the identity provider for SSO — MSAL configuration and Microsoft Graph API integration suggest the company uses M365 for email, calendar, and Teams.

4. **[INFERRED]** The "font color" logic (black = confirmed, red = forecast) in financial state classification is inherited directly from the Excel tracker format where font colors distinguished confirmed vs forecast dates. This is a pragmatic but fragile pattern.

5. **[INFERRED]** The `executionGateStatus` and `executionEnabled` flags are the primary mechanism for controlling whether construction can begin — this acts as the "notice to proceed" equivalent.

### Questions for Business Owner

1. **Construction Manager Finance Access:** The current role definition excludes the MONEY section. Should Construction Manager have read-only access to finance pages (cashflow, COS, revenue) for cost control? Or should a separate "Construction Finance View" be created?

2. **Matriarch Handover:** What specific documentation and sign-offs are required for O&M handover to Matriarch? Should this be a formal phase with its own gate requirements, or a simpler checklist?

3. **Approval SLA:** What is the expected turnaround time for approvals? Should escalation go to the next level of authority (e.g., PM → Program Manager → COO), or to a specific escalation contact?

4. **HSE Governance:** Should HSE have its own role and permission entity separate from Quality, or is the current combined quality_manager approach acceptable?

5. **Fiscal Year Rollover:** When FY26 ends (Aug 2026), is there a process for rolling over to FY27? Does the system need to support multiple active fiscal years (e.g., viewing FY25 history while working in FY26)?

6. **Variation Orders:** The schema has `voPmLimit` and `currentVoTotal` fields but no VO workflow. Is variation order management a priority, or is it handled outside the system?

7. **External Counterparty Portal:** The assignment model supports external counterparties. Is there a plan for counterparties to have login access and view their assigned work, or is assignment for internal tracking only?

8. **Board Pack Reporting:** The KPI traceability admin page exists. Is board-level reporting generated from this system, or does data flow out to another reporting tool (Power BI, etc.)?

---

*End of audit report. This document should be treated as the baseline for all subsequent development decisions.*
