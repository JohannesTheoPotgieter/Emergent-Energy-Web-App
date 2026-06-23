---
name: Milestone = integer WBS rule
description: A project-plan milestone is always a top-level integer WBS code; derive at read, never trust the stored is_milestone flag.
---

# Milestone is always an integer WBS code

A project-plan "milestone" is ALWAYS a top-level **integer** WBS code (`"1"`, `"2"`,
`"3"`) and NEVER a decimal sub-row (`"1.1"`, `"5.3"`). The single source of truth is
`shared/lib/milestone-wbs.ts` → `isMilestoneWbs(wbs) = /^\d+$/.test(String(wbs).trim())`.

**Why:** Owner rule (COO, 2026-06-18). The old import heuristic mis-flagged decimal
sub-tasks and "parent-with-children" rows as milestones. Fixed by deriving from the WBS
code instead of keyword/parenthood heuristics.

**How to apply:**
- The stored `work_items.is_milestone` column is **NOT authoritative**. Any NEW read /
  display path must derive `isMilestone` from `wbsCode` via `isMilestoneWbs(...)`, not
  pass through the stored flag — otherwise stale decimal rows leak through as milestones.
- Derive-at-read was chosen over a DB backfill on purpose: dev is Postgres / prod is
  Postgres but a regex backfill (`~`) is not portable across engines, and derivation
  fixes existing projects immediately with no re-import. Keep import + every read path
  using the one shared helper so they never drift.
- Do NOT re-introduce the "auto-mark every parent-with-children as a milestone" loop in
  the rollup service — parenthood does not imply milestone status.
- The UI diamond marker should render for any `isMilestone` row (integer-WBS phase
  parents included) — do not gate it behind `!hasChildren`.
- V2 manual milestone-create path is a separate, explicit user action — out of scope for
  this WBS-derivation rule.
