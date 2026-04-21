# 00b — Half-Built Feature Register

**Phase 0 companion artefact.** Read-only audit. No code modified.

> **Date:** 2026-04-21
> **Source:** Discovery agent pass over `shared/feature-flags.ts`, `client/src/config/page-registry.ts`, `server/routes.ts`, `server/routes/index.ts`, `client/src/pages/**`, and targeted grep for `TODO / FIXME / WIP / coming soon / placeholder / stubbed`.

Scope: things that look partially built — feature-flagged but off, backend wired but frontend incomplete, UI skeleton but no data layer, legacy path still mounted, explicit TODO comments on user-facing flows.

Every entry has an explicit recommendation: **Finish / Leave / Backlog**. Nothing is deleted or removed as a result of this register — it's the input to Phase 2 prioritisation only.

---

## A. Feature flags / explicit stubs (top 15)

Sourced from `shared/feature-flags.ts` (primary flag registry) and targeted grep. Ordered by user-facing impact.

| File : line | What | Status | Recommendation |
|---|---|---|---|
| `shared/feature-flags.ts:254` | `task_management_hub` — unified task board/list/calendar/metrics | Default **OFF**; underlying `/my-work/tasks` surface is feature-complete | **Finish** — high UX value; toggle, QA, enable |
| `shared/feature-flags.ts:328` | `pd_pm_handover_v2` — readiness gating, dual sign-off, lessons-learnt, COO health scoring | Flag gated; 7 related pages built (PdPmHandover, PmHandoverReview, LessonsLearnt, HandoverControl, HandoverDashboard, + aliases) | **Finish** — audit backend dual-sign-off logic, enable flag, production test |
| `client/src/pages/handover-control.tsx:77-78` | Handover Health Score — COO-facing exec enablement dashboard | UI skeleton renders; `/api/pd-pm-handover/control` backing query returns undefined | **Finish** — wire backend endpoint, small scope |
| `shared/feature-flags.ts:340` (smart_import_qb_precedence region) | Smart Import defers to QB on invoice fields when QB link exists; auto-realises when QB marks Paid | Handlers exist; test matrix not yet validated vs prod data | **Backlog** — QA against recent financials, then enable |
| `shared/feature-flags.ts:96` | `local_synced_save_flow` — local-first save with background sync | Beta in EngineeringTasksPage | **Backlog** — broader rollout after beta signal |
| `shared/feature-flags.ts:87, 99` | `contextual_ms_surfaces`, `ms_create_action` — Microsoft integration entry points | Flag-gated | **Backlog** — Phase 2 of MS integration |
| `shared/feature-flags.ts:244` | `migration_bridge_approvals_dual_write_v1` — reserved kill-switch | Disabled in Phase 1A (observational only) | **Backlog** — pending Phase 2 schema extension |
| `shared/feature-flags.ts:250` | `migration_bridge_project_dual_write_v1` — reserved kill-switch | Disabled in Phase 1A | **Backlog** — pending Phase 2 schema extension |
| `shared/feature-flags.ts:109-154` | 38 `promoted_*` migration-bridge flags — read-parity diagnostics | Most default OFF | **Backlog** — Phase 2+ schema migration work |
| `shared/feature-flags.ts:57` | `legacy_capture_deliverable` — controls legacy uncontrolled deliverable table | Retained for backwards-compat; new uploads use Engineering Stages | **Leave** — kill-switch for the legacy surface |
| `server/routes/ms-integration-extracted-routes.ts:107, 113` | `feature_ms_sharepoint_docs`, `feature_ms_teams` | Feature-gated behind config | **Backlog** — depends on MS phase rollout |
| `server/jwt.ts:30` | TODO (Prompt 11): multi-tenant `organizationId` in JWT | Multi-org deferred | **Backlog** — large-scope, separate track |
| `server/services/promoted-read-compat.ts:1026+` | PROVISIONAL fields in promoted read (7 diagnostics) | Phase 1A stubs deferred to Phase 2 | **Backlog** — Phase 2 schema work |
| `client/src/config/page-registry.ts:123-125` | Feedback & Support (`showInSidebar: false`) | Hidden per Prompt 0.7 ("not actively monitored") | **Leave** — route live for direct access; consider backlog reactivation after service model is defined |
| `client/src/config/page-registry.ts:150-153` | `/my-work/approvals` alias → `/my-work/tasks?source=approvals` | Alias for deep-link compatibility | **Leave** — keeps bookmarks working |

---

## B. Orphan pages

**None detected.** Every `client/src/pages/**/*.tsx` resolves to a `PAGE_REGISTRY` entry (either as a full page, detail route, or `routeComponentKey` in `client/src/config/route-components.ts`). The 46 pages marked `showInSidebar: false` are intentionally hidden — they remain routable via direct URL or programmatic navigation.

This is a strong signal: page lifecycle is well-managed. Phase 2 does NOT need orphan cleanup.

---

## C. Legacy routes still mounted where new equivalents exist

Dual-mount risks — both legacy and new files register handlers; precedence depends on mount order in `server/routes.ts`.

