# Full-Stack Architecture Audit — Emergent Energy Web App

> **Audit date**: 2026-03-20
> **Scope**: Complete full-stack audit (data layer, API layer, frontend layer)
> **Status**: Audit only — no code changes made

## Codebase Summary

| Metric | Value |
|--------|-------|
| Database tables | 200+ (Drizzle ORM / PostgreSQL) |
| Enums | 85 |
| Schema file | `shared/schema.ts` — 5,936 lines |
| API route files | 43 |
| API endpoints | 288+ |
| Services | 15 |
| Frontend pages | 99 |
| Frontend components | 147 |
| Custom hooks | 11 |
| SQL migrations | 33 |

## Critical Findings (Top 5)

1. **Dual project model** — Legacy `projects` table runs parallel to canonical `project_info`. Two root entities for the same concept with no FK link.
2. **Override tables have no FK integrity** — 8 override tables link by `projectName` (text) + `rowNumber` instead of foreign key. Breaks silently on rename or re-import.
3. **4 overlapping task systems** — `operational_tasks`, `work_items`, `mytool_tasks`, `engineering_tasks` with bidirectional sync. Conflict-prone.
4. **Frontend duplicates server permission logic** — Full permission matrix evaluated client-side AND server-side independently. Divergence risk.
5. **10+ API calls per project detail page** — No consolidated endpoint. Waterfall requests on every project view.

## Document Index

| Section | File | Contents |
|---------|------|----------|
| 1 | [01-current-data-spine.md](./01-current-data-spine.md) | Architecture diagram, all entity groups (A-K), relationships, API route map, data flow |
| 2 | [02-frontend-architecture.md](./02-frontend-architecture.md) | 99 pages by module, component hierarchy, state management, forms, computed state |
| 3 | [03-frontend-backend-connections.md](./03-frontend-backend-connections.md) | Entity-to-page mapping, per-page connection detail, flags (4 critical, 10 warnings) |
| 4 | [04-data-flow-validation-spine-issues.md](./04-data-flow-validation-spine-issues.md) | Bottom-up validation, inverted/circular patterns, backend/frontend/cross-cutting issues |
| 5 | [05-ideal-spine.md](./05-ideal-spine.md) | Proposed Layer 0-4 entity hierarchy, ideal API structure, frontend state ownership |
| 6 | [06-gap-analysis-migration-risk.md](./06-gap-analysis-migration-risk.md) | Current vs ideal gaps (10 data, 7 API, 7 frontend), issue severity table, migration risk |
| 7 | [07-ordered-changes.md](./07-ordered-changes.md) | 5-phase migration plan with 16 ordered changes, timeline, risk mitigation |

## Issue Count by Severity

| Severity | Count | Layer |
|----------|-------|-------|
| Critical (⛔) | 5 | Backend (3), Cross-cutting (2) |
| Warning (⚠️) | 10 | Backend (4), Frontend (4), Cross-cutting (2) |
| Info (ℹ️) | 4 | Backend (3), Frontend (1) |

## Quick Reference: What Powers Each Page

| Page | Primary Entity | API Layer | Issues |
|------|---------------|-----------|--------|
| `/dashboard` | project_info + aggregations | Legacy routes.ts | W5 (over-fetch) |
| `/project/:name` | project_info + 10 sub-entities | Legacy routes.ts (10+ calls) | W1, C4 |
| `/cashflow` | cashflow_points + overrides | Legacy routes.ts | W3, C2 |
| `/cos` | program_expense (aggregated) | Legacy routes.ts | W3, C2 |
| `/tasks` | operational_tasks + work_items | Legacy + task-mgmt routes | W7, C5 |
| `/my-work/*` | mytool_tasks + assigned tasks | Legacy routes | W7 |
| `/engineering/*` | engineering_tasks + stages | Engineering routes | W7 |
| `/quality` | qc_checklist + instances | Quality routes | ✅ Clean |
| `/pd/*` | pd_tickets + clients | PD routes | ✅ Clean |
| `/admin/*` | users + roles + settings | Admin routes | ✅ Clean |
