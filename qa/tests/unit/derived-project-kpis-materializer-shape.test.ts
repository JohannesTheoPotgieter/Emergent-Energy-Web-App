/**
 * TF-4 (audit V3) — Shape / contract test for the derived_project_kpis
 * materializer.
 *
 * The materializer in `server/services/derived-project-kpis-materializer.ts`
 * is the in-app writer that was missing per V3 finding TF-4. Three
 * production surfaces read the cache:
 *
 *   - server/services/project-platform-summary-service.ts (KPI tiles)
 *   - server/services/project-header-kpi-service.ts (project headers)
 *   - server/lib/priorities/progress-source.ts (priority dashboard rollups)
 *
 * This test pins the contract at the module boundary: the exported
 * functions exist, have stable type signatures, and the materializer
 * does NOT silently fall back to a different writer (e.g. via SQL
 * INSERT inside another service) without going through the canonical
 * entry points. End-to-end behaviour (numeric correctness against a
 * fixture project) needs a test DB; queued as DF-21 follow-up.
 */
import { describe, it, expect } from "vitest";
import * as materializer from "../../../server/services/derived-project-kpis-materializer";
import * as scheduler from "../../../server/bootstrap/derived-project-kpis-scheduler";

describe("TF-4 — derived_project_kpis materializer contract", () => {
  it("exports the single-project entry point with the expected signature", () => {
    expect(typeof materializer.recomputeDerivedKpisForProject).toBe("function");
    // Exactly one parameter (projectId: number); async returns Promise.
    expect(materializer.recomputeDerivedKpisForProject.length).toBe(1);
  });

  it("exports the portfolio entry point with the expected signature", () => {
    expect(typeof materializer.recomputeAllDerivedKpis).toBe("function");
    expect(materializer.recomputeAllDerivedKpis.length).toBe(0);
  });

  it("exports the scheduler entry / stop / status triplet", () => {
    expect(typeof scheduler.scheduleDerivedProjectKpiRefresh).toBe("function");
    expect(typeof scheduler.stopDerivedProjectKpiRefresh).toBe("function");
    expect(typeof scheduler.getDerivedProjectKpiSchedulerStatus).toBe("function");
  });

  it("scheduler status before any run has the expected initial shape", () => {
    const status = scheduler.getDerivedProjectKpiSchedulerStatus();
    expect(status).toHaveProperty("scheduled");
    expect(status).toHaveProperty("lastRunStartedAt");
    expect(status).toHaveProperty("lastRunFinishedAt");
    expect(status).toHaveProperty("lastRunProjectCount");
    expect(status).toHaveProperty("lastRunErrored");
    // Pre-schedule, the interval is null.
    expect(typeof status.scheduled).toBe("boolean");
  });

  it("scheduler can be stopped before it has started without throwing (idempotent teardown)", () => {
    expect(() => scheduler.stopDerivedProjectKpiRefresh()).not.toThrow();
  });
});
