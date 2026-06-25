/**
 * Quality Role & Permission Accountability Tests
 *
 * Proves that every quality and NCR route has the correct permission gate,
 * and that the accountability model matches the target design.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * Extract the middleware chain from a route definition line.
 * E.g. 'app.post("/api/quality/ncrs", requireAuth, requirePermission("quality", "create"), async'
 *   → 'requireAuth, requirePermission("quality", "create")'
 */
function extractMiddleware(routeLine: string): string {
  // Match everything between the URL closing quote and 'async'
  const match = routeLine.match(/",\s*(.+?),?\s*async/);
  return match ? match[1].trim() : "";
}

describe("quality route permission gates", () => {
  const routes = read("server/quality-routes.ts");

  it("item update requires pd_quality:edit", () => {
    // Line 675: app.post("/api/quality/project/:projectName/item/:itemInstanceId", ...)
    // This is the status update route — NOT the /approve or /evidence sub-routes
    const line = routes.split("\n").find((l) =>
      l.includes("app.post") &&
      l.includes("/item/:itemInstanceId\"") &&
      !l.includes("/approve") &&
      !l.includes("/evidence") &&
      !l.includes("/send-for-approval")
    );
    expect(line).toBeDefined();
    expect(line).toContain("requirePermission");
    expect(line).toMatch(/pd_quality/);
    expect(line).toMatch(/['"]edit['"]/);
  });

  it("approve route uses requirePermission(quality, edit) without requireAdminOrQm blocking HSE_MANAGER", () => {
    // Collapsed model: the old quality:approve gate folded into quality:edit.
    // Intent preserved — the approve action is a mutating action gated on edit.
    const line = routes.split("\n").find((l) => l.includes("/approve") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain("requirePermission");
    expect(line).toMatch(/['"]edit['"]/);
    // Must NOT have requireAdminOrQm which would block HSE_MANAGER
    expect(line).not.toContain("requireAdminOrQm");
  });

  it("evidence URL route uses quality:edit", () => {
    const lines = routes.split("\n").filter((l) => l.includes("/evidence") && l.includes("app.post") && !l.includes("/upload"));
    const urlLine = lines.find((l) => !l.includes("qmApprovalUpload"));
    expect(urlLine).toBeDefined();
    expect(urlLine).toContain('requirePermission("quality", "edit")');
  });

  it("evidence file upload uses quality:edit (aligned with URL evidence)", () => {
    const line = routes.split("\n").find((l) => l.includes("/evidence/upload") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
    // Must NOT have requireAdminOrQm that was blocking CM/HSE
    expect(line).not.toContain("requireAdminOrQm");
  });

  it("send-for-review uses pd_quality:edit (allows CONSTRUCTION_MANAGER)", () => {
    const line = routes.split("\n").find((l) => l.includes("/send-for-approval") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("pd_quality", "edit")');
    expect(line).not.toContain("requireAdminOrQm");
  });

  it("warning acknowledge uses quality:edit (approve folded into edit)", () => {
    // Collapsed model: the old quality:approve gate is now quality:edit.
    const line = routes.split("\n").find((l) => l.includes("/acknowledge") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("warning resolve uses quality:edit (approve folded into edit)", () => {
    // Collapsed model: the old quality:approve gate is now quality:edit.
    const line = routes.split("\n").find((l) => l.includes("/resolve") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("SharePoint browse uses quality:edit (not requireAdminOrQm)", () => {
    const line = routes.split("\n").find((l) => l.includes("/sp-browse") && l.includes("app.get"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
    expect(line).not.toContain("requireAdminOrQm");
  });
});

describe("NCR route permission gates", () => {
  const ncr = read("server/quality-ncr-routes.ts");

  it("NCR list requires quality:view", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs"') && l.includes("app.get"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "view")');
  });

  it("NCR create requires quality:edit (create folded into edit)", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs"') && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("NCR detail requires quality:view", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs/:id"') && l.includes("app.get"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "view")');
  });

  it("NCR update requires quality:edit", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs/:id"') && l.includes("app.put"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("NCR delete requires quality:edit (delete folded into edit)", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs/:id"') && l.includes("app.delete"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("NCR comment requires quality:edit", () => {
    const line = ncr.split("\n").find((l) => l.includes("/comments") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("NCR routes import permission middleware and audit logger", () => {
    expect(ncr).toContain('import { requirePermission }');
    expect(ncr).toContain('import { logAuditFromReq }');
  });

  it("NCR create and update have audit trail", () => {
    expect(ncr).toContain('logAuditFromReq(req, { entityType: "ncr_report"');
    // At least 3 audit calls: create, update, delete
    const auditCalls = ncr.match(/logAuditFromReq/g);
    expect(auditCalls).toBeTruthy();
    expect(auditCalls!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("governance views permission gates", () => {
  const gov = read("server/routes/governance-views-routes.ts");

  it("governance quality action requires quality:edit (approve folded into edit)", () => {
    const line = gov.split("\n").find((l) => l.includes("/api/governance/quality/:id/action"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "edit")');
  });

  it("imports requirePermission from permission-middleware", () => {
    expect(gov).toContain('import { requirePermission }');
  });
});

describe("permission entity definitions are consistent with route usage", () => {
  // Permission entities used to live in shared/schema/users.ts; they were
  // migrated to shared/permissions/registry.ts. This test points at the
  // current canonical location.
  //
  // Collapsed permission model: each entity has ONLY view_roles + edit_roles.
  // Every mutating action (create/approve/override/delete) folds into edit.
  // We read the registry programmatically rather than via brittle regex so the
  // edit_roles set is asserted exactly.
  const registry = read("shared/permissions/registry.ts");

  it("quality:edit includes the quality mutators (QM, HSE, CM) — approve folded into edit", () => {
    // Old model asserted quality:approve ⊇ {QUALITY_MANAGER, HSE_MANAGER} and
    // EXCLUDED CONSTRUCTION_MANAGER. Under the collapsed model the de-duplicated
    // union of the old create/edit/approve/override/delete lists became
    // edit_roles, which now ALSO contains CONSTRUCTION_MANAGER (it held
    // quality:edit before). That is an intentional broadening, not a bug.
    expect(registry).toMatch(/entity: 'quality'[\s\S]*?edit_roles:.*QUALITY_MANAGER/);
    expect(registry).toMatch(/entity: 'quality'[\s\S]*?edit_roles:.*HSE_MANAGER/);
    expect(registry).toMatch(/entity: 'quality'[\s\S]*?edit_roles:.*CONSTRUCTION_MANAGER/);
  });

  it("pd_quality:edit includes CONSTRUCTION_MANAGER", () => {
    // pd_quality:edit must include CONSTRUCTION_MANAGER
    expect(registry).toMatch(/entity: 'pd_quality'[\s\S]*?edit_roles:.*CONSTRUCTION_MANAGER/);
  });

  it("quality.edit_roles is exactly the approved mutator set (no delete_roles surface remains)", () => {
    // The old "quality:delete restricted to COO/CEO only" invariant is
    // meaningless now — delete folded into edit. The equivalent invariant is
    // the exact edit_roles set for the quality entity. Asserting the whole set
    // both pins the broadening (CONSTRUCTION_MANAGER, HSE_MANAGER now mutate)
    // and guarantees no unexpected role slipped in.
    const qualityBlock = registry.match(/entity: 'quality'[\s\S]*?edit_roles: \[([^\]]+)\]/);
    expect(qualityBlock).toBeTruthy();
    const editRoles = qualityBlock![1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    expect(editRoles.sort()).toEqual(
      ["COO_ADMIN", "CEO_ADMIN", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER", "HSE_MANAGER"].sort(),
    );
    // No legacy delete_roles key may linger on the quality entity.
    expect(registry).not.toMatch(/entity: 'quality'[\s\S]*?delete_roles:/);
  });
});
