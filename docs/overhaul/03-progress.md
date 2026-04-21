# 03 — Phase 3 Progress

**Phase 3 implementation tracker.** Updated as each function / primitive lands.

> **Approach:** the overhaul prompt's Phase 3 loop requires per-function verification ("Capture current behaviour [..] Confirm every item in the Preserved Behaviour contract"). That verification is done live against the running app and existing tests. In this session I built the **primitive toolkit** (additive, zero risk to existing screens) and documented the hand-off state for per-function migrations.
> **Invariant:** every new file in Phase 3 is additive. Nothing existing is modified without explicit preserved-behaviour sign-off.

---

## §1 Session 1 — Primitive toolkit (COMPLETE)

The 8 layout primitives from `01-design-system.md §3` are built as additive files under `client/src/components/layout/` and `client/src/components/ui/page-header.tsx` (extension). Each wraps existing `ui/*` components; none replaces an existing screen.

| Primitive | File | Status | First migration target |
|---|---|---|---|
| AppShell | `client/src/components/layout/AppShell.tsx` | 🟢 shipped | Phase 3 Wave 1 (whole-app) |
| LensNav | `client/src/components/layout/LensNav.tsx` | 🟢 shipped | Phase 3 Wave 1 (sidebar) |
| PageHeader (extended) | `client/src/components/ui/page-header.tsx` | 🟢 shipped | Wave 1 |
| PageLayout | `client/src/components/layout/PageLayout.tsx` | 🟢 shipped | Wave 1 |
| TableLayout | `client/src/components/layout/TableLayout.tsx` | 🟢 shipped | Wave 2 (F-004 Gates Pipeline) |
| DetailLayout | `client/src/components/layout/DetailLayout.tsx` | 🟢 shipped | Wave 3 (F-013 Project Detail) |
| FormLayout | `client/src/components/layout/FormLayout.tsx` | 🟢 shipped | Wave 4 (F-037 New Priority) |
| WizardLayout | `client/src/components/layout/WizardLayout.tsx` | 🟢 shipped | Wave 4 (F-018 Weekly Reviews) |
| `client/src/components/layout/index.ts` | (barrel) | 🟢 shipped | — |
| `client/src/components/layout/README.md` | (usage doc) | 🟢 shipped | — |

Legend: 🟢 shipped · 🟡 in progress · 🔴 blocked · ⚪ deferred

### §1.1 Safety record

- **All 8 primitive files are newly created** — zero existing screens modified.
- **`ui/page-header.tsx`** is the only touched existing file. Change is **strictly additive** — three new optional props (`status`, `kpiStrip`, `sticky`). Every existing call-site remains valid without change (verified by the new props being optional).
- **TypeScript check passed** at every commit via pre-commit hook.
- **No `@/components/layout` barrel imports** existed before this session (verified by grep); creating the barrel is safe.
- **No primitives imported into any page yet.** Adoption happens per-screen in subsequent sessions.

---

## §2 Function migrations

### §2.0 Wave 1 — in progress

| Function | Status | Commit | Notes |
|---|---|---|---|
| **F-002 Lifecycle Board** | 🟢 **migrated — awaiting owner staging review** | `6a41be2` | PageLayout + PageHeader. Add Project moved into PageHeader actions. Subtitle consolidated. Zero behaviour changes. Canonical reads unchanged. |

**Open for owner review (D-006, D-011):** staging deploy of `claude/platform-overhaul-3WF1E` → click through Lifecycle Board → approve for Wave-1 merge to main, or flag regressions.

### §2.1 Phase 3 Wave 1+ per-function migrations require live verification against the running app:

1. Capture current behaviour (manual checklist or strengthened test).
2. Make the change using the primitives.
3. If migration includes SoT change, compare canonical vs legacy outputs side-by-side.
4. Verify every Preserved Behaviour contract item holds.
5. Accessibility + dark-mode + reduced-motion pass.
6. Commit with `enhance(<lens>/<function>): ...` format.

