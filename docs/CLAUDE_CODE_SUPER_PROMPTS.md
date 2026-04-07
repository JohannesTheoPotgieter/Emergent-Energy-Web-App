> **⚠️ STALE METRICS** — This document contains metrics from a March 2026 audit that are no longer accurate.
> The canonical baseline is now [`docs/architecture-baseline-2026-04-07.md`](./architecture-baseline-2026-04-07.md).
>
> **Known stale claims carried into prompts below:**
> - "~223 tables" → actual: 282
> - "680KB monolithic routes.ts" → actual: 361.5 KB
> - "TypeScript strict mode disabled" / "strict: false" → actual: `strict: true`
> - "830+ route handlers" → actual: ~2,304 registrations across 122 files
> - "178+ `any` usages" → actual: ~4,996

# Emergent Energy Web App — Claude Code Super Prompts

> **Purpose:** Six self-contained prompts designed to be copy-pasted into Claude Code sessions. Each prompt addresses a distinct slice of findings from the Full Repository Audit (968-line, 86.6 KB report covering 10 phases) and the UX/QA Dashboard Assessment (rated 7.5/10). Work them in order — Prompt 1 is the most urgent.
>
> **Tech Stack Reference (all prompts):**
> Frontend: React 19, TypeScript, Vite 7, Wouter router, TanStack React Query, Tailwind CSS, shadcn/ui (Radix), Recharts
> Backend: Express.js + TypeScript, Passport.js, JWT + session dual auth, Drizzle ORM (~223 tables), Neon PostgreSQL
> Integrations: Microsoft Graph API (MSAL), Azure Key Vault, SharePoint, Teams, Outlook
> Scale: 24 users, 14 roles, ~830+ API endpoints, 117 routed pages

---

## PROMPT 1: Critical Security & Bug Fixes

```
You are working on the Emergent Energy web app — a React 19 + Express.js + PostgreSQL application with Drizzle ORM, ~223 tables, 830+ API endpoints, and Microsoft Graph integrations. This session focuses exclusively on CRITICAL SECURITY VULNERABILITIES and HIGH-PRIORITY BUG FIXES identified in a full repository audit.

### Branch & Commit Strategy
- Create branch: `fix/critical-security-and-bugs`
- Commit after each numbered section below with a descriptive message.
- Run `npm run build` (or the project's build command) after every commit to confirm nothing is broken.

---

### 1. Microsoft Tokens Stored Unencrypted (CRITICAL)

The column `ms_tokens` in the users table (or related credentials table) is described as "encrypted" in code comments but stores tokens as PLAINTEXT JSON. This means any database leak exposes every user's Microsoft access and refresh tokens.

**Files to inspect:**
- `shared/schema.ts` — find the `ms_tokens` column definition
- `server/ms-auth.ts` or `server/microsoft/auth.ts` — find where tokens are written to the DB
- `server/routes.ts` or the Microsoft auth route handlers — find where tokens are read back

**Fix:**
1. Create a utility module `server/utils/encryption.ts` that exports `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string` using AES-256-GCM with a key sourced from `process.env.TOKEN_ENCRYPTION_KEY` (or Azure Key Vault if already configured). Include a random IV per encryption, prepended to the ciphertext.
2. Update every code path that WRITES `ms_tokens` to call `encrypt()` before storing.
3. Update every code path that READS `ms_tokens` to call `decrypt()` after retrieval.
4. Add a one-time migration script `server/migrations/encrypt-existing-tokens.ts` that reads all existing plaintext tokens, encrypts them, and writes them back. Guard it with a dry-run flag.
5. Add `TOKEN_ENCRYPTION_KEY` to `.env.example` with a comment explaining how to generate one (e.g., `openssl rand -hex 32`).

---

### 2. Hardcoded Admin Passwords in Source (CRITICAL)

The audit found hardcoded admin passwords in source code. These must be removed immediately.

**Files to inspect:**
- `server/routes.ts` — search for any hardcoded password strings, look for patterns like `password === "..."` or seed/init blocks
- `server/seed.ts` or `server/init.ts` — check for default user creation with plaintext passwords
- Any file matching `**/admin*` or `**/seed*`

**Fix:**
1. Remove ALL hardcoded passwords from source files.
2. Replace with hashed values using `bcrypt` (or whatever hashing the project already uses for auth).
3. For development seeding, read default passwords from environment variables (`SEED_ADMIN_PASSWORD`) and hash them at seed time.
4. Add a check that prevents seeding if `NODE_ENV === 'production'`.
5. Search the entire codebase: `grep -r "password" --include="*.ts" --include="*.js"` and audit every hit.

---

### 3. Plaintext Password Storage (CRITICAL)

The table `role_credentials` has a column `last_password_plain` that stores passwords in plaintext.

**Files to inspect:**
- `shared/schema.ts` — find the `role_credentials` table and the `last_password_plain` column
- Search all files for `last_password_plain` to find every read/write

**Fix:**
1. Create a migration to DROP the `last_password_plain` column entirely.
2. Remove all references to this column in the codebase.
3. If there is a business need to show "last password" to admins, replace it with a "password last changed at" timestamp column instead. Never store plaintext passwords.

---

### 4. SQL Injection via sql.raw() (CRITICAL)

The audit flagged SQL injection risk through Drizzle's `sql.raw()` being called with unsanitized user input.

**Files to inspect:**
- `server/routes.ts` (680 KB monolith) — search for `sql.raw`, `sql\``, and any raw SQL construction
- Any file under `server/` using `sql.raw()`

**Fix:**
1. Identify every `sql.raw()` call. For each one, determine if user input flows into it.
2. Replace unsafe `sql.raw(userInput)` with parameterized Drizzle queries: `sql\`...${placeholder}\`` using Drizzle's tagged template which auto-parameterizes.
3. If dynamic column/table names are needed, validate them against a whitelist of allowed names — never interpolate user strings directly.
4. Add a comment `// SECURITY: parameterized` next to each fixed query for future auditors.

---

### 5. SharePoint List Auth Broken — Header Typo (HIGH)

The SharePoint List integration sends `X_REPLIT_TOKEN` (underscores) instead of `X-Replit-Token` (hyphens) in auth headers, causing silent auth failures.

**Files to inspect:**
- `server/microsoft/sharepoint.ts` or wherever SharePoint API calls are made
- Search for `X_REPLIT_TOKEN` across the codebase

**Fix:**
1. Replace `X_REPLIT_TOKEN` with `X-Replit-Token` in the header object.
2. Verify all other custom headers in MS integration files use hyphens, not underscores.

---

### 6. Graph API Scope Mismatch (HIGH)

The app requests `Chat.Read` scope but attempts operations requiring `Chat.ReadWrite`, causing silent failures in Teams chat features.

**Files to inspect:**
- `server/ms-auth.ts` or `server/microsoft/auth.ts` — find the MSAL scope configuration
- Search for `Chat.Read` across the codebase

