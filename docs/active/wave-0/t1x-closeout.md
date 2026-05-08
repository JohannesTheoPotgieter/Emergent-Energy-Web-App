# T1.x Reporting Trust Audit — close-out

**Date:** 2026-05-08
**Phase:** Plan v3 § 3 (Reporting Trust)
**Audience:** Johannes (COO) + future agents running T2 / T3 / similar trust audits
**Companion docs:** `docs/active/wave-0/t1x-reporting-findings.md` (the audit itself), `docs/active/wave-0/decisions-log.md` (the non-code decisions), `docs/active/wave-0/remediation-decision.md` (Track A § 1.4 outcome), `docs/AGENT_GUARDRAILS.md` § 3 (financial-formula HARD rules)

> **Note on `findings.md`:** Plan v3 § 0.4 referenced a single `docs/active/wave-0/findings.md` produced by the Wave 0 audit. That broad doc has been superseded by the per-pillar findings files (`t1x-reporting-findings.md`, plus T2 / T3 once they land). The narrower per-pillar shape proved easier to triage and fix-PR against. No separate consolidated findings doc is planned.

This is institutional memory for the audit → triage → 8-PR fix flow that closed § 3.1 → § 3.3 in one working day. It exists so the next trust audit (T2 inventory, T3 cashflow scenario, future portfolio-level audits) starts from the patterns that worked, not from a blank page.

---

## 1. Audit shape — what worked about the 6-section read-only audit

- **Read-only posture (§ 3.1)** kept the audit doc separable from the fix work. PR #854 was a docs-only PR; the eight code PRs all referenced it. Clean handoff to triage; clean rollback boundary if anything went wrong.
- **30-file cap + isolated sub-agent** (per the Plan-v3 "fresh `/clear`" recommendation) kept output focused. The audit read ~22 files of the 30-file cap. Without the cap, the agent would have wandered into adjacent surfaces and produced a more diffuse report.
- **Six fixed sections** (Inventory / Filter+Aggregation / Reconciliation / Cadence / KPI / Trust signals) covered the finance reporting surface without overlap. Each section has a different question, so findings don't collide.
- **Triage column on every row** (`fix-now` / `fix-soon` / `defer`) made § 3.2 mechanically fast. The COO read the doc, accepted or adjusted the column, and the rest was execution.
- **Anchored against `AGENT_GUARDRAILS § 3.1` / § 3.4 / § 9.3.** The audit didn't make value judgements; it pinned each finding to a documented HARD rule. That made the COO's accept/reject decisions about *priority*, not *legitimacy*.

## 2. Triage shape — how COO + agent produced the splits

