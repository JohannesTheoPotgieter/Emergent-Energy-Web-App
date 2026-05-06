# PD Reporting — Metric Definitions & Trust Assessment (2026-04-15)

Status: implemented on branch `claude/improve-pipedrive-integration-2cllX`.

## Trust principle

Commercial funnel numbers come from the `opportunities` table.
PD work queue numbers come from the `pd_tickets` table.
Handover numbers come from the `project_pd_pm_handover` table.
The three are never mixed in the same metric.

---

## Metric inventory

### Section 1 — Commercial Funnel

Source: `opportunities` table. Endpoint: `GET /api/pd/reports`.

| Metric | Key | Definition | Trust |
|--------|-----|------------|-------|
| Total Opportunities | `commercialFunnel.total` | Count of non-deleted rows in `opportunities`. | Trustworthy. |
| Active Pipeline | `commercialFunnel.active` | Count where `status` is not `won` or `lost`. | Trustworthy. |
| Won (FY) | `commercialFunnel.wonFy` | Count where `status=won` and `signedDate` within FY window. | Trustworthy if `signedDate` is reliably set on win. |
| Lost (FY) | `commercialFunnel.lostFy` | Count where `status=lost` and `updatedAt` within FY window. | Approximate — uses `updatedAt` as a proxy for when the loss was recorded. |
| Pipeline Value (R) | `commercialFunnel.activePipelineValue` | Sum of `estimatedValue` for active opportunities. | Trustworthy. Does NOT include ticket estimated values. |
| Pipeline Capacity (kWp) | `commercialFunnel.activePipelineKwp` | Sum of `estimatedKwp` for active opportunities. | Trustworthy. |
| By Stage | `commercialFunnel.byStage` | Active opportunities grouped by `stage`. | Trustworthy, but note the stage mapping is simplistic for Pipedrive-sourced rows (all open deals → `qualification`). |
| From Pipedrive | `commercialFunnel.pipedriveCount` | Count where `source='pipedrive'`. | Trustworthy. |
| Internal | `commercialFunnel.internalCount` | Count where `source!='pipedrive'`. | Trustworthy. |

### Section 2 — PD Work Queue — Throughput

Source: `pd_tickets` table.

| Metric | Key | Definition | Scope | Trust |
|--------|-----|------------|-------|-------|
| Created This Month | `throughput.createdThisMonth` | PD tickets with `createdAt` in current calendar month AND in the FY window. | FY | Trustworthy. |
| Created FY | `throughput.createdFY` | PD tickets with `createdAt` in the FY window. | FY | Trustworthy. |
| Completed This Month | `throughput.completedThisMonth` | Tickets with `status=Completed`, `createdAt` in FY, and `updatedAt` in current month. | FY | Approximate — `updatedAt` is a proxy for completion time. |
| Completed FY | `throughput.completedFY` | Tickets with `status=Completed` and `createdAt` in FY. | FY | Trustworthy. |
| Avg Cycle Time by Type | `throughput.avgCycleTimeByType` | For completed FY tickets: `(updatedAt - createdAt)` in days, averaged per `requestType`. | FY | Approximate — `updatedAt` is the last-touch timestamp, not a dedicated completion timestamp. |
| Avg Handover Cycle | `throughput.avgHandoverCycleTimeDays` | For accepted handovers: `(acceptedAt - createdAt)` in days. | All-time | Trustworthy. |
| Quarterly Breakdown | `throughput.quarterly` | Created/completed/submitted per FY quarter. | FY | Trustworthy. |

### Section 2b — PD Work Queue — Active State

Source: `pd_tickets` table.

| Metric | Key | Definition | Scope | Trust |
|--------|-----|------------|-------|-------|
| Active By Status | `pipelineHealth.activeByStatus` | Non-completed, non-cancelled FY tickets grouped by `status`. | FY (fixed in this change — previously all-time) | Trustworthy. |
| Active By Type | `pipelineHealth.activeByType` | Same, grouped by `requestType`. | FY (fixed) | Trustworthy. |
| Overdue Tickets | `pipelineHealth.overdueCount` | Tickets with `dueDate < today`, `status` not Completed/Cancelled. | All-time (intentional) | Trustworthy. |
| Workload Distribution | `pipelineHealth.ticketsPerMember` | Non-completed, non-cancelled tickets per `projectDeveloperUserId`. | All-time (intentional) | Trustworthy. |

### Section 3 — PD → PM Handover

Source: `project_pd_pm_handover` table.

| Metric | Key | Definition | Trust |
|--------|-----|------------|-------|
| Submitted | `handover.submitted` | Handovers with `submittedAt != null`. | Trustworthy. |
| Accepted | `handover.accepted` | Handovers with `status=ACCEPTED`. | Trustworthy. |
| Rejected | `handover.rejected` | Handovers with `status=REJECTED`. | Trustworthy. |
| Rejection Rate | `handover.rejectionRate` | `rejected / (accepted + rejected) × 100`. | Trustworthy. |
| Avg Decision Time | `handover.avgDecisionTimeDays` | `(acceptedAt or rejectedAt) - submittedAt` in days. | Trustworthy. |
| Top Rejection Reasons | `handover.topRejectionReasons` | From `project_handover_history` where action = `PD_PM_HANDOVER_REJECTED`. | Trustworthy. |

### Cross-Functional

| Metric | Key | Definition | Trust |
|--------|-----|------------|-------|
| Engineering Requests | `crossFunctional.engineeringRequests` | Count of non-cancelled tickets whose `requestType` is in the engineering set. | Trustworthy. All-time. |

---

## Bug fixed in this change

**`activeByStatus` / `activeByType` FY-filter bug.**
Before: these iterated over `allTickets` (every ticket in the system,
regardless of FY). After: they iterate over `fyTickets` (tickets created
within the selected FY window). This means the status/type breakdowns
now match the throughput numbers in the same report — previously they
could show 200 active tickets while throughput said 50 were created in
FY, which was confusing.

`overdueCount` and `ticketsPerMember` intentionally remain all-time
because an overdue ticket is overdue regardless of when it was created,
and a developer's workload is their current total, not just FY-origin.

---

## What is NOT in this report

- **Win rate** (won / (won + lost)). Not computed because `lostFy` uses
  `updatedAt` as a proxy and is therefore approximate.
- **Average deal size** (pipeline value / active count). Easy to derive
  client-side but not shipped as a named metric because the
  `estimatedValue` on Pipedrive-sourced rows may be stale between syncs.
- **Conversion rate** (opportunities → projects). Would require a join
  from `opportunities` to `project_info.opportunity_id`, which is
  nullable and frequently blank on imports. Tracked as future work.
- **Ticket-to-opportunity linkage metrics**. The `pd_tickets.opportunity_id`
  FK was added in a prior commit but is not yet populated on most rows.

---

End of metric definitions.
