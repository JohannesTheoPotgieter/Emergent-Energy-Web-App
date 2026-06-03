---
name: Project plan critical path & reschedule
description: How the PM plan's critical path is computed (hybrid) and how reschedule gates on dependencies
---

# Critical path (hybrid)

The plan's critical path is served by `GET /api/projects/:projectName/critical-path`
(canonical `work_items` + `work_item_dependencies`, leaf tasks only).

- **When dependencies exist** → dependency-driven CPM (`calculateCPM`, forward/backward
  pass, slack ≤ 0 = critical) on the SA working calendar.
- **When there are NO dependencies** → fall back to a **date-based longest chain**
  (`calculateCriticalPathByDates`): heaviest chain (by working-day duration) of
  *non-overlapping* tasks ending at the project's latest finish date.

**Why:** owner wants the schedule-defining path visible even before dependencies are
entered, but real precedence (when present) should win.

**How to apply:**
- Chaining rule is **strict**: a task `p` precedes `t` only when `p.end < t.start`.
  Dates are inclusive day ranges `[start..end]`, so `p.end === t.start` is an overlap
  and must NOT be chained (using `<=` is a bug that inflates chains for same-day tasks).
- Tie-breaks resolve to the **lower task id** (parent choice and end-anchor) so the
  result is deterministic regardless of DB/input row order.
- Endpoint returns `criticalTaskIds` (+ `criticalPathMode: "dependencies" | "dates"`).

# Highlight

Critical tasks render **bright red** in BOTH surfaces of `UnifiedPlanTab.tsx`, gated by
the existing "Critical path" toggle, keyed by `criticalSet.has(task.workItemId)`:
- Grid rows and Gantt bars. Critical row styling is made **mutually exclusive** with the
  blue selection highlight (both use `!bg-*`; competing `!important` bg utilities resolve
  by generated-CSS order, not class-string order, so only apply one at a time).

# Reschedule = earliest finish

`computeReschedule` already pulls every dependent task to its earliest valid start
(respects dependencies + manual/anchored dates) — i.e. "finish as early as possible".
With **zero dependencies** it is a no-op, so the Reschedule button first checks
`projectDependencies.length` and opens an "Add dependencies first" prompt instead of
running an empty reschedule.
