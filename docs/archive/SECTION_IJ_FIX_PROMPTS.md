# SECTION I + J — CONSOLIDATED FIX PROMPTS
> **Generated:** 2026-03-30  
> **Scope:** All risks from Section I (Risk Register) ordered by Section J (Refactor/Fix Sequence)  
> **Rule:** Complete each Tier fully before starting the next. One PR per numbered item.  
> **Guardrails:** Every migration needs a rollback file. Feature-flag Tier 4.1. Staging validation for Tier 2.1 and 2.2. 90-day deprecation window before any column drop.

---

## TIER 1 — PRODUCTION SAFETY
> Zero feature disruption. Authorization fixes only. Deploy and verify after each item.

---

### 1.1 — Lock Down Smart Import Authorization
**Addresses:** SEC-2, OPS-5

```
Add role-based authorization to all smart import routes in server/smart-import-routes.ts.

Requirements:
1. Define an authorized importer role set: FINANCE_MANAGER, ADMIN, CFO.
   Add a hasImportPermission(user) helper in server/permission-middleware.ts that checks
   requirePermission('data_import', 'create').

2. Apply the following middleware changes in server/smart-import-routes.ts:
   - POST /api/smart-import (initiate): requireAuth + requirePermission('data_import', 'create').
   - GET /api/smart-import/* (preview/status): requireAuth + requirePermission('data_import', 'create').
   - POST /api/smart-import/:runId/commit: requireAuth + requirePermission('data_import', 'approve').
   - POST /api/smart-import/:runId/rollback: requireAuth + requireAdmin (rollback is admin-only — destructive).

3. Seed ENTITY_PERMISSION_DEFAULTS with data_import entity permissions for:
   ADMIN, CFO, FINANCE_MANAGER → create, approve, delete.
   All other roles → no permissions on data_import.

4. Create an import audit log table importAuditLog:
   id, userId, userRole, action (INITIATED | COMMITTED | ROLLED_BACK | PREVIEW_VIEWED),
   runId, projectId, timestamp, ipAddress.
   Write an audit record for every commit and rollback action.

5. Add GET /api/smart-import/audit-log (ADMIN only) — returns all audit records paginated.

6. Return HTTP 403 with message "Insufficient permissions to perform data imports" for
   unauthorized attempts.

7. Add tests confirming:
   - ENGINEER role receives 403 on commit and rollback.
   - FINANCE_MANAGER receives 200 on commit.
   - Every commit and rollback creates an importAuditLog record.

Risk: LOW — adds authorization checks only. Users without permission lose access.
Validate: Admin users can still import after deploy.
```

---

### 1.2 — Add Permission Checks to Finance Tracker Endpoints
**Addresses:** SEC-3

```
Standardize and enforce role-based access control on all finance tracker API endpoints.

Requirements:
1. Create a finance permission helper hasFinanceReadAccess(user): boolean in
   server/permission-middleware.ts that returns true for:
   FINANCE_MANAGER, CFO, PROGRAM_MANAGER, ADMIN, MD, COO_ADMIN, CEO_ADMIN, ACCOUNTANT,
   PROGRAM_FINANCE_MANAGER.

2. In server/departments/finance-routes.ts and server/routes.ts, update:
   - GET /api/cos-tracker → requireAuth + requirePermission('cos', 'view').
   - GET /api/gp-tracker → requireAuth + requirePermission('gp_tracker', 'view').
   - GET /api/program-expenses → requireAuth + requirePermission('financials', 'view').
   - GET /api/program-inflows → requireAuth + requirePermission('financials', 'view').
   - GET /api/rev-tracker → currently requireAdmin. Change to requireAuth +
     requirePermission('financials', 'view'). Align with /api/revenue-tracker pattern.
   - GET /api/revenue-tracker → already uses requirePermission(revenue_tracker, view). Keep.
     Consolidate into one endpoint — see item 1.5.

3. Add a comment block at the top of the finance route file documenting the canonical
   finance-access role set.

4. Add tests confirming:
   - PROJECT_DEVELOPER receives 403 on all finance tracker endpoints.
   - FINANCE_MANAGER receives 200 on all finance tracker endpoints.
   - /api/rev-tracker and /api/revenue-tracker return identical auth behaviour.

Risk: LOW — users without finance permissions lose visibility. Verify role defaults
include view permissions for all finance roles before deploying.
```

---

### 1.3 — Fix MyTool Authorization (requireAdmin → requireAuth + user-scoping)
**Addresses:** OPS-4

```
Replace requireAdmin with requireAuth on all /api/mytool/* routes, then add
user-scoping so each user can only access their own data.

Requirements:
1. In server/routes.ts, find all ~30 /api/mytool/* route handlers.
   Replace requireAdmin middleware with requireAuth on every route.

2. On every query inside mytool route handlers, add a WHERE filter:
   WHERE owner_user_id = req.user.id (or equivalent Drizzle .where(eq(table.ownerUserId, req.user.id))).
   No mytool query may return data belonging to another user unless the requesting user
   is ADMIN or PROGRAM_MANAGER.

3. For ADMIN and PROGRAM_MANAGER roles, allow an optional ?userId= query param to
   view another user's MyTool data (for management oversight).

4. Add test with a non-admin user account confirming:
   - User A cannot see User B's mytool tasks.
   - User A can see their own mytool tasks.
   - ADMIN can see User A's tasks via ?userId=.

Risk: MEDIUM — opens MyTool to all authenticated users. Every query MUST filter by
ownerUserId. Test thoroughly with a non-admin account before deploy.
```

