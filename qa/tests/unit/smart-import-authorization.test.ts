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

  // Collapsed model: the commit route is now gated on smart_import:edit
  // (was :approve). `edit` is the de-duplicated union of the old
  // create/edit/approve/override/delete role lists. Assertions below were
  // retargeted from :approve → :edit and recomputed against
  // smart_import.edit_roles = [COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER,
  // PROGRAM_FINANCE_MANAGER].
  describe("smart_import edit permission (commit route)", () => {
    const emptyRoleRecord = { entityPermissions: null, authorityModel: null, canManageUsers: false, canManageRoles: false };

    it("ENGINEER is denied smart_import:edit (cannot commit)", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "smart_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });

    it("COO_ADMIN is allowed smart_import:edit (can commit)", () => {
      const result = evaluatePermissionForRole({
        role: "COO_ADMIN",
        entity: "smart_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("CEO_ADMIN is allowed smart_import:edit (can commit)", () => {
      const result = evaluatePermissionForRole({
        role: "CEO_ADMIN",
        entity: "smart_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    // SECURITY CHANGE (flagged): under the old 6-action model PROGRAM_FINANCE_MANAGER
    // was NOT in smart_import.approve_roles, so it was denied commit. In the
    // collapsed model smart_import.edit_roles is the union of the old lists and
    // DOES include PROGRAM_FINANCE_MANAGER (it was in the old edit_roles), so it
    // is now ALLOWED to commit. Expectation flipped to match the registry union.
    it("PROGRAM_FINANCE_MANAGER is allowed smart_import:edit (now in edit_roles union)", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "smart_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });
  });

  // Collapsed model: data import mutating access is now gated on
  // data_import:edit (was :create). Recomputed against
  // data_import.edit_roles = [COO_ADMIN, CEO_ADMIN, CFO, PROGRAM_FINANCE_MANAGER].
  describe("data_import edit permission", () => {
    const emptyRoleRecord = { entityPermissions: null, authorityModel: null, canManageUsers: false, canManageRoles: false };

    it("ENGINEER is denied data_import:edit", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "data_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(false);
    });

    it("CFO is allowed data_import:edit", () => {
      const result = evaluatePermissionForRole({
        role: "CFO",
        entity: "data_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("PROGRAM_FINANCE_MANAGER is allowed data_import:edit", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "data_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    // Former data_import:approve cases — approve folds into edit. COO_ADMIN /
    // PROGRAM_FINANCE_MANAGER remain allowed (both in edit_roles); ENGINEER
    // remains denied.
    it("COO_ADMIN is allowed data_import:edit (approve folds into edit)", () => {
      const result = evaluatePermissionForRole({
        role: "COO_ADMIN",
        entity: "data_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("PROGRAM_FINANCE_MANAGER is allowed data_import:edit (approve folds into edit)", () => {
      const result = evaluatePermissionForRole({
        role: "PROGRAM_FINANCE_MANAGER",
        entity: "data_import",
        action: "edit",
        roleRecord: emptyRoleRecord,
      });
      expect(result.allowed).toBe(true);
    });

    it("ENGINEER is denied data_import:edit (approve folds into edit)", () => {
      const result = evaluatePermissionForRole({
        role: "ENGINEER",
        entity: "data_import",
        action: "edit",
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
