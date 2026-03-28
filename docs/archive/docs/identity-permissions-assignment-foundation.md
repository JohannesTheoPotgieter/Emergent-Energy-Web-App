# Identity, Permissions, and Assignment Foundation

## Why this exists

Emergent Energy is not using roles for navigation chrome only. Roles and permissions define who may see, edit, assign, approve, and administer operational work across the project spine. Assignments must be durable and auditable across internal users and external counterparties.

## Canonical decisions

### Identity and authority
- `users.id` is the only internal identity for assignment and authority checks.
- `role_permissions` is the authoritative role capability source.
- `authority_model` inside `role_permissions` is the preferred operational authority layer.
- Backend route guards are authoritative. Frontend capability checks are advisory only.
- `COO_ADMIN` and `CEO_ADMIN` retain full cross-platform authority through both legacy and authority-model evaluation.

### Counterparty master data
- `counterparties` is the canonical external organization registry.
- `counterparty_contacts` is the canonical external person registry.
- Counterparty maintenance lives at `/counterparties`.
- Counterparties and contacts may be marked active/inactive without deleting historical usage.

### Canonical assignment model
- `entity_assignments` is the canonical assignment ledger for all supported work entities.
- Assignment identity is always:
  - `assignee_type`
  - `assignee_id`
- Valid `assignee_type` values:
  - `internal_user`
  - `external_counterparty`
  - `external_contact`
- Display text is a snapshot only:
  - `display_label_snapshot` preserves historical readability when names change.
- Legacy owner and approver columns still sync from canonical assignments for compatibility, but new work should read canonical assignments first.

## Shared service ownership

### Authoritative services
- `server/services/assignment-service.ts`
  - Assignable directory
  - Canonical assignment writes
  - Legacy assignment column synchronization
  - Assignment audit events
- `server/permission-middleware.ts`
  - Request-time permission and authority enforcement
  - Permission failure audit logging
- `server/auth-context.ts`
  - Session and bearer token parity
  - Resolved auth user hydration
- `server/invoice-pattern-routes.ts`
  - Counterparty and contact maintenance
- `server/approvals-routes.ts`
  - General approval assignment and approval decision enforcement

### Frontend shared consumers
- `client/src/lib/assignables.ts`
  - Canonical assignable directory fetch
  - Shared assignment selector utilities
- `client/src/components/UserAssignmentPicker.tsx`
  - Shared internal/external assignment UI
- `client/src/pages/counterparties.tsx`
  - Canonical maintenance UI for counterparties and contacts
- `client/src/pages/admin-roles.tsx`
  - Canonical roles and permissions control center UI

## Route ownership

### Assignment routes
- `/api/assignables`
  - Shared mixed directory for internal users, counterparties, and contacts
- `/api/tasks/reassign`
  - Shared mutation entrypoint for operational task-like assignment flows

### Counterparty routes
- `/api/counterparties/summary`
  - Counterparty register summary
- `/api/counterparties`
  - Canonical read-only counterparty directory for shared selectors and legacy consumers
- `/api/counterparties/:id`
  - Counterparty detail with contacts and assignment usage
- `/api/counterparties/:id/contacts`
  - Contact creation
- `/api/counterparties/:id/contacts/:contactId`
  - Contact update

### Permissions routes
- `/api/roles/control-center`
  - Authoritative roles and permissions page payload
- `/api/auth/permissions`
  - Current-user capability payload used by frontend gating

### Approval routes
- `/api/approvals/general`
  - Shared general approval list and create
- `/api/approvals/general/:id`
  - Shared general approval update and decision

## Safe extension rules

- Do not add new assignee text columns for new modules.
- Do not add department-specific counterparty tables.
- Do not add module-specific approval-assignee schemas.
- Do not add local bearer-only auth wrappers around permission routes. Use `server/auth-context.ts`.
- New modules must map into `entity_assignments` using a new `entity_type` value and reuse assignment service helpers.
- New routes must enforce backend authority with `requirePermission`, `requireAuthority`, or service-level authority checks.
- Every assignment mutation and permission failure must be auditable.

## Compatibility notes

- Legacy columns such as `owner_user_id`, `assigned_approver`, and similar fields remain populated for existing pages.
- Existing data continues to resolve because canonical reads fall back to legacy columns when no `entity_assignments` rows exist yet.
- New selectors must prefer `/api/assignables` instead of bespoke user lists.
