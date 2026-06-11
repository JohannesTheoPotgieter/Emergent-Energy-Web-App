/**
 * Finance observability — pure decision logic.
 *
 * Pins every alert boundary (heartbeat staleness, freshness/drift thresholds,
 * error-rate, integrity roll-up, health levels) without a DB or a clock.
 */
import { describe, it, expect } from "vitest";
import {
  deriveJobHeartbeatState,
  shouldAlertJobTransition,
  classifyFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS,
  isErrorRateBreached,
  DEFAULT_ERROR_RATE_THRESHOLDS,
  rollupIntegrity,
  worstHealthLevel,
  jobStateToLevel,
  resolveJobConfig,
  FINANCE_JOBS,
} from "../../../server/lib/finance-observability";

const now = new Date("2026-06-11T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("deriveJobHeartbeatState", () => {
  const cfg = { expectedIntervalMs: 15 * MIN, graceMs: 75 * MIN }; // 90 min window

  it("is healthy when the last success is inside the window", () => {
    expect(
      deriveJobHeartbeatState({ lastSuccessAt: ago(30 * MIN), lastFailureAt: null, lastStatus: "success", ...cfg, now }),
    ).toBe("healthy");
  });

  it("is stale when the last success is older than the window", () => {
    expect(
      deriveJobHeartbeatState({ lastSuccessAt: ago(3 * HOUR), lastFailureAt: null, lastStatus: "success", ...cfg, now }),
    ).toBe("stale");
  });

  it("is failing when the last run failed after the last success", () => {
    expect(
      deriveJobHeartbeatState({ lastSuccessAt: ago(2 * HOUR), lastFailureAt: ago(10 * MIN), lastStatus: "failure", ...cfg, now }),
    ).toBe("failing");
  });

  it("is unknown when never run and still inside the first window", () => {
    expect(
      deriveJobHeartbeatState({ lastSuccessAt: null, lastFailureAt: null, lastStatus: null, registeredAt: ago(10 * MIN), ...cfg, now }),
    ).toBe("unknown");
  });

  it("is STALE when a registered job has never produced a run past its window (dead scheduler that never started)", () => {
    expect(
      deriveJobHeartbeatState({ lastSuccessAt: null, lastFailureAt: null, lastStatus: null, registeredAt: ago(5 * HOUR), ...cfg, now }),
    ).toBe("stale");
  });
});

describe("shouldAlertJobTransition", () => {
  it("fires now_stale on unknown -> stale (unlike the integration rule)", () => {
    expect(shouldAlertJobTransition({ prev: "unknown", next: "stale" })).toBe("now_stale");
  });
  it("fires now_stale on healthy -> stale", () => {
    expect(shouldAlertJobTransition({ prev: "healthy", next: "stale" })).toBe("now_stale");
  });
  it("fires now_failing into failing", () => {
    expect(shouldAlertJobTransition({ prev: "healthy", next: "failing" })).toBe("now_failing");
  });
  it("fires recovery on stale -> healthy", () => {
    expect(shouldAlertJobTransition({ prev: "stale", next: "healthy" })).toBe("recovered_to_healthy");
  });
  it("suppresses no-change and transitions into unknown", () => {
    expect(shouldAlertJobTransition({ prev: "stale", next: "stale" })).toBeNull();
    expect(shouldAlertJobTransition({ prev: "healthy", next: "unknown" })).toBeNull();
  });
});

describe("classifyFreshness", () => {
  it("breaches tracker import age, qb recon age, variance and drift over threshold", () => {
    const signals = classifyFreshness(
      {
        trackerImportAgeMs: DEFAULT_FRESHNESS_THRESHOLDS.trackerImportMaxAgeMs + HOUR,
        qbReconAgeMs: DEFAULT_FRESHNESS_THRESHOLDS.qbReconMaxAgeMs + HOUR,
        trackerVsQbVarianceRand: DEFAULT_FRESHNESS_THRESHOLDS.trackerVsQbVarianceRand + 1,
        appVsTrackerDriftCount: DEFAULT_FRESHNESS_THRESHOLDS.appVsTrackerDriftCount + 1,
      },
      DEFAULT_FRESHNESS_THRESHOLDS,
    );
    expect(signals.every((s) => s.breached)).toBe(true);
  });

  it("does not breach on null observations or in-threshold values", () => {
    const signals = classifyFreshness(
      { trackerImportAgeMs: null, qbReconAgeMs: 0, trackerVsQbVarianceRand: 0, appVsTrackerDriftCount: 0 },
      DEFAULT_FRESHNESS_THRESHOLDS,
    );
    expect(signals.some((s) => s.breached)).toBe(false);
  });
});

describe("isErrorRateBreached", () => {
  it("breaches at the threshold", () => {
    expect(isErrorRateBreached(DEFAULT_ERROR_RATE_THRESHOLDS.countThreshold, DEFAULT_ERROR_RATE_THRESHOLDS)).toBe(true);
    expect(isErrorRateBreached(DEFAULT_ERROR_RATE_THRESHOLDS.countThreshold - 1, DEFAULT_ERROR_RATE_THRESHOLDS)).toBe(false);
  });
});

describe("rollupIntegrity", () => {
  it("drifts when any check drifts and sums drift counts", () => {
    const r = rollupIntegrity([
      { outcome: "pass", driftCount: 0 },
      { outcome: "drift", driftCount: 3 },
      { outcome: "skipped", driftCount: 0 },
    ]);
    expect(r.status).toBe("drift");
    expect(r.driftCount).toBe(3);
    expect(r.shouldAlert).toBe(true);
  });
  it("is skipped only when every check skipped", () => {
    expect(rollupIntegrity([{ outcome: "skipped", driftCount: 0 }, { outcome: "skipped", driftCount: 0 }]).status).toBe("skipped");
  });
  it("passes when at least one real check ran green", () => {
    const r = rollupIntegrity([{ outcome: "pass", driftCount: 0 }, { outcome: "skipped", driftCount: 0 }]);
    expect(r.status).toBe("pass");
    expect(r.shouldAlert).toBe(false);
  });
  it("errors when a check errored and none drifted", () => {
    expect(rollupIntegrity([{ outcome: "error", driftCount: 0 }, { outcome: "pass", driftCount: 0 }]).status).toBe("error");
  });
});

describe("health roll-up", () => {
  it("worst-wins across components", () => {
    expect(worstHealthLevel(["healthy", "warn", "critical"])).toBe("critical");
    expect(worstHealthLevel(["healthy", "healthy"])).toBe("healthy");
    expect(worstHealthLevel([])).toBe("unknown");
  });
  it("maps job states to levels", () => {
    expect(jobStateToLevel("failing")).toBe("critical");
    expect(jobStateToLevel("stale")).toBe("warn");
    expect(jobStateToLevel("healthy")).toBe("healthy");
    expect(jobStateToLevel("unknown")).toBe("unknown");
  });
});

describe("resolveJobConfig", () => {
  it("applies an env interval override", () => {
    const job = FINANCE_JOBS.find((j) => j.key === "derived-project-kpis")!;
    const resolved = resolveJobConfig(job, { FINANCE_JOB_DERIVED_PROJECT_KPIS_INTERVAL_MS: "60000" });
    expect(resolved.expectedIntervalMs).toBe(60000);
  });
  it("ignores an invalid override", () => {
    const job = FINANCE_JOBS.find((j) => j.key === "qb-recon-refresh")!;
    expect(resolveJobConfig(job, { FINANCE_JOB_QB_RECON_REFRESH_INTERVAL_MS: "nope" }).expectedIntervalMs).toBe(
      job.expectedIntervalMs,
    );
  });
});
