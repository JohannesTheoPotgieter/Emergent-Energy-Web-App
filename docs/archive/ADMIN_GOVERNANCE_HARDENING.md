# Admin Governance Hardening

## Overview

The Admin Control Center has been enhanced with a **Permission Enforcement Coverage** card that provides real-time visibility into the security posture of the application's API routes. This complements the existing Operational Exceptions card from the prior session.

## Permission Enforcement Coverage Card

### Metrics Displayed

| Metric | Value | Description |
|---|---|---|
| Backend-Enforced Routes | 42 | Routes with `requirePermission` or `requireAdmin` middleware |
| Ownership-Scoped Endpoints | 4 | Endpoints with backend ownership/role-based data filtering |
| Application-Logic-Only | 2 | Routes using inline role checks rather than middleware (deferred) |
| Recent Access Denials (7d) | Dynamic | Count of 403 responses in the last 7 days |
| Recent Import Issues (7d) | Dynamic | Count of import conflicts/duplicates detected in the last 7 days |

### Expandable Route Tables

The card includes expandable sections showing the full route table, grouped by category:

- **Purchase Order Routes** — 3 routes, `manage_pos` permission
- **Project Development Routes** — 5 routes, `manage_pd` permission
- **Weekly Review Routes** — 2 routes, `manage_reviews` permission
- **Project Routes** — 2 routes, `manage_projects` permission
- **Lifecycle Routes** — 9 routes, `manage_lifecycle` permission
- **Invoice Pattern Routes** — 11 routes, `manage_invoices` permission
- **Subcontractor Routes** — 2 routes, `manage_subcontractors` permission
- **Smart Import Routes** — 7 routes, `manage_imports` permission
- **Settings Routes** — 1 route, `requireAdmin` (admin-only)

Each table row shows: HTTP method, endpoint path, required permission, and enforcement type.

### Permissions Honesty Notice

The admin control center displays an updated honesty notice:

> **Permission Enforcement Status:** 42 of 44 critical write routes are now enforced with backend middleware. 2 routes use application-level inline role checks (engineering task creation, task reassignment). These provide equivalent protection but are not standardised on the middleware pattern. Read endpoints for project-specific views (engineering, quality) still rely on frontend context filtering. Full row-level security (RLS) is not yet implemented.

This notice ensures administrators have an accurate understanding of the current security posture without overstating coverage.

## Operational Exceptions Card

Already present from the prior session, this card displays:
- Active operational exceptions (temporary permission overrides)
- Exception expiry dates
- Granted-by information
- Affected users and routes

## Access Denial Tracking

When a `403 Forbidden` response is returned by the permission middleware, the event is logged with:
- Timestamp
- User ID and role
- Attempted endpoint and method
- Required permission that was missing

The 7-day rolling count is displayed on the coverage card, with drill-down available to see individual denial events.

## Import Issue Tracking

Import conflicts (duplicate detection, fuzzy match conflicts, rerun warnings) are tracked and the 7-day rolling count is displayed. This provides operational visibility into whether the duplicate prevention system is working as expected and whether users are encountering friction.
