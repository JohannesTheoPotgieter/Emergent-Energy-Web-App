# Section 5: Proposed Ideal Spine (Full-Stack Layer Diagram)

## 5.1 Data Layer — Ideal Entity Hierarchy

### Layer 0 — Foundation (No Dependencies)

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| `users` | Identity & authentication | id, username, email, password_hash, name, department, microsoft_id |
| `clients` | Client organizations | id, client_key, name, created_by (FK users) |
| `qc_template` | QC template definitions | id, name, version, is_active |
| `eng_stage_templates` | Engineering stage definitions | id, name, purpose, sort_order |
| `phase_template` | Lifecycle phase templates | id, phase, name, version |
| `calendar_holiday` | Holiday calendar | id, date, name, country_code |
| `app_settings` | Global configuration | id, key, value |
| `role_definitions` | Role permission matrices | id, role_key, label, entity_permissions (JSONB) |
| `counterparties` | Suppliers/contractors | id, name, type, contact_info |

### Layer 1 — Core Entities (Depend on Layer 0 only)

| Entity | Purpose | Dependencies |
|--------|---------|-------------|
| `project_info` | **Single project root** | `users` (pm, pd), `clients` |
| `portfolios` | Portfolio groupings | `users` (created_by) |
| `scenarios` | What-if scenarios | `users` (created_by) |
| `company_projects` | Company-level lifecycle view | — (linked by project_name to project_info) |
| `pd_tickets` | Development tickets | `clients`, `project_info`, `users` |
| `standup_schedules` | Standup definitions | — |

### Layer 2 — Domain Data (Depend on Layers 0-1)

| Entity | Purpose | Dependencies |
|--------|---------|-------------|
| `normalized_cost_lines` | **Single source** for all expenditure | `project_info`, `counterparties`, `import_runs` |
| `normalized_revenue_lines` | **Single source** for all revenue | `project_info`, `import_runs` |
| `work_items` | **Single source** for all tasks/work | `project_info`, `users` |
| `deliverables` | Engineering deliverables | `project_info`, `users` |
| `qc_checklist` | QC instance per project | `project_info`, `qc_template` |
| `project_eng_stages` | Engineering stage instances | `project_info`, `eng_stage_templates` |
| `project_plan` | Imported Gantt data | `project_info` |
| `cashflow_points` | Weekly time-series | `project_info` |
| `entity_assignments` | Universal assignment | `project_info`, `users`, `counterparties` |
| `notifications` | User notifications | `users` |
| `approvals` | Approval workflow | `project_info`, `users` |
| `project_portfolio_assignments` | Portfolio membership | `portfolios`, `project_info` |

### Layer 3 — Detail/Override Data (Depend on Layers 0-2)

| Entity | Purpose | Dependencies |
|--------|---------|-------------|
| `cost_line_overrides` | User edits on cost lines | `normalized_cost_lines` (FK) |
| `revenue_line_overrides` | User edits on revenue lines | `normalized_revenue_lines` (FK) |
| `work_item_assignments` | Task assignees | `work_items`, `users` |
| `work_item_dependencies` | Task DAG | `work_items` |
| `work_item_comments` | Discussion | `work_items`, `users` |
| `work_item_attachments` | Files | `work_items`, `users` |
| `qc_item_instance` | Checklist item status | `qc_checklist`, `qc_template_item` |
| `project_eng_tasks` | Engineering task instances | `project_eng_stages` |
| `deliverable_versions` | Version history | `deliverables` |
| `project_plan_overrides` | Plan edits | `project_plan` (should be FK) |
| `cashflow_overrides` | Cashflow edits | `project_info` (by FK, not text) |
| `mytool_tasks` | Personal task layer | `users` |
| `meeting_summaries` | Meeting records | — |

### Layer 4 — Audit/Events (Terminal — no dependents)

| Entity | Purpose | Dependencies |
|--------|---------|-------------|
| `audit_events` | Global audit log | `users` |
| `work_item_status_history` | Status change log | `work_items` |
| `project_phase_history` | Phase change log | `project_info`, `users` |
| `deliverable_events` | Deliverable status log | `deliverables` |
| `import_diff_events` | Import change detection | `import_runs` |
| `permission_audit_log` | Permission changes | `users` |
| `error_logs` | Error tracking | `users` |

## 5.2 API Layer — Ideal Structure

### Principle: One domain, one router, one service, shaped responses