---

### 1.4 — Protect Dashboard Metrics Refresh
**Addresses:** SEC-4

```
Add access control and rate limiting to the dashboard metrics refresh endpoint.

Requirements:
1. In server/api/v2/routes/v2-routes.ts, on POST /api/v2/dashboard-metrics/refresh:
   - Add requireAdmin middleware (only admins trigger manual refresh).
   - Add rate limiting: in-memory Map keyed by userId tracking last call timestamp.
     Reject requests within 5 minutes of previous call with HTTP 429:
     "Refresh already triggered within the last 5 minutes. Please wait."

2. Add GET /api/v2/dashboard-metrics/last-refresh (requireAuth):
   Returns { lastRefreshedAt: timestamp, nextAutoRefreshAt: timestamp }.

3. In the frontend dashboard component:
   - Show "Last refreshed: X minutes ago" timestamp.
   - Render the manual "Refresh" button only when current user has admin role.

Risk: LOW — restricts expensive computation trigger. No data changes.
```

---

### 1.5 — Resolve Revenue Tracker Auth Inconsistency
**Addresses:** SEC-3

```
Remove the duplicate revenue tracker endpoint and unify on a single auth pattern.

Requirements:
1. Determine which endpoint the frontend currently calls:
   - GET /api/rev-tracker (requireAdmin)
   - GET /api/revenue-tracker (requirePermission(revenue_tracker, view))
   Search client/ codebase for both paths.

2. The frontend-called endpoint is canonical. Update its auth to:
   requireAuth + requirePermission('financials', 'view') (consistent with item 1.2).

3. The unused endpoint: add a redirect response to the canonical endpoint with
   HTTP 301 for 30 days, then remove it in the following PR.

4. Add a comment documenting the consolidation decision.

Risk: LOW — verify which endpoint the frontend calls before removing the other.
```

---

## TIER 2 — DATA INTEGRITY
> Database-level fixes. No UI changes required. Must complete Tier 1 first.

---

### 2.1 — Convert Financial Amount Columns from Text to Decimal
**Addresses:** DAT-1

```
Migrate financial amount columns from text to NUMERIC(15,2) in shared/schema/finance.ts.

⚠️ HIGH RISK — Run on staging database copy first. Keep _legacy columns for 30 days.

Requirements:
1. Write migration migrations/YYYYMMDD_financial_amounts_to_numeric.sql:

   -- Step 1: Add decimal shadow columns
   ALTER TABLE normalized_revenue_lines ADD COLUMN amount_ex_vat_decimal NUMERIC(15,2);
   ALTER TABLE normalized_revenue_lines ADD COLUMN vat_decimal NUMERIC(15,2);
   ALTER TABLE normalized_cost_lines ADD COLUMN amount_ex_vat_decimal NUMERIC(15,2);

   -- Step 2: Create audit table for unparseable values
   CREATE TABLE IF NOT EXISTS migration_unparseable_amounts (
     id SERIAL PRIMARY KEY,
     table_name TEXT,
     row_id INTEGER,
     column_name TEXT,
     original_value TEXT,
     migrated_at TIMESTAMP DEFAULT NOW()
   );

   -- Step 3: Parse and copy (handle "TBC", "N/A", empty string, locale formats)
   UPDATE normalized_revenue_lines SET
     amount_ex_vat_decimal = CASE
       WHEN amount_ex_vat ~ '^[0-9,.\s]+$'
       THEN REPLACE(REPLACE(amount_ex_vat, ',', ''), ' ', '')::NUMERIC(15,2)
       ELSE NULL
     END;
   -- Insert unparseable rows into audit table for values that became NULL
   INSERT INTO migration_unparseable_amounts (table_name, row_id, column_name, original_value)
   SELECT 'normalized_revenue_lines', id, 'amount_ex_vat', amount_ex_vat
   FROM normalized_revenue_lines
   WHERE amount_ex_vat IS NOT NULL AND amount_ex_vat_decimal IS NULL
     AND amount_ex_vat NOT IN ('', 'TBC', 'N/A');
   -- Repeat for vat and normalized_cost_lines.amount_ex_vat

   -- Step 4: Rename columns
   ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_legacy;
   ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat_decimal TO amount_ex_vat;
   -- Repeat for all three columns

2. Write rollback migration YYYYMMDD_financial_amounts_to_numeric_rollback.sql:
   ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat TO amount_ex_vat_decimal;
   ALTER TABLE normalized_revenue_lines RENAME COLUMN amount_ex_vat_legacy TO amount_ex_vat;
   -- Repeat for all three columns. Drop decimal columns. _legacy columns remain.

3. Update shared/schema/finance.ts lines 450-451 and 493:
   - Change text("amount_ex_vat") to numeric("amount_ex_vat", { precision: 15, scale: 2 }).
   - Change text("vat") to numeric("vat", { precision: 15, scale: 2 }).

4. Search entire server codebase for parseFloat(, Number(, +row.amount patterns applied
   to these columns. Remove them — DB now returns JavaScript number directly.

5. In all Zod schemas validating incoming financial data, replace z.string() with
   z.coerce.number() for these fields.

6. Add CHECK constraint: amount_ex_vat >= 0.

7. Drop _legacy columns after 30-day observation window (separate PR).

Rollback plan: rename _legacy → canonical, drop decimal columns.
```

---

### 2.2 — Convert Project Date Columns from Text to Date
**Addresses:** DAT-2

