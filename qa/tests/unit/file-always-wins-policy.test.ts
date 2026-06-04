/**
 * File-always-wins import policy (owner decision 2026-06 — "Excel wins
 * everywhere, never prompt").
 *
 * These tests pin the policy surface that the commit handler and the
 * scheduler key off:
 *   - every section (PLAN included) is file-wins, and
 *   - the scheduler never parks for field conflicts under the policy.
 *
 * The per-gate auto-resolution in smart-import-routes.ts (resurrection,
 * duplicate-project, manual-edit, recency) is exercised end-to-end by the
 * API/import integration suites, which require a Postgres-backed app.
 */

import { describe, it, expect } from "vitest";
import {
  FILE_WINS_SECTIONS,
  sectionIsFileWins,
  IMPORT_FILE_ALWAYS_WINS,
} from "../../../server/imports/import-conflict-policy";
import { resolveSchedulerConflictPolicy } from "../../../server/imports/scheduler-conflict-policy";
import type { PlannerResult } from "../../../server/lib/import/planner";

describe("file-always-wins policy", () => {
  it("treats PLAN, REVENUE and EXPENDITURE all as file-wins", () => {
    expect(sectionIsFileWins("PLAN")).toBe(true);
    expect(sectionIsFileWins("REVENUE")).toBe(true);
    expect(sectionIsFileWins("EXPENDITURE")).toBe(true);
    expect(FILE_WINS_SECTIONS.size).toBe(3);
  });

  it("defaults IMPORT_FILE_ALWAYS_WINS to on when no env override is set", () => {
    // The runner does not set IMPORT_FILE_ALWAYS_WINS, so the default is true.
    expect(IMPORT_FILE_ALWAYS_WINS).toBe(true);
  });

  it("scheduler auto-commits (never parks) even WITH blocking conflicts under file-wins", () => {
    const planner = {
      conflicts: { hasBlockingConflicts: true, allRows: [] },
      resurrections: [],
    } as unknown as PlannerResult;

    const result = resolveSchedulerConflictPolicy(planner, true);

    expect(result.decision).toBe("commit");
    expect(result.reason).toBe("file_always_wins");
    expect(result.unresolvable).toEqual([]);
    expect(result.resolutions).toEqual({});
  });

  it("scheduler commit decision is independent of conflict detail under file-wins", () => {
    const planner = {
      conflicts: {
        hasBlockingConflicts: true,
        allRows: [
          {
            rowKey: "EXPENDITURE::row-1",
            conflictStatus: "HAS_CONFLICTS",
            fields: [
              {
                fieldName: "amountExVat",
                requiresDecision: true,
                mergeCase: "CONFLICT",
                baselineValue: 100,
                currentAppValue: 200,
                uploadedValue: 300,
              },
            ],
          },
        ],
      },
      resurrections: [],
    } as unknown as PlannerResult;

    expect(resolveSchedulerConflictPolicy(planner, true).decision).toBe("commit");
  });
});
