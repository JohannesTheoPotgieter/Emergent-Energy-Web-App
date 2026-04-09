# QA Hardening + Rollout Gate (Phased UX + Microsoft Integration)

## Scope and constraints
- No destructive DB actions in QA runs (no table drops, no truncation, no migration rewinds).
- No synthetic/fake coverage: each check must be run as an authentic user flow.
- Validate both **feature-flag-off** and **feature-flag-on** by phase.

## Rollout phases and flags
| Phase | Intent | Required flags ON |
|---|---|---|
| Phase 0 | Baseline safety (existing UX) | none |
| Phase 1 | Role-aware UX landing/navigation | `role_aware_ux` |
| Phase 2 | Microsoft context surfaces | `role_aware_ux`, `contextual_ms_surfaces` |
| Phase 3 | Microsoft create actions | `role_aware_ux`, `contextual_ms_surfaces`, `ms_create_action` |
| Phase 4 | Local+synced save | `role_aware_ux`, `contextual_ms_surfaces`, `ms_create_action`, `local_synced_save_flow` |
| Phase 5 | Admin/settings cleanup | `role_aware_ux`, `contextual_ms_surfaces`, `ms_create_action`, `local_synced_save_flow`, `cleaned_admin_visibility` |

## Role matrix (execute each phase for every role)
- COO
- CEO
- PM
- Construction Manager
- Engineer
- Engineering Manager
- Quality Manager
- Finance / CFO / Program Finance
- Project Developer
- Admin

## Required QA areas (mark each as pass/fail/blocked)
1. Role-based landings
2. Role-aware nav relevance
3. Page shell consistency
4. KPI consistency on updated screens
5. Microsoft integration visibility and context
6. Create from Outlook email
7. Create from Teams message/chat
8. Create from SharePoint/OneDrive document
9. Item type selection
10. Project selection behavior
11. Override reason capture
12. Audit log coverage
13. Deliverable send
14. Approval send
15. Canonical save
16. Local synced save / fallback behavior
17. Admin/settings cleanup
18. Mobile behavior
19. Tablet behavior
20. Desktop behavior

## Feature-flag-off stability checks (must pass before phase enablement)
- Confirm all rollout flags OFF and validate baseline role landing/nav/shell/KPI flows.
- Confirm Microsoft create endpoints return non-enabled behavior (no create action exposed).
- Confirm canonical save path still works with local sync flag OFF.
- Confirm admin settings remain available with cleanup flag OFF.

## Go / no-go gate criteria
- Go only if all required flags for the phase are ON.
- Go only if all required role x area checks are PASS for that phase.
- Any FAIL/BLOCKED/NOT TESTED in required checks = no-go.
- Any open Sev-1/Sev-2 defect in changed flows = no-go.

## Progressive enablement recommendation
1. Internal admin-only cohort (24 hours) on Phase 1.
2. PM + Engineering Manager cohort (48 hours) on Phase 2.
3. Engineer + Construction Manager + Quality Manager cohort (48 hours) on Phase 3.
4. Finance/CFO/Program Finance + Project Developer cohort (48 hours) on Phase 4.
5. COO + CEO executive cohort (24 hours) on Phase 5.
6. Full org enablement only after two stable business days with no Sev-1/2 regressions.

## Evidence to capture for each phase
- Flag snapshot from control-center before/after.
- Screenshots of role landing and nav for each role cohort.
- API evidence for create actions, approval send, deliverable send.
- Audit-event evidence for override reason capture and create/send actions.
- Mobile/tablet/desktop responsiveness evidence.

## Remaining blockers / ambiguity log template
| ID | Area | Role | Phase | Blocker or ambiguity | Owner | Target date | Status |
|---|---|---|---|---|---|---|---|
| B-001 | Example: project selection behavior | Engineer | Phase 3 | Multiple similarly named projects produce ambiguous selection copy | Product + Eng | YYYY-MM-DD | Open |
