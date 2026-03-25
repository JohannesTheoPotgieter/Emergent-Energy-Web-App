# Viewer Management Specification

## Overview
The Viewer Management system allows users to be added as "viewers" to work items (plan tasks). Viewers can see the task on their "My Work" dashboard without being assigned as the primary owner or responsible party. This is a "CC" style tracking mechanism.

## Data Model

### Table: `work_item_assignments`
| Column | Type | Description |
|---|---|---|
| id | SERIAL PK | Auto-increment primary key |
| work_item_id | INTEGER FK | References `work_items.id` (cascade delete) |
| user_id | INTEGER FK | References `users.id` |
| role | ENUM | `OWNER`, `ASSIGNEE`, `REVIEWER`, `VIEWER` |
| allocation_pct | REAL | Optional resource allocation percentage |
| created_at | TIMESTAMP | Assignment creation time |

## API Endpoints

### List Viewers
- **GET** `/api/work-items/:id/viewers`
- **Auth**: requireAuth
- **Response**: Array of viewer assignments with user details (name, username, role)

### Add Viewer
- **POST** `/api/work-items/:id/viewers`
- **Auth**: requireAuth
- **Body**: `{ userId: number }`
- **Idempotent**: Returns success with `alreadyExists: true` if duplicate
- **Audit**: `add_viewer` action logged

### Remove Viewer
- **DELETE** `/api/work-items/:id/viewers/:userId`
- **Auth**: requireAuth
- **Audit**: `remove_viewer` action logged

### Legacy Reassign (backward compatible)
- **PATCH** `/api/tasks/reassign`
- **Body**: `{ taskId, taskSource: "plan_viewer" | "remove_viewer", userId }`
- **Audit**: `add_viewer` / `remove_viewer` actions logged

## Frontend Components

### ViewerManagement
- **Location**: `client/src/pages/my-work-tasks.tsx`
- **Renders**: In `UnifiedTaskDetailDrawer` for plan-source tasks
- **Features**:
  - Lists current viewers as sky-blue chips with eye icon
  - Add viewer via searchable user popover
  - Remove viewer via X button on chip

### Badges
| Badge | Color | Condition |
|---|---|---|
| Viewing | Sky blue (`bg-sky-50 border-sky-200 text-sky-700`) | `_trackingRole === "viewer"` |
| Tracking | Teal (`bg-teal-50 border-teal-200 text-teal-700`) | `_trackingRole === "creator" \|\| "both"` |

### Filters
- "Tracking" source filter includes both creator/tracking and viewer tasks
- Viewer tasks are counted in the tracking tab count

## Access Control
- Viewers have **read-only** access to the task
- Viewers cannot reassign tasks they're only viewing (enforced by `isViewerOnly()` guard)
- All task modification endpoints use `requireAdmin` middleware
- Viewer add/remove operations are audit-logged

## My Work Integration
- Plan tasks where user has VIEWER assignment appear with `trackingRole: "viewer"`
- Tasks are visible in both list and board views
- Viewer tasks contribute to KPI counts (Active, High Priority)
