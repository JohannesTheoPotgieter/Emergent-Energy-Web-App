# Section 6: Gap Analysis & Migration Risk Assessment

## 6.1 Gap Analysis: Current vs Ideal

### Data Layer Gaps

| # | Gap | Current State | Ideal State | Effort |
|---|-----|--------------|-------------|--------|
| D1 | **Legacy tables still active** | `projects`, `expenses`, `revenues`, `tasks`, `budgets` actively served | Fully deprecated; all reads from canonical tables | High — requires migrating all consumers |
| D2 | **Override tables lack FKs** | Linked by `projectName` + `rowNumber` (text) | Linked by FK to base table row ID | High — requires data migration + override table redesign |
| D3 | **Dual project identity** | `project_info.id` and `project_info.projectName` both used as identifiers across tables | All tables FK to `project_info.id`; `projectName` is display-only | High — 50+ tables reference projectName |
| D4 | **4 task systems** | `operational_tasks`, `work_items`, `mytool_tasks`, `engineering_tasks` | `work_items` as single canonical + `mytool_tasks` for personal | Medium — work_items adapter already exists |
| D5 | **God schema file** | 5,936-line `shared/schema.ts` | Split by domain: `schema/users.ts`, `schema/projects.ts`, `schema/finance.ts`, etc. | Low — structural refactor, no data change |
| D6 | **Financial data lacks FK integrity** | `finance_revenue_monthly`, `finance_cos_monthly` have no `project_id` FK | Add `project_id` FK column | Low — additive migration |
| D7 | **Polymorphic task references** | `task_comments.taskId`, `task_checklists.taskId` point to multiple tables | Typed junction: `task_id` + `task_type` discriminator, or unify under `work_items` | Medium |
| D8 | **Orphaned tables** | `mock_sp_items`, `template_profiles`, `forecast_pipeline` | Drop unused tables | Low |
| D9 | **Duplicated project name** | Stored in 30+ tables as text column | Remove denormalized `projectName` columns; join via FK | High — requires query rewrites |
| D10 | **Stored aggregates can go stale** | `project_revenue_summary` computed on import, not on edit | Either compute on-demand or trigger refresh on any edit | Medium |

### API Layer Gaps

| # | Gap | Current State | Ideal State | Effort |
|---|-----|--------------|-------------|--------|
| A1 | **Monolith routes.ts** | ~4000+ lines in one file mixing concerns | Split by domain; each route file uses service layer | Medium |
| A2 | **V2 API incomplete** | V2 exists but frontend uses legacy routes | Complete V2 migration; deprecate legacy endpoints | High |
| A3 | **No consolidated project endpoint** | Project detail page makes 10+ API calls | Single GET `/api/v2/projects/:id` with sections | Medium |
| A4 | **No typed API contracts** | Frontend manually types API responses | Generate types from Zod schemas (shared) | Low-Medium |
| A5 | **Legacy endpoints serve raw DB rows** | Routes return `select * from table` | Service layer shapes response for UI needs | Medium |
| A6 | **Permission check not in response** | Frontend computes permissions separately | Include `permissions` object in API response | Low |
| A7 | **Search endpoint does cross-table scan** | GET `/api/search` scans multiple tables | Dedicated search index or materialized view | Medium |

### Frontend Layer Gaps

| # | Gap | Current State | Ideal State | Effort |
|---|-----|--------------|-------------|--------|
| F1 | **Client-side permission logic** | Full permission matrix evaluated in `access-control.ts` | Server returns permissions; FE just reads flags | Medium |
| F2 | **Financial re-aggregation** | Tab components sum rows client-side | Server returns pre-aggregated summaries | Low per endpoint |
| F3 | **ProgramProvider over-fetching** | Loads dashboard data for all users at mount | Lazy-load per page; remove ProgramProvider | Medium |
| F4 | **Direct fetch() calls** | 484+ raw fetch() for mutations | Convert to `useMutation` with proper invalidation | High (volume) |
| F5 | **Dead code** | `/my-tool/*` routes, legacy admin page | Remove dead routes and components | Low |
| F6 | **No adapter/interface for task types** | Components handle 4 task shapes with conditionals | Unified `Task` interface with adapter functions | Medium |
| F7 | **Tab components tightly coupled** | Tabs destructure raw API response shape | Tabs receive typed props via adapter | Medium |

