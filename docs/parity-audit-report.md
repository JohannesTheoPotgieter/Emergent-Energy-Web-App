# Migration Parity Audit Report

> **Generated:** 2026-04-05
> **Wave 6 Step 1 — Pre-cleanup audit**

## Summary

| Status | Count |
|--------|-------|
| READY_TO_RETIRE | 1 |
| BRIDGE_ACTIVE | 12 |
| PARITY_GAP | 0 |
| BLOCKED | 0 |
| **Total domains** | **13** |

## Compatibility Layer Size

- **Bridge objects (BRIDGE_ACTIVE):** 12 — these have view-swap INSTEAD OF triggers providing transparent dual-write
- **Ready to retire:** 1
- **Total legacy consumers across all domains:** 44

## Per-Domain Status

### Parties

| Field | Value |
|-------|-------|
| Promoted | `core.parties` |
| Legacy | `public.clients + public.counterparties + public.users` |
| Status | **BRIDGE_ACTIVE** |
| Notes | Parties backfilled from all 3 sources. INSTEAD OF triggers on clients handle dual-write. Users table still authoritative for auth. |
| Exit condition | Auth migrated to user_accounts; all client/counterparty pages use /api/parties |

**Legacy consumers (4):**
- `server/routes/auth-routes.ts (login reads users)`
- `server/departments/opportunities-routes.ts (reads clients)`
- `client/src/pages/clients.tsx (reads /api/clients)`
- `client/src/pages/counterparties.tsx (reads counterparties)`

---

### Project Identity

| Field | Value |
|-------|-------|
| Promoted | `core.project_instances + core.projects` |
| Legacy | `public.project_info` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers provide 100% write coverage. All legacy INSERTs/UPDATEs transparently write to promoted tables. |
| Exit condition | All project reads migrated to v2 API or compatibility views |

**Legacy consumers (4):**
- `server/routes/projects.routes.ts (GET /api/projects)`
- `server/services/project-v2-service.ts (reads project_info)`
- `client/src/pages/project-detail.tsx (reads /api/v2/projects/:id)`
- `40+ route files reference projectInfo`

---

### Project Execution State

| Field | Value |
|-------|-------|
| Promoted | `core.projects (phase + state_history)` |
| Legacy | `public.project_execution_state` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Phase authoritative in project_instances. Key dates still in execution state. |
| Exit condition | Key dates migrated to project_instances; all reads use promoted schema |

**Legacy consumers (4):**
- `server/lifecycle-routes.ts`
- `server/services/stage-lifecycle-service.ts`
- `client/src/pages/project-detail.tsx`
- `client/src/pages/execution-board.tsx`

---

### Work Items

| Field | Value |
|-------|-------|
| Promoted | `core.work_items_clean + core.work_packages` |
| Legacy | `public.work_items` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Legacy work_items is now a view over promoted table. |
| Exit condition | All task management pages use v2 work items API |

**Legacy consumers (4):**
- `server/task-management-routes.ts`
- `server/routes/planning-tasks-routes.ts`
- `client/src/pages/my-work-tasks.tsx`
- `client/src/pages/execution-board.tsx`

---

### Approvals

| Field | Value |
|-------|-------|
| Promoted | `core.approval_instances + core.approval_rules` |
| Legacy | `public.approvals` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Legacy approvals is now a view. |
| Exit condition | All approval pages use /api/approvals-v2 |

**Legacy consumers (3):**
- `server/routes/approvals-routes.ts`
- `client/src/pages/admin-approvals.tsx`
- `client/src/pages/my-work-tasks.tsx (approvals tab)`

---

### Deliverables

| Field | Value |
|-------|-------|
| Promoted | `core.deliverable_instances + core.deliverable_definitions` |
| Legacy | `public.deliverables` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Legacy deliverables is now a view. |
| Exit condition | All engineering pages use /api/deliverables v2 API |

**Legacy consumers (3):**
- `server/engineering-routes.ts`
- `server/deliverable-capture-routes.ts`
- `client/src/pages/engineering-dashboard.tsx`

---

### Finance (Cost Lines)

| Field | Value |
|-------|-------|
| Promoted | `finance.cost_lines` |
| Legacy | `public.normalized_cost_lines` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Smart import writes to legacy table name (now a view). Transparent dual-write. |
| Exit condition | Smart import writes to finance_records; analytical pages use materialized views |

**Legacy consumers (4):**
- `server/smart-import-routes.ts (writes)`
- `server/departments/finance-routes.ts (reads)`
- `client/src/pages/cos.tsx`
- `client/src/pages/cashflow.tsx`

---

### Finance (Revenue Lines)