```
Convert the 10 text date columns on projectExecutionState to proper date type.

Requirements:
1. Check whether migration 20260346_convert_text_dates_to_date_type.sql has been applied:
   SELECT * FROM schema_migrations WHERE name LIKE '%convert_text_dates%';
   If applied: skip to step 3. If not applied: proceed with step 2.

2. Write migration YYYYMMDD_convert_project_dates_to_date.sql:
   Columns: pdHandoverDate, constructionStartDate, commissioningDate, omHandoverDate,
   clientHandoverDate, constructionStartActual, pdHandoverActual, commissioningActual,
   clientHandoverActual, signedDate, cpSignedDate.

   For each column:
   -- Add shadow date column
   ALTER TABLE project_execution_state ADD COLUMN <col>_date DATE;
   -- Try multiple date formats
   UPDATE project_execution_state SET <col>_date = CASE
     WHEN <col> ~ '^\d{4}-\d{2}-\d{2}$' THEN <col>::DATE
     WHEN <col> ~ '^\d{2}/\d{2}/\d{4}$' THEN TO_DATE(<col>, 'DD/MM/YYYY')
     WHEN <col> ~ '^\d{2}-[A-Za-z]{3}-\d{4}$' THEN TO_DATE(<col>, 'DD-Mon-YYYY')
     ELSE NULL
   END;
   -- Log unparseable values
   INSERT INTO migration_unparseable_amounts (table_name, row_id, column_name, original_value)
   SELECT 'project_execution_state', id, '<col>', <col>
   FROM project_execution_state
   WHERE <col> IS NOT NULL AND <col>_date IS NULL AND <col> != '';
   -- Rename
   ALTER TABLE project_execution_state RENAME COLUMN <col> TO <col>_legacy;
   ALTER TABLE project_execution_state RENAME COLUMN <col>_date TO <col>;

3. Update shared/schema/projects.ts lines 139-149:
   Change text() to date() for all 10 columns.

4. Update all frontend date pickers writing to these columns to serialize as ISO YYYY-MM-DD.

5. Remove CAST calls from ORDER BY and WHERE clauses on these columns — they now sort
   chronologically natively.

6. Add Zod validation z.string().date() on PATCH projectExecutionState endpoint for
   all 10 fields.

7. Write rollback migration renaming _legacy back to canonical.
```

---

### 2.3 — Add Missing Indexes on FK Columns
**Addresses:** PERF-1

```
Add database indexes to all high-traffic FK columns.

Requirements:
Write migration migrations/YYYYMMDD_add_missing_fk_indexes.sql:

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ncl_import_run_id
  ON normalized_cost_lines(import_run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ncl_counterparty_id
  ON normalized_cost_lines(counterparty_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nrl_import_run_id
  ON normalized_revenue_lines(import_run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wi_client_id
  ON work_items(client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hci_handover_pack_id
  ON handover_checklist_items(handover_pack_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sites_client_id
  ON sites(client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cs_entity
  ON change_sets(entity_type, entity_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role
  ON users(role);

-- Composite indexes for common query patterns:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ncl_project_snapshot
  ON normalized_cost_lines(project_id, snapshot_run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nrl_project_snapshot
  ON normalized_revenue_lines(project_id, snapshot_run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psi_project_stage
  ON project_stage_instances(project_id, stage_code);

Use CONCURRENTLY to avoid table locks on production PostgreSQL.
After applying, run EXPLAIN ANALYZE on the cashflow computation query and COS tracker
query. Document before/after query plan in a comment in the migration file.

Risk: LOW — no application code changes. Monitor query performance improvements.
```

---

### 2.4 — Add Unique Constraints on Assignment Tables
**Addresses:** DAT-7

```
Add unique constraints to work item and entity assignment tables.

Requirements:
1. Write migration YYYYMMDD_assignment_unique_constraints.sql:

   -- Deduplicate first (keep lowest id per unique combination)
   DELETE FROM work_item_assignments
   WHERE id NOT IN (
     SELECT MIN(id) FROM work_item_assignments
     GROUP BY work_item_id, user_id, role
   );
   DELETE FROM entity_assignments
   WHERE id NOT IN (
     SELECT MIN(id) FROM entity_assignments
     GROUP BY entity_type, entity_id, assignee_id, assignment_role
   );

   -- Add unique constraints
   ALTER TABLE work_item_assignments
   ADD CONSTRAINT uq_work_item_user_role
   UNIQUE (work_item_id, user_id, role);

   ALTER TABLE entity_assignments
   ADD CONSTRAINT uq_entity_user_role
   UNIQUE (entity_type, entity_id, assignee_id, assignment_role);

2. Update shared/schema/tasks.ts workItemAssignments table definition to reflect
   the unique constraint using Drizzle's uniqueIndex() on (workItemId, userId, role).

3. In the service layer function that creates assignments:
   Change INSERT to INSERT ... ON CONFLICT ON CONSTRAINT uq_work_item_user_role DO NOTHING
   to silently ignore duplicate assignments rather than throwing a DB error.

4. Add test: assigning the same user+role to a work item twice results in one record only.

Risk: LOW — dedup migration runs first. Application inserts that would create duplicates
will be silently ignored via ON CONFLICT DO NOTHING.
```

---

### 2.5 — Add FK Constraint for snapshotRunId
**Addresses:** DAT-5

