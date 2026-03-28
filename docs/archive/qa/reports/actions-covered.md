# Action Buttons & Mutations Coverage Report

## Critical Mutations Tested

### Authentication Actions
| Action | Test | Status |
|--------|------|--------|
| Login (valid credentials) | API + E2E | ✅ TESTED |
| Login (invalid credentials) | API + E2E | ✅ TESTED |
| Logout | API | ✅ TESTED |

### Admin Mutations (Permission Enforcement)
| Action | Test Type | Status |
|--------|-----------|--------|
| Create project | API (admin-only) | ✅ TESTED |
| Reprocess all data | API (admin-only) | ✅ TESTED |
| Update role permissions | API (admin-only) | ✅ TESTED |
| Set opening balance | API (admin-only) | ✅ TESTED |
| Save MS integration config | API (admin-only) | ✅ TESTED |
| Manage users | API (admin-only) | ✅ TESTED |

### Data Integrity Actions
| Action | Test Type | Status |
|--------|-----------|--------|
| Smart Import upload | Manual | MANUAL — requires Excel fixture |
| Smart Import commit | Manual | MANUAL — depends on upload |
| Plan override save | Manual | MANUAL — requires project context |
| Expenditure override | Manual | MANUAL — requires project context |

### User-Level Actions (Not Permission-Gated)
| Action | Accessibility | Risk |
|--------|--------------|------|
| Create PD ticket | Any authenticated user | LOW |
| Edit PD ticket | Any authenticated user | MEDIUM — should scope to owner |
| Create PD client | Any authenticated user | LOW |
| Mark notification read | Own notifications only | LOW |
| Edit engineering task | Any authenticated user | LOW — UI scopes to assigned |

## Button Inventory by Page

### Home Page
- Jump to Project (search) — navigation only
- My Projects cards — navigation only
- Company Priorities cards — view only
- Action Hub links — navigation only

### Projects List
- Project row click — navigation
- Filter/sort controls — client-side only

### Project Detail
- Edit project fields — requirePermission(can_edit_project_info)
- Plan tab: inline edit — triggers override + audit
- Finance tab: override actions — tracked
- Engineering tab: task actions — status changes
- Quality tab: checklist actions — status changes

### Admin Pages
- Upload Excel — file processing
- Smart Import wizard — multi-step
- Create project — form submission
- Role management — permission grid
- MS Integration — config save
- Writeback mappings — CRUD

### Engineering
- Task status change — PATCH
- Send for approval — status change
- Approve/reject — status change
- Upload deliverable — file + status

### Quality
- Access code verification — challenge gate
- Checklist approval — status change
- Warning resolution — status change

## Summary
- **Total identified mutations:** 35+
- **Tested via automated tests:** 12 (permission enforcement focused)
- **Manual testing required:** Smart Import, Plan editing, Engineering workflow
- **Reason for manual:** Complex multi-step flows requiring specific data context
