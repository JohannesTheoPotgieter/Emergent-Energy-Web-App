# Write Authority Model

This document describes how write authority is managed across legacy and promoted data paths in the Emergent Energy platform.

## Overview

The platform uses a dual-path Write Authority model during the migration from legacy spreadsheet-based data to the promoted V2 schema. Each entity has a designated write authority that determines which system is the source of truth for mutations.

## Authority Levels

### Legacy Write Authority

Entities under legacy write authority are still primarily managed through Smart Import from spreadsheets. Direct API writes are restricted to backfill and reconciliation operations.

- **Revenue Lines**: Write authority remains with Smart Import. API mutations are limited to admin corrections.
- **Cost Lines**: Write authority remains with Smart Import. Direct edits require admin override.
- **Project Info**: Partially promoted. Core fields writable via API; financial fields still legacy.

### Promoted Write Authority

Entities under promoted write authority are fully writable via the V2 API. Smart Import serves only as an initial seed or reconciliation tool.

- **Work Items**: Fully promoted. Created and managed via the task management API.
- **QC Checklists**: Fully promoted. Managed via quality module API.
- **Standup Entries**: Fully promoted. Created via standup module API.
- **Approvals**: Fully promoted. Managed via approvals API.

## Deferred Paths

The following write paths are deferred and will be promoted in future phases:

- **Budget Baselines**: Currently seeded via import; direct API write deferred until backfill validation completes.
- **Procurement Items**: Partial API support; bulk import/backfill still uses legacy path.
- **Engineering Designs**: Created via API but bulk operations deferred.
- **Financial Review Snapshots**: Read-only derived data; write path deferred.
- **Invoice Pattern Rules**: Configuration managed via admin; bulk backfill deferred.

## Legacy-Only Fields

The following fields exist only in the legacy schema and are not promoted to V2:

- `patternRuleId` — Invoice pattern matching rule reference (legacy import artifact)
- `sourceSheet` — Original spreadsheet tab name
- `sourceRow` — Original spreadsheet row number
- `amountExVatLegacy` — Pre-migration TEXT amount column (kept for 30-day rollback)
- `vatLegacy` — Pre-migration TEXT VAT column (kept for 30-day rollback)

These fields are preserved for reconciliation and audit but are not exposed in the V2 API.

## Migration Sequence

1. **Phase 1**: Smart Import remains write authority for all financial entities.
2. **Phase 2**: Work items, QC, and standups promoted to API write authority.
3. **Phase 3**: Budget baselines and procurement items promoted.
4. **Phase 4**: Revenue and cost lines promoted (requires reconciliation pack sign-off).

## Reconciliation

Before promoting a legacy entity to API write authority:

1. Run the reconciliation pack to verify row parity.
2. Verify amount parity within tolerance thresholds.
3. Confirm no unresolved bridge failures.
4. Obtain sign-off from finance stakeholder.
