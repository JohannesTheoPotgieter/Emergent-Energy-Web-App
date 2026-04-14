# Admin Safety Guide (Active)

## Production safety policy
- No destructive/high-risk action without backup path, rollback path, and explicit approval.
- Prefer additive, reversible, idempotent changes.
- Production behavior and data safety override implementation elegance.

## Pre-change checklist
1. Confirm current git and migration state.
2. Confirm backup/snapshot availability.
3. Confirm rollback SQL or code revert path.
4. Confirm route and permission parity checks.
5. Confirm environment assumptions (dev/prod flags, secrets, integrations).

## High-risk actions (approval required)
- Dropping/renaming tables or columns.
- Bulk data rewrites with irreversible transforms.
- Permission model changes that can expand unauthorized access.
- Integration endpoint or credential cutovers.

## Incident handling
- Freeze risky writes when trust is uncertain.
- Preserve evidence and logs.
- Communicate uncertainty explicitly to operators.
- Recover from source-of-truth systems where possible.
