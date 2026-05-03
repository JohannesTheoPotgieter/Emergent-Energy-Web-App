import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../../../server/middleware/requireAdmin";

// Mock shared schema to provide ENTITY_PERMISSION_DEFAULTS
vi.mock("../../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    offset: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  },
  getDbMode: () => "postgres",
}));

import { evaluatePermissionForRole } from "../../../shared/permission-resolver";

describe("smart-import role-based authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── requireAdmin middleware ──

  it("ENGINEER receives 403 from requireAdmin (rollback guard)", async () => {
    const req = { user: { role: "ENGINEER" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("COO_ADMIN passes requireAdmin (rollback allowed)", async () => {
    const req = { user: { role: "COO_ADMIN" } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ── Permission evaluation via ENTITY_PERMISSION_DEFAULTS ──

  describe("smart_import approve permission (commit route)", () => {
    const emptyRoleRecord = { entityPermissions: null, authorityModel: null, canManageUsers: false, canManageRoles: false };

    it("ENGINEER is denied smart_import:approve (cannot commit)", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "smart_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });

    it("COO_ADMIN is allowed smart_import:approve (can commit)", () => {
      const result = evaluatePermissionForRole({
        role: "COO_ADMIN",
        entity: "smart_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("CEO_ADMIN is allowed smart_import:approve (can commit)", () => {
      const result = evaluatePermissionForRole({
        role: "CEO_ADMIN",
        entity: "smart_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("PROGRAM_FINANCE_MANAGER is denied smart_import:approve (approve is admin-only)", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "smart_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("data_import create permission", () => {
    const emptyRoleRecord = { entityPermissions: null, authorityModel: null, canManageUsers: false, canManageRoles: false };

    it("ENGINEER is denied data_import:create", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "data_import",
        action: "create",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });

    it("CFO is allowed data_import:create", () => {
      const result = evaluatePermissionForRole({
        role: "CFO",
        entity: "data_import",
        action: "create",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("PROGRAM_FINANCE_MANAGER is allowed data_import:create", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "data_import",
        action: "create",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("COO_ADMIN is allowed data_import:approve", () => {
      const result = evaluatePermissionForRole({
        role: "COO_ADMIN",
        entity: "data_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("PROGRAM_FINANCE_MANAGER is allowed data_import:approve", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "data_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("ENGINEER is denied data_import:approve", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "data_import",
        action: "approve",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });
  });

  // ── Audit logging coverage ──

  describe("import audit logging", () => {
    it("logAuditFromReq is callable with commit action shape", async () => {
      const { logAuditFromReq } = await import("../../../server/audit-logger");
      const mockReq = {
        user: { id: 1, name: "Admin", role: "COO_ADMIN" },
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        originalUrl: "/api/smart-import/42/commit",
        method: "POST",
      } as any;

      // Should not throw — we're verifying it creates the audit record shape
      expect(() => logAuditFromReq(mockReq, {
        entityType: "smart_import",
        entityId: "42",
        action: "commit",
        projectName: "Test Project",
        source: "IMPORT",
        changesJson: { counts: { planTasks: 10, revenueLines: 5 } },
      })).not.toThrow();
    });

    it("logAuditFromReq is callable with rollback action shape", async () => {
      const { logAuditFromReq } = await import("../../../server/audit-logger");
      const mockReq = {
        user: { id: 1, name: "Admin", role: "COO_ADMIN" },
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        originalUrl: "/api/smart-import/42/rollback",
        method: "POST",
      } as any;

      expect(() => logAuditFromReq(mockReq, {
        entityType: "smart_import",
        entityId: "42",
        action: "rollback",
        projectName: "Test Project",
        source: "IMPORT",
        changesJson: { previousStatus: "COMMITTED" },
      })).not.toThrow();
    });
  });
});
