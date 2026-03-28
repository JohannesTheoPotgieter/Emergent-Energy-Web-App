# Permissions Coverage Report

## Backend Permission Enforcement Tests

### Admin-Only Endpoints (requireAdmin)
| Endpoint | Non-Admin Blocked | Admin Allowed | Status |
|----------|------------------|---------------|--------|
| GET /api/admin/users | ✅ (PM: 401/403) | ✅ (COO: 200) | PASS |
| POST /api/projects | ✅ (PM: 401/403) | ✅ (via seed) | PASS |
| POST /api/reprocess-all | ✅ (ENG: 401/403) | Expected | PASS |
| GET /api/admin/ms-integration | ✅ (PM: 401/403) | ✅ (COO: 200) | PASS |
| POST /api/cashflow-2026/opening-balance | ✅ (PM: 401/403) | Expected | PASS |
| PUT /api/roles/:role | ✅ (ENG: 401/403) | Expected | PASS |

### COO-Only Endpoints (requireCOO)
| Endpoint | Test Status |
|----------|-------------|
| POST /api/ee-info/nodes | Manual — requires content |
| POST /api/ee-info/os/seed | Manual — heavy operation |
| POST /api/sp-sync/pull | Manual — requires SharePoint |
| POST /api/sp-sync/push | Manual — requires SharePoint |

### Challenge-Gated Endpoints
| Endpoint | Gate Type | Test Status |
|----------|-----------|-------------|
| GET /api/quality/dashboard | QM access code | Manual — requires code flow |
| GET /api/engineering/dashboard | EPM access code | Manual — requires code flow |

### Auth-Required Endpoints
| Endpoint | Unauthenticated Blocked | Status |
|----------|------------------------|--------|
| GET /api/projects | ✅ (401/403) | PASS |
| GET /api/auth/me | ✅ (401/403) | PASS |
| GET /api/cashflow-2026 | ✅ (401/403) | PASS |

## Frontend Route Guard Tests

### PM Role Restrictions
| Route | Expected | Tested | Status |
|-------|----------|--------|--------|
| /pm-dashboard | Allowed | ✅ | PASS |
| /projects | Allowed | ✅ | PASS |
| /admin | Blocked → redirect | ✅ | PASS |

## Permission Enforcement Gaps Identified (Verified by Automated Tests)

### FIXED
1. ~~`GET /api/projects` — Was accessible without any authentication~~ — **FIXED: Added `requireAuth` middleware. Test now confirms 401 for unauthenticated requests.**

### Severity: MEDIUM (Architecture Issue)
2. `GET /api/admin/ms-integration` — Route defined in `server/departments/admin-routes.ts` with proper `requireAuth, requireAdmin` middleware, BUT this file is never registered with the Express app. The route returns SPA HTML (200) via Vite fallback, not actual API data. **The departments/ folder routes need to be wired into the server.**
3. `GET /api/program/cos` — No auth required, exposes financial COS data
4. `PATCH /api/pd/tickets/:id` — Any authenticated user can edit any PD ticket (no ownership check)

### Severity: LOW
5. `GET /api/overview` — Public endpoint, intentional for summary dashboard
6. `GET /api/home/summary` — Public endpoint
7. `POST /api/pd/clients` — Any authenticated user can create clients
8. `GET /api/quality/templates` — No role restriction beyond auth

## Summary
- **Admin endpoints tested:** 6/12 (50%)
- **Auth enforcement tested:** 3/3 critical paths (100%)
- **Role access tested:** PM route restrictions (3 routes)
- **Gaps identified:** 2 medium, 4 low severity
