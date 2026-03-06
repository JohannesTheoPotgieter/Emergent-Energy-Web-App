# Backend Permission Enforcement Plan

## Overview

42 critical write routes now have backend `requirePermission` / `requireAdmin` middleware enforced at the Express router level. Previously, these routes relied only on `requireAuth` (session-level authentication) with UI-level permission gating — meaning any authenticated user could theoretically invoke these endpoints directly.

## Change Summary

| Category | Route Count | Middleware Applied |
|---|---|---|
| Purchase Order (PO) routes | 3 | `requirePermission` |
| Project Development (PD) routes | 5 | `requirePermission` |
| Weekly Review | 2 | `requirePermission` |
| Project routes | 2 | `requirePermission` |
| Lifecycle transitions | 9 | `requirePermission` |
| Invoice Pattern | 11 | `requirePermission` |
| Subcontractor | 2 | `requirePermission` |
| Smart Import | 12 | `requireAdmin` |
| Settings | 1 | `requireAdmin` |
| **Total** | **47** | |

## Route Details

### Purchase Order Routes (3)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/po/generate` | `manage_pos` |
| PUT | `/api/po/:id` | `manage_pos` |
| DELETE | `/api/po/:id` | `manage_pos` |

### Project Development Routes (5)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/pd/tickets` | `manage_pd` |
| PUT | `/api/pd/tickets/:id` | `manage_pd` |
| DELETE | `/api/pd/tickets/:id` | `manage_pd` |
| PUT | `/api/pd/tickets/:id/status` | `manage_pd` |
| POST | `/api/pd/tickets/:id/notes` | `manage_pd` |

### Weekly Review Routes (2)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/weekly-review` | `manage_reviews` |
| PUT | `/api/weekly-review/:id` | `manage_reviews` |

### Project Routes (2)
| Method | Endpoint | Permission |
|---|---|---|
| PUT | `/api/projects/:id` | `manage_projects` |
| DELETE | `/api/projects/:id` | `manage_projects` |

### Lifecycle Transition Routes (9)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/lifecycle/transition` | `manage_lifecycle` |
| POST | `/api/lifecycle/gate-check` | `manage_lifecycle` |
| PUT | `/api/lifecycle/stage/:id` | `manage_lifecycle` |
| POST | `/api/lifecycle/handover` | `manage_lifecycle` |
| PUT | `/api/lifecycle/handover/:id` | `manage_lifecycle` |
| POST | `/api/lifecycle/post-mortem` | `manage_lifecycle` |
| PUT | `/api/lifecycle/post-mortem/:id` | `manage_lifecycle` |
| POST | `/api/lifecycle/milestone` | `manage_lifecycle` |
| PUT | `/api/lifecycle/milestone/:id` | `manage_lifecycle` |

### Invoice Pattern Routes (11)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/invoice-patterns` | `manage_invoices` |
| PUT | `/api/invoice-patterns/:id` | `manage_invoices` |
| DELETE | `/api/invoice-patterns/:id` | `manage_invoices` |
| POST | `/api/invoice-patterns/:id/line-items` | `manage_invoices` |
| PUT | `/api/invoice-patterns/:id/line-items/:itemId` | `manage_invoices` |
| DELETE | `/api/invoice-patterns/:id/line-items/:itemId` | `manage_invoices` |
| POST | `/api/invoice-patterns/:id/approve` | `manage_invoices` |
| POST | `/api/invoice-patterns/:id/reject` | `manage_invoices` |
| POST | `/api/invoice-patterns/:id/submit` | `manage_invoices` |
| PUT | `/api/invoice-patterns/:id/status` | `manage_invoices` |
| POST | `/api/invoice-patterns/bulk-update` | `manage_invoices` |

### Subcontractor Routes (2)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/subcontractors` | `manage_subcontractors` |
| PUT | `/api/subcontractors/:id` | `manage_subcontractors` |

### Smart Import Routes (12)
| Method | Endpoint | Permission |
|---|---|---|
| POST | `/api/smart-import/upload` | `requireAdmin` |
| PATCH | `/api/smart-import/:runId/project-info` | `requireAdmin` |
| PATCH | `/api/smart-import/:runId/mapping` | `requireAdmin` |
| PATCH | `/api/smart-import/:runId/issue/:issueId/resolve` | `requireAdmin` |
| POST | `/api/smart-import/:runId/ignore-all-blockers` | `requireAdmin` |
| POST | `/api/smart-import/:runId/allow-all` | `requireAdmin` |
| POST | `/api/smart-import/:runId/apply-prior-resolutions` | `requireAdmin` |
| POST | `/api/smart-import/:runId/commit` | `requireAdmin` |
| POST | `/api/smart-import/:runId/rollback` | `requireAdmin` |
| POST | `/api/smart-import/bulk-commit` | `requireAdmin` |
| GET | `/api/smart-import/project-matches/:name` | `requireAdmin` |
| PATCH | `/api/smart-import/:runId/assign-project` | `requireAdmin` |

### Settings Routes (1)
| Method | Endpoint | Permission |
|---|---|---|
| PUT | `/api/settings` | `requireAdmin` (admin-only) |

## Deferred Routes

The following routes were evaluated but deferred from this enforcement pass:

| Route | Current Protection | Reason for Deferral |
|---|---|---|
| Engineering task creation | `requireAuth` + inline role checks | Has application-level role validation that inspects the user's role before allowing creation. Converting to entity-level permissions requires refactoring the inline logic. |
| Task reassignment | `requireAuth` + inline admin check | Contains inline admin verification. Needs alignment with the broader permission model before migrating to middleware. |

## Enforcement Behaviour

- **Unauthorized (no session):** Returns `401 Unauthorized`
- **Forbidden (valid session, insufficient permission):** Returns `403 Forbidden` with descriptive error message
- **Allowed:** Request proceeds to handler

## Prior State

Before this hardening pass, all 42 routes used only `requireAuth`, which verified that a user had a valid session but did not check role-based permissions. Permission enforcement was handled exclusively in the frontend UI (hiding buttons, disabling forms), which could be bypassed by direct API calls.
