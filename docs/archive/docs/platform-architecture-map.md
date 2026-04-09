# Platform Architecture Map

## Purpose
Emergent Energy is not a collection of disconnected department pages. The application is the operational control system for a solar EPC business, and the project remains the shared spine across finance, engineering, quality, procurement, construction, commissioning, handover, and governance.

This document defines the shared platform foundation that later modules must extend instead of bypassing.

## Architecture Decisions
1. `project_info.id` is the canonical project identity inside the application.
   `canonical_project_id` remains a compatibility hook, but the active platform spine resolves to `project_info.id` unless and until an external master key is promoted.
2. Lifecycle stage is canonicalized from `project_info.execution_phase` and `project_info.phase`.
   Shared normalization uses the existing `PROJECT_PHASE_LABELS`, `PHASE_TEXT_TO_ENUM`, and `LEGACY_TO_LIFECYCLE` mappings.
3. Shared tasking is canonicalized through `work_items`.
   Cross-project and cross-department workload should aggregate from `work_items`, not bespoke per-page joins over legacy task tables.
4. Shared assignees are canonicalized through `work_item_assignments`, with `work_items.owner_user_id` used only as a compatibility fallback for older records.
5. Shared approval actions are canonicalized through `approvals`.
   Any later approval workflow must attach to `project_id` and reuse this action contract before introducing another approval ledger.
6. Shared deliverable completion is canonicalized through `deliverables`.
   `deliverable_events` and `deliverable_versions` remain the history/version surfaces for the same deliverable spine.
7. The canonical latest update per project is `project_editable_fields.latest_update`.
   The platform exposes one latest update contract and one summary projection for it.
8. Every major mutation must be auditable through `audit_events`.
   Project-facing mutations should also emit project timeline events when they materially change project state.
9. Cross-department summary reads should go through shared services or `/api/platform/*` endpoints.
   New department pages should not embed bespoke summary joins inside page-specific route handlers.

## Shared Contracts
Implemented in `shared/platform-contracts.ts`.

- Project spine contract
  Canonical fields: project id, project name, client, lifecycle stage, ownership, active state.
- Department workspace contract
  Canonical fields: department id, project id, lifecycle stage, readable entities, writable entities, authoritative services.
- Shared work item contract
  Canonical fields: work item id, project id, workstream, normalized status, normalized priority, owner, authoritative task tables.
- Shared workflow action contract
  Canonical fields: action type, project id, status, source table, assigned/requested/decided users, due date, phase.
- Shared assignee contract
  Canonical fields: assignment role, user id, role id, display name, source entity, canonical vs fallback.
- Shared latest update contract
  Canonical fields: project id, text, updated at, updated by, source table.
- Shared activity contract
  Canonical fields: project id, last activity timestamp, summary, actor, source table.
- Shared KPI contract
  Canonical fields: id, name, numeric value, unit, source table, source service.

## Authoritative Tables
| Concern | Canonical table(s) | Notes |
| --- | --- | --- |
| Project spine | `project_info` | Project identity, lifecycle state, ownership, active/archived state |
| Latest update | `project_editable_fields` | One canonical latest update row per project name |
| Shared work items | `work_items` | Shared cross-department task and milestone spine |
| Shared assignees | `work_item_assignments` | Canonical assignee relationship model |
| Approval actions | `approvals` | Shared approval action ledger |
| Deliverable completion | `deliverables` | Shared deliverable completion state |
| Audit trail | `audit_events` | Mandatory auditable mutation trail |
| Project activity timeline | `project_events` when present, else `audit_events` fallback | Timeline enrichment, currently optional in some runtimes |
| Lifecycle history | `project_phase_history` | Authoritative phase transition record |
| KPI definitions | `shared/kpi-definitions.ts` | Shared reporting definitions used across dashboards and summaries |

