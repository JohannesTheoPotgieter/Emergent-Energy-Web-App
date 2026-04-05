# Bridge Exit Plan

> **Last updated:** 2026-04-05
> **Purpose:** Tracks the migration of legacy consumers to promoted schema APIs, enabling bridge retirement.

## Exit Sequence

Bridges should be retired in dependency order. A bridge can only be retired when ALL its legacy consumers have been migrated.

### Priority 1 — Auth + Identity (unblocks everything)

| Domain | Legacy Consumer | Migration Action | Target |
|--------|---------------|-----------------|--------|
| Parties (auth) | `auth-routes.ts` (login reads `users`) | Migrate login to read from `core.user_accounts` | Post-Wave 6 |
| Parties (clients) | `clients.tsx`, `client-detail.tsx` | Point to `/api/parties?kind=organisation` | Post-Wave 6 |
| Parties (counterparties) | `counterparties.tsx` | Point to `/api/parties` | Post-Wave 6 |

### Priority 2 — Project reads (high consumer count)

| Domain | Legacy Consumer | Migration Action | Target |
|--------|---------------|-----------------|--------|
| Project Identity | `projects.routes.ts` | Add v2 compatibility or migrate consumers | Post-Wave 6 |
| Execution State | `lifecycle-routes.ts`, `execution-board.tsx` | Read dates from `project_instances` | Post-Wave 6 |

### Priority 3 — Work engine

| Domain | Legacy Consumer | Migration Action | Target |
|--------|---------------|-----------------|--------|
| Work Items | `task-management-routes.ts`, `my-work-tasks.tsx` | Use `/api/work-items` v2 API | Post-Wave 6 |

### Priority 4 — Finance (analytical pages stay longer)

| Domain | Legacy Consumer | Migration Action | Target |
|--------|---------------|-----------------|--------|
| Cost/Revenue Lines | `smart-import-routes.ts` | Smart import writes to `finance_records` with change detection | Future sprint |
| Cost/Revenue Lines | `cos.tsx`, `cashflow.tsx`, `revenue-tracker.tsx` | Analytical pages use materialized views over promoted schema | Future sprint |
| Transactional Finance | `po-routes.ts`, `payment-request-routes.ts` | Use `/api/finance-records` v2 API | Post-Wave 6 |

### Priority 5 — Governance + Deliverables

| Domain | Legacy Consumer | Migration Action | Target |
|--------|---------------|-----------------|--------|
| Governed Processes | `financial-review-routes.ts`, `handover-routes.ts` | New processes always use governed_process API | Ongoing |
| Deliverables | `engineering-routes.ts` | Use `/api/deliverables` v2 API | Post-Wave 6 |
| Approvals | `approvals-routes.ts` | Use `/api/approvals-v2` API | Post-Wave 6 |

## Bridge Retirement Criteria

A bridge can be retired when:
1. **Zero legacy consumers** remain (all reads/writes migrated)
2. **Parity audit passes** (row counts match, sample data matches)
3. **14-day monitoring period** shows zero bridge sync failures
4. **Johannes approves** the retirement

## Current Status

| Domain | Bridges Active | Legacy Consumers | Can Retire? |
|--------|---------------|-----------------|------------|
| Parties | 1 (clients view-swap) | 4 | No |
| Project Identity | 1 (project_info view-swap) | 40+ | No |
| Execution State | 1 (view-swap) | 4 | No |
| Work Items | 1 (view-swap) | 4 | No |
| Approvals | 1 (view-swap) | 3 | No |
| Deliverables | 1 (view-swap) | 3 | No |
| Cost Lines | 1 (view-swap) | 4 | No |
| Revenue Lines | 1 (view-swap) | 3 | No |
| Transactional Finance | 0 (backfill only) | 7 | No |
| Governed Processes | 0 (backfill only) | 4 | No |
| External Resources | 0 (backfill only) | 2 | No |
| Activity/Audit Logs | 0 | 0 | **Yes** |
| Strategic Priorities | 0 (backfill only) | 2 | No |

**Total active bridges:** 8 (view-swap INSTEAD OF triggers)
**Ready to retire:** 1 (Activity/Audit Logs — already authoritative)