```
Add proper FK constraints to snapshotRunId columns in finance tables.

Requirements:
1. Investigate which table snapshotRunId references:
   Search shared/schema/ for the table whose id column is referenced by snapshot_run_id.
   Most likely smartImportRuns or a dedicated snapshot_runs table.

2. Identify orphaned rows:
   SELECT COUNT(*) FROM program_expense
   WHERE snapshot_run_id NOT IN (SELECT id FROM <target_table>);
   Repeat for program_inflows, normalized_revenue_lines, normalized_cost_lines.

3. Write migration YYYYMMDD_add_snapshot_run_id_fk.sql:
   -- Remove orphaned rows
   DELETE FROM program_expense
   WHERE snapshot_run_id IS NOT NULL
     AND snapshot_run_id NOT IN (SELECT id FROM <target_table>);
   -- Repeat for all 4 tables

   -- Add FK constraints
   ALTER TABLE program_expense
   ADD CONSTRAINT fk_program_expense_snapshot
   FOREIGN KEY (snapshot_run_id) REFERENCES <target_table>(id) ON DELETE SET NULL;
   -- Repeat for program_inflows, normalized_revenue_lines, normalized_cost_lines

4. Add indexes on snapshotRunId columns (if not already covered by 2.3):
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_program_expense_snapshot_run
     ON program_expense(snapshot_run_id);
   -- Repeat for other 3 tables

5. Update shared/schema/finance.ts: add .references(() => targetTable.id, { onDelete: 'set null' })
   to all four snapshotRunId declarations.

6. Add test: confirm that deleting a snapshot run sets snapshotRunId to NULL on
   associated lines rather than leaving orphaned references.

Risk: LOW — investigate orphans first. If volume is unexpectedly high, consult
business team before deleting.
```

---

## TIER 3 — SECURITY HARDENING
> After Tier 2 is complete and stable.

---

### 3.1 — Encrypt Counterparty Bank Details
**Addresses:** SEC-1

```
Add column-level encryption for counterparties.bankAccountNumber and
counterparties.bankBranchCode to meet POPIA compliance requirements.

Requirements:
1. Create server/lib/field-encryption.ts:
   - Use existing TOKEN_ENCRYPTION_KEY from .env (already used for Microsoft token encryption).
   - Implement encrypt(plaintext: string): string using AES-256-GCM.
   - Implement decrypt(ciphertext: string): string.
   - Both functions handle null/undefined gracefully (return as-is).
   - Never log encrypted or decrypted banking fields.

2. In all service/route code that writes to counterparties.bankAccountNumber or .bankBranchCode:
   - Wrap value with encrypt() before the database write.

3. In all service/route code that reads counterparties.bankAccountNumber or .bankBranchCode:
   - Wrap returned value with decrypt() before returning to caller.
   - Explicitly strip these fields from any general-purpose logging middleware.

4. Write one-time migration script scripts/encrypt-existing-bank-details.ts:
   - Reads all existing counterparty records with plain-text banking fields.
   - Re-writes them encrypted using the same encrypt() function.
   - Logs count of records migrated and any failures.
   - Add package.json script: "encrypt-bank-details": "tsx scripts/encrypt-existing-bank-details.ts"

5. In shared/schema/finance.ts, add comment to bankAccountNumber and bankBranchCode:
   // stored AES-256-GCM encrypted — decrypt before use via server/lib/field-encryption.ts

6. Add integration test confirming that a counterparty created with a bank account number:
   - Returns the correct decrypted value via the API.
   - Has a raw database column value that is NOT the plain-text input.

Risk: MEDIUM — existing plain-text values must be migrated via the encrypt-bank-details
script before any read code is switched to decrypt mode. Run script, verify, then deploy
read-side decryption.
```

---

### 3.2 — Remove @ts-nocheck from role-management.ts
**Addresses:** SEC-6

```
Remove the @ts-nocheck directive from server/role-management.ts and resolve all
TypeScript errors introduced.

Requirements:
1. Remove @ts-nocheck at line 1 of server/role-management.ts.

2. Run: npx tsc --noEmit 2>&1 | grep "role-management"
   Capture all type errors.

3. For each type error:
   - Replace any explicit `any` type with a specific type.
   - For user/permission objects, use types from shared/schema/ or create
     server/types/role-management-types.ts.
   - For functions returning any, define a proper return type interface.
   - Do NOT use `as any` as a workaround — define proper types.
   - For complex cases where full type is non-trivial, use `unknown` with a type guard.

4. Run the full test suite after all errors are resolved to confirm no regressions.

5. Update eslint.config.js TODO comment: note that role-management.ts is now fully
   type-checked, reducing the any violation count.

Risk: MEDIUM — expect significant type error volume. Fix one function at a time.
Run tests after each function fix before proceeding to the next.
```

---

### 3.3 — Validate and Document CSRF Scope
**Addresses:** SEC-5

```
Audit the CSRF middleware in server/index.ts to confirm all state-changing endpoints
are protected and webhook endpoints are explicitly exempt.

Requirements:
1. Create server/middleware/csrf-config.ts:
   - Export CSRF_EXEMPT_PATHS: string[] containing all paths that must be exempt:
     webhook endpoints (e.g., /api/webhooks/*), public token-based endpoints
     (e.g., /client-handover/:token), health-check routes.
   - Export CSRF_PROTECTED_METHODS: ['POST', 'PATCH', 'PUT', 'DELETE'].

2. In server/index.ts, modify CSRF middleware setup to:
   - Apply CSRF to all routes matching CSRF_PROTECTED_METHODS.
   - Explicitly skip routes matching CSRF_EXEMPT_PATHS.
   - Log a startup message: "CSRF: protecting [N] method types, [M] exempt paths"

3. Add a structured comment block in server/index.ts documenting:
   - Which routes are covered.
   - Which are excluded and why.
   - How frontend consumes the CSRF token.

4. Add integration tests confirming:
   - POST to a protected endpoint without CSRF token returns 403.
   - POST to a webhook endpoint without CSRF token returns 200 (or appropriate response).

Risk: LOW — audit and document. Only fix if gaps are found.
```

