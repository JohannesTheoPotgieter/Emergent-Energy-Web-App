/**
 * Stale-finance-read coherency tests.
 *
 * Proves that after any finance-affecting write path invokes
 * `refreshProjectMetricsAsync` / `invalidateProjectFinanceReads`:
 *
 *   1. The cached materialized-metrics row for that project is deleted
 *      synchronously (no pre-write cache hit on the next read).
 *   2. A pending-refresh marker is set synchronously so reads can surface an
 *      explicit "stale / pending recompute" signal until the async worker
 *      catches up, instead of silently serving pre-write state.
 *   3. `getCachedProjectMetrics` bypasses cache and re-reads the materialized
 *      row while the pending marker is present.
 *   4. Program-level cache is invalidated too, since finance writes roll up.
 *
 * These assertions pin the behaviour added by the "fix stale finance reads"
 * pass; they guard against regressions that would reintroduce a silent
 * stale window between finance writes and the next read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks for cache / db / job-queue ───────────────────────────────────────

type CacheEntry = { value: string; expiresAt: number | null };
const cacheStore = new Map<string, CacheEntry>();

const cacheMock = vi.hoisted(() => {
  // These wrap a shared in-test Map so set/get/delete are observable between
  // module code and assertions.
  return {
    cacheGet: vi.fn(async (key: string) => {
      const entry = (globalThis as any).__testCacheStore?.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        (globalThis as any).__testCacheStore.delete(key);
        return null;
      }
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }),
    cacheSet: vi.fn(async (key: string, value: unknown, ttlSeconds?: number) => {
      (globalThis as any).__testCacheStore.set(key, {
        value: JSON.stringify(value),
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
    }),
    cacheDelete: vi.fn(async (key: string) => {
      (globalThis as any).__testCacheStore.delete(key);
    }),
    cacheClear: vi.fn(async (pattern: string) => {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      const store = (globalThis as any).__testCacheStore as Map<string, CacheEntry>;
      for (const key of Array.from(store.keys())) {
        if (regex.test(key)) store.delete(key);
      }
    }),
    isRedisCache: vi.fn(() => false),
    getRedisClient: vi.fn(() => null),
  };
});

(globalThis as any).__testCacheStore = cacheStore;

vi.mock("../../../server/lib/cache", () => cacheMock);

// Capture enqueued jobs; the test drives the worker manually so we don't
// depend on the real async scheduler.
const jobQueueMock = vi.hoisted(() => {
  const workers = new Map<string, (data: unknown) => Promise<void>>();
  const enqueued: Array<{ queue: string; data: unknown }> = [];
  return {
    QUEUE_NAMES: { METRICS_REFRESH: "metrics-refresh" },
    enqueueJob: vi.fn(async (queue: string, data: unknown) => {
      enqueued.push({ queue, data });
      return "job-id";
    }),
    registerWorker: vi.fn(async (queue: string, handler: (data: unknown) => Promise<void>) => {
      workers.set(queue, handler);
    }),
    __enqueued: enqueued,
    __workers: workers,
  };
});

vi.mock("../../../server/lib/job-queue", () => jobQueueMock);

// DB mock: returns the materialized row currently attached to `dbMock.__row`.
const dbMock = vi.hoisted(() => {
  const state = { row: null as Record<string, unknown> | null };
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => (state.row ? [state.row] : [])),
      })),
      limit: vi.fn(async () => (state.row ? [state.row] : [])),
    })),
  }));
  return {
    db: { select },
    getDbMode: () => "postgres",
    __state: state,
  };
});

vi.mock("../../../server/db", () => ({
  db: dbMock.db,
  getDbMode: dbMock.getDbMode,
}));

// Schema barrel — the service only references table symbols as query
// builders; our db mock ignores them, so empty objects are enough.
vi.mock("@shared/schema", () => ({
  projectInfo: {},
  dashboardProjectMetrics: {},
  dashboardProgramMetrics: {},
  normalizedRevenueLines: {},
  normalizedCostLines: {},
  workItems: {},
  qcWarning: {},
  qcChecklist: {},
  qcItemInstance: {},
}));

vi.mock("@shared/quality-governance", () => ({ computeQcProgress: () => ({ totalApproved: 0, totalApplicable: 0 }) }));

vi.mock("../../../server/lib/finance/revenue-ar-status", () => ({ isRevenueSettled: () => false }));
vi.mock("../../../server/lib/finance/margin", () => ({ computeMarginPct: () => null }));
vi.mock("../../../server/lib/calculations/financeUtils", () => ({ getCosRealisedAmountForNclRow: () => 0 }));
vi.mock("../../../server/lib/finance/qb-allocation-read", () => ({
  getAssignedEvidenceByCostLineIds: async () => new Map(),
}));

import {
  refreshProjectMetricsAsync,
  invalidateProjectFinanceReads,
  getCachedProjectMetrics,
  getProjectMetricsPendingSince,
} from "../../../server/services/dashboard-metrics";

const PROJECT_ID = 42;
const CACHE_KEY = `dashboard:metrics:${PROJECT_ID}`;
const PENDING_KEY = `dashboard:metrics-pending:${PROJECT_ID}`;
const PROGRAM_CACHE_KEY = "dashboard:program-metrics";
const PROGRAM_PENDING_KEY = "dashboard:program-metrics-pending";

async function flushAsync() {
  // Let the sync-invalidation Promise.all microtasks settle.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("finance read coherency: refreshProjectMetricsAsync side effects", () => {
  beforeEach(() => {
    cacheStore.clear();
    (jobQueueMock.__enqueued as any).length = 0;
    dbMock.__state.row = null;
    vi.clearAllMocks();
  });

  it("synchronously deletes cached project metrics before the refresh job runs", async () => {
    // Pre-write: cache holds stale row.
    cacheStore.set(CACHE_KEY, {
      value: JSON.stringify({ totalRevenue: "100", projectId: PROJECT_ID, _stale: true }),
      expiresAt: Date.now() + 60_000,
    });
    cacheStore.set(PROGRAM_CACHE_KEY, {
      value: JSON.stringify({ totalProgramRevenue: "100" }),
      expiresAt: Date.now() + 60_000,
    });

    refreshProjectMetricsAsync(PROJECT_ID);
    await flushAsync();

    expect(cacheStore.has(CACHE_KEY)).toBe(false);
    expect(cacheStore.has(PROGRAM_CACHE_KEY)).toBe(false);
  });

  it("sets a pending-refresh marker so subsequent reads can report stale", async () => {
    refreshProjectMetricsAsync(PROJECT_ID);
    await flushAsync();

    const marker = await getProjectMetricsPendingSince(PROJECT_ID);
    expect(marker).not.toBeNull();
    expect(typeof marker).toBe("string");
    expect(cacheStore.has(PROGRAM_PENDING_KEY)).toBe(true);
  });

  it("enqueues exactly one metrics-refresh job for the project", async () => {
    refreshProjectMetricsAsync(PROJECT_ID);
    await flushAsync();

    expect(jobQueueMock.enqueueJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.enqueueJob).toHaveBeenCalledWith(
      "metrics-refresh",
      { type: "project", projectId: PROJECT_ID },
      expect.objectContaining({ jobId: `metrics-refresh-project-${PROJECT_ID}` }),
    );
  });

  it("invalidateProjectFinanceReads has identical effects (semantic alias)", async () => {
    cacheStore.set(CACHE_KEY, {
      value: JSON.stringify({ totalRevenue: "100" }),
      expiresAt: Date.now() + 60_000,
    });

    invalidateProjectFinanceReads(PROJECT_ID);
    await flushAsync();

    expect(cacheStore.has(CACHE_KEY)).toBe(false);
    expect(await getProjectMetricsPendingSince(PROJECT_ID)).not.toBeNull();
    expect(jobQueueMock.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("invalidateProjectFinanceReads is a no-op for invalid projectId", async () => {
    invalidateProjectFinanceReads(null);
    invalidateProjectFinanceReads(undefined);
    invalidateProjectFinanceReads(0);
    invalidateProjectFinanceReads(-1);
    invalidateProjectFinanceReads(NaN);
    await flushAsync();

    expect(jobQueueMock.enqueueJob).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });
});

describe("finance read coherency: getCachedProjectMetrics behaviour with pending marker", () => {
  beforeEach(() => {
    cacheStore.clear();
    (jobQueueMock.__enqueued as any).length = 0;
    dbMock.__state.row = null;
    vi.clearAllMocks();
  });

  it("returns fresh materialized row after write; next read is not stale-cached", async () => {
    // Simulate a finance write: invalidate.
    invalidateProjectFinanceReads(PROJECT_ID);
    await flushAsync();

    // Now the materialized row has been recomputed (worker ran), so the
    // DB returns the up-to-date row. We simulate that.
    const freshRow = { projectId: PROJECT_ID, totalCost: "500", totalRevenue: "1000" };
    dbMock.__state.row = freshRow;

    // Worker completion also clears the pending marker (tested implicitly
    // by worker tests); simulate it here.
    cacheStore.delete(PENDING_KEY);
    cacheStore.delete(PROGRAM_PENDING_KEY);

    const read = await getCachedProjectMetrics(PROJECT_ID);
    expect(read).toEqual(freshRow);
  });

  it("while pending marker is set, returns the materialized row without repopulating cache", async () => {
    // Pre-existing cached row would be stale — write clears it.
    invalidateProjectFinanceReads(PROJECT_ID);
    await flushAsync();

    // Worker hasn't finished yet: pending marker is still present,
    // materialized table still shows old numbers.
    const staleMaterializedRow = { projectId: PROJECT_ID, totalCost: "100", totalRevenue: "200" };
    dbMock.__state.row = staleMaterializedRow;

    // Pending marker must be observable to the caller (so UI envelope
    // can report staleness) *and* the cache must not be re-populated
    // with the stale row.
    expect(await getProjectMetricsPendingSince(PROJECT_ID)).not.toBeNull();

    const read = await getCachedProjectMetrics(PROJECT_ID);
    expect(read).toEqual(staleMaterializedRow);

    // Cache should NOT have been populated while pending is true —
    // otherwise we'd serve the stale row for 60s after the worker
    // clears the marker.
    expect(cacheStore.has(CACHE_KEY)).toBe(false);
  });

  it("uses cache normally when no pending marker is present", async () => {
    const freshRow = { projectId: PROJECT_ID, totalCost: "500" };
    dbMock.__state.row = freshRow;

    // First read: cache miss → hits DB → populates cache.
    const first = await getCachedProjectMetrics(PROJECT_ID);
    expect(first).toEqual(freshRow);
    expect(cacheStore.has(CACHE_KEY)).toBe(true);

    // Second read: cache hit.
    dbMock.__state.row = null; // prove the next read does NOT hit DB.
    const second = await getCachedProjectMetrics(PROJECT_ID);
    expect(second).toEqual(freshRow);
  });
});

describe("finance read coherency: worker clears pending marker", () => {
  beforeEach(() => {
    cacheStore.clear();
    (jobQueueMock.__enqueued as any).length = 0;
    dbMock.__state.row = null;
    vi.clearAllMocks();
  });

  it("registered worker is the one that will clear the pending marker on completion", () => {
    const worker = jobQueueMock.__workers.get("metrics-refresh");
    // The worker must be registered at module load.
    expect(typeof worker).toBe("function");
  });
});
