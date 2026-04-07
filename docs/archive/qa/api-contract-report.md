# API Contract Validation Report

## Endpoint Contract Summary

### Authentication Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/health | ❌ None | ❌ None | N/A | `{status: "ok"}` | ✅ VERIFIED |
| GET /api/auth/status | ❌ None | ❌ None | N/A | `{authenticated: bool}` | ✅ VERIFIED |
| POST /api/auth/login | ❌ None | ❌ None | ✅ 401 on bad creds | `{user: {...}}` | ✅ VERIFIED |
| POST /api/auth/logout | ❌ None | ❌ None | N/A | `{success: true}` | ✅ VERIFIED |
| GET /api/auth/me | ✅ Required | ❌ None | ✅ 401 unauthed | `{id, username, role, ...}` | ✅ VERIFIED |

### Project Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/projects | ✅ | ❌ | ✅ 401 unauthed | `Array<Project>` | ✅ VERIFIED |
| GET /api/projects/:name | ✅ | ❌ | 404 on invalid name | `Project` | ✅ VERIFIED |
| POST /api/projects | ✅ | ✅ Admin | ✅ 403 non-admin | `Project` | ✅ VERIFIED |
| PATCH /api/projects/:name | ✅ | ✅ Permission | Expected | `Project` | DOCUMENTED |
| GET /api/overview | ❌ | ❌ | N/A | `{projects, summary}` | ✅ VERIFIED |

### Finance Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/program/cos | ❌ | ❌ | N/A | `Array<COS>` | ⚠️ NO AUTH |
| GET /api/cashflow-2026 | ✅ | ❌ | ✅ 401 unauthed | `{weeks, summary}` | ✅ VERIFIED |
| POST /api/cashflow-2026/opening-balance | ✅ | ✅ Admin | ✅ 403 non-admin | `{success}` | ✅ VERIFIED |
| GET /api/cos-tracker | ✅ | ❌ | Expected | `{monthly, ytd}` | DOCUMENTED |

### Admin Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/admin/users | ✅ | ✅ Admin | ✅ 403 non-admin | `Array<User>` | ✅ VERIFIED |
| PATCH /api/admin/users/:id/role | ✅ | ✅ Admin | Expected | `{success}` | DOCUMENTED |
| POST /api/reprocess-all | ✅ | ✅ Admin | ✅ 403 non-admin | `{success}` | ✅ VERIFIED |
| GET /api/admin/ms-integration | ✅ | ✅ Admin | ✅ 403 non-admin | `{config}` | ✅ VERIFIED |
| PUT /api/admin/ms-integration/:key | ✅ | ✅ Admin | ✅ 400 invalid key | `{success}` | ✅ VERIFIED |

### Role Management Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/roles | ✅ | ❌ | Expected | `Array<Role>` | ✅ VERIFIED |
| PUT /api/roles/:role | ✅ | ✅ Admin | ✅ 403 non-admin | `{success}` | ✅ VERIFIED |

### EE-Info Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/ee-info/nodes | ✅ | ❌ | Expected | `Array<Node>` | DOCUMENTED |
| GET /api/ee-info/os/lifecycle | ✅ | ❌ | Expected | `{stages}` | DOCUMENTED |
| GET /api/ee-info/os/departments | ✅ | ❌ | Expected | `Array<Dept>` | DOCUMENTED |
| POST /api/ee-info/nodes | ✅ | ✅ COO | Expected | `Node` | DOCUMENTED |
| POST /api/ee-info/os/seed | ✅ | ✅ COO | Expected | `{success}` | DOCUMENTED |

### Smart Import Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| POST /api/smart-import/upload | ✅ | ❌ | Expected (no file) | `{runId, preview}` | DOCUMENTED |
| GET /api/smart-import/:runId | ✅ | ❌ | 404 invalid ID | `ImportRun` | DOCUMENTED |
| POST /api/smart-import/:runId/commit | ✅ | ❌ | Blocked if blockers | `{success}` | DOCUMENTED |

### Portfolio/Dashboard Endpoints

| Endpoint | Auth | Role | Invalid Rejected | Valid Schema | Status |
|----------|------|------|-----------------|--------------|--------|
| GET /api/portfolio-dashboard | ✅ | ❌ | Expected | `{viewMode, data}` | DOCUMENTED |
| GET /api/portfolios | ✅ | ❌ | Expected | `Array<Portfolio>` | DOCUMENTED |
| POST /api/portfolios | ✅ | ✅ Admin | Expected | `Portfolio` | DOCUMENTED |
| GET /api/pm/dashboard | ✅ | ❌ | Expected | `{projects, kpis}` | DOCUMENTED |
| GET /api/home/action-hub | ✅ | ❌ | Expected | `{stats, tasks, ...}` | DOCUMENTED |

## Contract Status Legend
- **✅ VERIFIED:** Tested via automated tests with assertions
- **DOCUMENTED:** Contract documented but tested only via smoke/load tests
- **⚠️ NO AUTH:** Endpoint accessible without authentication (security concern)

## Contract Validation Summary
- **Total endpoints:** 78+
- **Verified (automated tests):** 16 (21%)
- **Documented (contract known):** 50+ (64%)
- **Auth enforcement verified:** 10 endpoints
- **Permission enforcement verified:** 8 endpoints
- **Security concerns:** 1 (GET /api/program/cos lacks auth)