| Field | Value |
|-------|-------|
| Promoted | `finance.revenue_lines` |
| Legacy | `public.normalized_revenue_lines` |
| Status | **BRIDGE_ACTIVE** |
| Notes | View-swap INSTEAD OF triggers active. Same pattern as cost lines. |
| Exit condition | Smart import writes to finance_records; analytical pages use materialized views |

**Legacy consumers (3):**
- `server/smart-import-routes.ts (writes)`
- `client/src/pages/revenue-tracker.tsx`
- `client/src/pages/cashflow.tsx`

---

### Finance (Transactional)

| Field | Value |
|-------|-------|
| Promoted | `finance.finance_records` |
| Legacy | `public.purchase_orders + payment_requests + invoice_captures` |
| Status | **BRIDGE_ACTIVE** |
| Notes | Finance records backfilled from all transactional sources. New API available. Legacy routes still used by some pages. |
| Exit condition | All finance pages use /api/finance-records v2 API |

**Legacy consumers (7):**
- `server/po-routes.ts`
- `server/payment-request-routes.ts`
- `server/payment-batch-routes.ts`
- `server/invoice-capture-routes.ts`
- `client/src/pages/po-approval-board.tsx`
- `client/src/pages/payment-request-board.tsx`
- `client/src/pages/payment-batch-manager.tsx`

---

### Governed Processes

| Field | Value |
|-------|-------|
| Promoted | `core.governed_processes + checklist_items` |
| Legacy | `(derived from handovers, financial reviews, stage requirements)` |
| Status | **BRIDGE_ACTIVE** |
| Notes | Backfilled from 6 legacy sources. New processes use governed_process API. Legacy in-flight processes still use old routes. |
| Exit condition | All in-flight legacy processes complete; new processes always use governed_process |

**Legacy consumers (4):**
- `server/financial-review-routes.ts`
- `server/handover-routes.ts`
- `server/change-control-routes.ts`
- `server/payment-batch-routes.ts`

---

### External Resources

| Field | Value |
|-------|-------|
| Promoted | `core.external_resources + core.resource_links` |
| Legacy | `public.sp_files + deliverable_files` |
| Status | **BRIDGE_ACTIVE** |
| Notes | Backfilled from SharePoint files and deliverable files. New resource linking API available. |
| Exit condition | All file operations use external_resources API |

**Legacy consumers (2):**
- `server/sharepoint.ts`
- `server/deliverable-capture-routes.ts`

---

### Activity/Audit Logs

| Field | Value |
|-------|-------|
| Promoted | `internal.activity_log + internal.audit_log` |
| Legacy | `(new tables — no legacy equivalent)` |
| Status | **READY_TO_RETIRE** |
| Notes | No legacy equivalent to retire. These are net-new promoted tables. |
| Exit condition | N/A — already authoritative |

---

### Strategic Priorities

| Field | Value |
|-------|-------|
| Promoted | `core.strategic_priorities + links` |
| Legacy | `(derived from priorities tables)` |
| Status | **BRIDGE_ACTIVE** |
| Notes | Backfilled from legacy priorities. Some pages still read from legacy. |
| Exit condition | Priorities page uses promoted schema |

**Legacy consumers (2):**
- `server/departments/priority-strategic-routes.ts`
- `client/src/pages/priorities.tsx`

---

## SQL Verification Queries

Run these against the database to verify row count parity:

```sql
-- Parties parity
SELECT 'promoted' AS source, COUNT(*) FROM core.parties
UNION ALL
SELECT 'legacy_clients', COUNT(*) FROM _clients_legacy
UNION ALL
SELECT 'legacy_counterparties', COUNT(*) FROM counterparties
UNION ALL
SELECT 'legacy_users', COUNT(*) FROM _users_legacy;

-- Projects parity
SELECT 'promoted', COUNT(*) FROM core.project_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _project_info_legacy;

-- Work items parity
SELECT 'promoted', COUNT(*) FROM core.work_items_clean
UNION ALL
SELECT 'legacy', COUNT(*) FROM _work_items_legacy;

-- Approvals parity
SELECT 'promoted', COUNT(*) FROM core.approval_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _approvals_legacy;

-- Deliverables parity
SELECT 'promoted', COUNT(*) FROM core.deliverable_instances
UNION ALL
SELECT 'legacy', COUNT(*) FROM _deliverables_legacy;

-- Finance records parity
SELECT 'promoted', COUNT(*) FROM finance.finance_records
UNION ALL
SELECT 'legacy_po', COUNT(*) FROM purchase_orders
UNION ALL
SELECT 'legacy_pr', COUNT(*) FROM payment_requests
UNION ALL
SELECT 'legacy_inv', COUNT(*) FROM invoice_captures;
```

## Bridge Exit Plan

Each BRIDGE_ACTIVE domain needs its legacy consumers migrated before the bridge can be retired.
See `docs/bridge-exit-plan.md` for target dates and migration sequence.
