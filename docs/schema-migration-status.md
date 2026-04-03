# Schema Migration Status

> **Last updated:** 2026-04-03
> **Authority:** This is the single source of truth for migration state.

## Overall Status

| Layer | Status | Detail |
|-------|--------|--------|
| Schema Foundation (PR523) | **COMPLETE** | Phases A-H deployed. All DDL, backfills, rollbacks, compatibility views in place. |
| Runtime Write Cutover | **BRIDGED** | All 8 write domains now have bridge writers. See details below. |
| Dual Schema Authority | **GUARDED** | Startup-orchestrator skips legacy schema sync when promoted schema is present. |
| Reconciliation | **IMPLEMENTED** | SQL reconciliation checks + TypeScript runner with pass/fail. |
| VO/CR → Finance Gap | **CLOSED** | Bridge writer + F10 backfill migration deployed. |

---

## PR523 Phases Delivered

| Phase | Domain | DDL | Backfill | Rollback | Compat View |
|-------|--------|-----|----------|----------|-------------|
| A | Parties, Users, Roles | Yes | Yes | Yes | N/A |
| B | Project Types, Instances, Info, Party Links, Phase Defs | Yes | Yes | Yes | N/A |
| C | Work Packages, Work Items, Dependencies | Yes | Yes | Yes | N/A |
| D | Governed Processes | Yes | Yes | Yes | N/A |
| E | Deliverables, Approvals | Yes | Yes | Yes | N/A |
| F | Unified Finance (finance_records, budget_lines) | Yes | Yes | Yes | N/A |
| G | External Resources, Activity/Audit Logs | Yes | Yes | Yes | N/A |
| H | Strategic Priorities, Import Batches, Compatibility Views | Yes | Yes | Yes | Yes |

### Compatibility Views (Phase H.5 — Read-Only)

| View | Schema | Source Tables | INSTEAD OF Triggers |
|------|--------|---------------|---------------------|
| `core.v_projects` | core | project_instances, projects, project_types, phase_definitions | No |
| `core.v_work_items` | core | work_items_clean, work_packages, parties | No |
| `finance.v_finance_records` | finance | finance_records, project_instances, projects, parties, fiscal_periods | No |
| `core.v_deliverables` | core | deliverable_instances, deliverable_definitions, parties | No |
| `core.v_approvals` | core | approval_instances, parties | No |
| `core.v_governed_processes` | core | governed_processes, phase_definitions, parties | No |

### View-Swap INSTEAD OF Triggers (spine_view_swap.sql)

These replace legacy `public.*` tables with views that write-through to promoted tables:

| Legacy Table | Promoted Table | INSERT Trigger | UPDATE Trigger | DELETE Trigger |
|-------------|---------------|----------------|----------------|----------------|
| `public.approvals` → view | `documentation.document_approvals` | Yes | Yes | No |
| `public.deliverables` → view | `documentation.documents` | Yes | Yes | No |
| `public.work_items` → view | `core.work_items` | Yes | Yes | Yes |

---

## Runtime Write Domain Status

### Fully Bridged (writes propagate to promoted schema)

| Domain | Legacy Table | Promoted Table | Bridge Mechanism | Call Sites |
|--------|-------------|---------------|------------------|------------|
| Work Items | `public.work_items` (view) | `core.work_items` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE/DELETE |
| Approvals | `public.approvals` (view) | `documentation.document_approvals` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |
| Deliverables | `public.deliverables` (view) | `documentation.documents` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |

### Partially Bridged (bridge-writer exists, best-effort, fire-and-forget)

| Domain | Legacy Table | Promoted Table | Bridge | Gap |
|--------|-------------|---------------|--------|-----|
| Project Info | `public.project_info` | `core.projects` | `syncProject()` in bridge-writer.ts | UPDATE only, no INSERT bridge; fire-and-forget (failures silently logged) |
| Clients | `public.clients` | `core.clients` | `syncClient()` in bridge-writer.ts | Called from 1 route only (routes.ts:3590); fire-and-forget |
| Cost Lines | `public.normalized_cost_lines` | `finance.cost_lines` | `syncCostLine()` in bridge-writer.ts | Called from storage.ts; fire-and-forget; not all write paths covered |
| Revenue Lines | `public.normalized_revenue_lines` | `finance.revenue_lines` | `syncRevenueLine()` in bridge-writer.ts | Called from storage.ts; fire-and-forget; not all write paths covered |

### Not Bridged

| Domain | Legacy Table | Target Promoted Table | Status |
|--------|-------------|----------------------|--------|
| Project Execution State | `public.project_execution_state` | `core.project_state_history` | Split-table sync exists but no bridge to promoted schema |
| Change Requests / VOs | `public.change_requests` | `finance.finance_records` | No bridge writer. F01 schema accepts VOs but no runtime writes. |

---

## Dual Schema Authority Risk

**Problem:** `server/bootstrap/startup-orchestrator.ts` runs `runAdditiveSchemaAlignments()` on every server boot which executes:
1. `script/pre-push-enums.sql` — creates/updates enum types
2. `script/full-schema-alignment.sql` — adds columns via ALTER TABLE IF NOT EXISTS
3. Inline `CREATE TABLE IF NOT EXISTS` statements for ~20 legacy tables

This creates a second schema authority outside versioned migrations. Risks:
- Column definitions may drift between startup-orchestrator and migrations
- Table structure can change without migration history
- Promoted schema tables are NOT managed by startup-orchestrator (only legacy public.* tables)

**Resolution required:** Neutralize startup-orchestrator schema creation, make versioned migrations the sole authority.

---

## Finance Gap: Change Requests / Variation Orders

**Current state:**
- `change_requests` table in `public` schema has enriched VO fields (cause, clientLinked, revenueImpact, cosImpact, marginImpact)
- `change-control-routes.ts` writes directly to `public.change_requests` via Drizzle ORM
- `finance.finance_records` schema (Phase F.1) was designed to accept VOs (`legacy_entity_table = 'public.change_requests'`)
- Backfill migration `f03` covers costs, `f04` covers revenue, `f05` covers POs — **none cover change_requests**
- No bridge writer function exists for `syncChangeRequest()`

**Impact:** Approved VOs with cost/revenue impact are invisible to the unified finance view.
