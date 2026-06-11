/**
 * Finance observability — alert firing (ACCEPTANCE).
 *
 * Demonstrates each freeze-hardening alert FIRES on a simulated failure:
 *   - heartbeat dead-man's switch (job stale / failing)
 *   - data-freshness / drift breach
 *   - finance error-rate over threshold
 *   - weekly integrity guard finds drift
 *
 * Each test injects a simulated failure and asserts the owner is paged, without
 * touching a live DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// The error-monitor pages the owner via the real notify wrapper — mock it so we
// can assert the page without the dispatch pipeline / DB. The injected-deps
// tests below use their own spies and are unaffected.
vi.mock("../../../server/services/finance-observability/notify", () => ({
  notifyFinanceOwner: vi.fn(async () => {}),
  maybeSendFinanceTeamsAlert: vi.fn(async () => {}),
  FINANCE_OBSERVABILITY_ENTITY: "finance_observability",
}));

import { notifyFinanceOwner } from "../../../server/services/finance-observability/notify";
import {
  sweepFinanceJobHeartbeats,
  type HeartbeatSweepDeps,
} from "../../../server/services/finance-observability/job-heartbeats";
import {
  sweepFinanceFreshness,
  type FreshnessSweepDeps,
} from "../../../server/services/finance-observability/freshness";
import {
  recordFinanceServerError,
  checkErrorRateAndAlert,
  __resetFinanceErrorMonitorForTests,
} from "../../../server/services/finance-observability/error-monitor";
import { runFinanceIntegrityGuard } from "../../../server/services/finance-observability/integrity-guard";
import { DEFAULT_ERROR_RATE_THRESHOLDS } from "../../../server/lib/finance-observability";
import type { FinanceJobHeartbeat } from "../../../shared/schema/finance-observability";
import type { FinanceFreshnessReport } from "../../../server/services/finance-observability/freshness";

const now = new Date("2026-06-11T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

function makeHeartbeatRow(over: Partial<FinanceJobHeartbeat>): FinanceJobHeartbeat {
  return {
    id: 1,
    jobKey: "derived-project-kpis",
    lastStartedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastStatus: null,
    lastDurationMs: null,
    lastError: null,
    consecutiveFailures: 0,
    runCount: 0,
    lastAlertState: null,
    lastAlertAt: null,
    metadata: null,
    createdAt: ago(60 * 60 * 1000),
    updatedAt: now,
    ...over,
  } as FinanceJobHeartbeat;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFinanceErrorMonitorForTests();
});

describe("dead-man's switch — heartbeat sweep", () => {
  it("pages the owner when a finance job goes STALE", async () => {
    const notify = vi.fn(async () => {});
    const persisted: Array<{ id: number; next: string }> = [];
    const deps: HeartbeatSweepDeps = {
      // derived-project-kpis succeeded 5h ago — well past its 90-min window.
      loadRows: async () => [
        makeHeartbeatRow({ lastSuccessAt: ago(5 * 60 * 60 * 1000), lastStatus: "success", lastAlertState: "healthy" }),
      ],
      persistAlertState: async (id, next) => {
        persisted.push({ id, next });
      },
      notify,
    };

    const result = await sweepFinanceJobHeartbeats(now, deps);

    expect(result.fired).toBeGreaterThanOrEqual(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "finance_job_stale" }),
    );
    expect(persisted.some((p) => p.next === "stale")).toBe(true);
  });

  it("pages the owner when a finance job is FAILING", async () => {
    const notify = vi.fn(async () => {});
    const deps: HeartbeatSweepDeps = {
      loadRows: async () => [
        makeHeartbeatRow({
          jobKey: "qb-recon-refresh",
          lastSuccessAt: ago(48 * 60 * 60 * 1000),
          lastFailureAt: ago(60 * 1000),
          lastStatus: "failure",
          consecutiveFailures: 3,
          lastError: "QuickBooks unreachable",
        }),
      ],
      persistAlertState: async () => {},
      notify,
    };

    const result = await sweepFinanceJobHeartbeats(now, deps);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "finance_job_failing", critical: true }));
    expect(result.fired).toBe(1);
  });

  it("does NOT page when all jobs are healthy", async () => {
    const notify = vi.fn(async () => {});
    const deps: HeartbeatSweepDeps = {
      loadRows: async () => [
        makeHeartbeatRow({ lastSuccessAt: ago(60 * 1000), lastStatus: "success", lastAlertState: "healthy" }),
      ],
      persistAlertState: async () => {},
      notify,
    };
    const result = await sweepFinanceJobHeartbeats(now, deps);
    expect(result.fired).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("data-freshness sweep", () => {
  it("pages the owner on a freshness/drift breach", async () => {
    const notify = vi.fn(async () => {});
    const report: FinanceFreshnessReport = {
      generatedAt: now.toISOString(),
      thresholds: { trackerImportMaxAgeMs: 1, qbReconMaxAgeMs: 1, trackerVsQbVarianceRand: 1, appVsTrackerDriftCount: 1 },
      observations: {
        trackerImportLastSuccessAt: null,
        qbReconComputedAt: null,
        trackerVsQbVarianceRand: 9999,
        appVsTrackerDriftCount: 0,
      },
      anyBreached: true,
      signals: [
        { key: "tracker_vs_qb_variance", breached: true, value: 9999, threshold: 1, detail: "variance R9999 over limit" },
        { key: "qb_recon_stale", breached: false, value: 0, threshold: 1, detail: "" },
      ],
    };
    const deps: FreshnessSweepDeps = { getReport: async () => report, notify };

    const result = await sweepFinanceFreshness(now, deps);

    expect(result.breaches).toContain("tracker_vs_qb_variance");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "finance_freshness_tracker_vs_qb_variance", critical: true }),
    );
  });
});

describe("finance error-rate alert", () => {
  it("pages the owner when finance 5xx crosses the threshold", async () => {
    for (let i = 0; i < DEFAULT_ERROR_RATE_THRESHOLDS.countThreshold; i++) {
      recordFinanceServerError({ route: "GET /api/finance/lines/1", status: 500 }, now);
    }
    const result = await checkErrorRateAndAlert(now);

    expect(result.fired).toBe(true);
    expect(vi.mocked(notifyFinanceOwner)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "finance_error_rate_high", critical: true }),
    );
  });

  it("does not page below the threshold", async () => {
    recordFinanceServerError({ route: "GET /api/finance/lines/1", status: 500 }, now);
    const result = await checkErrorRateAndAlert(now);
    expect(result.fired).toBe(false);
    expect(vi.mocked(notifyFinanceOwner)).not.toHaveBeenCalled();
  });
});

describe("weekly integrity guard", () => {
  it("pages the owner immediately on DRIFT and records the run", async () => {
    const notify = vi.fn(async () => {});
    let persistedStatus: string | null = null;
    let markedAlerted = false;

    const result = await runFinanceIntegrityGuard({
      runType: "manual",
      deps: {
        getDbMode: () => "postgres",
        runGolden: async () => ({ outcome: "drift", driftCount: 3, detail: { sample: [] } }),
        runCrossSurface: async () => ({ outcome: "pass", driftCount: 0, detail: {} }),
        runReconciliation: async () => ({ outcome: "pass", driftCount: 0, detail: {} }),
        persistRun: async (row) => {
          persistedStatus = row.status as string;
          return 42;
        },
        markAlerted: async () => {
          markedAlerted = true;
        },
        notify,
        recordHeartbeat: async () => {},
        now: () => now,
      },
    });

    expect(result.status).toBe("drift");
    expect(result.driftCount).toBe(3);
    expect(result.alertDispatched).toBe(true);
    expect(persistedStatus).toBe("drift");
    expect(markedAlerted).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "finance_integrity_drift", critical: true }),
    );
  });

  it("does NOT page when all checks pass", async () => {
    const notify = vi.fn(async () => {});
    const result = await runFinanceIntegrityGuard({
      deps: {
        getDbMode: () => "postgres",
        runGolden: async () => ({ outcome: "pass", driftCount: 0, detail: {} }),
        runCrossSurface: async () => ({ outcome: "pass", driftCount: 0, detail: {} }),
        runReconciliation: async () => ({ outcome: "pass", driftCount: 0, detail: {} }),
        persistRun: async () => 1,
        markAlerted: async () => {},
        notify,
        recordHeartbeat: async () => {},
        now: () => now,
      },
    });
    expect(result.status).toBe("pass");
    expect(result.alertDispatched).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
