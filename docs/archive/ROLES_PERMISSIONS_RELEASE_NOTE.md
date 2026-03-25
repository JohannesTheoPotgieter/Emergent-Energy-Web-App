# Roles & Permissions — Release Note

## Version
UX Rework v1.1 — 2026-03-06

## Summary
The Roles & Permissions screen has been restructured from a single flat list into a 4-tab information architecture that separates navigation access, functional capabilities, scope rules, and enforcement truth. The goal is to make it materially easier for admins to understand what a role can see, what it can do, and how well that is actually enforced.

---

## What's Improved

### 1. Clear Information Hierarchy
The Permissions tab now has 4 sub-tabs:
- **Navigation** — sidebar section access with page listings
- **Capabilities** — entity/action permission matrix with search and presets
- **Scope & Limits** — data visibility rules per role tier
- **Enforcement & Risks** — backend enforcement truth, high-risk permissions, known gaps

### 2. Role Summary & Risk Visibility
- Each role now shows a summary: section count, editable entity count, high-risk permission count
- Roles in the list show System/Custom badges and risk indicators
- High-risk permissions (delete, override) are visually highlighted

### 3. Role Comparison
- New "Compare" feature lets admins select two roles and see every permission difference in a table

### 4. Backend Enforcement Markers
- Entities with backend-enforced middleware now show a green "BE" badge
- Admins can immediately see which permissions have real backend security vs UI-only gating

### 5. Honest Enforcement Disclosure
- The Enforcement tab shows live stats from the permission enforcement API
- High-risk permissions, backend-enforced features, UI-only features, and known limitations are clearly listed
- No pretending — limitations are disclosed explicitly

### 6. Search & Filter
- Role list has search/filter
- Capabilities tab has entity search
- Both improve productivity when configuring permissions

---

## What Still Remains Limited

### 1. Scope Rules Are Not Admin-Configurable
Scope tiers (Full Oversight, Owned, Assigned, Own Records) are determined by the role definition, not by the admin UI. The Scope tab is read-only for reference.

### 2. UI-Only Permission Gating
Some entity permissions only affect UI visibility (hiding buttons, tabs) and do not have dedicated backend middleware. These are clearly marked in the Enforcement tab.

### 3. No Row-Level Security
Database queries do not enforce row-level filtering across all endpoints. Some read endpoints rely on application logic for scoping.

### 4. No Audit Trail for Permission Changes
Changes to role permissions are saved but detailed audit logging (who changed what, when) is not yet implemented.

### 5. No Rate Limiting
API endpoints do not have rate limiting or brute-force protection.

---

## Recommendations for Admin Use Before Go-Live

1. **Review each role using the Navigation tab first** — ensure only appropriate sections are enabled
2. **Check the Enforcement tab for every role** — understand which permissions are backend-enforced vs UI-only
3. **Review high-risk permissions carefully** — delete and override permissions should only be given to roles that truly need them
4. **Use the Compare feature** — compare similar roles (e.g., Engineer vs Site PM) to verify differences are intentional
5. **Check the Scope & Limits tab** — ensure you understand which data each role can see
6. **Save changes per role, not in bulk** — reduces risk of unintended changes
7. **Test with actual user accounts** — log in as different roles after configuration to verify behavior matches expectations

---

## Technical Notes

- No backend changes were required for this UX rework
- The Enforcement tab fetches data from the existing `/api/admin/control-center/permission-enforcement` API endpoint
- All existing save/load functionality is preserved
- The `PERM_CATEGORIES` data structure now includes an `enforcement` field marking backend-enforced entities
- The `ACTION_META` data structure now includes a `risk` level for visual highlighting
