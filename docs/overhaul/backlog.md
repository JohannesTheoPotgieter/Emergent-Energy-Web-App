# Overhaul Backlog

**Rolling register of things discovered during the overhaul that are out of scope for the pass that found them.**

Add entries as they're discovered. Do not fix them in the pass — that's the whole point. Review and prioritise these after the overhaul completes (or after each Phase if batches accumulate).

Columns:

- **Found in**: Phase / artefact that surfaced the item
- **Severity**: `S1` (breaks user flow or data trust), `S2` (user-visible rough edge), `S3` (internal / maintenance), `S4` (nice-to-have)
- **Touches**: domain(s) impacted
- **Proposed action**: what to do about it — not a commitment, an option

---

## Phase 0 — discovery surface area

| # | Item | Found in | Severity | Touches | Proposed action |
|---|---|---|---|---|---|
| 1 | **HSL drift on brand primary.** `--primary: 145 72% 32%` (`index.css:64`) and `--sidebar-primary: 142 76% 36%` + animation colour `142 76% 36%` diverge. Brand hex `#16A34A` is the rendered canonical. | 00-inventory §1.3 | S3 | Design tokens | Unify during Phase 1 tokens.ts. Sign-off required before re-rendering. |
| 2 | **Duplicate `StatusBadge`** component: root `client/src/components/StatusBadge.tsx` + `client/src/components/ui/status-badge.tsx`. | 00-inventory §5.2 | S3 | Design system | Phase 1 design-system doc records canonical. Phase 3 migrates call-sites per-screen. Do not delete the root wrapper until all call-sites migrate. |
| 3 | **Hand-rolled `RAGBadge`** at `client/src/components/reports/RAGBadge.tsx:7-11` duplicates `RagBadge()` from `ui/status-badge.tsx`. | 00-inventory §5.2 | S3 | Design system | Same migration plan as #2. |
| 4 | **Decorative "energy-*" CSS** in `client/src/index.css:720-790` (energy-flow, energy-glow-border, energy-progress-bar, renewable-badge). Conflicts with prompt's "professional, clean, no decoration" brief. | 00-inventory §5.2 | S3 | Visual | Phase 1 audits which primitives reference these; Phase 3 migrates off them per-screen. Do NOT mass-remove — tied to existing call-sites. |
| 5 | **No shared data-fetching layer.** ~99 inline `useQuery` / `useMutation` call-sites across `client/src/components/`. | 00-inventory §5.2 | S3 | Frontend architecture | Phase 1 builds `useEntity` / `useEntityList` data-access primitives. Phase 3 migrates opt-in per-screen. |
| 6 | **Dual-mount legacy routes**: `server/engineering-routes.ts` (3607 lines) + `server/routes/engineering.routes.ts`; `server/quality-routes.ts` (2500 lines) + `server/routes/quality.routes.ts`; `server/microsoft-integration-enhancements-routes.ts` + `server/routes/microsoft.routes.ts`. | 00b §C | S2 | Server | Per-endpoint audit per domain. Unmount legacy handler-by-handler after confirming new-style equivalent. Additive-only rule means do not unmount in Phase 1–3 without sign-off. |
| 7 | **`server/analytics-routes.ts`** appears unmounted in `registerLegacyRoutes`. Likely dead. | 00b §C | S3 | Server | Confirm dead before removing. Removal is destructive — needs explicit approval. |
| 8 | **`commissioning-routes.ts` + `commissioning-dashboard-routes.ts`** still mount handlers although canonical commissioning now in `routes/quality.routes.ts`. | 00b §C | S3 | Server | Same audit pattern as #6. |
| 9 | **`resolveInflowEffectiveDates()` hybrid** reads legacy `operational_tasks` + `normalized_plan_tasks` at `server/lib/cashflow-helpers.ts:38`. | 00c §3 obs 1 | S2 | Finance / canonical migration | Priority 1 migration per 00c §4. Fold task-link logic into `normalized_revenue_lines` extension or `project_execution_state.financialReviewId`. |
| 10 | **Archive legacy `program_expense` + `program_inflows`** tables after 30-day post-cutover window (target 2026-05-21). | 00c §4 item 2 | S3 | Finance schema | Requires additive-only migration. Keep migrations + comments for audit trail. |
| 11 | **Cash-flow computation duplicated** across `server/lib/calculations/cashflow.ts` and `server/lib/cashflow-helpers.ts`. | 00c §4 item 3 | S3 | Finance internals | Consolidate per-function during Phase 2–3 cashflow work. |
| 12 | **`mytool_tasks`** table audit + retirement after 90-day observation. | 00c §4 item 10 | S3 | Tasks schema | Additive-only archive. |
| 13 | **Legacy `my_tool` permission-entity key** still used despite UX renamed to "My Work". Entity keys are DB-persisted — do not rename in place. | 00-inventory §5.3 obs 10 | S3 | RBAC | If rename ever wanted, requires runtime migration on `role_permissions` rows. Out of scope for overhaul. |
| 14 | **Handover Health Score** UI renders without backing endpoint (`client/src/pages/handover-control.tsx:77-78`). | 00b §A | S2 | Handover | Flagged as top-5 "finish it" candidate — belongs in Phase 2 plan, not backlog. Kept here as reference link. |
| 15 | **Dashboards for entities using permission-entity defaults that didn't surface cleanly** (`pm_dashboard`, `pm_on_the_go`). | 00-inventory §4.2 | S3 | RBAC audit | Direct lookup in `ENTITY_PERMISSION_DEFAULTS` needed before Phase 2 touches these pages. |
| 16 | **`PROJECT_DEVELOPER` has `stage_lifecycle` edit right** — atypical for a sales-stage role. | 00-inventory §4.3 | S3 | RBAC product-confirmation | Confirm with product owner in Phase 2 whether intentional. |
| 17 | **`ACCOUNTANT` can view `execution_board` but not edit** — noted because it's the only delivery-heavy entity where Accountant has read-only. | 00-inventory §4.3 | S4 | RBAC product-confirmation | Confirm intentional. |
| 18 | **`KEY_ACCOUNTS_MANAGER` view-only on portfolios** despite "account" in title. | 00-inventory §4.3 | S4 | RBAC product-confirmation | Confirm intentional. |
| 19 | **Duplicate page-chrome primitives.** `client/src/components/layout/page-shell.tsx` (`PageShell` + `SectionHeader`, used by 52 pages) overlaps with Phase-1 `client/src/components/layout/PageLayout.tsx` (`PageLayout` + `PageHeader`, used by F-002). Long-term consolidation is a design decision + thoughtful migration. | 03-progress §2.0a | S3 | Design system | Decide on canonical; migrate remaining callers to the winner. Not in current overhaul scope. |

---

## Rules for adding entries

- Add to this file the moment you discover the item, not later.
- Give it a severity and one-line proposed action — enough for someone to triage without re-discovering.
- Cite file:line. Future-you will need it.
- **Do not close an entry by deleting it** — mark it `[resolved in <commit>]` so the history of decisions stays visible.
- No scope creep: if an item belongs in a current phase plan (e.g. the top-5 "finish it" candidates), link to it but keep it outside this backlog.

---

**End of `backlog.md`.**