---

## TIER 4 — BUSINESS-CRITICAL WORKFLOW COVERAGE
> Core lifecycle gaps. Must complete Tiers 1–3 first.

---

### 4.1 — Implement Gate Enforcement Middleware *(feature-flagged)*
**Addresses:** OPS-1

```
⚠️ DEPLOY WITH FEATURE FLAG: ENABLE_GATE_ENFORCEMENT=true for gradual rollout.

Create a requireGateReady middleware that enforces blocking gate requirements
before allowing stage status transition to APPROVED.

Requirements:
1. Create server/middleware/gate-enforcement.ts:
   - Query projectStageRequirements WHERE stageInstanceId = <current stage> AND
     blocksGate = true AND status != 'COMPLETE'.
   - If blocking requirements exist AND no approved exception exists:
     Return HTTP 409 Conflict with body:
     {
       error: "Gate blocked",
       blockingRequirements: [{ id, name, assignedTo, department }]
     }
   - Allow bypass only if a projectStageExceptions record with status = 'APPROVED'
     exists for each blocking requirement.

2. Apply the middleware to stage status update routes in server/stage-lifecycle-routes.ts:
   On PATCH /api/project-stage-instances/:id/status, when newStatus === 'APPROVED':
   run requireGateReady before committing the status change.

3. Add ENABLE_GATE_ENFORCEMENT=false to .env.example with comment:
   # Set to true to enforce gate requirements before stage approval.
   # Audit existing projects before enabling.

4. Gate the middleware with the feature flag:
   if (process.env.ENABLE_GATE_ENFORCEMENT !== 'true') { return next(); }

5. Before enabling the flag in production:
   - Run: SELECT project_id, stage_code, COUNT(*) FROM project_stage_requirements
     WHERE blocks_gate = true AND status != 'COMPLETE' GROUP BY 1,2
     to audit how many projects would be blocked.
   - Notify all PROJECT_MANAGERs and PROGRAM_MANAGERs before enabling.
   - The admin override via projectStageExceptions already exists — confirm it works.

Risk: HIGH — changes core gates behavior. Existing projects with incomplete requirements
will be blocked from progression. Mandatory feature flag. Mandatory user communication
before enabling.
```

---

### 4.2 — Wire Financial Review Outcome to S05 Stage Status
**Addresses:** OPS-1 (S05 financial gate), GAP 1.5

```
When a financial review outcome is recorded, automatically update the S05 stage status.

Requirements:
1. In server/services/financial-review-service.ts, after saving a review outcome:
   - GO → set S05 projectStageInstances.stageStatus = 'APPROVED'.
   - NO_GO → set stageStatus = 'BLOCKED'. Create a notification for PM and PROGRAM_MANAGER.
   - CONDITIONAL_GO → set stageStatus = 'APPROVED'. Create a projectStageExceptions record
     with the condition text and status = 'APPROVED'.
   - DEFERRED → set stageStatus = 'IN_PROGRESS'. No stage change.

2. Confirm the review's projectId matches the correct projectStageInstances row for S05
   before updating.

3. In server/financial-review-routes.ts, add the service call after the review is persisted.

4. Add a notification in all outcome cases to: stage owner, PM, and PROGRAM_MANAGER.

5. Add tests for all 4 outcomes — confirm stageStatus is correct after each.

Risk: MEDIUM — verify projectId alignment between financial review and stage instance
records. Test all 4 outcomes in staging before deploy.
```

---

### 4.3 — Build Commissioning Frontend Page
**Addresses:** GAP coverage — missing commissioning UI

```
Create the /commissioning frontend page wired to existing backend routes.

Requirements:
1. Create client/src/pages/commissioning-dashboard.tsx.

2. Page sections:
   - Header: project selector dropdown (if PROGRAM_MANAGER) or current project
     (if PROJECT_MANAGER_SITE).
   - Section 1 — Commissioning Items: table of commissioningItems by project.
     Columns: item name, category, status, responsible person, due date, evidence.
     Status pipeline (inline badge): not_started → in_progress → ready_for_review →
     approved → closed.
     Evidence upload button per item (calls existing evidence upload endpoint).
   - Section 2 — SSEG Compliance: table of ssegItems with status and compliance flag.
   - Section 3 — Confirmation Checklist: Techsitter confirmed checkbox, metering
     confirmed checkbox. Both required before commissioning stage can be marked complete.

3. Register in client/src/config/page-registry.ts:
   path: /commissioning
   roles: PROJECT_MANAGER_SITE, ENGINEER, PROGRAM_MANAGER, ADMIN, COMMISSIONING_MANAGER

4. Wire to existing /api/commissioning/* backend routes — no new backend changes.

5. Add link to commissioning page from gates-pipeline.tsx for projects in S07/S08.

Risk: LOW — new page only. No backend changes. Backend routes already exist.
```

---

### 4.4 — Implement Weekly Client Update Overdue Detection
**Addresses:** OPS-2

