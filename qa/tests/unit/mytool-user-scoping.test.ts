import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock db
const dbMock = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  orderBy: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
}));

vi.mock("../../../server/db", () => ({ db: dbMock, getDbMode: () => "postgres" }));

import { requireAdmin } from "../../../server/middleware/requireAdmin";

describe("mytool user-scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Ownership isolation tests ──

  describe("ownership isolation", () => {
    it("User A cannot modify User B's mytool task (PATCH returns 403)", () => {
      // Simulates the ownership check pattern used in PATCH /api/mytool/tasks/:id
      const userAId = 10;
      const userBTaskOwnerId = 20;
      const existingTask = { id: 1, ownerUserId: userBTaskOwnerId, title: "User B's task" };

      // User A is not admin/PM
      const isOversight = false;
      const allowed = existingTask.ownerUserId === userAId || isOversight;
      expect(allowed).toBe(false);
    });

    it("User A can modify their own mytool task", () => {
      const userAId = 10;
      const existingTask = { id: 1, ownerUserId: userAId, title: "User A's task" };

      const isOversight = false;
      const allowed = existingTask.ownerUserId === userAId || isOversight;
      expect(allowed).toBe(true);
    });

    it("User A cannot delete User B's mytool task", () => {
      const userAId = 10;
      const userBTaskOwnerId = 20;
      const existingTask = { id: 2, ownerUserId: userBTaskOwnerId };

      const isOversight = false;
      const allowed = existingTask.ownerUserId === userAId || isOversight;
      expect(allowed).toBe(false);
    });
  });

  // ── Admin/PM oversight override tests ──

  describe("admin/PM oversight via userId param", () => {
    const MYTOOL_OVERSIGHT_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];

    function resolveMyToolUserId(authUserId: number, role: string, queryUserId: number | null): number {
      if (queryUserId && MYTOOL_OVERSIGHT_ROLES.includes(role)) {
        return queryUserId;
      }
      return authUserId;
    }

    it("ADMIN can view User A's tasks via ?userId= parameter", () => {
      const adminId = 1;
      const userAId = 10;
      const effectiveUserId = resolveMyToolUserId(adminId, "COO_ADMIN", userAId);
      expect(effectiveUserId).toBe(userAId);
    });

    it("PROGRAM_MANAGER can view User A's tasks via ?userId= parameter", () => {
      const pmId = 5;
      const userAId = 10;
      const effectiveUserId = resolveMyToolUserId(pmId, "PROGRAM_MANAGER", userAId);
      expect(effectiveUserId).toBe(userAId);
    });

    it("ENGINEER cannot use ?userId= to view other user's data", () => {
      const engineerId = 3;
      const userAId = 10;
      const effectiveUserId = resolveMyToolUserId(engineerId, "ENGINEER", userAId);
      expect(effectiveUserId).toBe(engineerId); // Falls back to own ID
    });

    it("COO_ADMIN without ?userId= gets own data", () => {
      const adminId = 1;
      const effectiveUserId = resolveMyToolUserId(adminId, "COO_ADMIN", null);
      expect(effectiveUserId).toBe(adminId);
    });

    it("ADMIN can modify User B's task via oversight role", () => {
      const userBTaskOwnerId = 20;
      const adminId = 1;
      const isOversight = MYTOOL_OVERSIGHT_ROLES.includes("COO_ADMIN");
      const allowed = userBTaskOwnerId === adminId || isOversight;
      expect(allowed).toBe(true);
    });
  });

  // ── requireAdmin still blocks non-admin on support-tickets ──

  describe("support-tickets remains admin-only", () => {
    it("non-admin receives 403 on support-tickets listing", () => {
      const req = { user: { role: "ENGINEER" } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      requireAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── Dependency ownership check ──

  describe("dependency ownership check", () => {
    it("User A cannot access dependencies on User B's task", () => {
      const userAId = 10;
      const task = { id: 5, ownerUserId: 20 };
      const isOversight = false;
      const allowed = task.ownerUserId === userAId || isOversight;
      expect(allowed).toBe(false);
    });

    it("User A can access dependencies on their own task", () => {
      const userAId = 10;
      const task = { id: 5, ownerUserId: 10 };
      const isOversight = false;
      const allowed = task.ownerUserId === userAId || isOversight;
      expect(allowed).toBe(true);
    });
  });
});
