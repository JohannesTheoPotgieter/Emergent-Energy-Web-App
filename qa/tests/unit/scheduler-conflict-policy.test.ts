import { describe, expect, it } from "vitest";
import { resolveSchedulerConflictPolicy } from "../../../server/imports/scheduler-conflict-policy";
import type { PlannerResult } from "../../../server/lib/import/planner";

// Build a minimal PlannerResult fixture. Anything the policy doesn't read
// gets a defensible default; only the fields the policy inspects are
// meaningful per test.
function makePlannerResult(overrides: Partial<{
  hasBlockingConflicts: boolean;
  allRows: Array<{
    rowKey: string;
    conflictStatus: "HAS_CONFLICTS" | "AUTO_RESOLVED" | "NO_CONFLICT";
    fields: Array<{
      fieldName: string;
      requiresDecision: boolean;
      mergeCase: string;
      baselineValue?: unknown;
      currentAppValue?: unknown;
      uploadedValue?: unknown;
    }>;
  }>;
}> = {}): PlannerResult {
  return {
    importMode: "INCREMENTAL",
    warnings: [],
    sections: { PLAN: null, REVENUE: null, EXPENDITURE: null },
    conflicts: {
      hasBlockingConflicts: overrides.hasBlockingConflicts ?? false,
      summary: {
        totalConflictRows: 0,
        unresolvedConflictRows: 0,
        autoResolvedRows: 0,
        sections: { PLAN: null, REVENUE: null, EXPENDITURE: null },
      },
      allRows: (overrides.allRows ?? []).map((row) => ({
        rowKey: row.rowKey,
        displayLabel: row.rowKey,
        section: "PLAN" as const,
        canonicalSource: "work_items",
        existingRowId: null,
        fileIndex: null,
        conflictStatus: row.conflictStatus,
        fields: row.fields.map((f) => ({
          fieldName: f.fieldName,
          baselineValue: f.baselineValue ?? null,
          currentAppValue: f.currentAppValue ?? null,
          uploadedValue: f.uploadedValue ?? null,
          mergeCase: f.mergeCase as any,
          requiresDecision: f.requiresDecision,
        })),
      })) as any,
    } as any,
  } as PlannerResult;
}

describe("scheduler conflict policy", () => {
  describe("commit decision", () => {
    it("commits when planner reports no blocking conflicts", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({ hasBlockingConflicts: false }));
      expect(result.decision).toBe("commit");
      expect(result.reason).toBe("no_blocking_conflicts");
      expect(result.resolutions).toEqual({});
      expect(result.unresolvable).toEqual([]);
    });

    it("commits when every row is AUTO_RESOLVED (engine already classified)", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: false,
        allRows: [
          {
            rowKey: "row-1",
            conflictStatus: "AUTO_RESOLVED",
            fields: [
              { fieldName: "amount", mergeCase: "AUTO_ACCEPT_FILE", requiresDecision: false },
              { fieldName: "notes", mergeCase: "KEEP_APP", requiresDecision: false },
            ],
          },
        ],
      }));
      expect(result.decision).toBe("commit");
    });

    it("commits when rows are NO_CONFLICT (everything UNCHANGED)", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: false,
        allRows: [
          {
            rowKey: "row-1",
            conflictStatus: "NO_CONFLICT",
            fields: [{ fieldName: "amount", mergeCase: "UNCHANGED", requiresDecision: false }],
          },
        ],
      }));
      expect(result.decision).toBe("commit");
    });
  });

  describe("park decision", () => {
    it("parks when planner reports blocking conflicts", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: true,
        allRows: [
          {
            rowKey: "plan::row-7",
            conflictStatus: "HAS_CONFLICTS",
            fields: [
              {
                fieldName: "endDate",
                mergeCase: "CONFLICT",
                requiresDecision: true,
                baselineValue: "2026-05-01",
                currentAppValue: "2026-05-15",
                uploadedValue: "2026-05-20",
              },
            ],
          },
        ],
      }));
      expect(result.decision).toBe("park");
      expect(result.reason).toBe("unresolvable_conflicts_1");
      expect(result.unresolvable).toHaveLength(1);
      expect(result.unresolvable[0]).toMatchObject({
        rowKey: "plan::row-7",
        fieldName: "endDate",
        mergeCase: "CONFLICT",
        baselineValue: "2026-05-01",
        currentAppValue: "2026-05-15",
        uploadedValue: "2026-05-20",
      });
      expect(result.resolutions).toEqual({});
    });

    it("captures every CONFLICT field across multiple rows", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: true,
        allRows: [
          {
            rowKey: "revenue::r1",
            conflictStatus: "HAS_CONFLICTS",
            fields: [
              { fieldName: "amount", mergeCase: "CONFLICT", requiresDecision: true },
              { fieldName: "notes", mergeCase: "KEEP_APP", requiresDecision: false },
            ],
          },
          {
            rowKey: "expenditure::r2",
            conflictStatus: "HAS_CONFLICTS",
            fields: [
              { fieldName: "amount", mergeCase: "CONFLICT", requiresDecision: true },
            ],
          },
        ],
      }));
      expect(result.decision).toBe("park");
      expect(result.unresolvable).toHaveLength(2);
      expect(result.unresolvable.map((u) => u.rowKey)).toEqual(["revenue::r1", "expenditure::r2"]);
    });

    it("ignores AUTO_RESOLVED rows even when other rows have CONFLICT", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: true,
        allRows: [
          {
            rowKey: "row-clean",
            conflictStatus: "AUTO_RESOLVED",
            fields: [{ fieldName: "amount", mergeCase: "AUTO_ACCEPT_FILE", requiresDecision: false }],
          },
          {
            rowKey: "row-dirty",
            conflictStatus: "HAS_CONFLICTS",
            fields: [{ fieldName: "amount", mergeCase: "CONFLICT", requiresDecision: true }],
          },
        ],
      }));
      expect(result.decision).toBe("park");
      expect(result.unresolvable).toHaveLength(1);
      expect(result.unresolvable[0].rowKey).toBe("row-dirty");
    });

    it("parks even if blocking flag is set but no CONFLICT field is visible (defensive)", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: true,
        allRows: [],
      }));
      expect(result.decision).toBe("park");
      expect(result.reason).toBe("blocking_conflicts_without_field_detail");
      expect(result.unresolvable).toEqual([]);
    });
  });

  describe("never auto-resolves a 3-way CONFLICT", () => {
    it("returns empty resolutions even when one safe field could be auto-resolved", () => {
      const result = resolveSchedulerConflictPolicy(makePlannerResult({
        hasBlockingConflicts: true,
        allRows: [
          {
            rowKey: "row-1",
            conflictStatus: "HAS_CONFLICTS",
            fields: [
              { fieldName: "amount", mergeCase: "AUTO_ACCEPT_FILE", requiresDecision: false },
              { fieldName: "endDate", mergeCase: "CONFLICT", requiresDecision: true },
            ],
          },
        ],
      }));
      expect(result.decision).toBe("park");
      expect(result.resolutions).toEqual({});
    });
  });
});
