# Runtime CRUD Probes

**Base URL:** http://localhost:5000

**Project under test:** id=310 (name redacted)

**Roles probed:** 12 of 12 declared in `ROLES_TO_PROBE` (one user per role; userId only stored, no PII). **Sampled coverage** — roles outside this list (e.g. HSE_MANAGER, SSEG_MANAGER, ENGINEERING_MANAGER, KEY_ACCOUNTS_MANAGER) are not exercised at runtime; the static matrix in `per-page-per-role-matrix.csv` covers all roles policy-wise.

**Verdict legend:**
- `✓ match` — observed status is consistent with the policy intent.
- `⚠ gap` — 2xx but role is NOT in the policy list (route under-enforces; security finding).
- `⚠ over` — 401/403 but role IS in the policy list (route over-enforces; UX finding).
- `◇ 5xx` — server error; **indeterminate for authz**, recorded for triage of #14-class bugs.
- `! 400` — payload rejected by validation (probe misconfigured, not authz).

**Caveat — layered guards.** `policyAuthorized` is derived from a single source per probe (entity rule or named middleware). Some routes apply multiple guards (e.g. entity rule + per-project membership). A 403 from a role that IS in the entity rule may therefore be correct (membership gate blocks), even though it shows here as `policy_overshoot` against the chosen probe baseline.

## Per-probe policy intent

| Probe | Policy intent (allowed roles) | Notes |
|---|---|---|
| HSE incidents create (valid payload) | COO_ADMIN, CEO_ADMIN, HSE_MANAGER, CONSTRUCTION_MANAGER, PROJECT_MANAGER_SITE | Policy from ENTITY_PERMISSION_DEFAULTS.hse_incidents.create_roles. Route at server/departments/hse-routes.ts:120 is requireAuth-only. |
| Planning tasks create (valid payload, real project) | COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER | Middleware policy (canEditProjectTasks at planning-tasks-routes.ts:658). Probe users are not PM/PD on the chosen project, so only the three unconditional roles should pass. |
| Admin users list (control) | COO_ADMIN, CEO_ADMIN | Middleware policy (requireAdmin). Control sample. |
| Project 351 finance (known 500) | COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER, ACCOUNTANT, PROJECT_MANAGER_SITE | TRIAGE-ONLY: hardcoded project id 351 to reproduce the documented 500. Policy here is the closest entity rule (cashflow.view_roles); the route also applies a per-project membership gate, so 403s are not strict authz overshoots. Excluded from policy_gap/overshoot counts. |

## Status matrix

| Probe | PROJECT_MANAGER_SITE | CCO | PROJECT_DEVELOPER | ACCOUNTANT | ENGINEER | QUALITY_MANAGER | CEO_ADMIN | PROGRAM_MANAGER | CFO | CONSTRUCTION_MANAGER | PROGRAM_FINANCE_MANAGER | COO_ADMIN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HSE incidents create (valid payload) | 201 ✓ | 201 ⚠gap | 201 ⚠gap | 201 ⚠gap | 201 ⚠gap | 201 ⚠gap | 201 ✓ | 201 ⚠gap | 201 ⚠gap | 201 ✓ | 201 ⚠gap | 201 ✓ |
| Planning tasks create (valid payload, real project) | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 200 ✓ | 200 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 200 ✓ |
| Admin users list (control) | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 200 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 403 ✓ | 200 ✓ |
| Project 351 finance (known 500) | 403 ⚠over | 500 ◇ | 403 ✓ | 500 ◇ | 403 ✓ | 403 ✓ | 500 ◇ | 500 ◇ | 500 ◇ | 500 ◇ | 500 ◇ | 500 ◇ |

## Policy gaps (route under-enforces — security findings)

| Probe | Role | Status | Body |
|---|---|---|---|
| HSE incidents create (valid payload) | CCO | 201 | `{"id":146,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | PROJECT_DEVELOPER | 201 | `{"id":147,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | ACCOUNTANT | 201 | `{"id":148,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | ENGINEER | 201 | `{"id":149,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | QUALITY_MANAGER | 201 | `{"id":150,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | PROGRAM_MANAGER | 201 | `{"id":152,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | CFO | 201 | `{"id":153,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |
| HSE incidents create (valid payload) | PROGRAM_FINANCE_MANAGER | 201 | `{"id":155,"projectId":310,"siteId":null,"incidentDate":"2026-04-22","incidentType":"near_miss","severity":"low","description":"[audit-probe] runtime authz test ` |

## Policy overshoots (route over-enforces — UX/access findings)

_None._

## Server errors (5xx — indeterminate for authz)

| Probe | Role | Status | Body |
|---|---|---|---|
| Project 351 finance (known 500) | CCO | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | ACCOUNTANT | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | CEO_ADMIN | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | PROGRAM_MANAGER | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | CFO | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | CONSTRUCTION_MANAGER | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | PROGRAM_FINANCE_MANAGER | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |
| Project 351 finance (known 500) | COO_ADMIN | 500 | `{"success":false,"data":null,"meta":null,"error":{"code":"INTERNAL_ERROR","message":"Unexpected error","details":null}}` |

## Indeterminate (status outside policy buckets — investigate)

_None._

## Triage-only probes (excluded from gap/overshoot counts)

These probes target known issues (e.g. specific project ids reproducing a server bug) where the policy baseline is approximate or layered guards apply. Findings here should drive triage of the underlying defect rather than be read as authorization drift.

| Probe | Role | Status | Verdict |
|---|---|---|---|
| Project 351 finance (known 500) | PROJECT_MANAGER_SITE | 403 | policy_overshoot |
| Project 351 finance (known 500) | CCO | 500 | server_error |
| Project 351 finance (known 500) | PROJECT_DEVELOPER | 403 | policy_match |
| Project 351 finance (known 500) | ACCOUNTANT | 500 | server_error |
| Project 351 finance (known 500) | ENGINEER | 403 | policy_match |
| Project 351 finance (known 500) | QUALITY_MANAGER | 403 | policy_match |
| Project 351 finance (known 500) | CEO_ADMIN | 500 | server_error |
| Project 351 finance (known 500) | PROGRAM_MANAGER | 500 | server_error |
| Project 351 finance (known 500) | CFO | 500 | server_error |
| Project 351 finance (known 500) | CONSTRUCTION_MANAGER | 500 | server_error |
| Project 351 finance (known 500) | PROGRAM_FINANCE_MANAGER | 500 | server_error |
| Project 351 finance (known 500) | COO_ADMIN | 500 | server_error |
