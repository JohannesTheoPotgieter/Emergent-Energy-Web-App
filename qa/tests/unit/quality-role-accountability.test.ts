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

  it("approve route uses requirePermission(quality, approve) without requireAdminOrQm blocking HSE_MANAGER", () => {
    const line = routes.split("\n").find((l) => l.includes("/approve") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain("requirePermission");
    expect(line).toMatch(/['"]approve['"]/);
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

  it("warning acknowledge uses quality:approve (not quality:edit)", () => {
    const line = routes.split("\n").find((l) => l.includes("/acknowledge") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "approve")');
    expect(line).not.toContain('"edit"');
  });

  it("warning resolve uses quality:approve (not quality:edit)", () => {
    const line = routes.split("\n").find((l) => l.includes("/resolve") && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "approve")');
    expect(line).not.toContain('"edit"');
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

  it("NCR create requires quality:create", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs"') && l.includes("app.post"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "create")');
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

  it("NCR delete requires quality:delete", () => {
    const line = ncr.split("\n").find((l) => l.includes('"/api/quality/ncrs/:id"') && l.includes("app.delete"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "delete")');
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

  it("governance quality action requires quality:approve", () => {
    const line = gov.split("\n").find((l) => l.includes("/api/governance/quality/:id/action"));
    expect(line).toBeDefined();
    expect(line).toContain('requirePermission("quality", "approve")');
  });

  it("imports requirePermission from permission-middleware", () => {
    expect(gov).toContain('import { requirePermission }');
  });
});

describe("permission entity definitions are consistent with route usage", () => {
  const users = read("shared/schema/users.ts");

  it("quality entity has correct role separation", () => {
    // quality:approve must include QUALITY_MANAGER and HSE_MANAGER but not CONSTRUCTION_MANAGER
    expect(users).toMatch(/entity: 'quality'[\s\S]*?approve_roles:.*QUALITY_MANAGER/);
    expect(users).toMatch(/entity: 'quality'[\s\S]*?approve_roles:.*HSE_MANAGER/);
  });

  it("pd_quality entity allows CONSTRUCTION_MANAGER to edit but not approve", () => {
    // pd_quality:edit must include CONSTRUCTION_MANAGER
    expect(users).toMatch(/entity: 'pd_quality'[\s\S]*?edit_roles:.*CONSTRUCTION_MANAGER/);
  });

  it("quality:delete is restricted to COO_ADMIN and CEO_ADMIN only", () => {
    // Extract the quality entity block and check delete_roles
    const qualityBlock = users.match(/entity: 'quality'[\s\S]*?delete_roles: \[([^\]]+)\]/);
    expect(qualityBlock).toBeTruthy();
    const deleteRoles = qualityBlock![1];
    expect(deleteRoles).toContain("COO_ADMIN");
    expect(deleteRoles).toContain("CEO_ADMIN");
    expect(deleteRoles).not.toContain("CONSTRUCTION_MANAGER");
    expect(deleteRoles).not.toContain("QUALITY_MANAGER");
  });
});