```
/api/v2/
├── auth/
│   ├── POST   login
│   ├── POST   logout
│   ├── GET    me                    → { user, permissions, role }
│   └── GET    status
│
├── projects/
│   ├── GET    /                     → ProjectSummary[]
│   ├── POST   /                     → Create project
│   ├── GET    /:id                  → ProjectDetail (overview + metadata)
│   ├── PATCH  /:id                  → Update project fields
│   ├── GET    /:id/finance          → { costSummary, revenueSummary, cashflow, cosBreakdown }
│   ├── GET    /:id/plan             → { tasks[], dependencies[], milestones[], overrides[] }
│   ├── GET    /:id/quality          → { checklist, items[], warnings[], evidence[] }
│   ├── GET    /:id/engineering      → { stages[], tasks[], deliverables[] }
│   ├── GET    /:id/work-items       → WorkItem[] (unified — replaces operational_tasks, eng_tasks)
│   ├── POST   /:id/work-items       → Create work item
│   ├── PATCH  /:id/work-items/:wid  → Update work item
│   ├── GET    /:id/deliverables     → Deliverable[]
│   ├── GET    /:id/timeline         → Event[]  (audit + phase history merged)
│   ├── GET    /:id/team             → TeamMember[]
│   └── PATCH  /:id/phase            → Phase transition (with validation)
│
├── finance/
│   ├── GET    /dashboard            → Program-level finance summary
│   ├── GET    /cashflow             → Weekly cashflow (all projects)
│   ├── GET    /cos                  → COS tracker (all projects)
│   ├── GET    /revenue-tracker      → Revenue tracker
│   ├── GET    /gp-tracker           → GP tracker
│   ├── PATCH  /overrides            → Apply financial override
│   └── GET    /fye                  → FYE tracking
│
├── tasks/
│   ├── GET    /my-work              → Tasks assigned to current user (across all types)
│   ├── GET    /board                → Task management board view
│   └── PATCH  /:id                  → Update any task (routed by type internally)
│
├── pd/
│   ├── GET    /dashboard            → PD metrics
│   ├── GET    /tickets              → PdTicket[]
│   ├── POST   /tickets              → Create ticket
│   ├── GET    /tickets/:id          → Ticket detail
│   └── POST   /tickets/:id/handover → Trigger handover
│
├── quality/
│   ├── GET    /dashboard            → QM overview
│   └── PATCH  /items/:id            → Update QC item
│
├── admin/
│   ├── GET    /users                → User management
│   ├── PATCH  /users/:id/role       → Change role
│   ├── GET    /audit                → Audit log
│   ├── POST   /import               → Trigger import
│   └── GET    /import/status        → Import status
│
├── portfolios/
│   ├── GET    /                     → Portfolio[]
│   ├── GET    /:id                  → Portfolio detail + projects
│   └── PATCH  /:id                  → Update portfolio
│
└── lookups/
    ├── GET    /users                → User directory
    ├── GET    /clients              → Client list
    ├── GET    /phases               → Phase definitions
    └── GET    /counterparties       → Counterparty list
```

### Data Contract Principles

1. **One endpoint per view** — no 10-call waterfalls for project detail
2. **Server shapes response** — frontend receives display-ready data, not raw DB rows
3. **Typed contracts** — generate TypeScript interfaces from Zod schemas
4. **Aggregations server-side** — totals, metrics, status counts computed in service layer
5. **Permissions embedded** — each response includes `{ data, permissions: { canEdit, canApprove, ... } }`

## 5.3 Frontend Layer — Ideal Structure

### Page → API Mapping

| Page | API Call(s) | State Location |
|------|-------------|---------------|
| `/dashboard` | GET `/api/v2/finance/dashboard` | React Query |
| `/projects` | GET `/api/v2/projects` | React Query |
| `/project/:id` | GET `/api/v2/projects/:id` (single call, server-shaped) | React Query |
| `/project/:id` + Finance tab | GET `/api/v2/projects/:id/finance` | React Query (lazy) |
| `/project/:id` + Plan tab | GET `/api/v2/projects/:id/plan` | React Query (lazy) |
| `/cashflow` | GET `/api/v2/finance/cashflow` | React Query |
| `/my-work` | GET `/api/v2/tasks/my-work` | React Query |
| `/engineering` | GET `/api/v2/projects/:id/engineering` | React Query |
| `/quality` | GET `/api/v2/quality/dashboard` | React Query |

### Component Data Flow

```
Page
 ├── useQuery() → server data (read-only display)
 ├── useMutation() → server writes (always via mutation hook)
 └── Children receive data via props (never re-fetch)
      ├── Display components: pure, receive shaped data
      └── Form components: receive initial values + onSubmit callback
```

### State Ownership

| State Type | Owner | Mechanism |
|-----------|-------|-----------|
| Server data | React Query cache | `useQuery` / `useMutation` with invalidation |
| Auth | `AuthProvider` context | Single fetch on mount, refresh on login/logout |
| UI state | Local component state | `useState`, `useReducer` |
| Route state | Wouter | URL path + query params |
| Theme | localStorage + CSS vars | `useTheme` hook |
| Permissions | Server response (per-endpoint) | Included in API response, not computed client-side |

### Write Ownership

| Component Type | Writes? | Pattern |
|---------------|---------|---------|
| Page components | Yes — owns mutations | `useMutation` → API → invalidate queries |
| Tab components | Yes — for their domain | `useMutation` with scoped invalidation |
| Display components | No | Read-only |
| Form components | No — fires callback | `onSubmit(data)` → parent handles mutation |
| Layout components | No | Read-only (except theme toggle) |
