# 04 — Regression Report

**Phase 4 deliverable.** Walks every function from `00-inventory.md` after Phase 3 migrations land, verifying behaviour preservation and platform-wide consistency.

> **Status:** SCAFFOLDED — Phase 4 runs **after** Phase 3 per-function migrations land. This file is the template they populate.
> Session 1 built the primitive toolkit only. No screens migrated. No regressions to report.

---

## §1 Methodology

Phase 4 walks every function in `00-inventory.md` and verifies — for each — that:

1. The function **still works**. Original user goal achievable.
2. The function **is still findable**. Route, sidebar entry, command-palette match still present.
3. The function **is still understandable**. Labels, hierarchy, and affordances intact.
4. The function's **behaviour is unchanged**. Same inputs produce same outputs.
5. Any migrated data reads return **identical data** to the pre-migration reads.

Sweep method: for each function, a verification checklist is run (manual or automated via `qa/tests/`). Failures are logged in §5 below with a remediation plan.

### §1.1 Cross-lens consistency checks

- **Save button position** — always right of primary action row.
- **Delete / Archive** — always in overflow menu or dedicated destructive-action row.
- **Cancel** — always explicit button; no back-button reliance.
- **Empty states** — variant matches intent (no-data / no-match / permission-denied).
- **Loading states** — skeleton dimensions match post-load layout.
- **Error states** — friendly message; retry affordance where applicable.
- **Confirmations** — destructive actions use `ConfirmDialog`.

### §1.2 Source-of-truth verification

- Every migrated function reads from canonical per `00c-source-of-truth-audit.md`.
- No regressions to legacy read paths.
- All data diffs from Phase 3 §4 resolved.

### §1.3 Responsive check

- Functions tested at common viewport widths the team uses (1440, 1280, 1024, 768, 390).
- Mobile-first lenses (PMS, CM, Eng, HSE, SSEG) get extra attention at 390/768.

### §1.4 Accessibility smoke test

Keyboard-only walk through most-used flows:

- Gates Pipeline (`/gates`) — navigate list, apply filter, clear filter, open first row.
- My Work (`/my-work`) — reach every action queue.
- Approvals (`/pm/approvals`) — navigate to queue, open an item.
- Project Detail (`/project/:id`) — switch tabs.
- Weekly Reviews wizard — complete all steps.

Every flow must be fully keyboard-navigable with visible focus ring.

### §1.5 Brand check

- Logo placement identical to Phase 0 recorded state (`/emergent-logo.png`, `AppLayout:251`).
- Brand hex values (`#16A34A` primary, `#22C55E` accent) unchanged.
- Fonts (Barlow heading / Inter body / JetBrains mono) unchanged.

---

## §2 Function-by-function verification

Run one row per `00-inventory.md` page. Populated during Phase 4 sweep.

| Function | Still works | Still findable | Behaviour unchanged | SoT canonical | Notes |
|---|---|---|---|---|---|
| _(empty — populated in Phase 4)_ | | | | | |

---

## §3 Cross-lens consistency findings

| Pattern | Consistent? | Exceptions | Resolution |
|---|---|---|---|
| _(empty — populated in Phase 4)_ | | | |

---

## §4 Responsive + accessibility findings

| Viewport / flow | Result | Notes |
|---|---|---|
| _(empty — populated in Phase 4)_ | | |

---

## §5 Regressions discovered + remediation

| # | Function | Regression | Remediation | Status |
|---|---|---|---|---|
| _(empty — no regressions discovered in Session 1; no screens migrated)_ | | | | |

---

## §6 Residual risks + handover to backlog

| # | Risk | Action | Target |
|---|---|---|---|
| _(empty — populated in Phase 4)_ | | | |

---

## §7 Session 1 status

No per-function migrations executed → no regressions possible.

**Primitive toolkit only:**

- 7 new files under `client/src/components/layout/` + 1 barrel + 1 README.
- 1 extended file (`ui/page-header.tsx`) — additive props only; existing call-sites untouched.
- TypeScript check passed at every commit.
- Zero routes, pages, components, or behaviour modified.

Phase 4 runs meaningfully only after Phase 3 Wave 1+ has landed real migrations. This file is the structure those sweeps will populate.

---

**End of `04-regression-report.md`.**