```
Add a scheduled job that detects overdue client updates and triggers notifications.

Requirements:
1. Create a BullMQ recurring job in server/services/client-update-overdue-job.ts:
   - Schedule: every 6 hours (or daily at 07:00 SAST via cron: '0 7 * * *').
   - Query: SELECT * FROM project_client_updates
     WHERE due_date < NOW() AND status NOT IN ('SENT', 'APPROVED').
   - For each overdue record:
     a. UPDATE project_client_updates SET status = 'OVERDUE' WHERE id = <id>.
     b. Create notification for project PM: "Client update overdue: [project name]"
        via notification-service.ts.
     c. Create notification for PROGRAM_MANAGER.
     d. If due_date < NOW() - INTERVAL '7 days':
        Create escalation notification for COO / COO_ADMIN:
        "CLIENT UPDATE ESCALATION: [project name] overdue by [N] days."

2. Register the job in the BullMQ worker bootstrap (wherever other scheduled jobs are
   registered).

3. Add GET /api/client-updates/overdue-summary (PROGRAM_MANAGER, ADMIN, COO_ADMIN):
   Returns count of overdue updates grouped by project and PM.

4. Add a test: seed an overdue project_client_update record, run the job manually,
   confirm status is set to OVERDUE and notifications were created.

Risk: LOW — additive. No existing behavior changes. Requires Redis/BullMQ (already installed).
```

---

### 4.5 — Add Stage Transition Notifications
**Addresses:** OPS-2 (escalation), GAP 1.5 (lifecycle automation)

```
Trigger notifications when projectStageInstances.stageStatus changes.

Requirements:
1. In the stage status update handler (server/stage-lifecycle-routes.ts), after
   persisting the status change, call notification-service.ts to create notifications for:
   - Stage owner of the new stage.
   - PROGRAM_MANAGER on the project.
   - Project PM.
   - Department leads whose requirements are in the new stage
     (query projectStageRequirements for departments involved in this stage).

2. Notification message format:
   "[Project Name] — Stage [S0X] [Stage Name] is now [NEW_STATUS]"
   Include a link to the gates workspace for this project.

3. For BLOCKED status transitions, include the list of blocking requirements in the
   notification body.

4. For APPROVED transitions, include who approved and when.

5. Add to .env.example: STAGE_TRANSITION_NOTIFICATIONS=true
   Gate the notification sending behind this flag for initial rollout.

Risk: LOW — additive notification behavior. No blocking logic. Feature-flag for rollout.
```

---

## TIER 5 — UX CLARITY
> After Tier 4 is complete and stable.

---

### 5.1 — Add Department Filter to Gates Workspace
**Addresses:** UX-3

```
Add role-based department filtering to gates workspace pages.

Requirements:
1. Create client/src/config/role-stage-map.ts:
   export const ROLE_TO_STAGE_MAP: Record<string, string[]> = {
     ENGINEER: ['S03', 'S04', 'S06'],
     QUALITY_MANAGER: ['S07', 'S08'],
     FINANCE_MANAGER: ['S05'],
     CONSTRUCTION_MANAGER: ['S06', 'S07'],
     PROJECT_MANAGER_SITE: ['S04', 'S05', 'S06', 'S07', 'S08'],
     PROGRAM_MANAGER: ['*'],
     ADMIN: ['*'],
     COO_ADMIN: ['*'],
     CEO_ADMIN: ['*'],
   };

2. In gates-pipeline.tsx and gates-blocked.tsx:
   - Read current user's role from auth context.
   - Apply ROLE_TO_STAGE_MAP filter as the default view.
   - Add "My Department" / "All Stages" toggle (users with ['*'] default to "All Stages").
   - Persist filter preference to localStorage key: gates-view-preference-<userId>.

3. Add a "My Pending Actions" banner at the top of gates-pipeline.tsx:
   Shows only stages in READY_FOR_REVIEW or BLOCKED status within the user's role scope.
   Include count badge on the navigation item.

4. Deepen gates-pipeline.tsx (currently 233 lines):
   - Add inline stage detail panel: clicking a row expands to show blocking requirements
     count, days in current status, assigned team members, next required action.
   - Add summary stats bar: Total Active, Blocked, Overdue, Ready for Review.

5. Deepen gates-blocked.tsx (currently 101 lines):
   - For each blocked stage, show the specific blocking requirement(s) preventing
     progression with responsible person and department.
   - Add "Escalate" button → sends notification to PROGRAM_MANAGER.

Risk: LOW — frontend filter only. No backend changes needed.
```

---

### 5.2 — Deprecate and Merge Dual-Source Client Tables
**Addresses:** DAT-3

```
Migrate all data to canonical stage-collaboration tables and deprecate legacy tables.

Requirements:
1. Audit phase — search for all reads/writes to:
   - clientCommitments (shared/schema/collaboration.ts)
   - clientUpdates (shared/schema/collaboration.ts)
   Document every file and line in docs/dual-source-audit.md.

2. Write migration YYYYMMDD_consolidate_client_tables.sql:
   -- Add migratedFromLegacy marker
   ALTER TABLE project_client_commitments ADD COLUMN migrated_from_legacy BOOLEAN DEFAULT false;
   ALTER TABLE project_client_updates ADD COLUMN migrated_from_legacy BOOLEAN DEFAULT false;

   -- Copy data
   INSERT INTO project_client_commitments (..., migrated_from_legacy)
   SELECT ..., true FROM client_commitments
   ON CONFLICT DO NOTHING;

   INSERT INTO project_client_updates (..., migrated_from_legacy)
   SELECT ..., true FROM client_updates
   ON CONFLICT DO NOTHING;

3. Update all service functions writing to old tables → write to new tables instead.
   Update all GET endpoints reading from old tables → read from new tables.

4. In shared/schema/collaboration.ts, add to both table definitions:
   /**
    * @deprecated Use projectClientCommitments in stage-collaboration.ts.
    * Data migrated YYYY-MM-DD. DO NOT write to this table.
    * Scheduled for drop after 90-day observation window.
    */

5. Add runtime guards in old write service functions:
   throw new Error('Write to deprecated clientCommitments table blocked. Use projectClientCommitments.');

6. After 90-day observation period with zero reads from legacy tables → separate PR to drop.

Risk: MEDIUM — must find all code paths reading from legacy tables before switching reads.
```

