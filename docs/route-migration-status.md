# Route Migration Status

Status of the monolithic `routes.ts` extraction into domain-specific route files.

## Overview

The legacy `server/routes.ts` file contains 187 route handlers that are being progressively extracted into dedicated route files organized by domain.

## Domain Groups and Priorities

| Domain | Priority | Status | Target File |
|--------|----------|--------|-------------|
| MyTool / Personal Tasks | P0 | Extracted | `task-management-routes.ts`, `mytool-routes.ts` |
| Admin / Control Center | P0 | Extracted | `admin-control-routes.ts` |
| Outlook / Microsoft Sync | P1 | Extracted | `ms-sync-routes.ts` |
| Finance / Payments | P1 | Partially extracted | `payment-request-routes.ts`, `financial-review-routes.ts` |
| Engineering | P1 | Extracted | `engineering-routes.ts` |
| Quality | P1 | Extracted | `quality-routes.ts` |
| Project Lifecycle | P1 | Extracted | `lifecycle-routes.ts` |
| Notifications | P1 | Extracted | `notification-routes.ts` |
| Reports | P1 | Extracted | `report-routes.ts` |
| Smart Import | P0 | Extracted | `smart-import-routes.ts` |

## Already-Extracted Route Files

The following route files have been fully extracted from the monolithic `routes.ts`:

- `notification-routes.ts` — Notification CRUD and read-all
- `report-routes.ts` — Report generation and retrieval
- `smart-import-routes.ts` — Smart import upload and processing
- `engineering-routes.ts` — Engineering tasks and deliverables
- `quality-routes.ts` — Quality management and NCRs
- `lifecycle-routes.ts` — Project lifecycle board
- `admin-control-routes.ts` — Admin control center
- `task-management-routes.ts` — Task CRUD operations
- `ms-sync-routes.ts` — Microsoft 365 sync
- `payment-request-routes.ts` — Payment request workflows
- `standup-routes.ts` — Standup schedules and entries

## Migration Process

1. Identify a domain group in `routes.ts`
2. Extract handlers to a new `{domain}-routes.ts` file
3. Register via `register-all-routes.ts`
4. Remove handlers from `routes.ts`
5. Verify no route duplication via `check:routes-migration` script
