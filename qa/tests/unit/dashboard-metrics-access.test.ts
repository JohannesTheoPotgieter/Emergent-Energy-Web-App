import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock cache module before importing service
const cacheMock = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  isRedisCache: vi.fn(() => false),
}));

vi.mock("../../../server/lib/cache", () => cacheMock);

// Mock db and schema
const dbMock = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../server/db", () => ({
  db: dbMock,
  getDbMode: () => "postgres",
}));

vi.mock("../../../server/services/dashboard-metrics", () => ({
  refreshAllMetrics: vi.fn().mockResolvedValue({ refreshed: 5, failed: 0, failedProjectIds: [] }),
  refreshProjectMetricsAsync: vi.fn(),
}));

import {
  checkRefreshRateLimit,
  setRefreshRateLimit,
  dashboardLastRefreshService,
  dashboardRefreshService,
} from "../../../server/api/v2/services/project-v2-service";
import { requireAdmin } from "../../../server/middleware/requireAdmin";

describe("dashboard metrics access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── requireAdmin middleware ──

  it("non-admin users receive 403 from requireAdmin", () => {
    const req = { user: { role: "ENGINEER" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "admin_required" });
  });

  it("COO_ADMIN passes requireAdmin", () => {
    const req = { user: { role: "COO_ADMIN" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("CEO_ADMIN passes requireAdmin", () => {
    const req = { user: { role: "CEO_ADMIN" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ── Rate limiting ──

  it("admin users can refresh (first request allowed)", async () => {
    cacheMock.cacheGet.mockResolvedValue(null);
    const result = await checkRefreshRateLimit(1);
    expect(result.allowed).toBe(true);
  });

  it("second refresh within 5 minutes is rejected", async () => {
    cacheMock.cacheGet.mockResolvedValue(new Date().toISOString());
    const result = await checkRefreshRateLimit(1);
    expect(result.allowed).toBe(false);
  });

  it("setRefreshRateLimit stores a 300s TTL cache entry", async () => {
    await setRefreshRateLimit(42);
    expect(cacheMock.cacheSet).toHaveBeenCalledWith(
      "dashboard:refresh-limit:42",
      expect.any(String),
      300,
    );
  });

  // ── dashboardRefreshService ──

  it("admin users receive 200-shape on first refresh", async () => {
    const result = await dashboardRefreshService();
    expect(result).toEqual({
      refreshed: 5,
      failed: 0,
      failedProjectIds: undefined,
      timestamp: expect.any(String),
    });
  });

  // ── GET /last-refresh shape ──

  it("GET /last-refresh returns the expected shape for admin", async () => {
    cacheMock.cacheGet.mockResolvedValue(null);
    dbMock.limit.mockResolvedValue([{ lastRefreshedAt: new Date("2025-01-01T00:00:00Z") }]);

    const result = await dashboardLastRefreshService(1, "COO_ADMIN");

    expect(result).toEqual({
      lastRefreshedAt: "2025-01-01T00:00:00.000Z",
      nextAutoRefreshAt: null,
      manualRefreshAllowed: true,
    });
  });

  it("GET /last-refresh returns manualRefreshAllowed=false for non-admin", async () => {
    dbMock.limit.mockResolvedValue([{ lastRefreshedAt: new Date("2025-01-01T00:00:00Z") }]);

    const result = await dashboardLastRefreshService(1, "ENGINEER");

    expect(result).toEqual({
      lastRefreshedAt: "2025-01-01T00:00:00.000Z",
      nextAutoRefreshAt: null,
      manualRefreshAllowed: false,
    });
  });

  it("GET /last-refresh returns null timestamps when no program metrics exist", async () => {
    cacheMock.cacheGet.mockResolvedValue(null);
    dbMock.limit.mockResolvedValue([]);

    const result = await dashboardLastRefreshService(1, "COO_ADMIN");

    expect(result).toEqual({
      lastRefreshedAt: null,
      nextAutoRefreshAt: null,
      manualRefreshAllowed: true,
    });
  });

  it("GET /last-refresh returns manualRefreshAllowed=false for admin within rate limit", async () => {
    cacheMock.cacheGet.mockResolvedValue(new Date().toISOString());
    dbMock.limit.mockResolvedValue([{ lastRefreshedAt: new Date() }]);

    const result = await dashboardLastRefreshService(1, "CEO_ADMIN");

    expect(result.manualRefreshAllowed).toBe(false);
  });
});
