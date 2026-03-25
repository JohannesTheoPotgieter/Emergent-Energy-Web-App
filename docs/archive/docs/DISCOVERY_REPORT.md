# Emergent Energy Dashboard — Discovery Report

**Date:** 2026-02-18
**Author:** Agent (automated discovery)

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix) |
| State | TanStack React Query (server), React Context (local) |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| Routing | wouter |
| Backend | Express.js + TypeScript (tsx runner) |
| Auth | Passport.js local strategy + JWT tokens |
| ORM | Drizzle ORM |
| Database | PostgreSQL (Neon-backed via Replit) |
| File Parsing | exceljs + multer |

---

## 2. Database / ORM / Migrations

- **ORM:** Drizzle ORM with `drizzle-orm/pg-core`
- **Schema file:** `shared/schema.ts` (~1,879 lines)
- **Migration strategy:** Schema pushes via Drizzle (`db:push`). No migration files directory.
- **Session store:** In-memory (SQLite fallback) or connect-pg-simple

---

## 3. Current Role / Login Implementation

### Roles (pgEnum `user_role`)
Current values: `admin`, `member`, `quality_manager`, `viewer`, `eng_program_manager`

### Users Table
- `id`, `email`, `password` (bcrypt hash), `name`, `role`
- Seeded users: `admin@emergent.energy`, `viewer@emergent.energy`, `qm@emergent.energy`

### Login Flow
- **Login page** (`client/src/pages/login.tsx`): Shows role tiles (Admin, QM, EPM)
- Each tile requires a 4-digit PIN challenge (client-side only: Admin=2024, QM=2026, EPM=2027)
- On unlock, auto-fills email/password and submits standard Passport local auth
- JWT token stored in localStorage for API auth
- Server auth: Passport session + JWT bearer token fallback

### Role Gating
- `RoleGuard` in `App.tsx` restricts paths by role
- EPM limited to: `/`, `/engineering`, `/engineering/tasks`, `/engineering/deliverables`, `/quality`, `/projects`
- Quality Manager limited to: `/`, `/quality`, `/projects`
- Admin paths (`/admin/*`) blocked for non-admin (except `/admin/reports`)
- Server-side: `requireAuth`, `requireAdmin`, `requireAdminOrEpm` middleware

---

## 4. Existing Modules (MUST REMAIN UNCHANGED)

### My Tool (UNTOUCHABLE)
- **Pages:** `my-tool-today.tsx`, `my-tool-week.tsx`, `my-tool-backlog.tsx`, `my-tool-settings.tsx`, `my-tool-admin-settings.tsx`, `my-tool-help.tsx`, `my-tool-priorities.tsx`
- **Components:** `client/src/components/mytool/` — TaskCard, TaskDetailDrawer, MyToolLayout
- **Schema:** `mytool_tasks`, `mytool_timeblocks`, `mytool_daily_reviews`, `mytool_company_priorities`, `mytool_user_preferences`, `mytool_dod_templates`
- **Backend:** Routes in `server/routes.ts` under `/api/mytool/*`

### Program View / Execution Dashboard (Excel-driven)
- **Page:** `dashboard.tsx`
- **Data source:** `projectInfo`, `programExpense`, `programInflows`, `projectPlan` tables (populated from Excel import)

### COS Tracker
- **Pages:** `cos.tsx`, `cos-control.tsx`
- **Backend:** `/api/cos-control/*`
- **Logic:** `server/lib/calculations/cosAggregator.ts`, `stateClassifier.ts`

### Cashflow Tracker
- **Pages:** `cashflow.tsx`, `cashflow-forecast.tsx`
- **Backend:** `/api/cashflow-forecast/*`
- **Logic:** `server/lib/calculations/cashflow.ts`, `forecaster.ts`

### Revenue Tracker
- **Page:** `revenue.tsx`

### Company Priorities
- **Page:** `my-tool-priorities.tsx` (inside My Tool)
- **Schema:** `mytool_company_priorities`

