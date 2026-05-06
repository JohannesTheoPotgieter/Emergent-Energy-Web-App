# Source-of-Truth Guide (Active)

## Canonical sources by domain
- **CRM pipeline and opportunity metadata**: Pipedrive.
- **Document-controlled artifacts**: SharePoint.
- **Execution and operational state**: Emergent Energy application database.
- **O&M downstream handover**: Matriarch.

## Write authority rules
- Data should be written in the owning system first, then synchronized downstream.
- Application-side overrides require explicit reason and audit evidence.
- Unknown provenance values must be marked as uncertain, not silently normalized.

## Conflict resolution order
1. Timestamped authoritative source event.
2. Approved manual override with actor + reason.
3. Escalation to admin safety workflow if conflict persists.

## Required metadata for trust
- Source system identifier.
- Last synced timestamp.
- Last successful sync status.
- Record-level audit trail for manual edits.

## Drift reporting (dev vs prod)
For any release touching data flow, produce a drift report covering:
- Schema and migration level.
- Route registration/cutover.
- Permission model differences.
- Feature flags/environment assumptions.

If production cannot be queried in the same change window, mark drift as **unverified** and block high-risk rollout actions.
