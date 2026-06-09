# Role Permission Audit — Latest Cycle

> Status: `PASS` — generated 2026-06-09 by `npm run qa:role-audit` from the canonical RBAC model (PAGE_REGISTRY → permissionEntity → checkPermission over DEFAULT_ROLE_PERMISSIONS). Re-run to refresh.

| Role | Route | Permission entity | Expected access | Observed access | API check performed | Result | Notes |
|---|---|---|---|---|---|---|---|
| COO_ADMIN | /projects | projects | Allow | 16 role(s) allowed | checkPermission(view) | pass | 16/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /project/:projectName | projects | Allow | 16 role(s) allowed | checkPermission(view) | pass | 16/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /cashflow | cashflow | Allow | 8 role(s) allowed | checkPermission(view) | pass | 8/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /quality | quality | Allow | 12 role(s) allowed | checkPermission(view) | pass | 12/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /engineering/tasks | eng_tasks | Allow | 9 role(s) allowed | checkPermission(view) | pass | 9/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /pm-dashboard | pm_dashboard | Allow | 4 role(s) allowed | checkPermission(view) | pass | 4/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /admin/control-center | admin_roles | Allow | 2 role(s) allowed | checkPermission(view) | pass | 2/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
| COO_ADMIN | /handover-control | handover | Allow | 10 role(s) allowed | checkPermission(view) | pass | 10/16 roles can view; derived from PAGE_REGISTRY + DEFAULT_ROLE_PERMISSIONS (asserted by qa/tests/unit/permissions-route-contract.test.ts) |
