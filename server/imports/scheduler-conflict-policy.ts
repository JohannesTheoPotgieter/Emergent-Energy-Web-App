/**
 * Scheduler conflict policy — auto-resolution rules for the
 * scheduled-import-v2 flow.
 *
 * The scheduler can't pause for user input, so it needs a deterministic
 * policy for every conflict the v2 planner reports. This module decides
 * whether the scheduler should auto-commit a run or park it as
 * `awaiting_review` for a human decision.
 *
 * **Used by:** `server/services/scheduled-import-v2.ts`.
 *
 * **Phase 6 PR 1 scope:** the policy is computed and stored in the run's
 * `summaryJson` but NOT applied to a commit yet. The commit handler in
 * `smart-import-routes.ts` (1,199 LOC) needs to be extracted into a
 * reusable service before the scheduler can call it programmatically.
 *
 * ---
 *
 * **Background — the v2 conflict engine already auto-resolves what it can.**
 * Per `server/lib/import/conflict-engine.ts`, each row's field-level merge
 * yields one of five `MergeCase` values:
 *
 * | mergeCase          | semantic                                | requiresDecision |
 * |--------------------|-----------------------------------------|------------------|
 * | UNCHANGED          | baseline = current app = file           | false            |
 * | AUTO_ACCEPT_FILE   | file changed, app unchanged             | false            |
 * | KEEP_APP           | app changed, file unchanged             | false            |
 * | NEW_FIELD          | field exists only in the file           | false            |
 * | CONFLICT           | both file AND app diverged differently  | true             |
 *
 * The engine sets `hasBlockingConflicts = true` only when at least one row
 * has a `CONFLICT` field. Everything else is already classified safely.
 *
 * **Policy rule (conservative):**
 *   - No blocking conflicts → `commit`. The scheduler's commit step can
 *     safely auto-resolve every field via the engine's existing decisions.
 *   - Any blocking conflicts → `park`. Never auto-resolve a true 3-way
 *     conflict; the user's intent could be lost. Surface the conflicting
 *     rows so the UI can prompt for human review.
 *
 * This intentionally matches the audit recommendation in
 * docs/AGENT_GUARDRAILS.md § 9: scheduler auto-commits clean re-imports;
 * any divergence parks for explicit review.
 */

import type { PlannerResult } from "../lib/import/planner";
import { IMPORT_FILE_ALWAYS_WINS } from "./import-conflict-policy";

export type SchedulerConflictDecision = "commit" | "park";

export interface SchedulerConflictPolicyResult {
  decision: SchedulerConflictDecision;
  /** Human-readable reason for the decision (audit log + UI). */
  reason: string;
  /**
   * Resolution map for the commit step:
   *   `{ "rowKey::fieldName": "keep_app" | "accept_file" }`.
   * Empty for the conservative policy (the engine has already classified
   * the non-conflict fields; we don't need to override them here).
   */
  resolutions: Record<string, "keep_app" | "accept_file">;
  /**
   * Field-level conflicts that triggered the park. Empty when committing.
   */
  unresolvable: Array<{
    rowKey: string;
    fieldName: string;
    mergeCase: string;
    baselineValue: unknown;
    currentAppValue: unknown;
    uploadedValue: unknown;
  }>;
}

export function resolveSchedulerConflictPolicy(
  plannerResult: PlannerResult,
  fileAlwaysWins: boolean = IMPORT_FILE_ALWAYS_WINS,
): SchedulerConflictPolicyResult {
  const conflicts = plannerResult.conflicts;

  // File-always-wins (owner decision 2026-06): never park for field conflicts
  // on the auto path — the commit writer applies the file value for every
  // section. scheduled-import-v2.ts still parks runs with no confident project
  // match or with deleted-row resurrections (the two unattended-only safety
  // cases). The flag is injectable so the legacy conflict-resolution path
  // stays unit-testable when it is off.
  if (fileAlwaysWins) {
    return {
      decision: "commit",
      reason: "file_always_wins",
      resolutions: {},
      unresolvable: [],
    };
  }

  if (!conflicts || !conflicts.hasBlockingConflicts) {
    return {
      decision: "commit",
      reason: "no_blocking_conflicts",
      resolutions: {},
      unresolvable: [],
    };
  }

  const unresolvable: SchedulerConflictPolicyResult["unresolvable"] = [];
  for (const row of conflicts.allRows) {
    if (row.conflictStatus !== "HAS_CONFLICTS") continue;
    for (const field of row.fields) {
      if (!field.requiresDecision) continue;
      unresolvable.push({
        rowKey: row.rowKey,
        fieldName: field.fieldName,
        mergeCase: field.mergeCase,
        baselineValue: field.baselineValue,
        currentAppValue: field.currentAppValue,
        uploadedValue: field.uploadedValue,
      });
    }
  }

  return {
    decision: "park",
    reason: unresolvable.length > 0
      ? `unresolvable_conflicts_${unresolvable.length}`
      : "blocking_conflicts_without_field_detail",
    resolutions: {},
    unresolvable,
  };
}