---

### 5.3 — Clean Up Legacy Redirect Chains
**Addresses:** UX-1

```
Replace multi-hop redirects with direct redirects in client/src/App.tsx.

Requirements:
1. In client/src/App.tsx lines 22-43, trace all 13 legacy redirect paths.
   For each redirect chain longer than 1 hop (A → B → C):
   Collapse to a direct redirect (A → C).
   Add comment: // Legacy: /dashboard → /execution-board → /gates. Collapsed to direct.

2. Specific collapses:
   /dashboard → /gates (remove /execution-board intermediate)
   /pm-dashboard → /gates (remove /execution-board intermediate)
   Any other chains found during audit.

3. In client/src/config/page-registry.ts:
   For every entry with a redirectTo property, verify the target is not itself a redirect.
   Add type: 'alias' | 'page' field to PageRegistry entry type.
   Mark entries with redirectTo as type: 'alias'.

4. Create scripts/check-redirect-chains.ts:
   Reads all redirect definitions from App.tsx and page-registry.ts.
   Detects and prints chains longer than 1 hop.
   Add to package.json: "check:redirects": "tsx scripts/check-redirect-chains.ts"
   Add to CI pipeline.

Risk: LOW — no data or backend changes. Update bookmarks documentation.
```

---

### 5.4 — Remove Duplicate PD Handover Page
**Addresses:** UX duplication

```
Verify pd-pm-handover-v2.tsx is active and remove pd-pm-handover.tsx (v1).

Requirements:
1. Verify: check client/src/App.tsx to confirm /pd/handover/:projectId renders
   pd-pm-handover-v2.tsx, not pd-pm-handover.tsx.

2. Search codebase for any import or reference to pd-pm-handover.tsx (v1 without -v2).
   If references found: update them to v2 first.

3. Delete client/src/pages/pd-pm-handover.tsx (v1 only after confirming v2 is active).

4. Remove the v1 route registration from client/src/App.tsx if it exists.

5. Add a comment in page-registry.ts entry for the handover page:
   // Active version: pd-pm-handover-v2.tsx. v1 removed YYYY-MM-DD.

Risk: LOW — verify v2 is what the route renders before deleting v1.
```

---

## TIER 6 — TECHNICAL DEBT CLEANUP
> Lowest urgency. Do last. One route group or one table at a time.

---

### 6.1 — Migrate Legacy routes.ts to Modular Files
**Addresses:** MAINT-1, PERF-3

```
Systematically move route handlers from server/routes.ts into domain-specific files.
Goal: routes.ts reaches 0 lines.

Requirements (Phase 1 — first 4 route groups):
1. Add to top of server/routes.ts:
   /**
    * DEPRECATION STATUS: FROZEN — DO NOT ADD NEW ROUTES HERE
    * Migration target: server/routes/<domain>-routes.ts
    * Progress: docs/route-migration-status.md
    */

2. Create docs/route-migration-status.md:
   - Total route count (run: grep -c "router\." routes.ts).
   - Extracted so far: [list].
   - Remaining: [list by domain].
   - Priority order.

3. Extract these route groups first (Phase 1):
   - server/routes/mytool-routes.ts — all /api/mytool/* routes.
   - server/routes/notification-routes.ts — all /api/notifications/* routes.
   - server/routes/reporting-routes.ts — all /api/reports/* and /api/report-center/* routes.
   - server/routes/client-updates-routes.ts — all /api/client-updates/* routes.

4. In server/register-all-routes.ts: import and register each new module.
   Do NOT remove from routes.ts yet — mark extracted routes with:
   // EXTRACTED to server/routes/<file>.ts — remove after verification.

5. Create a CI check: fail if routes.ts line count increases above current count.
   Print migration percentage on each PR.

6. Create server/routes/route-registry.ts as the new single entry point for all routes.
   All future new routes are registered here only.

Risk: HIGH cumulative, LOW per route group. Do one group at a time.
Verify each group with API tests before proceeding.
```

---

### 6.2 — Standardize Soft-Delete Pattern
**Addresses:** MAINT-3

```
Migrate all isActive boolean patterns to deletedAt timestamp. Do one table at a time.

Requirements:
1. Find all 12 tables with // TODO: migrate to deletedAt pattern comments.
   List in docs/soft-delete-migration.md.

2. For each table (one PR per table):
   a. Write migration:
      ALTER TABLE <table> ADD COLUMN deleted_at TIMESTAMP NULL;
      UPDATE <table> SET deleted_at = NOW() WHERE is_active = false;
   b. Update all queries for this table:
      WHERE is_active = true → WHERE deleted_at IS NULL
      WHERE is_active = false → WHERE deleted_at IS NOT NULL
   c. Mark isActive column deprecated in schema:
      // @deprecated — use deletedAt. Column kept for 30 days then dropped.

3. Create shared/utils/soft-delete.ts:
   export const notDeleted = sql`deleted_at IS NULL`;
   export const isDeleted = sql`deleted_at IS NOT NULL`;
   export const softDelete = (id: number) => db.update(table).set({ deletedAt: new Date() })...

4. Add CI lint check: flag any new query using is_active = true. Require deletedAt pattern.

5. Drop isActive columns 30 days after deletedAt is confirmed stable (separate PRs).

Risk: MEDIUM — must update every query referencing isActive. One table at a time.
```

