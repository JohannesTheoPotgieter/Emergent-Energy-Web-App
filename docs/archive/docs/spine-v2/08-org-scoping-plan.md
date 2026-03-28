# Prompt 11 — Organization Scoping Plan

Multi-tenancy future-proofing: `organization_id` has been added to 10 foundation tables. This document describes the work needed to enforce organization-level data isolation.

## Current State

- `organizations` table created with seed row (id=1, "Emergent Energy")
- `organization_id INTEGER NOT NULL DEFAULT 1` added to all 10 Layer 0/1 tables
- All existing rows auto-populated with organization_id = 1
- **No queries, routes, or middleware have been changed**

## Tables with organization_id

| Table | Schema File | Layer |
|-------|------------|-------|
| `users` | users.ts | 0 — Identity |
| `role_credentials` | users.ts | 0 — Identity |
| `app_settings` | users.ts | 0 — Config |
| `clients` | projects.ts | 1 — Entity |
| `project_info` | projects.ts | 1 — Entity |
| `portfolios` | projects.ts | 1 — Entity |
| `phase_template` | projects.ts | 1 — Template |
| `counterparties` | finance.ts | 1 — Entity |
| `qc_template` | quality.ts | 1 — Template |
| `eng_stage_templates` | engineering.ts | 1 — Template |

## Implementation Plan

### Phase 1: Auth Pipeline (Effort: ~2 days)

1. **Login endpoint** (`server/routes.ts` or `server/auth-context.ts`):
   - Look up user's `organization_id` from the `users` table
   - Include `organizationId` in JWT payload
   - Update `JWTPayload` interface in `server/jwt.ts`

2. **requireAuth middleware** (`server/auth-context.ts`):
   - After resolving the authenticated user, attach `req.user.organizationId`
   - This is already set up via the user record; just surface it

3. **Create `requireOrgScope` middleware**:
   - Reads `req.user.organizationId`
   - Injects it into a request-scoped context (e.g., `req.orgId`)
   - All downstream queries use this value

### Phase 2: Query Scoping (Effort: ~3-5 days)

Queries that need `WHERE organization_id = ?` added:

| Category | Files | Pattern |
|----------|-------|---------|
| **User queries** | `server/storage.ts`, `server/repositories/users-repository.ts` | All user list/search queries |
| **Project queries** | `server/storage.ts`, `server/routes.ts`, `server/smart-import-routes.ts` | Project list, project lookup by name |
| **Client queries** | `server/routes.ts`, `server/storage.ts` | Client list, client create |
| **Portfolio queries** | `server/portfolio-routes.ts` | Portfolio CRUD |
| **Counterparty queries** | `server/subcontractor-routes.ts`, `server/invoice-pattern-routes.ts` | Counterparty list, match, merge |
| **Template queries** | `server/eng-stage-routes.ts`, `server/routes.ts` | Template CRUD, template apply |
| **Settings queries** | `server/routes.ts`, `server/admin-recovery-routes.ts` | Settings read/write |
| **Role queries** | `server/routes.ts` | Role credential management |

### Phase 3: Cascade to Child Tables (Effort: ~2-3 days)

Child tables that inherit organization scope through FK relationships (don't need their own `organization_id` — they're scoped via their parent):

- `work_items` → scoped via `project_id` → `project_info.organization_id`
- `normalized_cost_lines` / `normalized_revenue_lines` → scoped via `project_name` / `project_id`
- `program_expense` / `program_inflows` → scoped via `project_name`
- `cashflow_points` / `finance_revenue_monthly` / `finance_cos_monthly` → scoped via `project_name`
- `qc_checklist_items` → scoped via `qc_template_id` → `qc_template.organization_id`
- `eng_task_templates` / `eng_deliverable_templates` → scoped via `stage_template_id`

For these, organization scoping is enforced by always filtering through the parent table's organization_id.

### Phase 4: Admin & Cross-Org Features (Effort: ~1-2 days)

- Super-admin role that can see all organizations
- Organization switching UI
- Organization management CRUD
- Cross-org reporting (if needed)

## Middleware Enforcement Strategy

```
Request → requireAuth → requireOrgScope → route handler
                          ↓
                    req.orgId = user.organizationId
                          ↓
                    All queries include:
                    WHERE organization_id = req.orgId
```

**Key principle**: Organization scoping is enforced at the middleware layer, not at the query layer. Individual route handlers don't need to know about multi-tenancy — the middleware injects the scope automatically.

## Estimated Total Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Auth Pipeline | ~2 days | Low — additive changes only |
| Phase 2: Query Scoping | ~3-5 days | Medium — many query touchpoints |
| Phase 3: Cascade Scoping | ~2-3 days | Low — leverages FK relationships |
| Phase 4: Admin Features | ~1-2 days | Low — new functionality |
| **Total** | **~8-12 days** | |

## Rollback

Run `migrations/20260334_organizations_multi_tenancy_rollback.sql` to:
1. Drop `organization_id` from all 10 tables
2. Drop `organizations` table
3. Remove related indexes

No data loss — the column is metadata only and all existing rows use the default value.