| Legacy file | New equivalent | Overlap assessment | Risk |
|---|---|---|---|
| `server/engineering-routes.ts` (3607 lines) | `server/routes/engineering.routes.ts` | Both active; new handles subset. Handler shadow-risk unconfirmed. | **High** — largest legacy file. Needs per-endpoint audit. |
| `server/quality-routes.ts` (2500 lines) | `server/routes/quality.routes.ts` | Both active; legacy absorbs commissioning + NCR | **High** — NCR surface has been aliased to `/quality` (registry rows 101-103), implies migration in flight |
| `server/microsoft-integration-enhancements-routes.ts` (36 lines) | `server/routes/microsoft.routes.ts` | Small legacy file, conditionally mounted via feature flag | **Low** — small surface, flag-gated |
| `server/commissioning-routes.ts` + `server/commissioning-dashboard-routes.ts` | Absorbed into `server/routes/quality.routes.ts` | Both legacy files still mount | **Medium** — check for live-traffic handlers |
| `server/analytics-routes.ts` (73 lines) | None | Appears unmounted in `registerLegacyRoutes` | **Low** — likely dead, confirm before removing (removal needs approval anyway) |

**Recommendation:** dedicated Phase-2 or standalone audit per legacy domain. Do NOT unmount anything in Phase 1 — additive-only rule. Per-endpoint handler-shadow audit goes into `backlog.md`.

---

## D. Phased-work references

Multi-phase plans whose later phases may be unshipped. References below cite the prompt/phase naming convention already in use in the codebase.

| Phase reference | Details | Status |
|---|---|---|
| **Phase 1A** (migration bridge) | Observability-only parity diagnostics for projects / lifecycle / approvals / finance / deliverables / party. Dual-write kill-switches reserved. | Observational; kill-switches default OFF. Phase 2 hasn't started. |
| **Phase 1 (EPC Workflow)** | PO Approval Board, Payment Request Board, Payment Batch Manager (registry lines 197-199) | Pages routable; backend handlers in legacy `payment-*-routes.ts` and `po-routes.ts`. **Functional but handlers split across legacy.** Flag as dual-mount. |
| **Phase B** (new entity pages) | Sites, Opportunities, procurement alias (registry lines 192-195) | Opportunities and Sites live; Procurement is alias-only (redirect → `/execution-board`). **Complete or intentional stub.** |
| **Phase D** (admin integration pages) | System Settings, Workflow Config, Data Migration Status, Pipedrive/QuickBooks Integrations (registry lines 206-211) | All pages routable; many wire to legacy route handlers. **Likely complete** but each page needs Phase 2 smoke check. |
| **Prompt 0.7** | Feedback & Support + duplicate Approvals entry | Intentionally de-emphasised; hidden. |
| **Prompt 2** | Old nav reorg (exceptions, project-lifecycle, command-center, sseg) | LEGACY_REDIRECTS in place; complete. |

---

## E. Top 5 "finish it" candidates

Highest ROI: complete existing work rather than start new. Ordered by estimated value/effort.

1. **Handover Health Score** (`client/src/pages/handover-control.tsx:77-78` + `/admin/handover-health`) — UI renders, backend query returns undefined. **Finish immediately**: wire the endpoint, add server-side aggregate. Quick win for COO visibility.

2. **`task_management_hub`** (`shared/feature-flags.ts:254`) — unified tasks hub. Underlying `/my-work/tasks` is feature-complete; flag is the only gate. **Finish**: QA + enable. Big UX improvement for every role.

3. **`pd_pm_handover_v2`** (`shared/feature-flags.ts:328`) — 7 pages built, flag gated. **Finish**: audit backend dual-sign-off logic, enable flag, production test. Moves the PD→PM bridge off the v1 flow retired 2026-03-31.

4. **Phase 1 (EPC Workflow) consolidation** — PO Approvals / Payment Requests / Payment Batches live in legacy route files. **Finish**: migrate handlers to `server/routes/financials.routes.ts` or a new `approvals.routes.ts`. No UX change visible to users.

5. **`smart_import_qb_precedence`** — handlers exist, test matrix incomplete. **Finish**: validate against recent-month financials, enable.

---

## F. Interpretation

The codebase is **healthier than a naive overhaul would assume**:

- Features are predominantly **gated behind flags rather than half-deleted or abandoned**. That's a mature discipline.
- No orphan pages — page lifecycle is actively managed.
- Canonical-backend migration (`00c-source-of-truth-audit.md`) is nearly complete; half-built features are mostly on the **frontend-flag** axis, not the **broken-data** axis.
- Three dual-mount risks (engineering, quality, microsoft) are real but contained — all three have a new-style partner already written, so this is a mid-migration state, not orphaned legacy.

**Implication for Phase 1–3 planning:** the "finish half-built features" scope in the overhaul prompt is bounded. The top 5 "finish it" candidates are clear and small. The main overhaul work is **visual polish + additive function** on already-healthy functional surfaces.

---

**End of `00b-half-built.md`.** Companion: `00-inventory.md`, `00c-source-of-truth-audit.md`, `backlog.md`.
