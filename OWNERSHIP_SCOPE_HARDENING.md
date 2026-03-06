# Ownership Scope Hardening

## Overview

Backend ownership scoping has been implemented to ensure that users only see data they are authorised to access. Previously, all authenticated users received the full dataset, with the frontend filtering results based on the logged-in user's role. This created a data leakage risk where direct API consumers could access all records.

## Scope Rules

### Full Oversight Roles
The following roles receive unfiltered access to all records:
- `ADMIN`
- `COO`
- `CEO`
- `CCO`
- `CFO`
- `PM` (Project Manager — headquarters level)
- `FINANCE_PM`
- `ACCOUNTANT`

These roles require cross-project visibility to perform their management, financial, or executive functions.

### Operational Ownership Roles

| Role | Scope Rule |
|---|---|
| `PROJECT_MANAGER_SITE` | Sees only projects they own or are assigned to |
| `ENGINEER` / `SENIOR_ENGINEER` | Sees only tasks and projects they are assigned to |
| `PD` (Project Development) | Sees only their own PD tickets |

## Hardened Endpoints

### GET /api/projects-summary
- Added ownership metadata to response (owner, assigned users)
- Added `scope=owned` query parameter support
- When a `PROJECT_MANAGER_SITE` user calls this endpoint, results are automatically filtered to projects where they are the owner or an assigned team member
- Full oversight roles receive the complete project list

### GET /api/tasks
- Non-management roles are now scoped to tasks where they are the assignee or project owner
- Full oversight roles receive all tasks
- Engineers receive only their directly assigned tasks
- Site PMs receive tasks from their owned/assigned projects

### GET /api/my-work/all-tasks
- Already strictly user-scoped (returns only the authenticated user's tasks)
- No changes required — confirmed as correctly implemented
- This endpoint serves the "My Work" view and has always been user-specific

### GET /api/pd/tickets
- PD users now see only their own tickets
- Management roles with full oversight see all PD tickets
- Prevents PD staff from viewing other PD team members' pipeline

## Implementation Pattern

```
// Pseudocode for ownership scoping
if (userHasFullOversight(user.role)) {
  return allRecords;
} else if (user.role === 'PROJECT_MANAGER_SITE') {
  return records.filter(r => r.ownerId === user.id || r.assignedTo.includes(user.id));
} else if (isEngineerRole(user.role)) {
  return records.filter(r => r.assignedTo.includes(user.id));
} else if (user.role === 'PD') {
  return records.filter(r => r.createdBy === user.id);
}
```

## Known Limitations

| Limitation | Description | Risk Level |
|---|---|---|
| Project-specific read endpoints | Endpoints under `/api/projects/:id/engineering`, `/api/projects/:id/quality`, etc. still rely on frontend context filtering rather than backend scoping | Medium — mitigated by the fact that users need to know the project ID, and project list is already scoped |
| Cross-project task visibility | Some task aggregation endpoints may include tasks from projects outside a user's scope if accessed by direct API call | Low — primary task endpoints are hardened |
| Historical data | Ownership changes (e.g., project reassignment) apply prospectively; historical data access follows current ownership | Low |

## Verification

To verify ownership scoping is working correctly:
1. Log in as a `PROJECT_MANAGER_SITE` user
2. Call `GET /api/projects-summary` — should return only owned/assigned projects
3. Call `GET /api/tasks` — should return only tasks from owned/assigned projects
4. Compare with an `ADMIN` user who should see all records
