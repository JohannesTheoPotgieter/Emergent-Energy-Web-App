/**
 * C2 — Dashboard freshness derivation + registry shape.
 *
 * Pure-logic tests. The DB write path (refreshDashboard,
 * refreshAllDashboards, getDashboardSnapshot) is covered by the
 * release gate against a live test DB; this file pins the
 * 2h/4h/unknown boundaries and the registry behaviour so a future
 * change can't silently shift the exec freshness indicator.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_DEFAULT_FRESH_MS,
  DASHBOARD_DEFAULT_STALE_MS,
  DASHBOARD_REFRESH_INTERVAL_MS,
  deriveDashboardFreshness,
  listRegisteredDashboards,
  registerDashboard,
  __clearDashboardRegistryForTests,
} from "../../../server/services/dashboard-refresh-service";
import { DASHBOARD_FRESHNESS_STATES } from "../../../shared/schema/dashboard-snapshots";

const NOW = new Date("2026-04-13T12:00:00Z");
const msAgo = (ms: number) => new Date(NOW.getTime() - ms);

afterEach(() => {
  __clearDashboardRegistryForTests();
});

describe("C2 — deriveDashboardFreshness (default 2h fresh / 4h stale)", () => {
  it("returns 'unknown' when there has never been a successful refresh", () => {
    const f = deriveDashboardFreshness({ lastSuccessAt: null, now: NOW });
    expect(f).toBe("unknown");
  });

  it("returns 'fresh' for an age of 5 minutes", () => {
    const f = deriveDashboardFreshness({ lastSuccessAt: msAgo(5 * 60 * 1000), now: NOW });
    expect(f).toBe("fresh");
  });

  it("returns 'fresh' exactly at the 2h boundary", () => {
    const f = deriveDashboardFreshness({
      lastSuccessAt: msAgo(DASHBOARD_DEFAULT_FRESH_MS),
      now: NOW,
    });
    expect(f).toBe("fresh");
  });

  it("returns 'warn' when age is between 2h and 4h", () => {
    const f = deriveDashboardFreshness({
      lastSuccessAt: msAgo(DASHBOARD_DEFAULT_FRESH_MS + 60 * 1000),
      now: NOW,
    });
    expect(f).toBe("warn");
  });

  it("returns 'warn' exactly at the 4h boundary", () => {
    const f = deriveDashboardFreshness({
      lastSuccessAt: msAgo(DASHBOARD_DEFAULT_STALE_MS),
      now: NOW,
    });
    expect(f).toBe("warn");
  });

  it("returns 'stale' when age exceeds the 4h cutoff", () => {
    const f = deriveDashboardFreshness({
      lastSuccessAt: msAgo(DASHBOARD_DEFAULT_STALE_MS + 60 * 1000),
      now: NOW,
    });
    expect(f).toBe("stale");
  });

  it("honours per-dashboard overrides", () => {
    // Tight 10min/20min windows.
    const fresh = deriveDashboardFreshness({
      lastSuccessAt: msAgo(5 * 60 * 1000),
      now: NOW,
      freshWindowMs: 10 * 60 * 1000,
      staleWindowMs: 20 * 60 * 1000,
    });
    const warn = deriveDashboardFreshness({
      lastSuccessAt: msAgo(15 * 60 * 1000),
      now: NOW,
      freshWindowMs: 10 * 60 * 1000,
      staleWindowMs: 20 * 60 * 1000,
    });
    const stale = deriveDashboardFreshness({
      lastSuccessAt: msAgo(25 * 60 * 1000),
      now: NOW,
      freshWindowMs: 10 * 60 * 1000,
      staleWindowMs: 20 * 60 * 1000,
    });
    expect(fresh).toBe("fresh");
    expect(warn).toBe("warn");
    expect(stale).toBe("stale");
  });
});

describe("C2 — thresholds + constants", () => {
  it("default fresh window is 2 hours", () => {
    expect(DASHBOARD_DEFAULT_FRESH_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("default stale window is 4 hours", () => {
    expect(DASHBOARD_DEFAULT_STALE_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("scheduler cadence is 15 minutes (8x headroom inside the fresh window)", () => {
    expect(DASHBOARD_REFRESH_INTERVAL_MS).toBe(15 * 60 * 1000);
    // Sanity: the cadence must be strictly inside the fresh window.
    expect(DASHBOARD_REFRESH_INTERVAL_MS).toBeLessThan(DASHBOARD_DEFAULT_FRESH_MS);
  });

  it("DASHBOARD_FRESHNESS_STATES is exactly the 4 agreed states", () => {
    expect([...DASHBOARD_FRESHNESS_STATES].sort()).toEqual(
      ["fresh", "stale", "unknown", "warn"].sort(),
    );
  });
});

describe("C2 — dashboard registry", () => {
  it("starts empty after clear", () => {
    expect(listRegisteredDashboards()).toHaveLength(0);
  });

  it("registers a dashboard and returns it in the list", () => {
    registerDashboard({
      key: "test_a",
      label: "Test A",
      compute: async () => ({ value: 1 }),
    });
    const all = listRegisteredDashboards();
    expect(all).toHaveLength(1);
    expect(all[0]!.key).toBe("test_a");
    expect(all[0]!.label).toBe("Test A");
  });

  it("re-registering the same key replaces the compute function", async () => {
    registerDashboard({
      key: "test_b",
      label: "Test B v1",
      compute: async () => ({ version: 1 }),
    });
    registerDashboard({
      key: "test_b",
      label: "Test B v2",
      compute: async () => ({ version: 2 }),
    });
    const all = listRegisteredDashboards();
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe("Test B v2");
    const payload = (await all[0]!.compute()) as { version: number };
    expect(payload.version).toBe(2);
  });
});