- Flow: agent presented findings + a recommendation per row; COO chose. Decisions were captured **in PR descriptions**, not in a separate decision log. Audit trail without a parallel doc.
- `AskUserQuestion` with structured A/B/C/Defer options for high-stakes calls (Surprise 2 weights, Surprise 3 ramp source). This forced a one-click decision instead of free-text deliberation.
- **Surprise: my own count was off.** I summarised "three fix-now defects" when the audit listed four. The COO caught the gap during triage; I owed a correction and addressed Finding A as a follow-up PR (#856). Documented here for honesty: agent self-summary needs verifying against the source.
- **Surprise: a "fix-soon" item collapsed to "fix-now"** once the COO saw the visible impact (Surprise 1 — null-data departments rendering red). The audit's triage column is a starting point, not a verdict.
- **Surprise: deferral was easier when there was no concrete code fix** (Surprise 2 originally, Findings D + E). The agent's recommendation to "defer because the fix is feature creep" was accepted faster than recommendations to defer because the fix was just hard.

## 3. Fix-PR cadence — 8 PRs in ~3 hours wall-clock

- **Per-PR loop**: branch from `main` → edit → `npm run check` → targeted `vitest run` → commit → push → draft PR. Each loop ~15-20 minutes. No `qa:full-proof` runs during iteration (per `CLAUDE.md` rule 4).
- **One defect per branch (mostly).** The first PR (#855) bundled three small fix-now defects into three commits because they were all small and independent; every subsequent PR was one defect, one branch.
- **What gating caught:** local `npm run check` + targeted vitest caught all issues pre-push. CI didn't run on any of the 8 PRs (the `pr-checks.yml` workflow doesn't trigger on draft PRs). After flipping to ready-for-review, all merged cleanly with no CI run — the local discipline carried.
- **What slipped:** my "PR #855 doesn't exist" false alarm — the fix-now branch had been committed and pushed silently between turns. I fact-checked instead of guessing, and corrected within the same message. **Lesson: always verify before claiming.**
- **Test pattern that scaled:** source-pin tests using `fs.readFileSync` + regex/contains assertions. When a behaviour test would have required mocking 21 db tables (the Company Overview service), the source-pin pattern caught structural regressions in seconds and stayed honest about its limitations.

## 4. Decisions made — Surprises 2 + 3, deferrals D + E

- **Surprise 2** (Finance KPI re-weight) — chose **Option B**: cash 30, debtors 25, COS-derived 45 (was 65). Rationale: cash + AR are the day-to-day finance signals; needed to drive a majority. PR #860 captures the full rationale and the before/after weight table.
- **Surprise 3** (FYTD ramp) — chose **`expectedPaymentDate ∈ [fyStart, today]`** over linear `months_elapsed / 12`. Rationale: anchor against captured forecasts, not calendar fiction. **Caveat documented in PR #859:** if `expectedPaymentDate` clusters towards FY end (back-loaded — likely for solar EPC), early-FY scores look strong. That's "no plan to compare against yet", not a bug. Future work: a captured month-by-month FY budget surface would replace this with an explicit plan curve.
- **Finding D** (overdue debtors `inverse_count + R unit`) — **deferred**. Math correct (R5M overdue → score 50); rename is feature creep without a second monetary KPI to bundle with.
- **Finding E** (programme reports not snapshotted / no time-travel) — **deferred**. Semantic, not bug; "current truth" is correct for the current use; only fix when time-travel is needed.
- **Decision heuristic that emerged:** *"if we DON'T fix this, what does the user see?"* If the answer is "wrong number on a tile", fix-now. If "naming inconsistency in a registry", defer. Cheap test, applied consistently.

## 5. Risk shape — blast radius + heads-up list

- **CFO-visible numeric shifts:** four PRs — #856 (cashflow weeks), #857 (Company Overview colour), #859 (Finance scores), #860 (Finance weights). All shifts are "math becoming honest", not new wrongness. Each PR carries a CFO heads-up note in its description.
- **All-user-visible:** PR #855's `/api/dashboard/my-work` change — fake fixture data → empty arrays. Visible to every authenticated user, but the change is *less* data, not different data.
- **RBAC-neutral, schema-neutral, migration-neutral:** all 8 PRs. No new tables, no permissions changes, no migration files. Per § 0A this means zero data-integrity risk; all changes are reversible by `git revert`.
- **Snapshot guard untouched throughout** — verified by the `ee-snapshot-auditor` sub-agent on PR #855 (the only PR that refactored a snapshot-table read path). § 3.1 invariant intact.

## 6. Reusable patterns for T2 / T3

- **Audit prompt scaffolding** — 6-section template, 30-file cap, defect-triage column, anchor on `AGENT_GUARDRAILS` HARD rules, sub-agent in isolated context. Copy this shape; vary the sections to match the audit domain (T2 inventory will need different sections than T1.x reporting).
- **Triage flow** — `AskUserQuestion` with structured A/B/C/Defer options for each non-obvious call. Capture decisions inline in PR descriptions. **Do not** create a separate decisions doc — the PR-merge log IS the decision log.
- **Per-PR loop** — branch from `main`, edit, local `npm run check` + targeted vitest (NOT `qa:full-proof`), commit, push, draft PR. One defect per branch; bundle only when defects are small and independent. Test files mirror the file they exercise.
- **Subagent discipline** — `/ee-review` for invariant pass on every code-touching PR; `ee-snapshot-auditor` for any PR touching a snapshot-table read path. Both before commit, not after.
- **Source-pin test pattern** — when behaviour testing requires heavy mocking, `fs.readFileSync` + regex/contains source assertions. Cheaper than mocks, catches structural regressions, doesn't pretend to test runtime behaviour. Use it; don't apologise for it; don't replace a real unit test where one is cheap.

## 7. What I'd do differently

- **Honest counts up-front.** The "three fix-now" miscount cost the COO a triage round. Before claiming completeness, agents should verify their own summary against the source doc — a 30-second `grep -c "fix-now"` would have caught it.
- **Behaviour tests where the cost is low.** PR #855's cash-window refactor used source-pin tests because mocking 21 tables felt too heavy. In hindsight, a focused unit test on a single extracted helper would have been more durable and not much more work. Source-pin is the *fallback*, not the default.
- **CFO-visible heads-up BEFORE the change, not in the PR description.** Surprise 3 (FYTD ramp) and Surprise 2 (Finance re-weight) shift visible numbers materially. Both should have surfaced an interactive "is the COO ready for the score to move?" beat *before* code was written, not as a risk note in the PR description after.
- **More frequent scope check-ins.** The session nearly over-ran into Finding C Wave A before stopping. Default to "ship and check in" at PR boundaries, not at fatigue boundaries.

---

*End of close-out. Companion file: `docs/active/wave-0/t1x-reporting-findings.md` (the audit). Companion PRs: #854–#861, all merged to `main` between 06:41 and 07:50 on 2026-05-08.*
