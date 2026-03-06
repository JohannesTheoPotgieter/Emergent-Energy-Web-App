# Roles & Permissions QA Matrix

## Test Environment
- Application: Emergent Energy Dashboard
- Date: 2026-03-06
- Tester: Automated + Manual Verification

---

## Test Cases

### Navigation Tab (10 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 1 | Navigation tab renders all 7 display sections | My Work, PD, Engineering, Quality, PM, Finance, System visible | PASS |
| 2 | Each section shows page list | Page badges rendered under each section | PASS |
| 3 | Toggle section off | Section shows inactive state, "Active" badge removed | PASS |
| 4 | Toggle section on | Section shows active state, "Active" badge appears | PASS |
| 5 | System/Admin section shows "Always On" | Cannot toggle off, "Always On" badge shown | PASS |
| 6 | Section toggle creates pending change | Amber dot appears on role in list | PASS |
| 7 | Section toggle groups work (MY_WORK includes COLLABORATION) | Toggling My Work affects both MY_WORK and COLLABORATION sections | PASS |
| 8 | Section toggle groups work (PD includes COCKPIT) | Toggling PD affects both PROJECT_DEVELOPMENT and COCKPIT | PASS |
| 9 | Disabled section shows clear inactive state | Reduced opacity, gray styling | PASS |
| 10 | Section state persists after save | Toggle, save, refresh — state preserved | PASS |

### Capabilities Tab (15 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 11 | All 8 permission categories render | My Work, PD, Engineering, Quality, PM, Finance, Project Detail, System | PASS |
| 12 | Disabled section shows "Section Off" badge | Lock icon + "Section Off" in category header | PASS |
| 13 | Disabled section shows "Enable in Navigation tab" message | Instructional text in disabled section body | PASS |
| 14 | Permission toggles work (V/E/A/O/D) | Click toggles state, visual feedback immediate | PASS |
| 15 | Preset "All" enables all actions for category | All action buttons become active | PASS |
| 16 | Preset "View" enables only view actions | Only V buttons active, others inactive | PASS |
| 17 | Preset "Off" disables all actions | All action buttons inactive | PASS |
| 18 | Backend-enforced entities show "BE" badge | Green badge with server icon visible | PASS |
| 19 | High-risk actions (delete, override) show ring highlight when active | Red ring around active delete/override buttons | PASS |
| 20 | Permission search filters entities | Type in search, only matching entities shown | PASS |
| 21 | Permission search hides empty categories | Categories with no matching entities hidden | PASS |
| 22 | Entity count badge updates correctly | Shows X/Y count matching enabled entities | PASS |
| 23 | Changes create pending state | Amber dot on role, save button appears | PASS |
| 24 | Save persists permission changes | Save, refresh, verify state preserved | PASS |
| 25 | Discard removes pending changes | Click discard, state reverts to saved | PASS |

### Scope & Limits Tab (8 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 26 | Scope tiers display correctly | 4 tiers shown: Full Oversight, Owned, Assigned, Own Records | PASS |
| 27 | Current role's tier highlighted | Green border + "Current Role" badge on matching tier | PASS |
| 28 | CEO_ADMIN highlights "Full Oversight" | Correct tier highlighted | PASS |
| 29 | PROJECT_MANAGER_SITE highlights "Owned Projects" | Correct tier highlighted | PASS |
| 30 | ENGINEER highlights "Assigned Only" | Correct tier highlighted | PASS |
| 31 | PROJECT_DEVELOPER highlights "Own Records" | Correct tier highlighted | PASS |
| 32 | Backend scope rules display | 6 scope rules shown with endpoint, scope, affected roles | PASS |
| 33 | All scope rules show "backend" enforcement badge | Green badge on every rule | PASS |

### Enforcement & Risks Tab (10 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 34 | Enforcement stats load from API | 4 stat cards with counts | PASS |
| 35 | Backend-enforced route count matches API | Shows correct count from control center API | PASS |
| 36 | High-risk permissions section shows for roles with delete/override | Lists all enabled high-risk perms | PASS |
| 37 | High-risk permissions empty for low-risk roles | Shows green checkmark + "no high-risk" message | PASS |
| 38 | Backend-enforced features listed correctly | Green badges for entities with backend enforcement | PASS |
| 39 | UI-only features listed correctly | Amber badges for entities without backend enforcement | PASS |
| 40 | Known limitations section renders | 4 known limitations displayed | PASS |
| 41 | Enforcement truth banner shown | Amber info banner explains the panel's purpose | PASS |
| 42 | API failure handled gracefully | Loading spinner shown, no crash on error | PASS |
| 43 | Denial count displays (or 0) | Shows recent access denials from last 7 days | PASS |

### Role Management (12 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 44 | Role list renders with search | Search input + role list visible | PASS |
| 45 | Role search filters roles | Type to filter, matching roles shown | PASS |
| 46 | System/Custom badges display on role list | System roles show blue "System" badge, others show "Custom" | PASS |
| 47 | Risk indicator shows on high-risk roles | Shield icon on roles with 3+ high-risk perms | PASS |
| 48 | Role summary header shows stats | Section count, editable count, high-risk count | PASS |
| 49 | Compare button opens dialog | Click compare, dialog with role selector appears | PASS |
| 50 | Role comparison shows differences | Select second role, diff table appears | PASS |
| 51 | Role comparison shows identical message | Same-permission roles show "identical" message | PASS |
| 52 | Create role dialog works | Fill fields, create, role appears in list | PASS |
| 53 | Rename role works | Click pencil, type new name, save | PASS |
| 54 | Delete custom role works | Delete button, confirm, role removed | PASS |
| 55 | Save All with multiple changed roles | Changes saved for all modified roles | PASS |

### Regression (10 tests)

| # | Test Case | Expected | Result |
|---|---|---|---|
| 56 | Users tab still functional | Users list, create, role change, password reset all work | PASS |
| 57 | Page access control still works | Non-admin users see "Access Denied" | PASS |
| 58 | Sidebar permission gating still works | Roles without section access don't see sidebar items | PASS |
| 59 | Entity permission gating still works | Backend rejects unauthorized write requests with 403 | PASS |
| 60 | Permission defaults still apply | New/unseeded permissions fall back to ENTITY_PERMISSION_DEFAULTS | PASS |
| 61 | Save changes via PUT /api/roles/:roleKey | API accepts and persists changes | PASS |
| 62 | Sticky save bar still functions | Appears when changes pending, save/discard work | PASS |
| 63 | Dialog modals render correctly | Create role, save all confirm, reset password all render | PASS |
| 64 | Mobile responsiveness maintained | Layout adapts to small screens | PASS |
| 65 | No console errors on page load | Clean browser console | PASS |

---

## Summary

| Category | Tests | Passed | Failed |
|---|---|---|---|
| Navigation Tab | 10 | 10 | 0 |
| Capabilities Tab | 15 | 15 | 0 |
| Scope & Limits Tab | 8 | 8 | 0 |
| Enforcement & Risks Tab | 10 | 10 | 0 |
| Role Management | 12 | 12 | 0 |
| Regression | 10 | 10 | 0 |
| **Total** | **65** | **65** | **0** |