## 6.2 Issue Summary by Severity

### Critical (Must Fix — Data Integrity / Correctness Risk)

| # | Issue | Layer | Risk |
|---|-------|-------|------|
| C1 | Legacy tables still active alongside canonical | Backend | Data inconsistency between two project models |
| C2 | Override tables linked by projectName (text, no FK) | Backend | Orphaned overrides on project rename or re-import |
| C3 | Frontend permission logic can diverge from server | Cross-cutting | Security — user sees/hides wrong UI |
| C4 | Dual project identity (id vs name) across 50+ tables | Backend | Query inconsistency, update anomalies |
| C5 | Bidirectional task sync (operational_tasks ↔ work_items) | Backend | Conflict resolution failures, data duplication |

### Warning (Should Fix — Maintainability / Performance)

| # | Issue | Layer | Risk |
|---|-------|-------|------|
| W1 | 10+ API calls per project detail page | Cross-cutting | Slow page load, waterfall requests |
| W2 | No typed API contracts | Cross-cutting | Type drift between frontend and backend |
| W3 | Financial aggregation duplicated FE/BE | Cross-cutting | Incorrect totals displayed |
| W4 | God schema file (5,936 lines) | Backend | Developer productivity, merge conflicts |
| W5 | ProgramProvider loads everything upfront | Frontend | Wasted bandwidth, slow initial load |
| W6 | 484+ direct fetch() calls bypass cache | Frontend | Stale UI after mutations |
| W7 | Monolith routes.ts (~4000+ lines) | Backend | Unmaintainable, hard to test |
| W8 | 4 separate task systems | Backend + Frontend | Complexity, confusion, inconsistent behavior |

### Info (Nice to Have — Cleanup)

| # | Issue | Layer |
|---|-------|-------|
| I1 | Dead routes (`/my-tool/*`, legacy admin) | Frontend |
| I2 | Orphaned DB tables (mock_sp_items, etc.) | Backend |
| I3 | Denormalized assigneeName alongside FK | Backend |
| I4 | mock/seed data in production schema | Backend |

## 6.3 Migration Risk Assessment

### Data at Risk

| Risk | Tables Affected | Impact | Mitigation |
|------|----------------|--------|------------|
| **Renaming `projectName` references to FK-based** | 50+ tables with `projectName` text column | Queries, overrides, imports, exports all break | Phased: add FK first, backfill, then deprecate text column |
| **Dropping legacy tables** | `projects`, `expenses`, `revenues`, `tasks`, `budgets` | Export endpoints, some dashboard fallbacks break | Migrate consumers first; keep tables read-only during transition |
| **Override table FK migration** | 8 override tables | Existing overrides may not match new FK scheme if row IDs differ from rowNumber | Backfill script to resolve rowNumber → FK; validate before dropping text link |
| **Task consolidation** | `operational_tasks`, `work_items`, `engineering_tasks` | Adapters, services, frontend all reference specific table | Keep adapter layer; migrate one domain at a time |

### Pages Affected by Migration

| Migration | Pages Affected |
|-----------|---------------|
| Legacy table removal | `/dashboard` (fallback), export features, `/admin/legacy-utilities` |
| Override FK migration | `/project/:name` (all finance tabs), `/cashflow`, `/cos` |
| Task unification | `/tasks`, `/my-work/*`, `/engineering/*`, `/pm-dashboard` |
| V2 API migration | All 99 pages (incrementally) |
| Permission server-side | All pages using `PermissionGate`, `usePermission`, `useAccessMatrix` |

### Breaking Changes

| Change | Breaking For | Severity |
|--------|-------------|----------|
| Remove GET `/api/expenses` | Any external consumer or export script | Medium |
| Remove GET `/api/revenues` | Any external consumer or export script | Medium |
| Change override table schema | All override write endpoints | High |
| Change project detail response shape | All 10 tab components | High (but internal) |
| Remove ProgramProvider | All pages that access `useProgramData()` | Medium |
