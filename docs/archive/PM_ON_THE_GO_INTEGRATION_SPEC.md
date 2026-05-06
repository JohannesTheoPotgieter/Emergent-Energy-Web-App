# PM On The Go Integration Spec — V1.2

## Overview
PM On The Go has been enhanced with three new mobile action cards that bring procurement, commissioning, and approval workflows to the field.

## New Action Cards

### 1. Add Procurement (`add_procurement`)
- **Icon**: CreditCard (violet)
- **Fields**: Title (required), Description, Category (SearchableSelect: material/equipment/service/subcontract/other), Expected Cost, Required Date
- **Endpoint**: `POST /api/procurement` with `projectId` in body
- **Auth**: Bearer token from localStorage
- **Behaviour**: Creates procurement item in `requested` status

### 2. Update Commissioning (`update_commissioning`)
- **Icon**: ClipboardCheck (cyan)
- **Fields**: Fetches existing commissioning items, shows status badges, each item has SearchableSelect for status update
- **Endpoint**: `GET /api/commissioning/project/:projectId` (read), `PATCH /api/commissioning/:itemId` (update)
- **Auth**: Bearer token from localStorage
- **Behaviour**: Inline status updates with save button per item

### 3. Review Approvals (`review_approvals`)
- **Icon**: ThumbsUp (lime)
- **Fields**: Lists pending approvals filtered to current project, each with approve/reject buttons
- **Endpoint**: `GET /api/approvals/pending` (read), `PATCH /api/approvals/general/:id` or engineering-specific endpoints (action)
- **Auth**: Bearer token from localStorage
- **Behaviour**: Approve or reject directly from mobile, same permissions as desktop

## Data Consistency
All mobile actions use the same:
- Database tables as desktop
- Permission middleware
- Audit logging
- Status transition validation

## File Changes
- `client/src/pages/pm-on-the-go-project.tsx` — Extended ActionType union, ACTION_CONFIG array, and ActionDialog switch with three new form components