This loop is **not safely parallelisable across 56 functions in a single automated session** — every migration needs owner eyes on the live UI to confirm the Preserved Behaviour contract. Attempting a rapid multi-function rewrite violates the overhaul's "no behaviour changes" rule.

### §2.1 Migration roadmap

| Wave | Function(s) | Status | Notes |
|---|---|---|---|
| 1 | F-002 Lifecycle Board | 🟢 **migrated — awaiting owner staging review** | Commit `6a41be2`. PageLayout + PageHeader applied. |
| 2 | F-004 Gates Pipeline + F-005–F-011 sub-lanes | ⚪ deferred | Proves TableLayout; harvests 8 pages. |
| 2 | F-012 Projects, F-019 Milestone Tracker, F-030 COS, F-031 Revenue Tracker, F-037 Priorities list, F-041 Eng Tasks, F-048 Opportunities | ⚪ deferred | Harvest TableLayout further. |
| 3 | F-013 Project Detail | ⚪ deferred | Largest surface. Proves DetailLayout. High risk. |
| 3 | F-015 Clients, F-021 Handover, F-026 Portfolio Detail, F-028 PM On-The-Go, F-032 QB Throughput, F-036 Company Overview, F-039 Commissioning, F-040 Eng Dashboard, F-042 Eng Standup, F-043 Eng Monthly Report, F-044 Eng Templates, F-047 PD Dashboard, F-049 Quality, F-050 HSE, F-051 Admin integrations, F-053 Admin config | ⚪ deferred | DetailLayout harvest. |
| 4 | F-018 Weekly Reviews, F-056 Project Create | ⚪ deferred | Proves WizardLayout. |
| 4 | F-037 New Priority, Admin forms | ⚪ deferred | FormLayout harvest. |
| 5 | F-016 Approvals, F-017 Financial Review, F-022 PO, F-023 Payment Requests, F-024 Payment Batches | ⚪ deferred | Approvals domain. |
| 6 | F-030 COS, F-031 Revenue, F-032 QB Throughput, F-029 Cashflow | ⚪ deferred | Finance wave — Cashflow last. |
| 7 | F-020 Handover Control (backend + UI), F-021a PD→PM v2 flag, F-036 polish | ⚪ deferred | Finish-it. |
| 8 | F-027 PM On-The-Go home, F-001 Execution Board, F-014 Sites, F-033–F-035, F-038, F-045, F-046, F-052, F-054, F-055 | ⚪ deferred | Mobile + remainder. |

Total: **56 functions deferred** to subsequent sessions where per-function verification can run against a live app.

---

## §3 Decisions surfaced during implementation (Session 1)

### Technical decisions (during primitive build)

| # | Decision | Note |
|---|---|---|
| D-001 | `client/src/components/layout/index.ts` barrel created. | Verified no existing `from "@/components/layout"` imports exist; safe. |
| D-002 | `PageHeader` extension is additive-only. | `status`, `kpiStrip`, `sticky` are new optional props. Existing call-sites untouched. |
| D-003 | `AppShell` access-agnostic. | Access filtering happens in the caller (via `useAccessMatrix`); `LensNav` accepts pre-filtered entries. Keeps primitives testable in isolation. |
| D-004 | `DetailLayout` throws at runtime for empty tabs array. | Developer safety — prevents silent blank pages. |
| D-005 | `WizardLayout` does not render nav buttons. | Caller owns Next/Back logic so it can validate per its own rules. Primitive provides the footer slot only. |

### Owner decisions (2026-04-21 — blocking-clarity round)