### Quality Module
- **Page:** `qm-dashboard.tsx`
- **Backend:** `server/quality-routes.ts` (1,036 lines)
- **Schema:** `qm_templates`, `qm_checklists`, `qm_checklist_items`, `qm_risk_answers`, `qm_warnings`, `qm_postmortems`

### Engineering Module
- **Pages:** `engineering-dashboard.tsx`, `engineering-tasks.tsx`, `engineering-deliverables.tsx`, `engineering-teams.tsx`, `engineering-audit-log.tsx`
- **Backend:** `server/engineering-routes.ts` (1,790 lines)
- **Schema:** `operationalTasks`, `taskComments`, `taskActivityLog`, `deliverables`, `deliverableVersions`, `qcWarning`, `qcWarningEvent`

### Excel Import
- **Parser:** `server/excelParser.ts`
- **Pipeline:** `server/importPipeline.ts`
- **Schema:** `importRuns`, `change_ledger`, `snapshots`, `snapshot_metrics`

### Phase Templates
- **Page:** `phase-templates.tsx`
- **Backend:** `server/template-routes.ts`
- **Schema:** `phaseTemplate`, `phaseTemplateItem`, `phaseTemplateItemHistory`, `phaseTemplateApplication`

### Exec Portfolio
- **Page:** `exec-portfolio.tsx`
- **Phases:** P0 through P7 (`PROJECT_PHASES` array in schema)

---

## 5. Finance Logic Locations (DO NOT MODIFY)

| File | Purpose |
|------|---------|
| `server/lib/calculations/stateClassifier.ts` | Expense state classification |
| `server/lib/calculations/forecaster.ts` | Payment forecasting |
| `server/lib/calculations/confidence.ts` | Confidence scoring |
| `server/lib/calculations/cashflow.ts` | Cashflow computation |
| `server/lib/calculations/cosAggregator.ts` | COS aggregation |
| `server/lib/calculations/dataQuality.ts` | Data quality rules |
| `server/lib/calculations/hashing.ts` | Row hashing |
| `server/lib/calculations/supplierExtractor.ts` | Supplier extraction |
| `server/lib/calculations/scenarioResolver.ts` | Scenario resolver |
| `server/lib/backfill.ts` | Computed field backfill |
| `server/excelParser.ts` | Excel parsing |
| `server/importPipeline.ts` | Import pipeline |

---

## 6. Existing Auditing Patterns

- **writeback_audit_log:** Tracks Excel writeback operations (id, mapping_id, action, executed_by, result, row_count, preview_data, rollback_data)
- **taskActivityLog:** Tracks operational task changes (task_id, action, field_name, old_value, new_value, changed_by)
- **qm_access_challenges:** QM access code audit trail with rate limiting
- **No global audit_event table exists**

---

## 7. Migration Strategy

### Schema Additions (safe, additive)
1. **New enum:** `company_role` — 10 business roles
2. **New table:** `role_credentials` — hashed passwords per role, lockout fields
3. **New enum:** `company_lifecycle_phase` — 5 lifecycle stages
4. **New table:** `company_projects` — lifecycle-aware project records linked to `projectInfo`
5. **New table:** `engineering_tasks` — lifecycle-tagged tasks with approval fields
6. **New table:** `engineering_task_attachments` — local file reference storage
7. **New table:** `audit_events` — global audit log
8. **New table:** `app_settings` — key-value settings (sync root, phase ownership, toggles)

### Key Decisions
- **Do NOT modify `userRoleEnum`** — the new role system uses a separate `role_credentials` table. Existing user/session system remains for internal use.
- **Do NOT modify `projectInfo`** — create `company_projects` linked by `projectName`
- **Do NOT modify `operationalTasks`** — create new `engineering_tasks` table
- **Do NOT touch any calculation files**

---

## 8. Questions for Johannes

No blocking questions at this time. Proceeding with implementation.
