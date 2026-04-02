# Phase 2: Bridge Writes Plan

> **Status:** Plan only — no implementation without sign-off  
> **Prerequisite:** Phase 1B complete, all promoted schemas deployed, backfills validated  
> **Goal:** Every legacy table write propagates to its promoted counterpart in real-time  

---

## 1. What "Bridge Write" Means

A bridge write is a secondary write that fires whenever the app writes to a legacy `public.*` table, ensuring the corresponding promoted schema table stays in sync. The legacy table remains the source of truth. The promoted table is a read-optimized mirror with lineage tracking.

```
App write → public.project_info (legacy) → bridge → core.projects (promoted)
                                                   → core.project_state_history (snapshot)
                                                   → last_synced_at = NOW()
```

---

## 2. Current State

### Infrastructure already in place (from Phase 1B)
- `last_synced_at` column on 6 promoted tables (core.projects, core.clients, documentation.document_approvals, documentation.documents, finance.cost_lines, finance.revenue_lines)
- `internal.sync_watermarks` table for aggregate lag tracking
- State history tables (core.project_state_history, documentation.approval_state_history, finance.cost_line_history, finance.revenue_line_history)
- Legacy→promoted lineage columns on all promoted tables (`legacy_project_info_id`, `legacy_program_expense_id`, etc.)

### Write paths (from `server/storage.ts`)
All data mutations route through `DatabaseStorage` class methods. Key write methods:

| Method | Legacy table | Promoted counterpart | Priority |
|--------|-------------|---------------------|----------|
| `updateProjectInfoById` | `project_info` | `core.projects` | HIGH |
| `upsertProjectInfo` | `project_info` | `core.projects` | HIGH |
| `updateProgramExpenseFields` | `program_expense` | `finance.cost_lines` | HIGH |
| `createManyProgramExpenses` | `program_expense` | `finance.cost_lines` | HIGH |
| `deleteProgramExpensesByProject` | `program_expense` | `finance.cost_lines` | HIGH |
| `updateProgramInflowFields` | `program_inflows` | `finance.revenue_lines` | HIGH |
| `createManyProgramInflows` | `program_inflows` | `finance.revenue_lines` | HIGH |
| `deleteProgramInflowsByProject` | `program_inflows` | `finance.revenue_lines` | HIGH |
| `createUser` / user updates | `users` | `internal.users` | MEDIUM |
| `createProject` | `projects` | — | LOW (rarely used directly) |
| Approval status changes | `approvals` | `documentation.document_approvals` | MEDIUM |
| Work item CRUD | `work_items` | `core.work_items` | MEDIUM |
| Deliverable updates | `deliverables` | `documentation.documents` | LOW |

### What ALREADY exists (discovered in codebase)

**Two domains have dual-write code deployed and feature-flagged OFF:**

1. **Project master dual-write** (`server/routes.ts` ~line 3386)
   - Flag: `promoted_core_project_master_dual_write` (default OFF)
   - Mirrors `project_info` updates → `core.projects` via `INSERT ... ON CONFLICT UPDATE`
   - Returns `X-Promoted-Clients-Dual-Write: mirrored|mirror_failed` header

2. **Clients dual-write** (`server/routes.ts` ~line 3623, `server/pd-routes.ts` ~line 185)
   - Flag: `promoted_core_clients_dual_write` (default OFF)
   - Mirrors client creates → `core.clients` via `INSERT ... ON CONFLICT UPDATE`

**Feature flags defined** (`shared/feature-flags.ts`):
- `promoted_core_clients_dual_write` — implemented, flag OFF
- `promoted_core_project_master_dual_write` — implemented, flag OFF
- `migration_bridge_approvals_dual_write_v1` — defined, no code yet
- `migration_bridge_project_dual_write_v1` — defined, no code yet

**Related patterns already in use:**
- `server/lib/project-info-sync.ts` — split-table sync (project_info → project_execution_state)
- `server/services/personal-task-bridge.ts` — bridge from mytool_tasks → work_items
- `server/ms-sync-service.ts` — watermark tracking with `last_synced_at`

### What does NOT exist yet
- Bridge write logic for finance, approvals, deliverables, parties
- State history snapshot writes on mutation
- `last_synced_at` population on any bridge write
- `sync_watermarks` population by reconciliation
- Conflict resolution for concurrent writes