| # | Decision | Implication for Phase 3 |
|---|---|---|
| D-006 | **Approver: owner only.** Every migrated page reviewed personally by the owner before wave merges. | Migration tempo capped by owner review bandwidth. Tactical: ship small wave-sized batches to make review tractable. |
| D-007 | **Aesthetic principle: "good-looking solve."** Migrated pages must be information-dense + professional + clean per the wireframes. Decorative effects allowed only where they serve the user. No decoration as filler. | New surfaces = no decoration (committed). Existing migrated surfaces = case-by-case: keep purposeful motion (state transitions, loading skeletons), strip filler animations that exist only for aesthetic noise. |
| D-008 | **Operational approval thresholds preserved exactly.** Current workflow rules (amount caps, required signatories per level) are not re-examined during the overhaul. | Every approval-domain migration (F-016 / F-017 / F-022 / F-023 / F-024) must preserve routing rules bit-for-bit. Regression test includes: "a payment that today requires CFO sign-off still requires CFO sign-off after migration." |
| D-009 | **Mobile-first is every lens, not just field roles.** Prior scoping of "mobile-first for 5 lenses" is overridden. Every lens must be fully usable on mobile. | Propagated in §4 (plan) and `01-wireframes.md §W7` (bottom-tab table already covers all 16 roles). Every F-entry now counts mobile render as part of its Preserved Behaviour contract. See D-010 below for what "mobile-first" means in practice. |
| D-010 | **Mobile-first definition.** "Mobile-first" means: (1) no layout breaks at 390px width, (2) primary flows are touch-reachable without horizontal scroll, (3) 44px minimum touch targets (already enforced in `index.css:305-318`), (4) each role has a lens-appropriate mobile bottom-tab set per `01-wireframes.md §W7`. It does NOT mean every page has a separate mobile-only design. | `AppShell` primitive already supports bottomTabBar for any lens (no code change needed). Caller composes per-lens bottomTabBar content from the W7 table. |
| D-011 | **Deploy gate: staging per wave, owner-approved merge to main.** Each migration wave lands on the feature branch; a staging deploy is produced; owner clicks through; only then merges to main. | Phase 3 workflow: (i) wave migrations land on branch → (ii) staging deploy + screenshot pack → (iii) owner approval → (iv) merge to main. Applies to every wave. |

---

## §4 Data diffs requiring decision

Per Phase 3 loop step 4: "If outputs differ — stop. Surface the diff."

| # | Function | Legacy output | Canonical output | Decision |
|---|---|---|---|---|
| — | None surfaced — no per-function migrations executed in Session 1. | | | |

---

## §5 Open questions for next session

| # | Question | Blocking? |
|---|---|---|
| Q-1 | Wave 1 kick-off page confirmed as F-002 Lifecycle Board — proceed as planned? | Low — fall-through to plan if no redirect. |
| Q-2 | When Wave 1 lands, do we leave `AppLayout.tsx` mounted or cut over the whole app? Overhaul rule says additive coexistence until explicit sign-off. | No — default is coexistence. |
| Q-3 | Should Phase 3 per-function migrations follow a single commit per function, or batch by wave? | Session-2 tactical — not blocking. |

---

## §6 Regression log

| # | Function | Regression | Resolution |
|---|---|---|---|
| — | None found in Session 1. Zero screens modified; only primitives added. | | |

---

## §7 Session 1 summary

**Delivered:**

- 7 new layout primitives (AppShell, LensNav, PageLayout, TableLayout, DetailLayout, FormLayout, WizardLayout).
- 1 extended primitive (ui/page-header.tsx — additive props).
- 1 barrel re-export + 1 README with usage examples.
- Full doc coverage in `01-design-system.md §3`.
- Zero breaking changes, zero behaviour changes, zero removals.

**Not delivered** (deferred to subsequent sessions with live-app verification):

- Per-function migrations for F-001 through F-056.
- AppLayout.tsx retirement (intentionally kept mounted — overhaul rule).
- Phase 4 regression sweep (requires migrated screens to sweep).

**Ready for Session 2:**

- Developer can adopt any primitive via `import { X } from "@/components/layout"`.
- Each migration follows the README's checklist + `02-function-plan.md` per-function contract.
- Proposed kick-off: F-002 Lifecycle Board as the Wave 1 proof.

---

**End of `03-progress.md`.**
