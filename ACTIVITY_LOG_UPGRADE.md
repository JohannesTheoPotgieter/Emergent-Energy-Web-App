# Activity Log Upgrade Specification

## Overview
The System Activity Log has been upgraded with enhanced filtering, search, and export capabilities to support operational investigation by administrators.

## Changes

### Backend (`server/audit-routes.ts`)

#### Enhanced Filters
- **User filter**: New `userName` query parameter filters by `user_name` column
- **Action filter**: Pre-existing, now exposed with dedicated dropdown
- **Date range**: Pre-existing `from`/`to` parameters, now with dedicated UI
- **Source**: Pre-existing filter

#### Expanded Search
Search now covers 5 fields (previously 3):
1. Summary text
2. Action
3. Entity type
4. **User name** (new)
5. **Project name** (new)

#### CSV Export
- **Endpoint**: `GET /api/audit/activity-log/export`
- **Auth**: requireAuth + requireAdmin
- **Format**: CSV with headers
- **Columns**: Time, Source, Action, Entity Type, Entity ID, Project, User, Role, Summary, Record Type
- **Limit**: 10,000 rows maximum
- **Respects all filters**: Same query parameters as the main activity-log endpoint

#### Filter Data
The `/api/audit/activity-log` endpoint now returns additional filter options:
- `userNames`: Distinct user names across audit events and change sets

### Frontend (`client/src/pages/system-activity-log.tsx`)

#### New Filter Controls
| Filter | Component | Test ID |
|---|---|---|
| User | SearchableSelect dropdown | `select-activity-user` |
| Action | SearchableSelect dropdown | `select-activity-action` |
| From Date | Date input | `input-activity-from-date` |
| To Date | Date input | `input-activity-to-date` |
| Clear Filters | Button with active count | `button-clear-filters` |

#### Export
| Feature | Component | Test ID |
|---|---|---|
| Export CSV | Button with loading state | `button-export-csv` |

#### Table Improvements
- Added dedicated **User** column showing the actor's name
- Improved filter layout: two rows (dropdowns + date range)
- Tighter spacing for better investigation usability

## Usage Scenarios

### Investigating a Specific User's Actions
1. Select the user from the User dropdown
2. Optionally narrow by date range
3. Review the filtered activity log
4. Click "View" on any entry for detailed changes

### Exporting for Audit
1. Apply desired filters
2. Click "Export CSV"
3. File downloads with filtered results (up to 10,000 rows)

### Finding a Specific Change
1. Type in the search box (searches across summary, action, entity, user, project)
2. Review matching results
3. Use the detail dialog for granular field-level diffs