---

## 3. Architecture Options

### Option A: Application-Layer Bridge (Recommended)

Add bridge write calls directly in `storage.ts` methods, after the legacy write succeeds.

**Pros:**
- Full control over mapping logic
- Can handle column name drift (purpose→description, etc.)
- Can write to state history tables simultaneously
- Can set `last_synced_at = NOW()` atomically
- Testable in isolation

**Cons:**
- Every storage method needs modification
- Bridge failure could leave promoted table stale (but not corrupt legacy)

**Error handling:** Bridge writes are best-effort. If the bridge write fails, log the error but don't roll back the legacy write. The reconciliation system will detect the staleness via `last_synced_at` lag.

### Option B: Database Triggers

Create PostgreSQL triggers on legacy tables that automatically INSERT/UPDATE promoted tables.

**Pros:**
- Catches all writes including raw SQL, backfills, and imports
- No application code changes

**Cons:**
- Triggers are invisible and hard to debug
- Column name mapping requires PL/pgSQL functions
- Cannot easily write to state history tables with `snapshot_reason`
- Trigger failures block the legacy write (dangerous)
- Testing is harder

### Option C: Event Queue (Change Data Capture)

Write change events to a queue (domain_events table or external), process asynchronously.

**Pros:**
- Decoupled, resilient
- Natural audit trail
- Can replay events

**Cons:**
- Adds latency (not real-time)
- Requires event consumer infrastructure
- More complex to implement and operate

### Recommendation: **Option A** for Phase 2

Application-layer bridge writes in `storage.ts` are the simplest, most debuggable, and most controllable approach. The `last_synced_at` + `sync_watermarks` infrastructure already assumes this model.

---

## 4. Implementation Plan

### Phase 2a: Activate Existing + Extend Core Bridge Writes (Highest Priority)

**Scope:** `project_info` ↔ `core.projects`, `clients` ↔ `core.clients`, `program_expense` ↔ `finance.cost_lines`, `program_inflows` ↔ `finance.revenue_lines`

**Steps:**
1. **Validate existing dual-write code** — review `routes.ts` lines 3386-3416 (projects) and 3623-3645 (clients) for correctness against current promoted schema (Phase 1B added columns that the existing bridge code may not cover)
2. **Extend existing bridges** — add Phase 1B columns to project dual-write (current_stage_code, gate_status, gate_readiness_pct, phase_updated_at, signed_status, execution_phase) and client dual-write (legal_entity_name, trading_name, client_type, primary_contact_*)
3. **Add `last_synced_at = NOW()`** to both existing bridge write queries
4. **Add state history snapshots** — insert `core.project_state_history` row with `snapshot_reason = 'bridge_write'` on every project bridge write
5. **Create `server/bridge/bridge-writer.ts`** — centralized module for new finance bridge writes:
   - `mapProgramExpenseToCostLine()` + `mapProgramInflowToRevenueLine()`
   - Fiscal period derivation on write (lookup `finance.fiscal_periods` by date)
   - `finance.cost_line_history` / `finance.revenue_line_history` snapshots
6. Wire finance bridge calls into `storage.ts`:
   - `updateProgramExpenseFields` → upsert `finance.cost_lines`
   - `createManyProgramExpenses` → bulk upsert `finance.cost_lines`
   - `deleteProgramExpensesByProject` → soft-mark or delete from `finance.cost_lines`
   - Same pattern for `program_inflows` → `finance.revenue_lines`
7. **Enable flags** — turn on `promoted_core_project_master_dual_write` and `promoted_core_clients_dual_write` after validation
8. Add error logging + staleness detection

**Validation:**
- Reconciliation report shows zero delta after bridge-written mutations
- `sync_watermarks` shows lag_seconds ≈ 0 for bridged domains
- State history tables accumulate new snapshots with `snapshot_reason = 'bridge_write'`

### Phase 2b: Secondary Bridge Writes

**Scope:** `users` ↔ `internal.users`, `approvals` ↔ `documentation.document_approvals`, `clients` ↔ `core.clients`, `work_items` ↔ `core.work_items`

### Phase 2c: Import Path Bridge Writes

**Scope:** Smart import pipeline writes to `program_expense` and `program_inflows` in bulk. These bulk writes need bridge equivalents in the import service, not just `storage.ts`.

