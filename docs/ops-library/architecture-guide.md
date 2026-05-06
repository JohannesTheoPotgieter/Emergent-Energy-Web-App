# Architecture Guide (Active)

## Purpose
Define runtime boundaries, ownership, and non-negotiable integration flow for production-safe operation.

## System boundaries
- **Frontend (`client/`)**: role-aware workflows and stage-specific execution UI.
- **Backend (`server/`)**: API routes, enforcement, workflow orchestration, audit events.
- **Database (`migrations/`, Drizzle schema)**: additive schema evolution, rollback-capable migrations.
- **Integrations**:
  - Pipedrive = CRM source of truth.
  - SharePoint = major document source of truth.
  - Matriarch = O&M handover and downstream operations destination.

## Workflow architecture
1. Project Development establishes pipeline and commercial baseline.
2. Project Management owns execution after formal handover.
3. Compliance/HSE activate only post-handover.
4. Finance realization logic follows payment/invoice events (see Finance Trust Guide).

## Ownership map
- Domain logic: `server/api/`, `server/lib/`.
- Route registration and cutover checks: migration verification scripts in `scripts/` and `server/migration-*.ts`.
- Database truth: SQL migrations under `migrations/` with rollback pairs where applicable.

## Change control
- No destructive schema operations in production without approved migration path + rollback.
- Require route parity and permission parity checks before go-live.
- Treat historical rollout prompts as reference only, never as executable runbook.
