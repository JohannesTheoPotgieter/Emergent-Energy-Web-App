import { describe, it, expect } from "vitest";
import {
  summarizeLastAutoPull,
  type SmartImportRunRow,
} from "../../../server/lib/import/last-auto-pull-summary";

function run(partial: Partial<SmartImportRunRow> & { id: number }): SmartImportRunRow {
  return {
    projectId: null,
    projectName: null,
    sourceFileName: null,
    status: "committed",
    committedAt: null,
    uploadedAt: null,
    summaryJson: null,
    ...partial,
  };
}

describe("summarizeLastAutoPull", () => {
  it("returns null when there are no scheduler-produced runs", () => {
    const rows = [
      run({ id: 1, summaryJson: null }),
      // A manual upload carries no schedulerV2.batchRunId.
      run({ id: 2, summaryJson: { manualUpload: { triggerType: "manual" } } }),
    ];
    expect(summarizeLastAutoPull(rows)).toBeNull();
  });

  it("groups only the most recent batch and ignores older batches + manual runs", () => {
    const rows: SmartImportRunRow[] = [
      // Newest-first ordering, as the route supplies.
      run({
        id: 10,
        projectName: "Project A",
        sourceFileName: "A.xlsx",
        status: "committed",
        uploadedAt: "2026-06-18T10:00:00Z",
        summaryJson: {
          schedulerV2: { batchRunId: "batch_2", matchSource: "binding" },
          normalization: { revenueLines: [1, 2, 3], costLines: [1, 2] },
        },
      }),
      run({
        id: 11,
        projectName: "Project B",
        sourceFileName: "B.xlsx",
        status: "awaiting_review",
        uploadedAt: "2026-06-18T09:59:00Z",
        summaryJson: {
          schedulerV2: {
            batchRunId: "batch_2",
            autoCommitGate: { decision: "park", reason: "net_delta_exceeded" },
          },
          normalization: { planTasks: [1] },
        },
      }),
      // Older batch — must be excluded.
      run({
        id: 5,
        sourceFileName: "old.xlsx",
        status: "committed",
        uploadedAt: "2026-06-17T08:00:00Z",
        summaryJson: { schedulerV2: { batchRunId: "batch_1" } },
      }),
      // Manual run — excluded.
      run({ id: 6, summaryJson: { manualUpload: {} } }),
    ];

    const batch = summarizeLastAutoPull(rows);
    expect(batch).not.toBeNull();
    expect(batch!.batchRunId).toBe("batch_2");
    expect(batch!.ranAt).toBe("2026-06-18T10:00:00Z");
    expect(batch!.files.map((f) => f.runId)).toEqual([10, 11]);
    expect(batch!.counts).toEqual({
      total: 2,
      committed: 1,
      needsReview: 1,
      failed: 0,
      inProgress: 0,
    });

    const a = batch!.files.find((f) => f.runId === 10)!;
    expect(a.sections).toEqual(["Revenue", "Expenditure"]);
    expect(a.changeCounts).toEqual({ plan: 0, revenue: 3, expenditure: 2 });
    expect(a.matchSource).toBe("binding");
    expect(a.reason).toBeNull();

    const b = batch!.files.find((f) => f.runId === 11)!;
    expect(b.sections).toEqual(["Plan"]);
    expect(b.reason).toBe("net_delta_exceeded");
  });

  it("counts failures and derives the reason with error > quarantine > gate precedence", () => {
    const rows: SmartImportRunRow[] = [
      run({
        id: 20,
        status: "failed",
        uploadedAt: "2026-06-18T11:00:00Z",
        summaryJson: {
          schedulerV2: {
            batchRunId: "batch_9",
            // error envelope wins over any gate/quarantine signal
            autoCommitGate: { decision: "park", reason: "should_not_win" },
          },
          error: { message: "Commit transaction rolled back" },
        },
      }),
      run({
        id: 21,
        status: "awaiting_review",
        uploadedAt: "2026-06-18T10:59:00Z",
        summaryJson: {
          schedulerV2: {
            batchRunId: "batch_9",
            quarantine: { kind: "older_revision", reason: "newer copy present" },
          },
        },
      }),
    ];

    const batch = summarizeLastAutoPull(rows)!;
    expect(batch.counts).toEqual({
      total: 2,
      committed: 0,
      needsReview: 1,
      failed: 1,
      inProgress: 0,
    });
    expect(batch.files.find((f) => f.runId === 20)!.reason).toBe("Commit transaction rolled back");
    expect(batch.files.find((f) => f.runId === 21)!.reason).toBe(
      "Older revision: newer copy present",
    );
  });
});
