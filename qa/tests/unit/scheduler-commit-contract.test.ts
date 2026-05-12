/**
 * Type-level contract pin for `commitSmartImportRunAsSystem`
 * (`server/services/scheduler-commit.ts`).
 *
 * The scheduler-commit service is 786 LOC of transaction logic intentionally
 * duplicated from the HTTP commit handler in `smart-import-routes.ts:1899`.
 * A full behavioural contract test requires a live DB and is best done as a
 * `qa/tests/api/` integration test (deferred).
 *
 * This file pins the *interface surface* — the shape of the discriminated
 * union and the options type — so that any silent refactor that adds or
 * drops a result branch fails CI. The session-wide audit flagged this as
 * a coverage gap (PR #902 follow-up).
 *
 * The orchestrator (`scheduled-import-v2.ts`) is the only caller and
 * pattern-matches on `result.status`; if a new branch is added without
 * updating the orchestrator, the type checker catches it — but only if
 * this file imports both types together.
 */

import { describe, expect, it, expectTypeOf } from "vitest";
import {
  commitSmartImportRunAsSystem,
  type SchedulerCommitResult,
  type SchedulerCommitOptions,
} from "../../../server/services/scheduler-commit";

describe("scheduler-commit contract pin", () => {
  describe("exports", () => {
    it("commitSmartImportRunAsSystem is callable", () => {
      expect(typeof commitSmartImportRunAsSystem).toBe("function");
    });

    it("returns a Promise", () => {
      // We can't actually invoke it (needs DB) but we can assert it's async.
      const fn = commitSmartImportRunAsSystem as unknown as { constructor: { name: string } };
      expect(fn.constructor.name).toBe("AsyncFunction");
    });
  });

  describe("SchedulerCommitOptions shape", () => {
    it("accepts a minimal { runId }", () => {
      const opts: SchedulerCommitOptions = { runId: 1 };
      expect(opts.runId).toBe(1);
    });

    it("accepts v2ConflictResolutions as a map of compound keys → decision", () => {
      const opts: SchedulerCommitOptions = {
        runId: 1,
        v2ConflictResolutions: {
          "plan::row-1::endDate": "accept_file",
          "expenditure::row-5::amount": "keep_app",
        },
      };
      expect(Object.keys(opts.v2ConflictResolutions ?? {}).length).toBe(2);
    });
  });

  describe("SchedulerCommitResult discriminated union", () => {
    // Each test builds a value of the union type — if a branch is renamed
    // or removed, TypeScript compilation fails and the test errors at
    // build time, not runtime.

    it("supports 'committed' branch with runId + counts + v2 + durationMs", () => {
      const result: SchedulerCommitResult = {
        status: "committed",
        runId: 42,
        counts: { planTasks: 1, revenueLines: 2, costLines: 3, executionPhases: 0 },
        v2: null,
        durationMs: 100,
      };
      expect(result.status).toBe("committed");
    });

    it("supports 'skipped_already_committed' early-return branch", () => {
      const result: SchedulerCommitResult = {
        status: "skipped_already_committed",
        runId: 1,
      };
      expect(result.status).toBe("skipped_already_committed");
    });

    it("supports 'skipped_no_normalization' branch", () => {
      const result: SchedulerCommitResult = {
        status: "skipped_no_normalization",
        runId: 1,
      };
      expect(result.status).toBe("skipped_no_normalization");
    });

    it("supports 'skipped_no_project_id' branch with reason", () => {
      const result: SchedulerCommitResult = {
        status: "skipped_no_project_id",
        runId: 1,
        reason: "scheduler only commits runs with a matched projectId",
      };
      expect(result.reason).toMatch(/projectId/);
    });

    it("supports 'skipped_recency_older' branch with timestamps", () => {
      const result: SchedulerCommitResult = {
        status: "skipped_recency_older",
        runId: 1,
        lastCommittedAt: new Date("2026-05-01"),
        currentUploadedAt: new Date("2026-04-01"),
      };
      expect(result.lastCommittedAt).toBeInstanceOf(Date);
    });

    it("supports 'skipped_recency_equal' branch", () => {
      const result: SchedulerCommitResult = {
        status: "skipped_recency_equal",
        runId: 1,
        lastCommittedAt: new Date("2026-05-01T12:00:00Z"),
        currentUploadedAt: new Date("2026-05-01T12:00:30Z"),
      };
      expect(result.status).toBe("skipped_recency_equal");
    });

    it("supports 'blocked_v2_conflicts' branch with conflict list", () => {
      const result: SchedulerCommitResult = {
        status: "blocked_v2_conflicts",
        runId: 1,
        conflicts: [
          { rowKey: "plan::row-7", fieldName: "endDate", mergeCase: "CONFLICT" },
        ],
      };
      expect(result.conflicts).toHaveLength(1);
    });

    it("supports 'blocked_writer_engine_conflicts' branch", () => {
      const result: SchedulerCommitResult = {
        status: "blocked_writer_engine_conflicts",
        runId: 1,
        conflicts: [] as any, // wizard-row type is internal; not asserting deep shape
      };
      expect(result.status).toBe("blocked_writer_engine_conflicts");
    });
  });

  describe("type narrowing — orchestrator should be able to pattern-match every branch", () => {
    // This simulates what `scheduled-import-v2.ts:processFileV2` does with
    // the result. If a new branch is added to the union without a case
    // here, the `never` assertion at the end fails compilation.
    function patternMatch(result: SchedulerCommitResult): string {
      switch (result.status) {
        case "committed":
          return `OK ${result.runId} planTasks=${result.counts.planTasks}`;
        case "skipped_already_committed":
        case "skipped_no_normalization":
          return `skip:${result.status}`;
        case "skipped_no_project_id":
          return `skip:${result.status} reason=${result.reason}`;
        case "skipped_recency_older":
        case "skipped_recency_equal":
          return `skip:${result.status} last=${result.lastCommittedAt?.toISOString() ?? ""}`;
        case "blocked_v2_conflicts":
          return `block:v2 n=${result.conflicts.length}`;
        case "blocked_writer_engine_conflicts":
          return `block:writer`;
        default: {
          // If this assertion fails to typecheck, a new branch was added
          // without updating the orchestrator's switch.
          const _exhaustive: never = result;
          return _exhaustive;
        }
      }
    }

    it("handles a 'committed' result", () => {
      const r: SchedulerCommitResult = {
        status: "committed",
        runId: 1,
        counts: { planTasks: 5, revenueLines: 0, costLines: 0, executionPhases: 0 },
        v2: null,
        durationMs: 50,
      };
      expect(patternMatch(r)).toBe("OK 1 planTasks=5");
    });

    it("handles every skip branch", () => {
      expect(patternMatch({ status: "skipped_already_committed", runId: 1 })).toBe("skip:skipped_already_committed");
      expect(patternMatch({ status: "skipped_no_normalization", runId: 1 })).toBe("skip:skipped_no_normalization");
      expect(patternMatch({ status: "skipped_no_project_id", runId: 1, reason: "x" })).toBe("skip:skipped_no_project_id reason=x");
    });

    it("handles block branches", () => {
      expect(
        patternMatch({ status: "blocked_v2_conflicts", runId: 1, conflicts: [] }),
      ).toBe("block:v2 n=0");
    });
  });

  describe("type-level pin", () => {
    it("commitSmartImportRunAsSystem returns Promise<SchedulerCommitResult>", () => {
      expectTypeOf(commitSmartImportRunAsSystem).returns.toEqualTypeOf<Promise<SchedulerCommitResult>>();
    });

    it("commitSmartImportRunAsSystem accepts exactly SchedulerCommitOptions", () => {
      expectTypeOf(commitSmartImportRunAsSystem).parameter(0).toEqualTypeOf<SchedulerCommitOptions>();
    });
  });
});