**Fix:**
1. Update the scope array to include `Chat.ReadWrite` (or `Chat.ReadWrite.All` depending on the app's needs) instead of just `Chat.Read`.
2. Verify that the Azure AD app registration in the portal also has this permission granted. Add a comment in the code noting this portal dependency.
3. Check for any other scope mismatches: compare every Graph API call's required permissions against the scopes requested at auth time.

---

### 7. XSS via innerHTML in Teams Chat (HIGH)

Teams chat messages are rendered using `innerHTML` or `dangerouslySetInnerHTML` without sanitization, allowing cross-site scripting.

**Files to inspect:**
- Search for `innerHTML` and `dangerouslySetInnerHTML` in all `.tsx` files
- Likely in `client/src/pages/teams/` or `client/src/components/teams/`

**Fix:**
1. Install `dompurify` (`npm install dompurify @types/dompurify`).
2. Create a utility: `client/src/lib/sanitize.ts` exporting `sanitizeHtml(dirty: string): string` using DOMPurify.
3. Wrap every `dangerouslySetInnerHTML` usage: `dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}`.
4. If any raw `innerHTML` assignments exist, refactor them to use React's rendering or the sanitized approach.

---

### 8. POST /api/admin/mark-active Missing requireAdmin (HIGH)

This admin endpoint lacks the `requireAdmin` middleware, allowing any authenticated user to activate/deactivate accounts.

**Files to inspect:**
- `server/routes.ts` — search for `/api/admin/mark-active`
- Find the middleware chain for this route

**Fix:**
1. Add `requireAdmin` (or whatever the project's admin middleware is called) to the route handler chain.
2. Audit ALL routes under `/api/admin/*` to confirm they all have admin middleware. List any others that are missing and fix them.

---

### 9. File Upload MIME Bypass & Unauthenticated File Serving (HIGH)

File upload validates MIME type but only checks the file extension, which is trivially spoofable. Additionally, uploaded files are served without authentication.

**Files to inspect:**
- `server/routes.ts` — search for upload/multer configuration
- The static file serving middleware for uploads
- `server/middleware/` — check for auth middleware on file routes

**Fix:**
1. Add server-side MIME validation using magic bytes (use `file-type` npm package): read the first few bytes of the uploaded file and verify the actual type matches the claimed type.
2. Add authentication middleware to the file serving route so only logged-in users can access uploaded files.
3. If files need to be scoped to specific users/projects, add authorization checks too.
4. Sanitize uploaded filenames: strip path traversal characters (`../`, `..\\`), limit to alphanumeric + hyphens + dots, and generate a UUID-based filename for storage while preserving the original name in the database.

---

### 10. graphPost Fails on 202 No Content (MEDIUM)

The `graphPost` helper function treats HTTP 202 (Accepted, no body) as an error because it tries to parse JSON from an empty response.

**Files to inspect:**
- `server/microsoft/graph.ts` or wherever `graphPost` is defined
- Search for `graphPost` to find the implementation

**Fix:**
1. After the fetch call, check `response.status === 202` or `response.status === 204` or `!response.headers.get('content-length')` before attempting `response.json()`.
2. Return `null` or an empty success object for bodyless success responses.
3. Apply the same fix to `graphPut`, `graphPatch`, `graphDelete` if they exist.

---

### Final Checks
After all fixes:
1. Run `npm run build` and fix any type errors.
2. Run `npm run lint` if configured.
3. Search the full codebase one more time for: `sql.raw`, `innerHTML`, `dangerouslySetInnerHTML`, hardcoded passwords, `X_REPLIT_TOKEN`, `last_password_plain`.
4. Commit with message: "fix: complete critical security and bug fix pass — see individual commits for details"
```

---

## PROMPT 2: Database Schema & Data Integrity

```
You are working on the Emergent Energy web app — a React 19 + Express.js + PostgreSQL application using Drizzle ORM with ~223 tables defined in `shared/schema.ts`. This session focuses on DATABASE SCHEMA CORRECTIONS AND DATA INTEGRITY fixes from the full repository audit.

### Branch & Commit Strategy
- Create branch: `fix/database-schema-integrity`
- Commit after each numbered section.
- Run `npm run build` after every commit.
- For schema changes, generate Drizzle migrations using the project's migration command (likely `npx drizzle-kit generate` or `npm run db:generate`).

---

### 1. Add 25 Missing Foreign Key References

The audit identified 25+ foreign key references that are missing from the schema, meaning the database has no referential integrity enforcement for these relationships.

**File:** `shared/schema.ts`

**Approach:**
1. Search `shared/schema.ts` for all `integer()` or `text()` columns whose names end in `_id` (e.g., `project_id`, `user_id`, `task_id`, `team_id`).
2. For each `_id` column, check whether it has a `.references(() => otherTable.id)` call.
3. If it does NOT have a reference, determine the correct target table from the column name and add the reference.
4. Common patterns to look for:
   - `project_id` → `projects.id`
   - `user_id` / `assigned_to` / `created_by` / `updated_by` → `users.id`
   - `task_id` → `tasks.id`
   - `team_id` → `teams.id`
   - `department_id` → `departments.id`
   - `milestone_id` → `milestones.id`
5. For each FK, decide on the cascade behavior: use `{ onDelete: 'set null' }` for optional relationships and `{ onDelete: 'cascade' }` for ownership relationships (e.g., task sub-items when a task is deleted).
6. Generate and review the migration. Make sure existing data won't violate the new constraints — if orphaned rows exist, the migration will fail. Add a pre-migration script that identifies and reports orphaned rows.

---

### 2. Add UNIQUE Constraint on users.email

The `users.email` column has no UNIQUE constraint, meaning duplicate email addresses can exist.

**File:** `shared/schema.ts`

**Fix:**
1. Find the `users` table definition.
2. Add `.unique()` to the `email` column, or add a unique index: `uniqueIndex('users_email_unique').on(users.email)`.
3. Before generating the migration, write a quick query script to check for existing duplicate emails. If duplicates exist, document them and decide on a merge strategy (likely keep the most recently active account).

---

### 3. Add Missing Indexes for Performance

The audit identified multiple columns used in WHERE clauses and JOINs that lack indexes.

**File:** `shared/schema.ts`

**Add indexes for these common query patterns:**
1. `projects.status` — filtered on almost every dashboard query
2. `projects.phase` — filtered in pipeline views
3. `tasks.project_id` — joined constantly
4. `tasks.assigned_to` — filtered for "My Tasks" views
5. `tasks.status` — filtered in board/list views
6. `tasks.due_date` — sorted/filtered for overdue queries
7. `audit_logs.created_at` — sorted for recent activity
8. `audit_logs.user_id` — filtered for user activity
9. `notifications.user_id` + `notifications.read` — compound index for unread notification queries
10. `financial_records.project_id` + `financial_records.period` — compound index for project financial queries
11. Any column used in `ORDER BY` in the top 20 most-hit API endpoints

Use Drizzle's `index()` function in the table definition's extra config.

---

### 4. Standardize Soft-Delete Pattern

The audit found inconsistent soft-delete implementation — some tables use `deleted_at` timestamp, some use `is_deleted` boolean, some have no soft-delete at all.

**File:** `shared/schema.ts`

**Fix:**
1. Search for all variations: `deleted_at`, `is_deleted`, `isDeleted`, `active`, `is_active`.
2. Pick ONE standard: `deleted_at` (timestamp, nullable) is the best practice — it's both a flag and a record of when deletion happened.
3. For tables using `is_deleted` boolean: add a `deleted_at` column, migrate data (`deleted_at = NOW()` where `is_deleted = true`), then drop `is_deleted` in a later migration.
4. For important entity tables that lack soft-delete entirely (projects, tasks, users, financial records), add `deleted_at`.
5. Update the Drizzle query helpers: create a shared `whereNotDeleted` filter that can be applied to all queries. Something like:
   ```typescript
   export const notDeleted = <T extends { deletedAt: ... }>(table: T) => isNull(table.deletedAt);
   ```
6. Audit all SELECT queries on soft-deleteable tables to ensure they filter out deleted rows.

---

### 5. Fix Type Mismatches and Column Issues

The audit flagged several column type issues:

1. **Date columns stored as text:** Find any date/timestamp data stored in `text()` columns and migrate to proper `timestamp()` or `date()` types. Common culprits: `due_date`, `start_date`, `end_date`, `completed_at`.
2. **Numeric columns stored as text:** Financial amounts, quantities, or percentages stored as `text()` should be `numeric()` or `real()`.
3. **Boolean columns stored as integers:** Any `0/1` integer columns that represent true/false should be `boolean()`.
4. **Inconsistent ID types:** Ensure all primary keys use the same type (either `serial()` for auto-increment integers or `uuid()` — don't mix).

---

### 6. Add 7 Missing Tables

The audit identified 7 tables that should exist but don't. Based on the application's domain (energy project management), these likely include:

1. **audit_trail** — if not already present, for tracking all data changes with before/after values
2. **notification_preferences** — user-level notification settings
3. **file_versions** — version history for uploaded documents
4. **project_milestones** — if milestones are currently embedded in projects rather than normalized
5. **approval_workflows** — for RFI/submittal/inspection approval chains
6. **dashboard_preferences** — user dashboard customization settings
7. **import_history** — tracking data import runs, errors, and status

For each: define the table in `shared/schema.ts` with appropriate columns, types, foreign keys, indexes, and timestamps (`created_at`, `updated_at`). Follow the existing patterns in the schema file.

---

### 7. Hardcoded FY26 Months/Budgets

Financial calculations and budget periods are hardcoded to FY26 months instead of being dynamic.

**Files to inspect:**
- `server/routes.ts` — search for "FY26", "2026", month arrays
- `shared/schema.ts` — check for hardcoded fiscal year references
- `client/src/pages/financials/` — check for hardcoded period lists

**Fix:**
1. Create a `fiscal_years` table with `id`, `name`, `start_date`, `end_date`, `is_current`.
2. Create a `fiscal_periods` table with `id`, `fiscal_year_id`, `period_name`, `start_date`, `end_date`, `sort_order`.
3. Replace all hardcoded month/year references with lookups against these tables.
4. Seed the tables with FY26 data and add FY27 as a template.

---

### Final Checks
1. Run `npx drizzle-kit generate` to create all migrations.
2. Review every generated SQL migration file for correctness.
3. Run `npm run build` to verify TypeScript compiles.
4. Run `npx drizzle-kit push` against a development database to test the migrations (or whatever the project's migration command is).
5. Commit with message: "fix: database schema integrity — FKs, indexes, soft-delete, type fixes"
```

---

## PROMPT 3: Frontend Bug Fixes & Consistency

```
You are working on the Emergent Energy web app — a React 19 + TypeScript frontend using Wouter for routing, TanStack React Query for data fetching, Tailwind CSS + shadcn/ui for styling. This session focuses on FRONTEND BUG FIXES AND CONSISTENCY issues from the audit.

### Branch & Commit Strategy
- Create branch: `fix/frontend-bugs-consistency`
- Commit after each numbered section.
- Run `npm run build` after every commit.

---

### 1. Fix 401 Redirect Going to /login Instead of /auth/login

When a user's session expires and they receive a 401, the app redirects to `/login` which doesn't exist as a route, resulting in a 404.

**Files to inspect:**
- `client/src/lib/queryClient.ts` or wherever the global fetch/query configuration lives
- `client/src/hooks/use-auth.ts` or similar auth hook
- `client/src/App.tsx` or `client/src/router.tsx` — check the route definitions for the login page
- Search for `"/login"` across all `.ts` and `.tsx` files

**Fix:**
1. Find every instance of `"/login"` in the frontend code.
2. Determine the correct login route by checking the router config (likely `/auth/login`).
3. Replace all instances. Pay special attention to:
   - The global 401 handler in the query client or fetch wrapper
   - Any `useLocation` or `navigate` calls that redirect on auth failure
   - The `ProtectedRoute` or `AuthGuard` component
4. Add a catch-all redirect: if someone hits `/login`, redirect them to `/auth/login`.

---

### 2. Fix Dashboard Queries Skipping Bearer Token

Dashboard API calls don't include the Authorization Bearer token, causing them to fail silently or return empty data.

**Files to inspect:**
- `client/src/pages/dashboard/` — all dashboard page components
- `client/src/lib/queryClient.ts` — the default fetch function
- `client/src/hooks/` — any custom fetch hooks

**Fix:**
1. Check if the app has a centralized fetch wrapper that automatically includes the auth token. If it does, find out why dashboard queries bypass it (they may use raw `fetch()` instead of the wrapper).
2. Ensure ALL API calls go through a single `apiClient` or `fetchWithAuth` function that:
   - Reads the JWT from wherever it's stored (localStorage, cookie, or auth context)
   - Adds `Authorization: Bearer ${token}` to every request
   - Handles 401 responses by redirecting to login (the correct path from fix #1)
3. Audit every `fetch()` call in the dashboard pages and refactor to use the centralized client.
4. Also check if there are `useQuery` calls with custom `queryFn` functions that do raw fetches — standardize them.

---

### 3. Fix 10+ Queries That Silently Swallow Errors as Empty Arrays

The audit found that 10+ API call sites catch errors and return empty arrays `[]` instead of surfacing the error, making debugging impossible and showing users misleading "no data" states.

**Files to inspect:**
- `server/routes.ts` — search for `catch` blocks that return `res.json([])` or `return []`
- `client/src/` — search for `.catch(() =>` patterns that return empty arrays

**Fix (backend):**
1. Search `server/routes.ts` for patterns like: `catch (error) { ... res.json([]) }` or `catch { return [] }`.
2. Replace with proper error responses: `res.status(500).json({ error: "Failed to fetch [resource]", details: error.message })`.
3. Add logging: `console.error("[Route name] error:", error)` in every catch block.

**Fix (frontend):**
1. Search for `.catch(() => [])` or similar patterns in React Query `queryFn` functions.
2. Let errors propagate so React Query's error state works correctly.
3. Ensure each data-displaying component handles the `isError` state from `useQuery` with a user-friendly error message, not just showing empty content.
4. Create a shared `<QueryErrorBanner />` component that can be dropped into any page:
   ```tsx
   function QueryErrorBanner({ error }: { error: Error }) {
     return (
       <Alert variant="destructive">
         <AlertTitle>Something went wrong</AlertTitle>
         <AlertDescription>{error.message}</AlertDescription>
       </Alert>
     );
   }
   ```

---

### 4. Fix Status Value Inconsistencies

The audit found inconsistent status values across the app — some places use "in_progress", others use "In Progress", others use "IN_PROGRESS" or numeric codes.

**Files to inspect:**
- `shared/schema.ts` — find all enum definitions and status columns
- `client/src/` — search for status string literals
- `server/routes.ts` — search for status comparisons

**Fix:**
1. Create a canonical status enum file: `shared/constants/statuses.ts` that exports all status values as TypeScript enums or const objects:
   ```typescript
   export const ProjectStatus = { ACTIVE: 'active', ON_HOLD: 'on_hold', COMPLETED: 'completed', ... } as const;
   export const TaskStatus = { TODO: 'todo', IN_PROGRESS: 'in_progress', DONE: 'done', ... } as const;
   ```
2. Use lowercase_snake_case as the canonical format (matching typical DB conventions).
3. Create display-name mappings: `export const ProjectStatusLabels: Record<string, string> = { active: "Active", on_hold: "On Hold", ... }`.
4. Replace all hardcoded status strings across frontend and backend with references to these constants.
5. Add a `<StatusBadge status={value} type="project" />` shared component that maps status to consistent colors and labels.

---

### 5. Fix Multi-Assignee IDs Lost on Task Creation

When creating a task with multiple assignees, only the first assignee ID is saved.

**Files to inspect:**
- `client/src/pages/tasks/` or wherever the task creation form lives
- `server/routes.ts` — the POST endpoint for task creation
- `shared/schema.ts` — the tasks table and any task_assignees junction table

**Fix:**
1. Check if a `task_assignees` junction table exists. If not, create one with `task_id` and `user_id` columns.
2. On the backend, update the task creation endpoint to accept an array of assignee IDs and insert rows into the junction table within the same transaction.
3. On the frontend, ensure the multi-select component correctly sends an array, not just the last selected value.
4. Update task queries to JOIN on the junction table and return all assignees.

---

### 6. Fix Date Parsing Ambiguity (DD/MM vs MM/DD)

The app has inconsistent date parsing — some places assume DD/MM/YYYY (South African format) and others assume MM/DD/YYYY (US format).

**Files to inspect:**
- Search for `new Date(`, `Date.parse(`, `dayjs(`, `format(` across the codebase
- `client/src/lib/` — check for date utility functions
- `server/` — check for date parsing in import/export logic

**Fix:**
1. Create `shared/utils/dates.ts` with standardized date parsing and formatting functions.
2. Use ISO 8601 (YYYY-MM-DD) as the canonical format for all API communication and database storage.
3. Only convert to DD/MM/YYYY for DISPLAY in the South African locale on the frontend.
4. For the Smart Import module (which reads external data), explicitly specify the expected date format and parse with a library like `dayjs` with strict parsing enabled.
5. Add the `dayjs` customParseFormat plugin if not already present.

---

### 7. Fix Notification System No-Ops

The audit found that the QM (Quality Management) notification system and financial warning notifications are completely disabled — they're no-op functions that do nothing.

**Files to inspect:**
- Search for `notification` across server files
- Look for functions that are empty or just have `// TODO` comments
- `server/routes.ts` — search for notification-related endpoints

**Fix:**
1. Identify all no-op notification functions.
2. For each one, implement a basic notification that:
   - Creates a row in the `notifications` table with `user_id`, `type`, `title`, `message`, `link`, `created_at`, `read` (boolean).
   - The API already likely has a GET endpoint for notifications — verify it reads from this table.
3. Key notifications to implement:
   - QM quality warnings (when inspection fails, NCR raised, SLA breach approaching)
   - Financial warnings (budget threshold exceeded, variance above tolerance, missing actuals)
   - Task overdue notifications
4. If a notification table doesn't exist, create one (coordinate with Prompt 2's missing tables).

---

### 8. Fix Amber-RAG Projects Excluded from At-Risk Count

Projects with Amber-RAG status are excluded from the at-risk count on the dashboard, under-reporting risk.

**Files to inspect:**
- `server/routes.ts` — find the dashboard summary/stats endpoint
- Search for "at-risk", "at_risk", "amber", "rag" in backend code
- `client/src/pages/dashboard/` — check the metric card that shows at-risk count

**Fix:**
1. Find the query that counts at-risk projects.
2. Update the WHERE clause to include both RED and AMBER RAG statuses (or however the project defines risk levels).
3. Consider showing separate counts: "X Red / Y Amber" rather than a single number, giving better visibility.

---

### 9. Fix Watchers Not Receiving Notifications

The audit found that project/task watchers are stored but never actually notified when changes occur.

**Files to inspect:**
- Search for `watcher` across the codebase
- Find the tables/columns that store watcher relationships
- Find the mutation endpoints (PUT/PATCH/POST) for tasks and projects

**Fix:**
1. In every task/project update endpoint, after the update succeeds, query the watchers for that entity.
2. For each watcher, create a notification record.
3. Wrap notification creation in a try/catch so notification failures don't block the main operation.

---

### Final Checks
1. Run `npm run build` and fix all TypeScript errors.
2. Verify the login redirect works by checking route definitions.
3. Search for any remaining `catch(() => [])` patterns.
4. Commit: "fix: frontend bugs — auth redirect, error handling, status consistency, notifications"
```

---

## PROMPT 4: Dashboard & UX Enhancements

```
You are working on the Emergent Energy web app's dashboard and UX layer — React 19 + TypeScript with Tailwind CSS, shadcn/ui, and Recharts. This session implements DASHBOARD AND UX ENHANCEMENTS from both the Full Repository Audit and the UX/QA Assessment (which rated the current dashboard 7.5/10).

### Branch & Commit Strategy
- Create branch: `feature/dashboard-ux-enhancements`
- Commit after each numbered section.
- Run `npm run build` after every commit.

---

### 1. Make All Dashboard Metric Cards Clickable with Drill-Through

Currently, the dashboard shows metric cards (TOTAL PROJECTS: 56, IN CONSTRUCTION: 11, etc.) that are purely informational. Users expect to click them and see the filtered list of items.

**Files to inspect:**
- `client/src/pages/dashboard/` — the main dashboard page
- `client/src/components/dashboard/` — metric card components (might be called StatCard, MetricCard, KPICard, etc.)

**Implementation:**
1. Find the dashboard's metric card component. Wrap it in a clickable container (or make the whole card an anchor/button).
2. Each card should navigate to the relevant list view with a pre-applied filter. For example:
   - "Total Projects: 56" → `/projects`
   - "In Construction: 11" → `/projects?status=construction`
   - "At Risk: 8" → `/projects?rag=red,amber`
   - "Behind Plan: 5" → `/projects?schedule_status=behind`
3. Use Wouter's `useLocation` hook for navigation.
4. Add hover states: slight elevation/shadow increase, cursor pointer, and a subtle arrow icon.
5. Add `role="link"` and `aria-label` for accessibility.

---

### 2. Add Data Import Health Widget

There is no visibility into whether data imports (Smart Import) are healthy.

**Backend:**
1. Create endpoint `GET /api/dashboard/import-health` that returns:
   ```json
   {
     "lastImportTime": "2026-03-23T08:30:00Z",
     "lastImportStatus": "success",
     "errorCount": 2,
     "pendingValidations": 5,
     "importHistory": [
       { "timestamp": "...", "status": "success", "recordsProcessed": 150, "errors": 0 },
       { "timestamp": "...", "status": "partial", "recordsProcessed": 120, "errors": 3 }
     ]
   }
   ```
2. Pull this from the import history table (or create one if it doesn't exist).

**Frontend:**
1. Create `client/src/components/dashboard/ImportHealthWidget.tsx`.
2. Show: last import time (relative, e.g., "2 hours ago"), status badge (green/amber/red), error count with link to error details, pending validation count with link.
3. If last import was >24 hours ago, show a warning state.
4. Add this widget to the dashboard layout.

---

### 3. Enhance ATTENTION NEEDED Section

The current "Attention Needed" items (Behind Plan, Eng. Blockers, Quality Warnings) are just numbers. They need to be actionable lists.

**Files to inspect:**
- `client/src/pages/dashboard/` — find the attention/alerts section
- `server/routes.ts` — find the endpoints that serve attention items

**Implementation:**
1. Create endpoint `GET /api/dashboard/attention-items` that returns categorized items:
   ```json
   {
     "behindPlan": [
       { "id": 1, "name": "Solar Farm Alpha", "owner": "John", "daysBehind": 12, "severity": "high", "link": "/projects/1" }
     ],
     "engineeringBlockers": [...],
     "qualityWarnings": [...],
     "overdueActions": [...]
   }
   ```
2. Create `client/src/components/dashboard/AttentionPanel.tsx` with expandable sections for each category.
3. Each item should show: entity name (linked), owner/assignee, age (how long it's been in this state), severity badge, and a quick-action button (e.g., "Assign", "Escalate").
4. Sort by severity then age (oldest first).
5. Limit to 5 per category with "View all X" link.

---

### 4. Enhance Financial Tiles

Current financial display lacks period filters, comparisons, and trend indicators.

**Files to inspect:**
- `client/src/pages/dashboard/` — financial summary section
- `client/src/pages/financials/` — detailed financial pages
- `server/routes.ts` — financial summary endpoints

**Implementation:**
1. Add period filter tabs: YTD | Current FY | This Month | Last Month | Custom.
2. For each financial metric, show three values: Plan | Actual | Forecast.
3. Add variance indicators: show the delta between plan and actual as both absolute (R 1.2M) and percentage (8.3%), colored green (under budget) or red (over budget).
4. Add sparkline charts using Recharts' `<Sparkline>` or a minimal `<LineChart>` showing the last 6 months trend.
5. Create endpoint `GET /api/dashboard/financial-summary?period=ytd` that returns the structured data.
6. Use skeleton loading states while data fetches.

---

### 5. Add "My Work Today" Role-Tailored Section

Users currently have no personalized "what should I focus on" view.

**Implementation:**
1. Create endpoint `GET /api/dashboard/my-work` that returns, for the current user:
   ```json
   {
     "overdueTasks": [...],
     "dueTodayTasks": [...],
     "upcomingTasks": [...],  // next 7 days
     "pendingApprovals": [...],
     "recentMentions": [...],
     "assignedProjects": [...]
   }
   ```
2. Create `client/src/components/dashboard/MyWorkToday.tsx`.
3. Show as a two-column card at the top of the dashboard:
   - Left: task list grouped by urgency (overdue in red, today in amber, upcoming in default)
   - Right: pending approvals and recent activity
4. Each item links to its detail page.
5. Role-based variations:
   - PMs see their project health summary
   - Engineers see task board + blockers
   - Finance sees pending approvals + variance alerts
   - Admins see system health + user activity
6. If the user has no items, show an encouraging "You're all caught up!" state.

---

### 6. Improve Visual Hierarchy and Layout

The UX assessment noted poor visual hierarchy, unclear icons, and inconsistent spacing.

**Implementation:**
1. **Section headers:** Add clear section titles with icons to each dashboard area:
   - "Portfolio Overview" (Briefcase icon) for project metrics
   - "Attention Needed" (AlertTriangle icon) for alerts
   - "Financial Summary" (DollarSign icon) for financial tiles
   - "My Work" (User icon) for personalized section
2. **Color system:** Create a consistent color-coded system:
   - Green (#22c55e): On track, under budget, healthy
   - Amber (#f59e0b): Warning, approaching threshold, needs attention
   - Red (#ef4444): Critical, overdue, over budget, blocked
   - Blue (#3b82f6): Informational, neutral metrics
3. **Spacing:** Ensure consistent gap between sections (use `space-y-6` or `gap-6`).
4. **Card design:** All metric cards should have consistent padding (p-6), border radius (rounded-lg), and shadow (shadow-sm).
5. **Typography:** Section titles in `text-lg font-semibold`, metric values in `text-3xl font-bold`, labels in `text-sm text-muted-foreground`.

---

### 7. Fix Search Input and Add Context

The UX assessment noted the search input is unlabeled with unclear functionality.

**Files to inspect:**
- `client/src/components/layout/` — the app shell/header where search likely lives
- Search for `<Input` or `<Search` in layout components

**Fix:**
1. Add a placeholder: "Search projects, tasks, people..."
2. Add a search icon (Search from lucide-react) inside the input.
3. Add keyboard shortcut hint: show "⌘K" or "Ctrl+K" badge next to the input.
4. Implement a command palette (Ctrl+K) using shadcn/ui's `<Command>` component that lets users search across all entities.
5. Show recent searches and quick-jump categories.

---

### 8. Fix Reports Presented as Plain Text Links

Reports are shown as simple text links without any preview or context.

**Files to inspect:**
- `client/src/pages/reports/` or `client/src/pages/reporting/`

**Fix:**
1. Create a `<ReportCard />` component that shows:
   - Report icon (based on type: PDF, Excel, chart)
   - Report name
   - Description/subtitle
   - Last generated date
   - "Generate" / "Download" / "View" action buttons
2. Replace the text link list with a grid of report cards.
3. Group reports by category (Financial, Engineering, Quality, Executive).

---

### 9. Operational Overview "PDF" Fix

The audit found that the operational overview "PDF" export actually generates HTML, not a real PDF.

**Files to inspect:**
- Search for "operational overview" in the codebase
- Find the export/download handler

**Fix:**
1. If the project has a PDF generation library installed (puppeteer, pdfmake, jspdf), use it.
2. If not, install `puppeteer` and create a utility that renders the HTML to PDF using headless Chrome.
3. Set proper Content-Type and Content-Disposition headers: `application/pdf` and `attachment; filename="operational-overview.pdf"`.

---

### Final Checks
1. Run `npm run build`.
2. Visually review the dashboard layout by running the dev server (`npm run dev`).
3. Test metric card clicks navigate to correct filtered views.
4. Verify financial tiles load with correct period data.
5. Commit: "feat: dashboard UX enhancements — drill-through, health widget, attention panel, financial tiles, My Work"
```

---

## PROMPT 5: Backend Architecture & Code Quality

```
You are working on the Emergent Energy web app's backend — Express.js + TypeScript with a 680KB monolithic routes.ts file, TypeScript strict mode disabled, no CI/CD, and 178+ `any` usages. This session focuses on BACKEND ARCHITECTURE REFACTORING AND CODE QUALITY improvements.

### Branch & Commit Strategy
- Create branch: `refactor/backend-architecture-quality`
- Commit after each numbered section.
- Run `npm run build` after every commit — this is especially critical here as we're doing major refactoring.

---

### 1. Split the 680KB routes.ts Monolith

`server/routes.ts` is a single 680KB file containing all ~830+ route handlers. It's excluded from TypeScript type checking because it's too large. This is the single biggest code quality issue.

**Strategy — Domain-Based Routing Modules:**
1. Create the following directory structure:
   ```
   server/
   ├── routes/
   │   ├── index.ts          ← re-exports and registers all routers
   │   ├── auth.routes.ts    ← login, logout, register, password reset, MS OAuth
   │   ├── users.routes.ts   ← user CRUD, profile, preferences
   │   ├── projects.routes.ts ← project CRUD, status, phases, RAG
   │   ├── tasks.routes.ts   ← task CRUD, assignments, board operations
   │   ├── financials.routes.ts ← budgets, actuals, forecasts, invoices
   │   ├── engineering.routes.ts ← engineering-specific operations
   │   ├── quality.routes.ts ← QA, inspections, NCRs, checklists
   │   ├── dashboard.routes.ts ← all dashboard summary endpoints
   │   ├── reports.routes.ts ← report generation and retrieval
   │   ├── admin.routes.ts   ← admin-only operations
   │   ├── imports.routes.ts ← Smart Import endpoints
   │   ├── microsoft.routes.ts ← Teams, SharePoint, Outlook, Graph API
   │   ├── notifications.routes.ts ← notification CRUD and preferences
   │   ├── documents.routes.ts ← file upload, download, management
   │   └── pipeline.routes.ts ← PD pipeline operations
   ```

2. **Approach — one module at a time:**
   - Start with the smallest/simplest domain (e.g., `auth.routes.ts`).
   - In the new file, create an Express Router: `const router = express.Router()`.
   - CUT the relevant route handlers from `routes.ts` and PASTE into the new module file.
   - Export the router: `export default router`.
   - In `routes/index.ts`, import and mount: `app.use('/api/auth', authRouter)` (adjust path prefixes).
   - Run `npm run build` and test.
   - Repeat for each domain.

3. **Keep `routes.ts` as a shrinking file** during migration — don't try to do it all at once. After moving a batch, verify the build, then move the next batch.

4. **After migration:** Delete the old `routes.ts` (or rename to `routes.ts.legacy` temporarily). Update `tsconfig.json` to remove any exclusion patterns that were needed for the monolith.

5. **Shared middleware:** Extract common middleware into `server/middleware/`:
   - `requireAuth.ts` — authentication check
   - `requireAdmin.ts` — admin role check
   - `requireRole.ts` — role-based access with configurable allowed roles
   - `validateBody.ts` — request body validation using Zod schemas
   - `asyncHandler.ts` — wrapper that catches async errors and passes to Express error handler

---

### 2. Enable TypeScript Strict Mode and Fix `any` Usages

Currently `strict: false` in `tsconfig.json` with 178+ `any` usages.

**Phased approach:**
1. **Phase 1 — Enable strict incrementally:**
   - Add to `tsconfig.json`: `"strict": true`
   - Also add: `"noImplicitAny": true`, `"strictNullChecks": true`, `"strictFunctionTypes": true`
   - Run `npm run build` to see all errors. Count them.

2. **Phase 2 — Fix errors by category:**
   - **Implicit `any` parameters:** Add explicit types to function parameters, especially Express handlers: `(req: Request, res: Response)`.
   - **Null checks:** Add null guards or optional chaining for nullable values.
   - **`any` return types:** Type the return values of functions, especially DB queries — Drizzle should provide types via the schema.

3. **Phase 3 — Replace explicit `any`:**
   - Search for `: any` across the codebase.
   - For DB results, use Drizzle's inferred types: `typeof users.$inferSelect`.
   - For API responses, create response type interfaces in `shared/types/`.
   - For truly unknown types, use `unknown` with type guards instead of `any`.

4. **Pragmatic exception:** If some files have too many errors to fix in this session, you may add `// @ts-expect-error — TODO: type this` comments for non-critical issues, but track them. Do NOT use `@ts-ignore`.

---

### 3. Set Up CI/CD Pipeline

The audit found there is NO CI/CD pipeline.

**Create `.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
        if: hashFiles('**/*.test.ts') != ''
```

Also create:
1. `.github/workflows/pr-checks.yml` — runs on PRs, includes build + lint + type check.
2. `.github/PULL_REQUEST_TEMPLATE.md` — with checklist for reviewers.

---

### 4. Set Up ESLint & Prettier

**ESLint:**
1. Install: `npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-config-prettier`
2. Create `eslint.config.js` (flat config format for ESLint 9+):
   - Enable `@typescript-eslint/recommended`
   - Add rules: `no-console: warn` (to catch debug logs), `@typescript-eslint/no-explicit-any: warn`, `@typescript-eslint/no-unused-vars: error`
   - Ignore generated files and `node_modules`

**Prettier:**
1. Install: `npm install -D prettier`
2. Create `.prettierrc`:
   ```json
   {
     "semi": true,
     "singleQuote": true,
     "trailingComma": "all",
     "printWidth": 100,
     "tabWidth": 2
   }
   ```
3. Add scripts to `package.json`:
   ```json
   "lint": "eslint .",
   "lint:fix": "eslint . --fix",
   "format": "prettier --write .",
   "format:check": "prettier --check ."
   ```

---

### 5. Create Shared Validation Layer with Zod

Many endpoints lack input validation.

**Implementation:**
1. Install Zod if not present: `npm install zod`.
2. Create `shared/validators/` directory with schema files:
   - `shared/validators/project.ts` — CreateProjectSchema, UpdateProjectSchema
   - `shared/validators/task.ts` — CreateTaskSchema, UpdateTaskSchema
   - `shared/validators/user.ts` — CreateUserSchema, UpdateUserSchema
   - etc.
3. Create `server/middleware/validateBody.ts`:
   ```typescript
   import { ZodSchema } from 'zod';
   export function validateBody(schema: ZodSchema) {
     return (req, res, next) => {
       const result = schema.safeParse(req.body);
       if (!result.success) {
         return res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
       }
       req.body = result.data;
       next();
     };
   }
   ```
4. Apply to the highest-traffic POST/PUT endpoints first.

---

### 6. Add Centralized Error Handling

**Create `server/middleware/errorHandler.ts`:**
```typescript
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[${req.method} ${req.path}]`, err);

  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Validation error', details: err });
  }
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Authentication required' });
  }

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { details: err.message, stack: err.stack } : {})
  });
}
```

Register it as the LAST middleware in the Express app.

**Create `server/utils/asyncHandler.ts`:**
```typescript
export const asyncHandler = (fn: Function) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

Wrap all async route handlers with this to ensure errors propagate to the error handler.

---

### Final Checks
1. Run `npm run build` — zero errors.
2. Run `npm run lint` — review and fix critical issues.
3. Run `npm run format:check` — format the codebase.
4. Verify the routes split didn't break any API calls by checking a few key endpoints.
5. Commit: "refactor: split routes monolith, enable strict TS, add CI/CD, ESLint, Prettier, Zod validation"
```

---

## PROMPT 6: Advanced Features & World-Class Gaps

```
You are working on the Emergent Energy web app — a React 19 + Express.js + PostgreSQL energy project management platform. This session implements ADVANCED FEATURES identified as gaps between the current state and a world-class project management tool. These are lower priority than Prompts 1-5 but represent the path to a 9+/10 UX rating.

### Branch & Commit Strategy
- Create branch: `feature/advanced-capabilities`
- Commit after each numbered section.
- Run `npm run build` after every commit.

---

### 1. Advanced Reporting System

The current reporting is basic text links with no scheduling, export options, or customization.

**Backend (`server/routes/reports.routes.ts`):**
1. Create endpoint `GET /api/reports/catalog` — returns available report types with metadata (name, description, category, available formats, parameters).
2. Create endpoint `POST /api/reports/generate` — accepts `{ reportType, format, parameters, schedule? }`:
   - `format`: 'pdf' | 'xlsx' | 'pptx' | 'csv'
   - `parameters`: date range, project filter, department filter, etc.
   - `schedule`: optional cron expression for recurring generation
3. Create endpoint `GET /api/reports/scheduled` — list user's scheduled reports.
4. Create endpoint `GET /api/reports/history` — past generated reports with download links.

**Report types to implement:**
- Portfolio Status Report (PDF) — all projects with RAG, schedule, budget summary
- Financial Variance Report (Excel) — plan vs actual vs forecast with charts
- Engineering Progress Report (PDF) — task completion, milestone tracking, blockers
- Quality Summary Report (PDF) — inspection results, NCR status, compliance metrics
- Executive Dashboard Export (PDF) — snapshot of the dashboard as a formatted document

**Frontend (`client/src/pages/reports/`):**
1. Create a Report Center page with:
   - Report catalog as cards grouped by category
   - Each card shows: icon, name, description, available formats, "Generate" button
   - Parameter form (date range picker, project multi-select, etc.) that appears on generate
   - Report history table with download links and status
2. Add a "Schedule Report" dialog:
   - Frequency: Daily, Weekly, Monthly
   - Day/time selection
   - Email delivery toggle (if email integration exists)
   - Format selection

---

### 2. Engineering Daily Standup Workflow

The UX assessment identified no structured daily standup workflow for engineering teams.

**Data model:**
1. Create `standup_entries` table:
   - `id`, `user_id`, `date`, `yesterday` (text), `today` (text), `blockers` (text), `project_id`, `created_at`
2. Create `standup_meetings` table:
   - `id`, `team_id`, `date`, `status` ('pending' | 'in_progress' | 'completed'), `notes`, `created_at`

**Backend:**
1. `POST /api/standups/entry` — submit daily standup entry
2. `GET /api/standups/today?team_id=X` — get all entries for today's standup
3. `GET /api/standups/history?team_id=X&from=&to=` — historical standups
4. `GET /api/standups/blockers/active` — all unresolved blockers across teams

**Frontend (`client/src/pages/engineering/standup/`):**
1. **Standup Entry Form:** Three text areas (Yesterday, Today, Blockers) + project selector + submit button. Pre-populate "Yesterday" from the user's previous entry's "Today" field.
2. **Team Standup View:** Show all team members' entries for today in a card layout. Highlight missing entries. Show blocker count prominently.
3. **Standup History:** Calendar view with dots indicating completed standups. Click a date to see that day's entries.
4. **Blockers Dashboard:** Aggregated view of all active blockers with age, owner, and resolution status.

---

### 3. Quality Management NCR Workflows

Current quality management is basic — no Non-Conformance Report (NCR) workflow, no per-project quality dashboards.

**Data model:**
1. Create `ncr_reports` table:
   - `id`, `project_id`, `reported_by`, `assigned_to`, `title`, `description`, `severity` ('minor' | 'major' | 'critical'), `status` ('open' | 'investigating' | 'corrective_action' | 'verification' | 'closed'), `root_cause`, `corrective_action`, `preventive_action`, `due_date`, `closed_at`, `created_at`, `updated_at`
2. Create `ncr_attachments` table: `id`, `ncr_id`, `file_path`, `file_name`, `uploaded_by`, `created_at`
3. Create `ncr_comments` table: `id`, `ncr_id`, `user_id`, `comment`, `created_at`

**Backend:**
1. Full CRUD for NCRs with status transition validation (can't skip from 'open' to 'closed').
2. `GET /api/quality/dashboard?project_id=X` — quality metrics for a project:
   - Open NCRs by severity
   - Average time to close
   - NCR trend (monthly count)
   - Inspection pass rate
   - SLA compliance percentage
3. `GET /api/quality/ncrs?status=open&severity=critical` — filterable NCR list.

**Frontend (`client/src/pages/quality/`):**
1. **NCR List:** Filterable/sortable table with status badges, severity indicators, age, and assignee.
2. **NCR Detail Page:** Full NCR view with timeline of status changes, comments thread, attachments, and action buttons for status transitions.
3. **Quality Dashboard:** Per-project quality health with:
   - NCR count by severity (donut chart)
   - NCR aging distribution (bar chart)
   - Trend line of NCRs opened vs closed per month
   - Inspection results summary
   - SLA metrics with traffic light indicators

---

### 4. Dashboard Personalization

Users cannot customize their dashboard layout or preferences.

**Data model:**
1. Create `user_dashboard_preferences` table:
   - `id`, `user_id` (unique), `layout` (jsonb — array of widget positions), `pinned_projects` (jsonb — array of project IDs), `default_period` ('ytd' | 'fy' | 'month'), `theme` ('light' | 'dark' | 'system'), `updated_at`

**Backend:**
1. `GET /api/user/dashboard-preferences` — get current user's preferences (return defaults if none saved).
2. `PUT /api/user/dashboard-preferences` — save preferences.

**Frontend:**
1. **Widget system:** Wrap each dashboard section in a `<DashboardWidget>` component that:
   - Has a drag handle (grip icon in the header)
   - Has a pin/unpin toggle
   - Has a minimize/maximize toggle
   - Can be hidden via a "Customize Dashboard" panel
2. **Customize panel:** Slide-out panel showing all available widgets with toggles to show/hide.
3. **Pin projects:** Let users pin specific projects to always show at the top of their dashboard.
4. **Persist layout:** Save widget order and visibility to the preferences endpoint on every change (debounced).
5. **Reset to defaults:** Button to restore the standard layout.

For this iteration, use CSS Grid with `order` property for positioning rather than a full drag-and-drop library — it's simpler and sufficient.

---

### 5. Advanced Analytics & Visualizations

The UX assessment identified gaps in analytics capabilities.

**Implementation — add to existing dashboard and project pages:**

1. **Portfolio Health Heatmap** (`client/src/components/analytics/PortfolioHeatmap.tsx`):
   - Grid of projects as colored cells
   - Color = RAG status (Red/Amber/Green)
   - Size = budget value
   - Click to drill into project
   - Use Recharts `<Treemap>` or a custom SVG grid

2. **Trend Lines on Key Metrics** (`client/src/components/analytics/TrendChart.tsx`):
   - Reusable component that takes metric data + time range
   - Shows line chart with area fill
   - Add to: project count over time, budget utilization trend, task completion velocity
   - Use Recharts `<AreaChart>`

3. **Budget vs Actual Waterfall Chart** (`client/src/components/analytics/WaterfallChart.tsx`):
   - Show budget breakdown: starting budget → changes → actuals → remaining
   - Color-coded bars (green for under, red for over)
   - Use Recharts `<BarChart>` with stacked/waterfall configuration

4. **Task Velocity Chart** (`client/src/components/analytics/VelocityChart.tsx`):
   - Show tasks completed per week/sprint over the last 12 weeks
   - Include trend line and average
   - Useful for engineering standup context

5. **Backend endpoints needed:**
   - `GET /api/analytics/portfolio-health` — heatmap data
   - `GET /api/analytics/trends?metric=X&period=Y` — generic trend endpoint
   - `GET /api/analytics/budget-waterfall?project_id=X` — waterfall data
   - `GET /api/analytics/velocity?team_id=X` — task velocity data

---

### 6. Microsoft Integration Roadmap Improvements

The audit identified several MS integration gaps beyond the critical bugs (fixed in Prompt 1).

**Improvements to implement:**

1. **Teams Presence Indicators:**
   - When showing user lists/cards, fetch presence status from Graph API (`/users/{id}/presence`).
   - Show green/yellow/red/gray dot next to user names.
   - Cache presence data for 2 minutes to avoid rate limits.
   - Create `server/microsoft/presence.ts` for the API calls.

2. **SharePoint Document Links in Project Context:**
   - On project detail pages, show linked SharePoint documents.
   - Create `GET /api/projects/:id/sharepoint-documents` that queries the project's SharePoint folder.
   - Display as a file list with icons, names, last modified date, and "Open in SharePoint" links.

3. **Outlook Calendar Integration:**
   - Show upcoming project-related meetings on project detail pages.
   - Create `GET /api/projects/:id/meetings` that queries Outlook calendar events containing the project name.
   - Display as a timeline/list with date, time, title, and attendees.

4. **Token Refresh Resilience:**
   - Implement proper MSAL token refresh with retry logic.
   - Create `server/microsoft/tokenManager.ts`:
     - Wraps all Graph API calls with automatic token refresh on 401.
     - Implements exponential backoff on rate limits (429).
     - Logs token refresh events for debugging.
   - Replace all direct token access with calls through the token manager.

---

### 7. Mobile/Responsive Optimization

The UX assessment flagged that mobile/responsive behavior hasn't been validated.

**Implementation:**
1. **Dashboard:** Switch from multi-column grid to single-column stack on mobile (`md:grid-cols-3 grid-cols-1`).
2. **Navigation:** Implement a mobile hamburger menu that slides in from the left. The current sidebar should collapse to icons on tablet and become a drawer on mobile.
3. **Tables:** For data tables on mobile, either:
   - Switch to a card layout below `md` breakpoint, or
   - Add horizontal scroll with sticky first column
4. **Forms:** Stack form fields vertically on mobile, full-width inputs.
5. **Touch targets:** Ensure all clickable elements are at least 44x44px on mobile.
6. **Test breakpoints:** sm (640px), md (768px), lg (1024px), xl (1280px).

Add a global `useBreakpoint()` hook:
```typescript
function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState('xl');
  // Listen to window resize, return current breakpoint
  return { isMobile: breakpoint === 'sm', isTablet: breakpoint === 'md', ... };
}
```

---

### Final Checks
1. Run `npm run build` — zero errors.
2. Verify all new endpoints return correct data shapes.
3. Check that new components render without console errors.
4. Verify responsive layout at 375px, 768px, and 1280px widths.
5. Commit: "feat: advanced reporting, standup workflow, NCR system, personalization, analytics, MS improvements, responsive"
```

---

## Quick Reference — Execution Order

| Order | Prompt | Est. Effort | Risk if Skipped |
|-------|--------|-------------|-----------------|
| 1 | Critical Security & Bug Fixes | 1-2 days | **Data breach, auth bypass** |
| 2 | Database Schema & Integrity | 1 day | Data corruption, orphaned records |
| 3 | Frontend Bugs & Consistency | 1 day | Broken UX, silent failures |
| 4 | Dashboard & UX Enhancements | 2-3 days | Low user satisfaction (stays at 7.5) |
| 5 | Backend Architecture & Quality | 2-3 days | Unmaintainable codebase, no CI |
| 6 | Advanced Features | 3-5 days | Missing world-class capabilities |

**Total estimated effort: 10-15 development days**

> **Tip:** Run Prompts 1 and 2 first — they fix active vulnerabilities and data integrity issues. Prompts 3-5 can be parallelized across developers. Prompt 6 is the "nice-to-have" layer that takes the app from good to great.