## Authoritative Services
| Service | Responsibility |
| --- | --- |
| `server/services/project-platform-summary-service.ts` | Shared project summary composition for all departments |
| `server/services/canonical-dashboard-kpi-service.ts` | Canonical finance and task KPI aggregation, now cross-db safe |
| `server/services/lifecycle-stage-gate-service.ts` | Canonical lifecycle gate evaluation and overrides |
| `server/services/project-event-service.ts` | Project timeline event emission |

## Route Ownership
| Route | Owner |
| --- | --- |
| `/api/projects-summary` | `server/routes.ts` |
| `/api/platform/contracts` | `server/platform-routes.ts` |
| `/api/platform/projects/:projectId/summary` | `server/platform-routes.ts` |
| `/api/projects-summary/:projectName/latest-update` | `server/routes.ts` |
| `/api/projects/:projectId/phase` | `server/engineering-routes.ts` |
| `/api/project-events/project/:projectId` | `server/project-events-routes.ts` |
| `/api/approvals/*` | `server/approvals-routes.ts` |
| `/api/deliverable-capture/*` | `server/deliverable-capture-routes.ts` |
| `/api/quality/project/*` | `server/quality-routes.ts` |
| `/api/projects/:projectId/eng-tasks` | `server/engineering-routes.ts` |

The route ownership registry is implemented in `server/platform/route-ownership.ts`.

## Department Read / Write Boundaries
| Department | May read | May write |
| --- | --- | --- |
| Project | project spine, latest update, activity, KPIs, work items, approvals, deliverables | project spine, latest update, work items |
| Finance | project spine, latest update, activity, KPIs, approvals, deliverables | approvals |
| Engineering | project spine, latest update, activity, KPIs, work items, approvals, deliverables | work items, deliverables, approvals |
| Quality | project spine, latest update, activity, KPIs, work items, approvals, deliverables | approvals, deliverables |
| Procurement | project spine, latest update, activity, KPIs, approvals | approvals |
| Construction | project spine, latest update, activity, KPIs, work items, deliverables | work items, deliverables |
| Commissioning | project spine, latest update, activity, KPIs, approvals, deliverables | approvals, deliverables |
| Handover | project spine, latest update, activity, KPIs, approvals, deliverables | approvals, deliverables |
| Governance | project spine, latest update, activity, KPIs, approvals, deliverables | project spine, latest update |

## Anti-Duplication Safeguards
1. One canonical lifecycle source: `project_info.phase` and `project_info.execution_phase`, normalized by the shared platform contract.
2. One canonical latest update per project: `project_editable_fields.latest_update`.
3. One canonical assignee model: `work_item_assignments`, with compatibility fallback from `work_items.owner_user_id`.
4. One canonical approval action model: `approvals`.
5. One canonical deliverable completion model: `deliverables.status`, normalized through the shared workflow action contract.
6. One canonical shared summary composition layer: `project-platform-summary-service`.
7. One canonical API error shape for platform endpoints and refactored project-summary mutations: `server/lib/api-error.ts`.

## Shared Summary Consumption
Current shared entry points:

- `/api/projects-summary`
  Existing legacy shape preserved for current pages.
  Canonical `shared_summary` payload is now attached per project.
- `/api/platform/projects/:projectId/summary`
  New stable platform summary endpoint for later department work.
- `/api/platform/contracts`
  New machine-readable contract and route-ownership endpoint.

## Safe Extension Pattern
When adding a new project-facing feature:

1. Attach every record to `project_info.id`.
2. Reuse `work_items`, `work_item_assignments`, `approvals`, and `deliverables` before creating a new workflow table.
3. If a new table is truly required, include:
   - `project_id`
   - actor fields
   - timestamps
   - status using shared conventions
   - audit emission on every major mutation
4. Surface cross-department summary needs through `project-platform-summary-service` or `/api/platform/*`.
5. Use `server/lib/api-error.ts` for backend-enforced error responses.
6. Update this document and `server/platform/route-ownership.ts` when route ownership changes.