---

### 6.3 — Remove Deprecated projectName Text Columns
**Addresses:** DAT-4

```
⚠️ 90-DAY DEPRECATION WINDOW — Do not drop columns prematurely.

Requirements (Phase 1 — stop writing):
1. Find all 14+ tables carrying projectName text NOT NULL marked @deprecated.
   List in docs/project-name-deprecation.md.

2. In all INSERT and UPDATE operations across server codebase:
   Stop populating projectName. projectId FK must already be populated on every write.

3. Add database-level comments via migration:
   COMMENT ON COLUMN <table>.project_name IS
   'DEPRECATED: use project_id FK. Do not query. Scheduled for removal after 90 days.';

4. In Drizzle schema, mark each projectName field:
   /** @deprecated Do not use in queries. Use projectId and JOIN to projects table. */

5. Replace all WHERE project_name = and ORDER BY project_name in SQL strings and
   service code with project_id lookups or joins to the projects table.

6. Add a CI grep check that fails if projectName is referenced in any new code.

Phase 2 (after 90-day observation — separate PR):
7. Make projectName nullable: ALTER TABLE <table> ALTER COLUMN project_name DROP NOT NULL.
8. After confirming zero reads: ALTER TABLE <table> DROP COLUMN project_name.
   Do one table at a time.

Risk: HIGH — 14+ tables. Legacy code may filter by projectName.
Full search-and-replace required. One table at a time.
```

---

### 6.4 — Unify MyTool Tasks and workItems
**Addresses:** MAINT-4

```
Migrate mytoolTasks data into workItems with workstream='PERSONAL'.

Requirements (Phase 1 — bridge):
1. Create server/services/personal-task-bridge.ts:
   - getPersonalTasks(userId): reads from workItems WHERE workstream = 'PERSONAL'
     AND assignedUserId = userId. Canonical source.
   - createPersonalTask(userId, task): writes to workItems with workstream = 'PERSONAL'.
   - getMytoolTasksLegacy(userId): reads from mytoolTasks for backward compatibility only.

2. Identify mytool-specific fields not on workItems:
   pinnedToday, pinnedWeek, bucket, blockedReason, nextStep, definitionOfDone,
   completionNote, etc.
   Create workItemPersonal extension table in shared/schema/tasks.ts for these fields
   (1:1 with workItems, same pattern as workItemPm and workItemEngineering).

3. Write one-time migration: copy all mytoolTasks records to workItems (workstream='PERSONAL')
   for each user. Map status, priority, due date. Insert personal-specific fields into
   workItemPersonal extension table.

4. Update all /api/mytool/tasks/* handlers to use personal-task-bridge.ts.

5. Add compatibility shim: GET /api/mytool/tasks returns workItems (workstream='PERSONAL')
   in the mytoolTask response shape — mapped in the bridge service.

6. Mark mytoolTasks table deprecated in schema after migration:
   /** @deprecated All personal tasks now in workItems (workstream=PERSONAL).
    *  Scheduled for drop after 90-day observation period. */

Risk: HIGH — mytoolTasks has unique fields. Extension table required.
Major refactor — do in isolation, not alongside other Tier 6 items.
```

---

### 6.5 — Upgrade @typescript-eslint/no-explicit-any to Error
**Addresses:** MAINT-5

```
Progressively eliminate 500+ any violations. Ratchet mechanism: never allow new ones.

Requirements (Phase 1 — high-risk files):
1. In eslint.config.js, add file-level overrides upgrading no-explicit-any to 'error' for:
   - server/permission-middleware.ts
   - server/lifecycle-stage-gate-service.ts
   - shared/schema/*.ts
   (server/role-management.ts already handled in 3.2)

2. For each file upgraded to 'error':
   - Run npx eslint --fix <file>.
   - Manually resolve remaining violations.
   - Create server/types/<domain>-types.ts as needed for shared type definitions.
   - Create shared/types/index.ts as central export for all shared types.

3. CI ratchet mechanism:
   Add CI step: npx eslint --format=json | count any violations.
   Store current count as the baseline.
   Fail CI if violation count increases above baseline.
   Print current count and trend on each PR.

4. Phase 2 (subsequent PRs, by directory):
   shared/ → server/api/v2/ → server/services/ → server/routes/ → client/
   Each directory in a separate PR. Upgrade to 'error' per directory only when clean.

Risk: LOW per fix, HIGH cumulative effort. Use ratchet to prevent regression while
fixing incrementally.
```

---

## IMPLEMENTATION GUARDRAILS

| Rule | Detail |
|------|--------|
| **Tier ordering** | Never deploy Tier 2+ without Tier 1 complete |
| **One PR per item** | Do not combine items across tiers |
| **Rollback files** | Every migration needs a corresponding `_rollback.sql` file |
| **Feature flags** | Tier 4.1 (gate enforcement) MUST be flag-gated (`ENABLE_GATE_ENFORCEMENT`) |
| **Staging first** | Tier 2.1 and 2.2 MUST run on a staging database copy before production |
| **Deprecation window** | No column drops without 90-day observation (6.3) or 30-day window (6.2) |
| **User communication** | Notify users before Tier 4.1 (gate enforcement) and Tier 1.3 (MyTool access) |
| **Silent drop rule** | Never drop a column without a deprecation PR landing first |
| **Audit all before running** | Run orphan/duplicate audits before migrations 2.4 and 2.5 |