### Phase 2d: Reconciliation Hardening

**Scope:** Update reconciliation to use `last_synced_at` for real staleness measurement. Populate `sync_watermarks` on every reconciliation run. Alert on lag > 15 minutes.

---

## 5. Bridge Writer Module Design

```typescript
// server/bridge/bridge-writer.ts

interface BridgeWriteResult {
  success: boolean;
  promotedId?: number;
  error?: string;
}

class BridgeWriter {
  // Core domain
  async syncProject(legacyProjectInfo: ProjectInfo): Promise<BridgeWriteResult>;
  async syncProjectState(legacyPES: ProjectExecutionState): Promise<BridgeWriteResult>;
  
  // Finance domain
  async syncCostLine(legacyExpense: ProgramExpense): Promise<BridgeWriteResult>;
  async syncCostLines(legacyExpenses: ProgramExpense[]): Promise<BridgeWriteResult[]>;
  async syncRevenueLine(legacyInflow: ProgramInflows): Promise<BridgeWriteResult>;
  async syncRevenueLines(legacyInflows: ProgramInflows[]): Promise<BridgeWriteResult[]>;
  
  // Documentation domain
  async syncApproval(legacyApproval: Approval): Promise<BridgeWriteResult>;
  async syncDocument(legacyDeliverable: Deliverable): Promise<BridgeWriteResult>;
  
  // Identity domain
  async syncUser(legacyUser: User): Promise<BridgeWriteResult>;
  async syncClient(legacyClient: Client): Promise<BridgeWriteResult>;
}
```

Each `sync*` method:
1. Maps legacy columns → promoted columns (handling drift)
2. Upserts the promoted table via `ON CONFLICT (legacy_*_id) DO UPDATE`
3. Sets `last_synced_at = NOW()`
4. Inserts a state history snapshot with `snapshot_reason = 'bridge_write'`
5. Returns success/failure without throwing (best-effort)

---

## 6. Execution Order

| Step | What | Risk | Reversible |
|------|------|------|------------|
| 1 | Create `bridge-writer.ts` module with mapping functions | None (new file) | Yes (delete file) |
| 2 | Add unit tests for mapping functions | None | Yes |
| 3 | Wire bridge calls into `storage.ts` for `project_info` | Low (adds secondary writes) | Yes (remove calls) |
| 4 | Run reconciliation, verify zero delta on projects | None (read-only) | N/A |
| 5 | Wire bridge calls for `program_expense` + `program_inflows` | Low | Yes |
| 6 | Run reconciliation, verify zero delta on finance | None | N/A |
| 7 | Wire bridge calls for remaining domains | Low | Yes |
| 8 | Update reconciliation to use `last_synced_at` | Low | Yes |
| 9 | Populate `sync_watermarks` on reconciliation runs | Low | Yes |
| 10 | Monitor for 1 week, verify lag stays at 0 | None | N/A |

---

## 7. What NOT to Do in Phase 2

- **No read cutovers** — App continues reading from `public.*` tables. Promoted tables are mirrors only.
- **No legacy table modifications** — Bridge writes don't change legacy schema or behavior.
- **No ORM schema changes** — Drizzle schema stays public-only. Bridge writes use raw SQL or the `pg` driver.
- **No trigger-based sync** — Application-layer only for debuggability.
- **No delete propagation yet** — Soft-delete patterns only. Physical deletes need Phase 3 planning.

---

## 8. Success Criteria

Phase 2 is complete when:
1. Every write to `project_info`, `program_expense`, `program_inflows` automatically propagates to promoted tables
2. `last_synced_at` is populated on every bridge-written row
3. Reconciliation reports zero delta for bridged domains
4. `sync_watermarks` shows `lag_seconds = 0` for all bridged domains
5. State history tables accumulate snapshots with `snapshot_reason = 'bridge_write'`
6. No regression in app performance (bridge writes add < 50ms per mutation)

---

## 9. Dependencies

- Phase 1B complete ✅
- All promoted schemas deployed ✅
- `last_synced_at` columns exist ✅
- `internal.sync_watermarks` table exists ✅
- State history tables exist ✅
- Reconciliation infrastructure exists ✅

**No blockers. Phase 2 can begin immediately.**
