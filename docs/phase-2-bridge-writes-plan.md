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

### What does NOT exist yet
- No bridge write logic in any write path
- No triggers or event-driven sync
- No dual-write transaction coordination
- No conflict resolution for concurrent writes

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

### Phase 2a: Core Bridge Writes (Highest Priority)

**Scope:** `project_info` ↔ `core.projects`, `program_expense` ↔ `finance.cost_lines`, `program_inflows` ↔ `finance.revenue_lines`

These are the three most-written domains and the ones reconciliation already monitors.

**Steps:**
1. Create `server/bridge/bridge-writer.ts` — centralized bridge write module
2. Define mapping functions: `mapProjectInfoToCoreProject()`, `mapProgramExpenseToCostLine()`, `mapProgramInflowToRevenueLine()`
3. Add bridge calls to `storage.ts` methods:
   - `updateProjectInfoById` → upsert `core.projects` + insert `core.project_state_history`
   - `upsertProjectInfo` → same
   - `updateProgramExpenseFields` → upsert `finance.cost_lines` + insert `finance.cost_line_history`
   - `createManyProgramExpenses` → bulk upsert `finance.cost_lines`
   - `deleteProgramExpensesByProject` → soft-mark or delete from `finance.cost_lines`
   - Same pattern for `program_inflows` → `finance.revenue_lines`
4. Set `last_synced_at = NOW()` on every bridge write
5. Add error logging + staleness detection

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
