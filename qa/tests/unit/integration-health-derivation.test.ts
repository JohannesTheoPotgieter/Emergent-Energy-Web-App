/**
 * C1 — Integration health derivation.
 *
 * Pure-logic tests. The DB side of the service (recordIntegrationRun,
 * getIntegrationHealth, seedIntegrationRegistry) is covered by the
 * release gate against a live test DB. This file pins the
 * healthy / stale / failing / unknown thresholds so a future refactor
 * can't silently shift the dashboard.
 *
 * Confirmed defaults (per user direction):
 *   - healthy : last success within 25h
 *   - stale   : no success in 25h, no recent failure
 *   - failing : last run failed OR last failure newer than last success
 *   - unknown : no runs ever recorded
 */

import { describe, expect, it } from "vitest";
import {
  deriveIntegrationHealth,
  INTEGRATION_HEALTHY_WINDOW_MS,
} from "../../../server/services/integration-health-service";
import {
  INTEGRATION_HEALTH_STATES,
  INTEGRATION_RUN_STATUSES,
  INTEGRATION_SEED,
} from "../../../shared/schema/integrations";

const NOW = new Date("2026-04-13T12:00:00Z");
const msAgo = (ms: number) => new Date(NOW.getTime() - ms);

describe("C1 — deriveIntegrationHealth", () => {
  it("returns 'unknown' when there are no runs at all", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      now: NOW,
    });
    expect(h).toBe("unknown");
  });

  it("returns 'healthy' when the last success is inside the 25h window", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(60 * 60 * 1000), // 1h ago
      lastRunAt: msAgo(60 * 60 * 1000),
      lastRunStatus: "success",
      now: NOW,
    });
    expect(h).toBe("healthy");
  });

  it("returns 'healthy' exactly at the 25h boundary", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(INTEGRATION_HEALTHY_WINDOW_MS),
      lastRunAt: msAgo(INTEGRATION_HEALTHY_WINDOW_MS),
      lastRunStatus: "success",
      now: NOW,
    });
    expect(h).toBe("healthy");
  });

  it("returns 'stale' when the last success is older than 25h and no recent failure", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(INTEGRATION_HEALTHY_WINDOW_MS + 60 * 1000),
      lastRunAt: msAgo(INTEGRATION_HEALTHY_WINDOW_MS + 60 * 1000),
      lastRunStatus: "success",
      now: NOW,
    });
    expect(h).toBe("stale");
  });

  it("returns 'failing' when the most recent run is a failure newer than the last success", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(60 * 60 * 1000), // 1h ago
      lastRunAt: msAgo(10 * 60 * 1000), // 10min ago
      lastRunStatus: "failure",
      now: NOW,
    });
    expect(h).toBe("failing");
  });

  it("returns 'failing' when there are runs but no success ever", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: null,
      lastRunAt: msAgo(60 * 60 * 1000),
      lastRunStatus: "failure",
      now: NOW,
    });
    expect(h).toBe("failing");
  });

  it("returns 'healthy' when a recent success follows an older failure", () => {
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(10 * 60 * 1000), // 10min ago
      lastRunAt: msAgo(10 * 60 * 1000),
      lastRunStatus: "success",
      now: NOW,
    });
    expect(h).toBe("healthy");
  });

  it("a 'partial' most-recent run does NOT flip to failing on its own", () => {
    // partial runs are informational; only 'failure' trips the gate
    const h = deriveIntegrationHealth({
      lastSuccessAt: msAgo(60 * 60 * 1000),
      lastRunAt: msAgo(10 * 60 * 1000),
      lastRunStatus: "partial",
      now: NOW,
    });
    expect(h).toBe("healthy");
  });
});

describe("C1 — shape + enums", () => {
  it("INTEGRATION_HEALTH_STATES is exactly the 4 agreed states", () => {
    expect([...INTEGRATION_HEALTH_STATES].sort()).toEqual(
      ["failing", "healthy", "stale", "unknown"].sort(),
    );
  });

  it("INTEGRATION_RUN_STATUSES is exactly the 3 run outcomes", () => {
    expect([...INTEGRATION_RUN_STATUSES].sort()).toEqual(
      ["failure", "partial", "success"].sort(),
    );
  });

  it("INTEGRATION_HEALTHY_WINDOW_MS is 25 hours", () => {
    expect(INTEGRATION_HEALTHY_WINDOW_MS).toBe(25 * 60 * 60 * 1000);
  });
});

describe("C1 — INTEGRATION_SEED", () => {
  it("seeds at least Pipedrive, Microsoft 365, and ClickUp", () => {
    const names = INTEGRATION_SEED.map((s) => s.name);
    expect(names).toContain("pipedrive");
    expect(names).toContain("microsoft_365");
    expect(names).toContain("clickup");
  });

  it("every seed row has a displayName, description, owner and fallback", () => {
    for (const seed of INTEGRATION_SEED) {
      expect(seed.displayName.length).toBeGreaterThan(0);
      expect(seed.description.length).toBeGreaterThan(10);
      expect(seed.ownerProcess.length).toBeGreaterThan(0);
      expect(seed.fallbackDescription.length).toBeGreaterThan(10);
      expect(seed.alertTarget.length).toBeGreaterThan(0);
    }
  });

  it("seed names are unique", () => {
    const names = INTEGRATION_SEED.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
