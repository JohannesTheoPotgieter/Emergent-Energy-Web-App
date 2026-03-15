# API v2 Migration Tracker

## Status legend
- `introduced`: v2 endpoint implemented and wired
- `frontend-pending`: frontend still using legacy endpoint
- `compat-wrapper`: temporary wrapper in place
- `deprecate-ready`: legacy endpoint can be removed after approval

## Domain status
| Domain | v2 status | Notes |
|---|---|---|
| auth / me / permissions | introduced | `/api/v2/me`, `/api/v2/me/permissions` added; permission payload now policy-source aligned from `permission-catalog`. |
| dashboard read models | introduced | `/api/v2/dashboard/:role` returns differentiated role-aware payloads (COO/CFO/PM/Engineer/Quality/PD). |
| projects hub | introduced | `/api/v2/projects`, `/api/v2/projects/:projectId/*` with service/repository flow and project-id keyed reads. |
| project development | introduced | handover now updates both phase history and current project phase in one transaction; invalid transitions are rejected. |
| engineering | introduced | engineering summary + dedicated design list/create/patch handlers with stage existence validation. |
| quality | introduced | quality summary + check list/create/patch handlers; create validates checklist belongs to requested project and supports multi-checklist reads. |
| project management | introduced | work items + milestone endpoints with dedicated validation/permissions/audit and duplicate-create guard at repository level. |
| procurement | introduced | procurement items, PO-specific flow, and invoice capture flow split and audited. |
| project finance | introduced | summary/cashflow/cos/revenue/expenditure are distinct contracts; variations create/patch/list implemented. |
| imports / sync | introduced | `/api/v2/imports/:domain` via smart import runs repository read. |
| lookups / reference data | introduced | `/api/v2/lookups/:type` with users/counterparties repository reads. |
| audit/activity | introduced | `/api/v2/audit/activity` and expanded write-action audit hooks across mutation domains. |

## Legacy compatibility policy
1. Old `/api/*` endpoints remain active for now and are not deleted.
2. New frontend callers should target `/api/v2/*` for project/detail/dashboard/procurement/finance paths first.
3. Any unavoidable wrappers should be isolated and marked with `TODO(v2-cutover)`.
4. Removal of legacy endpoints only after:
   - regression comparison passes,
   - user approval,
   - migration matrix marks endpoint as `deprecate-ready`.

## Deprecated / replacement routing notes
| Legacy endpoint group | Replacement v2 endpoint | Status |
|---|---|---|
| `/api/projects/*` project detail/summary mixes | `/api/v2/projects/:projectId`, `/overview`, `/health` | frontend-pending |
| lifecycle handover wrappers | `/api/v2/projects/:projectId/development/handover` | compat-wrapper |
| mixed engineering task/deliverable handlers | `/api/v2/projects/:projectId/engineering` + `/engineering/designs` | frontend-pending |
| generic quality wrappers | `/api/v2/projects/:projectId/quality` + `/quality/checks` | frontend-pending |
| combined procurement/PO aliases | `/api/v2/projects/:projectId/procurement/items` + `/procurement/pos` | frontend-pending |
| finance summary blobs | `/api/v2/projects/:projectId/finance/{summary,cashflow,cos,revenue,expenditure,variations}` | frontend-pending |

## Remaining migration TODOs
- Frontend cutover still pending for pages that call legacy procurement/finance routes.
- POs still persist in `procurement_items` (PO-specific flow is API-isolated, storage split can follow post-cutover).
- Finance variations still persist in `work_items` (`workstream=FINANCE`, `type=VARIATION`) and should move to dedicated storage later if reporting pressure increases.

## Cutover notes
- API v2 business logic now blocks invalid lifecycle transitions and enforces mutation validations consistently.
- Permission enforcement in v2 routes uses one catalog-backed source through `access-policy`.
- Legacy tables remain untouched, but new v2 logic must only use target truth tables documented in `docs/db/TARGET_TRUTH_MATRIX.md`.
