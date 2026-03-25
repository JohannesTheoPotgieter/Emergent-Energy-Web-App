# Architecture

## System overview
Emergent Energy is a full-stack operations platform for project delivery, finance visibility, quality, engineering, and governance workflows.

- Frontend: React + TypeScript
- Backend: Express + TypeScript
- Data: PostgreSQL (Drizzle + SQL migrations)

## Canonical platform spine
The application uses a project-centric spine:

- `project_info` is the canonical project identity table.
- Cross-functional work tracking is centered on `work_items`.
- Assignments are centered on `entity_assignments` / `work_item_assignments`.
- Approval workflows are centered on `approvals`.
- Deliverables are centered on `deliverables`.
- Auditable mutation history is centered on `audit_events`.

## Service and route ownership
Shared project-summary and contract-oriented APIs should flow through shared platform services and route ownership boundaries instead of page-specific joins. Prefer stable `/api/platform/*` contracts for cross-module summary reads.

## Extension guardrails
When adding new capabilities:

1. Attach records to canonical project identity (`project_info.id`).
2. Reuse canonical workflow tables before introducing new structures.
3. Enforce authorization on backend routes.
4. Emit audit events for major state transitions.
5. Keep lifecycle/state normalization aligned to shared mappings.
