# API v2 Migration Tracker

## Status legend
- `introduced`: v2 endpoint implemented and wired
- `frontend-pending`: frontend still using legacy endpoint
- `compat-wrapper`: temporary wrapper in place
- `deprecate-ready`: legacy endpoint can be removed after approval

## Domain status
| Domain | v2 status | Notes |
|---|---|---|
| auth / me / permissions | introduced | `/api/v2/me`, `/api/v2/me/permissions` added; permission payload now policy-source aligned. |
| dashboard read models | introduced | `/api/v2/dashboard/:role` now returns differentiated role-aware payload shapes. |
| projects hub | introduced | `/api/v2/projects`, `/api/v2/projects/:projectId/*` with service/repository flow. |
| project development | introduced | handover now updates both phase history and current project phase in one transaction. |
| engineering | introduced | engineering summary + dedicated design list/create/patch handlers. |
| quality | introduced | quality summary + check list/create/patch handlers; supports multi-checklist project reads. |
| project management | introduced | work items + milestone-specific endpoints with separate validation/permissions/audit. |
| procurement | introduced | procurement items, PO-specific flow, and invoice capture flow split and audited. |
| project finance | introduced | summary/cashflow/cos/revenue/expenditure are distinct contracts; variations create/patch/list implemented. |
| imports / sync | introduced | `/api/v2/imports/:domain` via smart import runs repository read. |
| lookups / reference data | introduced | `/api/v2/lookups/:type` with users/counterparties repository reads. |
| audit/activity | introduced | `/api/v2/audit/activity` and expanded write-action audit hooks. |

## Legacy compatibility policy
1. Old `/api/*` endpoints remain active for now and are not deleted.
2. New frontend callers should target `/api/v2/*` for project/detail/dashboard/procurement/finance paths first.
3. Any unavoidable wrappers should be isolated and marked with `TODO(v2-cutover)`.
4. Removal of legacy endpoints only after:
   - regression comparison passes,
   - user approval,
   - migration matrix marks endpoint as `deprecate-ready`.

## Remaining migration TODOs
- Frontend cutover still pending for some pages that call legacy procurement/finance routes.
- Consider introducing dedicated physical tables for purchase orders and finance variations after v2 traffic stabilizes.
