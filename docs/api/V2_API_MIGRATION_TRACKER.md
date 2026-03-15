# API v2 Migration Tracker

## Status legend
- `introduced`: v2 endpoint implemented and wired
- `frontend-pending`: frontend still using legacy endpoint
- `compat-wrapper`: temporary wrapper in place
- `deprecate-ready`: legacy endpoint can be removed after approval

## Domain status
| Domain | v2 status | Notes |
|---|---|---|
| auth / me / permissions | introduced | `/api/v2/me`, `/api/v2/me/permissions` added. |
| dashboard read models | introduced | `/api/v2/dashboard/:role` optimized aggregate counts. |
| projects hub | introduced | `/api/v2/projects`, `/api/v2/projects/:projectId/*` baseline endpoints added. |
| project development | introduced | development view + explicit handover transition endpoint. |
| engineering | introduced | engineering summary and designs endpoints. |
| quality | introduced | quality summary + checks endpoints. |
| project management | introduced | work items + milestones endpoints via `work_items`. |
| procurement | introduced | project procurement/items/PO/invoice endpoints consolidated. |
| project finance | introduced | summary/cashflow/cos/revenue/expenditure read models from normalized tables. |
| imports / sync | introduced | `/api/v2/imports/:domain` scaffolded to smart import runs. |
| lookups / reference data | introduced | `/api/v2/lookups/:type` with users/counterparties. |
| audit/activity | introduced | `/api/v2/audit/activity` and write-action audit hooks. |

## Legacy compatibility policy
1. Old `/api/*` endpoints remain active for now and are not deleted.
2. New frontend callers should target `/api/v2/*` for project/detail/dashboard/procurement/finance paths first.
3. Any unavoidable wrappers should be isolated and marked with `TODO(v2-cutover)`.
4. Removal of legacy endpoints only after:
   - regression comparison passes,
   - user approval,
   - migration matrix marks endpoint as `deprecate-ready`.

## Remaining frontend migration TODOs
- Update project list/detail pages to consume `/api/v2/projects*` contracts.
- Update dashboard role pages to consume `/api/v2/dashboard/:role`.
- Update procurement PO/invoice capture screens to consume `/api/v2/projects/:projectId/procurement/*`.
- Update finance tabs to consume `/api/v2/projects/:projectId/finance/*`.
- Update quality and engineering screens to use `/api/v2/projects/:projectId/quality*` and `/engineering*`.
- Keep compatibility adapters isolated while callers are switched.
