# Roles and Permissions

## Core principles
- Backend authorization is authoritative.
- Frontend visibility checks are advisory UX controls.
- Role capabilities flow from canonical role-permission mappings.

## Canonical identity and assignment
- Internal identity: `users.id`
- Canonical assignment ledger: `entity_assignments`
- Task-oriented assignment surfaces: `work_item_assignments`

Supported assignee types:
- `internal_user`
- `external_counterparty`
- `external_contact`

## Operations rules
- Do not create module-specific assignment schemas when canonical assignment supports the use case.
- Maintain auditable permission failures and assignment mutations.
- Keep compatibility fallback behavior only where legacy consumers still require it.
